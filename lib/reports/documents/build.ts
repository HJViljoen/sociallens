import type { SupabaseClient } from '@supabase/supabase-js'
import { DOCUMENT_BUILD_BUDGET_USD, DOCUMENT_QUESTIONS_MAX } from '../../config'
import { createSnapshot } from '../../snapshots'
import type { ReportRow } from '../types'
import { documentTemplate } from './templates'
import { documentSettings, isDocumentData, type DocumentSnapshotData, type DocumentWorkings } from './types'
import { loadSignals } from './signals'
import { composeQuestions, type ResearchQuestion } from './questions'
import { runResearch, type ResearchAnswer } from './research'
import { allowedTokens, composeDocument, documentFigures, thinWeek } from './compose'
import { generateDocument, DOCUMENT_WRITER_MODEL } from './write-model'
import { DOCUMENT_PROMPT_VERSION, type PreviousBrief } from './write'

/**
 * A document build, in process: read the update, ask, write, compose,
 * freeze. No rendering here (the route and the script render; an Inngest
 * step never does). Phases are reported to the caller so a build row can say
 * where it is.
 */

export type DocumentPhase = 'researching' | 'writing' | 'checking' | 'freezing'

export interface DocumentBuildResult {
  snapshotId: string
  title: string
  data: DocumentSnapshotData
  workings: DocumentWorkings
  questions: ResearchQuestion[]
  answers: ResearchAnswer[]
  costUsd: number
  timings: Record<string, number>
  evidenceIds: string[]
}

export class DocumentBuildError extends Error {}

export async function buildDocumentSnapshot(
  admin: SupabaseClient,
  args: { clientId: string; userId: string | null; report: ReportRow; company: string; runId?: string | null; onPhase?: (phase: DocumentPhase) => void | Promise<void> },
): Promise<DocumentBuildResult> {
  const template = documentTemplate(args.report.template_key)
  if (!template) throw new DocumentBuildError(`Not a document template: ${args.report.template_key ?? 'none'}`)
  const settings = documentSettings(args.report.settings)
  const timings: Record<string, number> = {}
  const t = (k: string, from: number) => { timings[k] = Date.now() - from }

  await args.onPhase?.('researching')
  let t0 = Date.now()
  const signals = await loadSignals(admin, { clientId: args.clientId, runId: args.runId ?? null, settings })
  t('signals', t0)
  const questions = composeQuestions(template, signals, settings, DOCUMENT_QUESTIONS_MAX)
  t0 = Date.now()
  const research = await runResearch(admin, { clientId: args.clientId, companyName: signals.company, runId: signals.runId, questions, budgetUsd: DOCUMENT_BUILD_BUDGET_USD })
  t('research', t0)

  await args.onPhase?.('writing')
  const figures = documentFigures(signals, research.answers)
  const period = periodOf(signals.runDate)
  const previous = await previousBrief(admin, args.report)
  t0 = Date.now()
  const written = await generateDocument(admin, {
    clientId: args.clientId, runId: signals.runId,
    template, settings, company: signals.company, period, reader: args.report.cover?.reader ?? null,
    figures, signals, answers: research.answers, previous, thin: thinWeek(signals), allow: allowedTokens(signals, research.answers),
  })
  t('write', t0)

  await args.onPhase?.('freezing')
  const title = args.report.cover?.title?.trim() || args.report.title || template.name
  const costUsd = research.costUsd + written.costUsd
  const { data, workings } = composeDocument({
    template, settings, reportId: args.report.id, title, period, signals, answers: research.answers, written: written.written, figures,
    model: DOCUMENT_WRITER_MODEL, promptVersion: DOCUMENT_PROMPT_VERSION, costUsd, timings,
  })
  const snap = await createSnapshot(admin, {
    clientId: args.clientId,
    userId: args.userId,
    kind: 'report',
    ref: { reportId: args.report.id || undefined, params: {} },
    title: `${title} · ${signals.company}`,
    runId: signals.runId,
    data,
    workings,
    reportId: args.report.id || null,
  })
  return { snapshotId: snap.id, title: `${title} · ${signals.company}`, data, workings, questions, answers: research.answers, costUsd, timings, evidenceIds: snap.evidenceIds }
}

/** The report's latest document build, for continuity: its summary and its
 *  finding headlines. Null on a first build or when the report has none. */
export async function previousBrief(admin: SupabaseClient, report: Pick<ReportRow, 'id' | 'latest_snapshot_id'>): Promise<PreviousBrief | null> {
  if (!report.id) return null
  const { data } = await admin
    .from('report_snapshots')
    .select('data')
    .eq('report_id', report.id)
    .order('created_at', { ascending: false })
    .limit(1)
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
