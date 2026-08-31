import Link from 'next/link'
import { canManageTenant, getSessionContext } from '@/lib/auth'
import { PageFrame, PageBar, BarPill } from '@/components/shell/page-grid'
import { PaneHeader, PaneBody, PaneEmpty, DetailHeader, DetailSection } from '@/components/shell/master-list'
import { BuildButton } from '@/components/reports/build-button'
import { DocumentBuildControl } from '@/components/documents/build-control'
import { BUILD_ACTIVE, type ReportBuildRow, type ReportKind } from '@/lib/reports/types'
import { BUILD_COLS, BUILD_PHASE_WORDS } from '@/lib/reports/documents/builds'
import { documentTemplate } from '@/lib/reports/documents/templates'
import { DeleteReport } from '@/components/reports/delete-report'
import { ShareLinks, type ShareLinkView } from '@/components/reports/share-links'
import { ScheduleForm } from '@/components/schedules/schedule-form'
import { createAdminClient } from '@/lib/supabase-admin'
import { getBaseUrl } from '@/lib/site'
import { coverPlainText } from '@/lib/reports/cover'
import { catalogueTitle } from '@/lib/reports/catalogue'
import { AUDIENCES, type CoverSpec, type CoverText, type FigureTable, type ReportSection } from '@/lib/reports/types'
import { CADENCES, type ScheduleRow } from '@/lib/schedules/types'
import { sendFailureSentence } from '@/lib/schedules/copy'
import { cn } from '@/lib/utils'

// The Studio (Heinrich, 2026-08-30): your reports down the left, the one you
// picked on the right. A report is a template of your own (pages, tiles,
// who it is written for) plus its sending (who gets it after which updates,
// PDF attached, share link inside). New report = pick a template or go
// custom. Reports (the other page) is the archive of what went out.

export const dynamic = 'force-dynamic'

const BASE = '/dashboard/studio'
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const fmtBytes = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`)

interface Report { id: string; kind: ReportKind; template_key: string | null; title: string; audience: string; cover: CoverSpec; status: 'draft' | 'built'; sections: ReportSection[]; latest_snapshot_id: string | null; updated_at: string }
interface BuildRow { id: string; title: string; created_at: string; cover: CoverText | null; figures: FigureTable | null; artifacts: { id: string; format: string; bytes: number; stale: boolean; rendered_at: string; version: number }[] }
interface SendRow { id: string; schedule_id: string | null; status: string; subject: string | null; recipients: string[]; sent_at: string | null; claimed_at: string; error: string | null; ready_at: string | null; approved_by: string | null }

const readerOf = (r: Pick<Report, 'audience' | 'cover'>) => r.cover?.reader?.trim() || AUDIENCES.find((a) => a.key === r.audience)?.label || 'General'
const pagesOf = (sections: { page: string }[]) => [...new Set(sections.map((s) => catalogueTitle(s.page)))]

export default async function StudioPage({ searchParams }: { searchParams?: Promise<{ item?: string }> }) {
  const sp = (await searchParams) ?? {}
  const { supabase, clientId, role, email } = await getSessionContext()
  const canManage = canManageTenant(role)

  const [{ data: reportData }, { data: scheduleData }, { data: sendData }, { data: runData }] = await Promise.all([
    supabase.from('reports').select('id, kind, template_key, title, audience, cover, status, sections, latest_snapshot_id, updated_at').eq('client_id', clientId).order('created_at'),
    supabase.from('report_schedules').select('*').eq('client_id', clientId),
    supabase.from('report_sends').select('id, schedule_id, status, subject, recipients, sent_at, claimed_at, error, ready_at, approved_by').eq('client_id', clientId).order('claimed_at', { ascending: false }).limit(100),
    supabase.from('pipeline_runs').select('id').eq('client_id', clientId).in('status', ['completed', 'partial']).limit(1),
  ])
  const reports = (reportData ?? []) as Report[]
  const schedules = (scheduleData ?? []) as ScheduleRow[]
  const sends = (sendData ?? []) as SendRow[]
  const sendable = (runData ?? []).length > 0
  const scheduleOf = new Map(schedules.filter((s) => s.report_id).map((s) => [s.report_id as string, s]))

  const selectedId = sp.item && reports.some((r) => r.id === sp.item) ? sp.item : reports[0]?.id ?? null
  const selected = selectedId ? reports.find((r) => r.id === selectedId) ?? null : null
  const schedule = selected ? scheduleOf.get(selected.id) ?? null : null
  const scheduleSends = schedule ? sends.filter((s) => s.schedule_id === schedule.id) : []
  const history = scheduleSends.slice(0, 6)
  // A build waiting for a person: the newest one, shown to every member.
  const readySend = scheduleSends.find((s) => s.status === 'ready') ?? null
  // Who pressed Send, for the archive line.
  const approverIds = [...new Set(history.map((s) => s.approved_by).filter(Boolean) as string[])]
  let nameOf = new Map<string, string>()
  if (approverIds.length) {
    const { data: people } = await supabase.from('users').select('id, full_name, email').in('id', approverIds)
    nameOf = new Map(((people ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [p.id, p.full_name || p.email]))
  }

  let builds: BuildRow[] = []
  let shareLinks: ShareLinkView[] = []
  // A written report's builds are its report_builds rows (phase, cost, the
  // PDF); an edit on a build's snapshot marks it. The share section takes
  // the latest finished build's snapshot.
  let docBuilds: ReportBuildRow[] = []
  let editedSnapshots = new Set<string>()
  const isDocument = selected?.kind === 'document'
  if (selected && isDocument) {
    const { data: db } = await supabase.from('report_builds').select(BUILD_COLS).eq('client_id', clientId).eq('report_id', selected.id).order('started_at', { ascending: false }).limit(12)
    docBuilds = (db ?? []) as ReportBuildRow[]
    const snapIds = docBuilds.map((b) => b.snapshot_id).filter((x): x is string => Boolean(x))
    if (snapIds.length) {
      const { data: ed } = await supabase.from('report_edits').select('snapshot_id').in('snapshot_id', snapIds)
      editedSnapshots = new Set(((ed ?? []) as { snapshot_id: string }[]).map((e) => e.snapshot_id))
    }
  }
  if (selected) {
    const { data: b } = await supabase.from('report_snapshots')
      .select('id, title, created_at, cover:data->cover, figures:data->figures, artifacts(id, format, bytes, stale, rendered_at, version)')
      .eq('client_id', clientId).eq('report_id', selected.id).order('created_at', { ascending: false }).limit(12)
    builds = (b ?? []) as unknown as BuildRow[]
    if (builds.length) {
      // The token is withheld from the workspace's own RLS reads; links are read server-side, scoped to the tenant.
      const admin = createAdminClient()
      const base = await getBaseUrl()
      const byBuild = new Map(builds.map((x) => [x.id, x.created_at]))
      const { data: l } = await admin.from('share_links')
        .select('id, snapshot_id, token, title, expires_at, password_hash, revoked_at, view_count, last_viewed_at, created_at')
        .eq('client_id', clientId).in('snapshot_id', builds.map((x) => x.id)).order('created_at', { ascending: false })
      shareLinks = ((l ?? []) as { id: string; snapshot_id: string; token: string; title: string; expires_at: string | null; password_hash: string | null; revoked_at: string | null; view_count: number; last_viewed_at: string | null; created_at: string }[])
        .map((x) => ({ id: x.id, url: `${base}/r/${x.token}`, title: x.title, createdAt: x.created_at, expiresAt: x.expires_at, revokedAt: x.revoked_at, protected: Boolean(x.password_hash), views: x.view_count, lastViewedAt: x.last_viewed_at, buildAt: byBuild.get(x.snapshot_id) ?? x.created_at }))
    }
  }

  const sendingLine = (s: ScheduleRow | null) => {
    if (!s) return 'not sent to anyone yet'
    const cadence = CADENCES.find((c) => c.key === s.cadence)?.label.toLowerCase() ?? s.cadence
    return `${s.active ? 'sends' : 'sending off'} · ${cadence} · ${s.recipients.length} ${s.recipients.length === 1 ? 'person' : 'people'}`
  }

  return (
    <PageFrame className="min-h-0 flex-1">
      <PageBar title="Studio" context="your reports, and who gets them">
        <Link href={`${BASE}/new`}><BarPill primary>New report</BarPill></Link>
      </PageBar>
      <div className="flex min-h-0 flex-1 flex-col gap-3 md:h-[calc(100dvh_-_6.75rem)] md:flex-row">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg bg-tile shadow-tile md:w-[280px] md:shrink-0">
          <PaneHeader title="Reports" meta={reports.length ? `${reports.length}` : undefined}>
            <Link href={`${BASE}/new`} aria-label="New report" className="inline-flex size-6 items-center justify-center rounded-full bg-inner text-[15px] leading-none text-secondary-foreground ring-1 ring-border hover:bg-tile">+</Link>
          </PaneHeader>
          <PaneBody>
            {reports.length ? (
              <ul className="flex flex-col">
                {reports.map((r) => (
                  <li key={r.id}>
                    <Link href={`${BASE}?item=${r.id}`} className={cn('block rounded-[4px] px-3 py-2 hover:bg-inner', r.id === selectedId && 'bg-inner')}>
                      <p className={cn('truncate text-[13px] leading-[1.3]', r.id === selectedId ? 'font-semibold' : 'font-medium')}>{r.title}</p>
                      <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">for {readerOf(r)} · {scheduleOf.get(r.id)?.active ? `sends to ${scheduleOf.get(r.id)!.recipients.length}` : r.status === 'built' ? 'built' : 'draft'}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <PaneEmpty>No reports yet. Start one from a template, or go custom.</PaneEmpty>
            )}
          </PaneBody>
        </section>

        <section className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg bg-tile shadow-tile">
          {selected ? (
            <>
              <DetailHeader eyebrow={`${isDocument ? 'Written report' : 'Report'} · written for ${readerOf(selected)}`} title={selected.title}
                meta={isDocument
                  ? `${documentTemplate(selected.template_key)?.name ?? 'written'} · written by Verbatim from the update · ${selected.status === 'built' ? 'built' : 'not built yet'} · edited ${fmtWhen(selected.updated_at)} · ${sendingLine(schedule)}`
                  : `${selected.sections.length} section${selected.sections.length === 1 ? '' : 's'} · ${pagesOf(selected.sections).join(' · ') || 'empty'} · ${selected.status === 'built' ? 'built' : 'draft'} · edited ${fmtWhen(selected.updated_at)} · ${sendingLine(schedule)}`} />
              <DetailSection>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`${BASE}/edit/${selected.id}`} className="inline-flex h-8 items-center rounded-full bg-tile px-3 text-[12px] font-medium text-secondary-foreground ring-1 ring-border hover:bg-inner">Edit</Link>
                  {isDocument
                    ? <DocumentBuildControl reportId={selected.id} inFlight={docBuilds[0] && BUILD_ACTIVE.includes(docBuilds[0].status) ? { id: docBuilds[0].id, status: docBuilds[0].status, startedAt: docBuilds[0].started_at } : null} />
                    : <BuildButton reportId={selected.id} />}
                  <DeleteReport id={selected.id} />
                </div>
              </DetailSection>
              <DetailSection label="Sending">
                <ScheduleForm
                  key={`${selected.id}:${schedule?.updated_at ?? 'none'}:${readySend?.id ?? 'none'}`}
                  reportId={selected.id}
                  reportTitle={selected.title}
                  schedule={schedule}
                  canManage={canManage}
                  userEmail={email ?? null}
                  sendable={sendable}
                  isDocument={isDocument}
                  ready={readySend ? { id: readySend.id, subject: readySend.subject, readyAt: readySend.ready_at, error: readySend.error ? sendFailureSentence(readySend.error) : null } : null}
                />
                {history.length > 0 && (
                  <ul className="mt-4 flex flex-col gap-1.5 border-t border-border/60 pt-3">
                    {history.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 text-[12.5px]">
                        {/* A ready send has no archive page yet: Reports lists what went out. */}
                        {s.status === 'ready'
                          ? <span className="font-medium">{s.subject ?? 'Update'}</span>
                          : <Link href={`/dashboard/reports?group=sent&item=${s.id}`} className="font-medium underline-offset-2 hover:underline">{s.subject ?? 'Update'}</Link>}
                        <span className="font-mono text-[10.5px] text-muted-foreground">
                          {s.status === 'sent' && s.sent_at
                            ? `sent ${fmtWhen(s.sent_at)} to ${s.recipients.length}${s.approved_by ? ` · sent by ${nameOf.get(s.approved_by) ?? 'a teammate'}` : ''}`
                            : s.status === 'failed' ? `did not send ${fmtWhen(s.claimed_at)} · ${sendFailureSentence(s.error)}`
                            : s.status === 'ready' ? `ready for review ${fmtWhen(s.ready_at ?? s.claimed_at)}`
                            : `${s.status} ${fmtWhen(s.claimed_at)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </DetailSection>
              <DetailSection label="Builds">
                {isDocument ? (
                  docBuilds.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {docBuilds.map((b) => {
                        const art = builds.find((x) => x.id === b.snapshot_id)?.artifacts.find((a) => a.format === 'pdf') ?? null
                        return (
                          <li key={b.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[4px] bg-inner px-4 py-2.5 text-[12.5px]">
                            <span className="font-mono text-[10.5px] text-muted-foreground">{fmtWhen(b.started_at)}</span>
                            <span className={b.status === 'failed' ? 'text-negative' : b.status === 'done' ? '' : 'text-secondary-foreground'}>{b.status === 'done' ? 'Built' : BUILD_PHASE_WORDS[b.status]}{b.status === 'failed' && b.error ? `: ${b.error}` : ''}</span>
                            {b.needs_review && <span className="text-warning">a finding was dropped after a check, read before sending</span>}
                            {b.snapshot_id && editedSnapshots.has(b.snapshot_id) && <span className="font-mono text-[10.5px] text-muted-foreground">edited</span>}
                            {Number(b.cost_usd) > 0 && <span className="font-mono text-[10.5px] text-muted-foreground">${Number(b.cost_usd).toFixed(2)}</span>}
                            {art && <a href={`/api/artifacts/${art.id}`} className="font-medium underline underline-offset-2">PDF · {fmtBytes(art.bytes)}{art.stale ? ' · re-renders' : ''}</a>}
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">Not built yet. Building reads the update, asks the data, writes the brief for its reader and prints the PDF. Three to five minutes.</p>
                  )
                ) : builds.length > 0 ? (
                  <ul className="flex flex-col gap-3">
                    {builds.map((b) => (
                      <li key={b.id} className="rounded-[4px] bg-inner px-4 py-3">
                        <p className="font-mono text-[10.5px] text-muted-foreground">built {fmtWhen(b.created_at)}{b === builds[0] && selected.status === 'draft' ? ' · edited since, build again for a current PDF' : ''}</p>
                        {b.cover && b.figures && <p className="mt-1.5 text-[12.5px] leading-relaxed text-secondary-foreground">{coverPlainText(b.cover.body, b.figures)}</p>}
                        <div className="mt-2 flex flex-wrap gap-3">
                          {b.artifacts.map((a) => (
                            <a key={a.id} href={`/api/artifacts/${a.id}`} className="text-[12px] font-medium underline underline-offset-2">Download {a.format.toUpperCase()} · {fmtBytes(a.bytes)}{a.stale ? ' · re-renders' : ''}</a>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-muted-foreground">Not built yet. Building freezes the figures as they are now, writes the cover for its reader and prints the PDF.</p>
                )}
              </DetailSection>
              <DetailSection label="Share">
                <ShareLinks snapshotId={builds[0]?.id ?? null} links={shareLinks} />
              </DetailSection>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-start justify-center gap-3 px-8">
              <p className="text-[14px] font-medium">Nothing here yet.</p>
              <p className="max-w-[44ch] text-[12.5px] text-muted-foreground">A report arranges the pages you already have for a reader you name, and can go out to a list of people after each update.</p>
              <Link href={`${BASE}/new`}><BarPill primary>New report</BarPill></Link>
            </div>
          )}
        </section>
      </div>
    </PageFrame>
  )
}
