import Link from 'next/link'
import { getSessionContext } from '@/lib/auth'
import { PageFrame, PageBar, BarPill } from '@/components/shell/page-grid'
import { MasterDetail } from '@/components/shell/master-detail'
import { PaneHeader, PaneBody, RailGroup, RailLink, ListRows, ListRow, PaneEmpty, DetailHeader, DetailSection } from '@/components/shell/master-list'
import { ListSearch } from '@/components/shell/list-search'
import { ShareLinks, type ShareLinkView } from '@/components/reports/share-links'
import { createAdminClient } from '@/lib/supabase-admin'
import { getBaseUrl } from '@/lib/site'
import { coverPlainText } from '@/lib/reports/cover'
import type { CoverText, FigureTable } from '@/lib/reports/types'
import { sendDidNotFinish, sendFailureSentence } from '@/lib/schedules/copy'

// Reports — the archive of what went out and what was built (Stage 3):
//   Sent  — every scheduled send (subject, who, when, the PDF, the share link,
//           the email as sent — re-rendered from its snapshot, never stored),
//           with the updates emailed before schedules existed beneath them.
//   Built — PDFs built by hand in the Studio, with their share links.
// Making things happens in the Studio; this page is what left the building.

interface SendRow {
  id: string
  schedule_id: string | null
  schedule_name: string | null
  run_id: string | null
  snapshot_id: string | null
  artifact_id: string | null
  share_link_id: string | null
  subject: string | null
  recipients: string[]
  status: string
  error: string | null
  claimed_at: string
  sent_at: string | null
  report_schedules: { name: string; attach_pdf: boolean } | null
}
interface LegacyReport { id: string; subject: string | null; week_start: string | null; week_end: string | null; sent_to: string[] | null; sent_at: string | null }
interface BuildRow {
  id: string
  title: string
  created_at: string
  report_id: string | null
  cover: CoverText | null
  figures: FigureTable | null
  artifacts: { id: string; format: string; bytes: number; stale: boolean; rendered_at: string; version: number }[]
}

type Group = 'sent' | 'built'
const BASE = '/dashboard/reports'
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null)
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const fmtBytes = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`)
const href = (group: Group, item?: string | null) => {
  const q = new URLSearchParams()
  if (group !== 'sent') q.set('group', group)
  if (item) q.set('item', item)
  const qs = q.toString()
  return qs ? `${BASE}?${qs}` : BASE
}
const scheduleName = (s: SendRow) => s.report_schedules?.name ?? s.schedule_name ?? 'a schedule since deleted'
const sendLine = (s: SendRow) =>
  s.status === 'sent' && s.sent_at ? `sent ${fmtWhen(s.sent_at)} to ${s.recipients.length} ${s.recipients.length === 1 ? 'person' : 'people'}`
  : s.status === 'failed' ? `did not send · ${fmtWhen(s.claimed_at)}`
  : sendDidNotFinish(s.status, s.claimed_at) ? `did not finish · ${fmtWhen(s.claimed_at)}`
  : `sending · ${fmtWhen(s.claimed_at)}`

export default async function ReportsPage({ searchParams }: { searchParams?: Promise<{ group?: string; item?: string }> }) {
  const sp = (await searchParams) ?? {}
  const { supabase, clientId } = await getSessionContext()
  const group: Group = sp.group === 'built' ? 'built' : 'sent'

  const [{ data: sendData }, { data: legacyData }, { data: buildData }] = await Promise.all([
    supabase.from('report_sends').select('id, schedule_id, schedule_name, run_id, snapshot_id, artifact_id, share_link_id, subject, recipients, status, error, claimed_at, sent_at, report_schedules(name, attach_pdf)')
      .eq('client_id', clientId).in('status', ['sent', 'failed', 'claimed']).order('claimed_at', { ascending: false }).limit(200),
    supabase.from('weekly_reports').select('id, subject, week_start, week_end, sent_to, sent_at').eq('client_id', clientId).order('week_end', { ascending: false }),
    supabase.from('report_snapshots')
      .select('id, title, created_at, report_id, cover:data->cover, figures:data->figures, artifacts(id, format, bytes, stale, rendered_at, version)')
      .eq('client_id', clientId).eq('kind', 'report').order('created_at', { ascending: false }).limit(100),
  ])
  const sends = (sendData ?? []) as unknown as SendRow[]
  const legacy = (legacyData ?? []) as LegacyReport[]
  const sentSnapshotIds = new Set(sends.map((s) => s.snapshot_id).filter(Boolean))
  const builds = ((buildData ?? []) as unknown as BuildRow[]).filter((b) => !sentSnapshotIds.has(b.id))

  // ── selection ─────────────────────────────────────────────────────────
  const sentIds = [...sends.map((s) => s.id), ...legacy.map((l) => l.id)]
  const sentId = group === 'sent' ? (sp.item && sentIds.includes(sp.item) ? sp.item : sentIds[0] ?? null) : null
  const selectedSend = sentId ? sends.find((s) => s.id === sentId) ?? null : null
  const selectedLegacy = sentId && !selectedSend ? legacy.find((l) => l.id === sentId) ?? null : null
  const buildId = group === 'built' ? (sp.item && builds.some((b) => b.id === sp.item) ? sp.item : builds[0]?.id ?? null) : null
  const selectedBuild = buildId ? builds.find((b) => b.id === buildId) ?? null : null

  // Share links for the selected item — read server-side (the token is
  // withheld from the workspace's RLS reads), scoped to the tenant.
  let shareLinks: ShareLinkView[] = []
  const linkSnapshot = selectedSend?.snapshot_id ?? selectedBuild?.id ?? null
  if (linkSnapshot) {
    const admin = createAdminClient()
    const base = await getBaseUrl()
    const { data: l } = await admin.from('share_links')
      .select('id, snapshot_id, token, title, expires_at, password_hash, revoked_at, view_count, last_viewed_at, created_at')
      .eq('client_id', clientId).eq('snapshot_id', linkSnapshot).order('created_at', { ascending: false })
    shareLinks = ((l ?? []) as { id: string; snapshot_id: string; token: string; title: string; expires_at: string | null; password_hash: string | null; revoked_at: string | null; view_count: number; last_viewed_at: string | null; created_at: string }[])
      .map((x) => ({ id: x.id, url: `${base}/r/${x.token}`, title: x.title, createdAt: x.created_at, expiresAt: x.expires_at, revokedAt: x.revoked_at, protected: Boolean(x.password_hash), views: x.view_count, lastViewedAt: x.last_viewed_at, buildAt: x.created_at }))
  }
  type ArtifactLite = { id: string; format: string; bytes: number; stale: boolean }
  let artifact: ArtifactLite | null = null
  if (selectedSend?.artifact_id) {
    const { data: a } = await supabase.from('artifacts').select('id, format, bytes, stale').eq('id', selectedSend.artifact_id).maybeSingle()
    artifact = (a as ArtifactLite | null) ?? null
  }
  let legacyHtml: string | null = null
  if (selectedLegacy) {
    const { data: row } = await supabase.from('weekly_reports').select('html_content').eq('client_id', clientId).eq('id', selectedLegacy.id).maybeSingle()
    legacyHtml = row?.html_content ? String(row.html_content).replace(/<head>/i, '<head><base target="_blank">') : null
  }

  const rail = (
    <>
      <PaneHeader title="Archive" meta="what left the building" />
      <PaneBody>
        <RailGroup label="Reports">
          <RailLink href={href('sent')} active={group === 'sent'} count={sends.length + legacy.length}>Sent</RailLink>
          <RailLink href={href('built')} active={group === 'built'} count={builds.length}>Built</RailLink>
        </RailGroup>
      </PaneBody>
    </>
  )

  const LIST_ID = 'reports-list'
  const list = group === 'sent' ? (
    <>
      <PaneHeader title="Sent" meta={sends.length + legacy.length > 0 ? 'newest first' : undefined}>
        {sends.length + legacy.length > 5 && <ListSearch scope={LIST_ID} placeholder="Search sent updates…" />}
      </PaneHeader>
      <PaneBody>
        <div id={LIST_ID}>
          {sends.length + legacy.length > 0 ? (
            <ListRows>
              {sends.map((s) => (
                <ListRow key={s.id} href={href('sent', s.id)} active={s.id === sentId} search={`${s.subject ?? ''} ${scheduleName(s)}`}>
                  <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{s.subject ?? 'Update'}</p>
                  <p className={`mt-0.5 font-mono text-[10.5px] ${s.status === 'failed' || sendDidNotFinish(s.status, s.claimed_at) ? 'text-negative' : 'text-muted-foreground'}`}>{scheduleName(s)} · {sendLine(s)}</p>
                </ListRow>
              ))}
              {legacy.map((l) => (
                <ListRow key={l.id} href={href('sent', l.id)} active={l.id === sentId} search={`${l.subject ?? ''} ${fmtDate(l.week_end) ?? ''}`}>
                  <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{l.subject ?? 'Update'}</p>
                  <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">earlier update · {fmtDate(l.week_start)} – {fmtDate(l.week_end)} · {l.sent_at ? `emailed ${fmtDate(l.sent_at)}` : 'viewable here'}</p>
                </ListRow>
              ))}
            </ListRows>
          ) : (
            <PaneEmpty>Nothing sent yet. Each schedule in the Studio sends after the next update — the first lands then.</PaneEmpty>
          )}
        </div>
      </PaneBody>
    </>
  ) : (
    <>
      <PaneHeader title="Built" meta={builds.length > 0 ? 'newest first' : undefined}>
        {builds.length > 5 && <ListSearch scope={LIST_ID} placeholder="Search builds…" />}
      </PaneHeader>
      <PaneBody>
        <div id={LIST_ID}>
          {builds.length > 0 ? (
            <ListRows>
              {builds.map((b) => (
                <ListRow key={b.id} href={href('built', b.id)} active={b.id === buildId} search={b.title}>
                  <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{b.title}</p>
                  <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">built {fmtWhen(b.created_at)} · {b.artifacts.length ? b.artifacts.map((a) => a.format.toUpperCase()).join(', ') : 'no file'}</p>
                </ListRow>
              ))}
            </ListRows>
          ) : (
            <PaneEmpty>Nothing built by hand yet. Build any template in the Studio and its PDF lands here.</PaneEmpty>
          )}
        </div>
      </PaneBody>
    </>
  )

  const detail = group === 'sent' ? (
    selectedSend ? (
      <>
        <DetailHeader eyebrow={scheduleName(selectedSend)} title={selectedSend.subject ?? 'Update'} meta={sendLine(selectedSend)} />
        {(selectedSend.status === 'failed' || sendDidNotFinish(selectedSend.status, selectedSend.claimed_at)) && (
          <DetailSection><p className="text-[12.5px] text-negative">This update did not reach anyone. {selectedSend.status === 'failed' ? sendFailureSentence(selectedSend.error) : 'The send started and never finished.'} An owner or admin can send it again from the Studio.</p></DetailSection>
        )}
        <DetailSection label="To">
          <p className="text-[12.5px] text-secondary-foreground">{selectedSend.recipients.join(' · ') || 'nobody'}</p>
        </DetailSection>
        <DetailSection label="Files and links">
          <div className="flex flex-wrap items-center gap-3">
            {artifact ? (
              <a href={`/api/artifacts/${artifact.id}`} className="text-[12px] font-medium underline underline-offset-2">Download the PDF · {fmtBytes(artifact.bytes)}{artifact.stale ? ' · re-renders' : ''}{selectedSend.report_schedules?.attach_pdf ? ' · was attached' : ''}</a>
            ) : <span className="text-[12px] text-muted-foreground">No PDF stored.</span>}
          </div>
          <div className="mt-3"><ShareLinks snapshotId={selectedSend.snapshot_id} links={shareLinks} /></div>
        </DetailSection>
        {selectedSend.snapshot_id && selectedSend.schedule_id && (
          <DetailSection label="The email as sent">
            <iframe src={`/api/schedules/${selectedSend.schedule_id}/preview?send=${selectedSend.id}`} sandbox="allow-popups allow-popups-to-escape-sandbox" title={selectedSend.subject ?? 'Update'} className="h-[720px] w-full rounded-[4px] bg-tile ring-1 ring-border" />
            <p className="mt-1 text-[11px] text-muted-foreground">Re-rendered from the figures it was sent with; the quoted voices are read live, so a withdrawn comment never shows.</p>
          </DetailSection>
        )}
      </>
    ) : selectedLegacy ? (
      <>
        <DetailHeader eyebrow="Earlier update" title={selectedLegacy.subject ?? 'Update'}
          meta={`${fmtDate(selectedLegacy.week_start)} – ${fmtDate(selectedLegacy.week_end)}${selectedLegacy.sent_at ? ` · emailed ${fmtDate(selectedLegacy.sent_at)}${selectedLegacy.sent_to?.length ? ` to ${selectedLegacy.sent_to.length}` : ''}` : ' · stored, not emailed'}`} />
        {legacyHtml ? (
          <iframe srcDoc={legacyHtml} sandbox="allow-popups allow-popups-to-escape-sandbox" title={selectedLegacy.subject ?? 'Update'} className="min-h-0 w-full flex-1 bg-tile max-md:h-[70vh]" />
        ) : (
          <PaneEmpty>This update has no stored content.</PaneEmpty>
        )}
      </>
    ) : (
      <PaneEmpty>Select an update to read it here.</PaneEmpty>
    )
  ) : selectedBuild ? (
    <>
      <DetailHeader eyebrow="Built in the Studio" title={selectedBuild.title} meta={`built ${fmtWhen(selectedBuild.created_at)}${selectedBuild.cover?.model ? '' : ' · cover written in code'}`} />
      <DetailSection>
        {selectedBuild.cover && selectedBuild.figures && <p className="text-[12.5px] leading-relaxed text-secondary-foreground">{coverPlainText(selectedBuild.cover.body, selectedBuild.figures)}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {selectedBuild.artifacts.map((a) => (
            <a key={a.id} href={`/api/artifacts/${a.id}`} className="text-[12px] font-medium underline underline-offset-2">Download {a.format.toUpperCase()} · {fmtBytes(a.bytes)}{a.stale ? ' · re-renders' : ''}</a>
          ))}
          {selectedBuild.report_id && <Link href={`/dashboard/studio?group=templates&item=${selectedBuild.report_id}`} className="text-[12px] font-medium underline underline-offset-2">Its template in the Studio</Link>}
        </div>
      </DetailSection>
      <DetailSection label="Share">
        <ShareLinks snapshotId={selectedBuild.id} links={shareLinks} />
      </DetailSection>
    </>
  ) : (
    <PaneEmpty>Select a build.</PaneEmpty>
  )

  return (
    <PageFrame className="min-h-0 flex-1">
      <PageBar title="Reports" context="what went out, and what was built">
        <Link href="/dashboard/studio"><BarPill primary>Open the Studio</BarPill></Link>
      </PageBar>
      <MasterDetail id="reports" rail={rail} list={list} detail={detail} />
    </PageFrame>
  )
}
