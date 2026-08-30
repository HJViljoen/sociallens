import type { SupabaseClient } from '@supabase/supabase-js'
import { DOCUMENT_BUILD_BUDGET_USD, DOCUMENT_QUESTIONS_MAX } from '../../config'
import { createSnapshot } from '../../snapshots'
import { collectQuoteRefs, freezeQuotes, resolveQuotes } from '../../renderables/quotes-freeze'
import { fetchQuoteTextsByRefs } from '../../quotes'
import type { ReportRow } from '../types'
import { finishBuild } from '../build'
import { documentTemplate, type DocumentTemplate } from './templates'
import { documentSettings, isDocumentData, type DocumentSettings } from './types'
import { loadSignals } from './signals'
import { composeQuestions, type ResearchQuestion } from './questions'
import { BuildBlockedError, runResearch, type ResearchAnswer } from './research'
import { allowedTokens, composeDocument, documentFigures, thinWeek } from './compose'
import { generateDocument, DOCUMENT_WRITER_MODEL, WriteFailedError } from './write-model'
import { DOCUMENT_PROMPT_VERSION, type PreviousBrief, type WriterOutput } from './write'
import { checkDocument, type FindingVerdict } from './check'
import { completeBuild, failBuild, latestRunId, loadBuild, setBuildCost, setBuildStatus } from './builds'

/**
 * A document build as STEPS (T7, 2026-08-31): research → write → check →
 * freeze → render. Each step is a plain function, JSON in and JSON out, that
 * moves the build row's status on entry and adds its own model spend, so the
 * Inngest function (inngest/functions/build-document.ts) can run one per
 * `step.run` and the script can run them in process, the same code either
 * way. Signals are reloaded per step (≈ 7 s, deterministic for the pinned
 * run) rather than passed: they carry a closure and the themes' embeddings,
 * neither of which belongs in a step's memoised output. Rendering is a
 * route's job (finishBuild); no step launches Chromium.
 */

export class DocumentBuildError extends Error {}

export interface BuildContext {
  /** Null when there is no build row (the in-process script path). */
  buildId: string | null
  clientId: string
  userId: string | null
  runId: string | null
  report: ReportRow
  template: DocumentTemplate
  settings: DocumentSettings
  company: string
}

export interface ResearchOut { questions: ResearchQuestion[]; answers: ResearchAnswer[]; costUsd: number; stoppedForBudget: boolean; timings: Record<string, number> }
export interface WriteOut { written: WriterOutput; previous: PreviousBrief | null; costUsd: number; timings: Record<string, number> }
export interface CheckOut { written: WriterOutput; verdicts: FindingVerdict[]; dropped: { headline: string; reason: string }[]; flagged: boolean; costUsd: number; timings: Record<string, number> }
export interface FreezeOut { snapshotId: string; title: string; evidenceIds: string[]; costUsd: number }
export interface RenderOut { artifactId: string; bytes: number; ms: number; url: string }

export function contextFor(args: { clientId: string; userId: string | null; report: ReportRow; company: string; runId?: string | null; buildId?: string | null }): BuildContext {
  const template = documentTemplate(args.report.template_key)
  if (!template) throw new DocumentBuildError(`Not a document template: ${args.report.template_key ?? 'none'}`)
  return {
    buildId: args.buildId ?? null,
    clientId: args.clientId,
    userId: args.userId,
    runId: args.runId ?? null,
    report: args.report,
    template,
    settings: documentSettings(args.report.settings),
    company: args.company,
  }
}

/** The context of a build row: its report, tenant, run and company. */
export async function buildContext(admin: SupabaseClient, buildId: string): Promise<BuildContext> {
  const build = await loadBuild(admin, buildId)
  if (!build) throw new DocumentBuildError(`No such build: ${buildId}`)
  if (!build.report_id) throw new DocumentBuildError('The report of this build is gone.')
  const [{ data: report }, { data: client }] = await Promise.all([
    admin.from('reports').select('*').eq('id', build.report_id).eq('client_id', build.client_id).maybeSingle(),
    admin.from('clients').select('company_name').eq('id', build.client_id).maybeSingle(),
  ])
  if (!report) throw new DocumentBuildError('The report of this build is gone.')
  if ((report as ReportRow).kind !== 'document') throw new DocumentBuildError('Not a document report.')
  return contextFor({
    clientId: build.client_id,
    userId: build.requested_by,
    report: report as ReportRow,
    company: (client?.company_name as string | undefined) ?? '',
    runId: build.run_id,
    buildId: build.id,
  })
}

const mark = async (admin: SupabaseClient, ctx: BuildContext, status: 'researching' | 'writing' | 'checking' | 'rendering', patch?: Parameters<typeof setBuildStatus>[3]) => {
  if (ctx.buildId) await setBuildStatus(admin, ctx.buildId, status, patch)
}
/** The build's spend so far, written as an absolute number so a retried
 *  step cannot count itself twice. */
const spend = async (admin: SupabaseClient, ctx: BuildContext, totalUsd: number) => {
  if (ctx.buildId) await setBuildCost(admin, ctx.buildId, totalUsd)
}
const signalsOf = (admin: SupabaseClient, ctx: BuildContext) => loadSignals(admin, { clientId: ctx.clientId, runId: ctx.runId, settings: ctx.settings })

export async function researchStep(admin: SupabaseClient, ctx: BuildContext): Promise<ResearchOut> {
  await mark(admin, ctx, 'researching')
  const timings: Record<string, number> = {}
  let t0 = Date.now()
  const signals = await signalsOf(admin, ctx)
  timings.signals = Date.now() - t0
  const questions = composeQuestions(ctx.template, signals, ctx.settings, DOCUMENT_QUESTIONS_MAX)
  t0 = Date.now()
  const research = await runResearch(admin, { clientId: ctx.clientId, companyName: signals.company, runId: signals.runId, questions, budgetUsd: DOCUMENT_BUILD_BUDGET_USD })
  timings.research = Date.now() - t0
  await spend(admin, ctx, research.costUsd)
  // The step's output is memoised by Inngest, so no comment's words may be in
  // it (AGENTS.md): quotes leave as refs with empty text; freezeStep resolves
  // them again for the picker.
  const answers = freezeQuotes(research.answers).data as ResearchAnswer[]
  return { questions, answers, costUsd: research.costUsd, stoppedForBudget: research.stoppedForBudget, timings }
}

export async function writeStep(admin: SupabaseClient, ctx: BuildContext, r: Pick<ResearchOut, 'answers' | 'costUsd'>): Promise<WriteOut> {
  await mark(admin, ctx, 'writing')
  const signals = await signalsOf(admin, ctx)
  const figures = documentFigures(signals, r.answers)
  const period = periodOf(signals.runDate)
  const previous = await previousBrief(admin, ctx.report)
  const t0 = Date.now()
  const written = await generateDocument(admin, {
    clientId: ctx.clientId, runId: signals.runId,
    template: ctx.template, settings: ctx.settings, company: signals.company, period, reader: ctx.report.cover?.reader ?? null,
    figures, signals, answers: r.answers, previous, thin: thinWeek(signals), allow: allowedTokens(signals, r.answers),
  })
  await spend(admin, ctx, r.costUsd + written.costUsd)
  return { written: written.written, previous, costUsd: written.costUsd, timings: { write: Date.now() - t0 } }
}

export async function checkStep(admin: SupabaseClient, ctx: BuildContext, w: Pick<WriteOut, 'written'>, priorCostUsd = 0): Promise<CheckOut> {
  await mark(admin, ctx, 'checking')
  const runId = ctx.runId ?? (await latestRunId(admin, ctx.clientId))
  if (!runId) throw new DocumentBuildError('No finished run to check against.')
  const t0 = Date.now()
  const out = await checkDocument(admin, { clientId: ctx.clientId, runId, companyName: ctx.company, written: w.written })
  await spend(admin, ctx, priorCostUsd + out.costUsd)
  if (out.flagged) await mark(admin, ctx, 'checking', { needs_review: true })
  return { written: out.written, verdicts: out.verdicts, dropped: out.dropped, flagged: out.flagged, costUsd: out.costUsd, timings: { check: Date.now() - t0 } }
}

export async function freezeStep(
  admin: SupabaseClient,
  ctx: BuildContext,
  args: { answers: ResearchAnswer[]; written: WriterOutput; check: Pick<CheckOut, 'verdicts' | 'dropped'> | null; costUsd: number; timings: Record<string, number> },
): Promise<FreezeOut> {
  // A retried step must not freeze twice: the row already names its snapshot.
  if (ctx.buildId) {
    const row = await loadBuild(admin, ctx.buildId)
    if (row?.snapshot_id) {
      const { data: snap } = await admin.from('report_snapshots').select('id, title, evidence_ids').eq('id', row.snapshot_id).maybeSingle()
      if (snap) return { snapshotId: snap.id as string, title: (snap.title as string) ?? '', evidenceIds: (snap.evidence_ids as string[]) ?? [], costUsd: args.costUsd }
    }
  }
  // The quote picker judges words (readsAsHeroQuote); the step boundary
  // stripped them, so resolve the refs once, in memory, never stored.
  const refs = collectQuoteRefs(args.answers)
  const texts = refs.length ? await fetchQuoteTextsByRefs(admin, refs) : new Map<string, string>()
  const answers = resolveQuotes(args.answers, texts) as ResearchAnswer[]
  const signals = await signalsOf(admin, ctx)
  const figures = documentFigures(signals, answers)
  const period = periodOf(signals.runDate)
  const title = ctx.report.cover?.title?.trim() || ctx.report.title || ctx.template.name
  const check = args.check
    ? {
        verdicts: Object.fromEntries(args.check.verdicts.filter((v) => v.verdict !== 'contradicts').map((v) => [v.headline, v.verdict as 'echoes' | 'silent'])),
        dropped: args.check.dropped,
      }
    : null
  const { data, workings } = composeDocument({
    template: ctx.template, settings: ctx.settings, reportId: ctx.report.id, title, period, signals, answers, written: args.written, figures,
    model: DOCUMENT_WRITER_MODEL, promptVersion: DOCUMENT_PROMPT_VERSION, costUsd: args.costUsd, timings: args.timings, check,
  })
  const fullTitle = `${title} · ${signals.company}`
  const snap = await createSnapshot(admin, {
    clientId: ctx.clientId,
    userId: ctx.userId,
    kind: 'report',
    ref: { reportId: ctx.report.id || undefined, params: {} },
    title: fullTitle,
    runId: signals.runId,
    data,
    workings,
    reportId: ctx.report.id || null,
  })
  if (ctx.buildId) await setBuildStatus(admin, ctx.buildId, 'checking', { snapshot_id: snap.id })
  return { snapshotId: snap.id, title: fullTitle, evidenceIds: snap.evidenceIds, costUsd: args.costUsd }
}

/** The render, in a route or a script, never in a step. */
export async function renderStep(admin: SupabaseClient, ctx: BuildContext, f: Pick<FreezeOut, 'snapshotId' | 'title'>, baseUrl: string): Promise<RenderOut> {
  if (ctx.buildId) {
    const row = await loadBuild(admin, ctx.buildId)
    if (row?.status === 'failed') throw new DocumentBuildError('This build was given up on; a newer one may be running.')
    if (row?.status === 'done' && row.artifact_id) {
      const { data: art } = await admin.from('artifacts').select('id, bytes').eq('id', row.artifact_id).maybeSingle()
      if (art) return { artifactId: art.id as string, bytes: (art.bytes as number) ?? 0, ms: 0, url: '' }
    }
  }
  await mark(admin, ctx, 'rendering')
  const out = await finishBuild(admin, { clientId: ctx.clientId, userId: ctx.userId, reportId: ctx.report.id, snapshotId: f.snapshotId, title: f.title, baseUrl })
  if (ctx.buildId) await completeBuild(admin, ctx.buildId, { artifact_id: out.artifact.id, snapshot_id: f.snapshotId })
  return { artifactId: out.artifact.id, bytes: out.artifact.bytes, ms: out.ms, url: out.url }
}

/** All the steps, in process (the script; a tenant without Inngest). Marks
 *  the row failed on any throw and rethrows. */
export async function runBuildInProcess(
  admin: SupabaseClient,
  ctx: BuildContext,
  opts: { baseUrl: string; check?: boolean; log?: (line: string) => void },
): Promise<{ research: ResearchOut; write: WriteOut; check: CheckOut | null; freeze: FreezeOut; render: RenderOut }> {
  const log = opts.log ?? (() => {})
  try {
    const research = await researchStep(admin, ctx)
    log(`research: ${research.answers.length} answers · $${research.costUsd.toFixed(3)} · ${research.timings.research} ms`)
    const write = await writeStep(admin, ctx, research)
    log(`write: ${write.written.findings.length} findings · $${write.costUsd.toFixed(3)} · ${write.timings.write} ms`)
    const check = opts.check === false ? null : await checkStep(admin, ctx, write, research.costUsd + write.costUsd)
    if (check) log(`check: ${check.verdicts.map((v) => v.verdict).join(', ') || 'nothing to check'} · dropped ${check.dropped.length} · $${check.costUsd.toFixed(3)} · ${check.timings.check} ms`)
    const costUsd = research.costUsd + write.costUsd + (check?.costUsd ?? 0)
    const timings = { ...research.timings, ...write.timings, ...(check?.timings ?? {}) }
    const freeze = await freezeStep(admin, ctx, { answers: research.answers, written: check?.written ?? write.written, check, costUsd, timings })
    log(`freeze: snapshot ${freeze.snapshotId.slice(0, 8)} · ${freeze.evidenceIds.length} evidence refs`)
    const render = await renderStep(admin, ctx, freeze, opts.baseUrl)
    log(`render: ${render.bytes} bytes · ${render.ms} ms`)
    return { research, write, check, freeze, render }
  } catch (e) {
    if (ctx.buildId) await failBuild(admin, ctx.buildId, plainBuildMessage(e)).catch(() => {})
    throw e
  }
}

/** What a tenant may read about a failure: the known classes carry
 *  calibrated words; anything else stays in the logs. */
export function plainBuildMessage(e: unknown): string {
  if (e instanceof BuildBlockedError || e instanceof WriteFailedError || e instanceof DocumentBuildError) return e.message
  console.error('[documents] build failed:', e)
  return 'The build failed. Try again, or tell us if it keeps happening.'
}

/** The report's latest document build, for continuity: its summary and its
 *  finding headlines. Null on a first build or when the report has none. */
export async function previousBrief(admin: SupabaseClient, report: Pick<ReportRow, 'id' | 'client_id' | 'latest_snapshot_id'>): Promise<PreviousBrief | null> {
  // The last brief anyone SAW: reports.latest_snapshot_id is set when a build
  // printed, so a freeze that never rendered does not steer continuity.
  if (!report.id || !report.latest_snapshot_id) return null
  const { data } = await admin
    .from('report_snapshots')
    .select('data')
    .eq('id', report.latest_snapshot_id)
    .eq('client_id', report.client_id)
    .maybeSingle()
  const d = (data as { data?: unknown } | null)?.data
  if (!isDocumentData(d)) return null
  const summary = d.pages.find((p) => p.kind === 'in_short')?.blocks.find((b) => b.field === 'summary')?.text ?? ''
  const headlines = d.pages.filter((p) => p.kind === 'finding').map((p) => p.blocks.find((b) => b.field === 'headline')?.text ?? '').filter(Boolean)
  if (!summary && !headlines.length) return null
  return { summary, headlines }
}

/** "Update of 30 Aug 2026". */
export function periodOf(runDate: string): string {
  const d = new Date(runDate)
  if (Number.isNaN(d.getTime())) return 'This update'
  return `Update of ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
}
