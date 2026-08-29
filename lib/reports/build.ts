import type { SupabaseClient } from '@supabase/supabase-js'
import { pageModule } from '../../components/pages/registry'
import { createSnapshot } from '../snapshots'
import { artifactFilename, logExport, signedArtifactUrl, storeArtifact } from '../artifacts'
import { renderArtifact } from '../render/render'
import { figuresFor, mergeFigures } from './figures'
import { generateCover } from './cover-model'
import { methodOf, type ReportRow, type ReportSection, type ReportSnapshotData, type SectionData } from './types'

/**
 * Building a report (Stage 2): run every section's page loader with the
 * section's own params (the session's RLS client, as /api/export — the tenant
 * never comes from a body), compute the figures, write the cover, and freeze
 * the lot into ONE snapshot of kind 'report'. From there it is an ordinary
 * snapshot: /render prints it, Storage keeps the PDF, erasure stales it, a
 * share link points at it.
 */

export interface LoadedSections {
  sections: SectionData[]
  /** Sections that produced nothing (a page before its first update, a key
   *  nobody knows) — reported to the operator, not silently dropped. */
  skipped: { section: ReportSection; reason: string }[]
}

export async function loadReportSections(supabase: unknown, clientId: string, report: Pick<ReportRow, 'sections'>): Promise<LoadedSections> {
  // One loader call per distinct (page, params, variant); two sections that
  // show the same page with the same selection share a load.
  const byKey = new Map<string, Promise<unknown>>()
  const loadFor = (s: ReportSection) => {
    const key = `${s.page}|${s.variant ?? 'default'}|${JSON.stringify(Object.entries(s.params).sort())}`
    let p = byKey.get(key)
    if (!p) {
      const mod = pageModule(s.page)
      p = mod ? mod.load({ supabase, clientId, params: s.params, variant: s.variant ?? 'default' }) : Promise.resolve(null)
      byKey.set(key, p)
    }
    return p
  }
  const loaded = await Promise.all(report.sections.map((s) => loadFor(s).catch((e) => ({ __error: String(e?.message ?? e) }))))
  const out: LoadedSections = { sections: [], skipped: [] }
  report.sections.forEach((section, i) => {
    const mod = pageModule(section.page)
    const data = loaded[i] as unknown
    if (!mod) { out.skipped.push({ section, reason: 'That page cannot be included.' }); return }
    if (data && typeof data === 'object' && '__error' in (data as object)) { out.skipped.push({ section, reason: `Could not load this page: ${(data as { __error: string }).__error}` }); return }
    if (!data) { out.skipped.push({ section, reason: 'Nothing to show yet — this page has no update behind it.' }); return }
    // A key the catalogue does not know is dropped, not fatal (a renamed tile
    // degrades a template rather than breaking it).
    const keys = section.keys?.filter((k) => Boolean(mod.renderables[k]))
    if (section.keys && (!keys || keys.length === 0)) { out.skipped.push({ section, reason: 'None of the tiles named here exist any more.' }); return }
    out.sections.push({
      section: keys ? { ...section, keys } : section,
      title: mod.snapshotTitle(data),
      context: mod.printContext ? mod.printContext(data) : mod.snapshotTitle(data),
      data,
    })
  })
  return out
}

export interface SnapshotReportResult {
  snapshotId: string
  title: string
  data: ReportSnapshotData
  skipped: LoadedSections['skipped']
  evidenceIds: string[]
}

/** Load, compose the cover, freeze. No rendering — scripts/render-page.ts and
 *  the build route both start here. */
export async function snapshotReport(args: {
  admin: SupabaseClient
  supabase: unknown
  clientId: string
  userId: string | null
  report: ReportRow
  company: string
}): Promise<SnapshotReportResult> {
  const { sections, skipped } = await loadReportSections(args.supabase, args.clientId, args.report)
  if (!sections.length) throw new BuildEmptyError(skipped[0]?.reason ?? 'Nothing to build yet — your first update has not landed.')

  const figures = mergeFigures(sections.map((s) => figuresFor(s.section.page, s.data)))
  const first = methodOf(sections[0].data)
  const company = first?.company || args.company
  const period = first?.period || 'This update'
  const runId = (sections.map((s) => (s.data as { runId?: unknown }).runId).find((r) => typeof r === 'string') as string | undefined) ?? null
  const title = args.report.cover.title?.trim() || args.report.title

  const cover = await generateCover({
    admin: args.admin,
    clientId: args.clientId,
    runId,
    register: args.report.cover.register ?? args.report.audience,
    title,
    company,
    period,
    sectionTitles: sections.map((s) => s.title),
    brief: briefOf(sections),
    figures,
  })

  const data: ReportSnapshotData = {
    version: 1,
    reportId: args.report.id,
    title,
    audience: args.report.audience,
    company,
    period,
    cover,
    figures,
    sections,
  }
  const snap = await createSnapshot(args.admin, {
    clientId: args.clientId,
    userId: args.userId,
    kind: 'report',
    ref: { reportId: args.report.id, params: {} },
    title: `${title} · ${company}`,
    runId,
    data,
    reportId: args.report.id,
  })
  return { snapshotId: snap.id, title: `${title} · ${company}`, data, skipped, evidenceIds: snap.evidenceIds }
}

/** The executive brief, if the dashboard is in the report: its headline and
 *  resolved beats, model prose the pipeline already validated. */
function briefOf(sections: SectionData[]): { headline: string; beats: string[] } | null {
  for (const s of sections) {
    if (s.section.page !== 'dashboard') continue
    const hero = (s.data as { hero?: { headline?: string; beats?: { before: string; figure: string; after: string }[]; show?: boolean } }).hero
    if (!hero?.headline) return null
    return { headline: hero.headline, beats: (hero.beats ?? []).map((b) => `${b.before}${b.figure}${b.after}`.trim()) }
  }
  return null
}

export class BuildEmptyError extends Error {}

export async function buildReport(args: {
  admin: SupabaseClient
  supabase: unknown
  clientId: string
  userId: string | null
  report: ReportRow
  company: string
  baseUrl: string
}): Promise<{ snapshotId: string; artifactId: string; url: string; ms: number; bytes: number; skipped: LoadedSections['skipped'] }> {
  const snap = await snapshotReport(args)
  let artifact
  let ms = 0
  try {
    const rendered = await renderArtifact({ baseUrl: args.baseUrl, snapshotId: snap.snapshotId, format: 'pdf' })
    ms = rendered.ms
    artifact = await storeArtifact(args.admin, { clientId: args.clientId, snapshotId: snap.snapshotId, format: 'pdf', tileKey: null, buffer: rendered.buffer, renderMs: ms })
  } catch (e) {
    await args.admin.from('report_snapshots').delete().eq('id', snap.snapshotId)
    throw e
  }
  await logExport(args.admin, { clientId: args.clientId, userId: args.userId, snapshotId: snap.snapshotId, artifactId: artifact.id, action: 'export', kind: 'report', format: 'pdf', page: null, tileKey: null })
  await args.admin
    .from('reports')
    .update({ status: 'built', latest_snapshot_id: snap.snapshotId, updated_at: new Date().toISOString() })
    .eq('id', args.report.id)
    .eq('client_id', args.clientId)
  const url = await signedArtifactUrl(args.admin, artifact, artifactFilename(snap.title, artifact))
  return { snapshotId: snap.snapshotId, artifactId: artifact.id, url, ms, bytes: artifact.bytes, skipped: snap.skipped }
}
