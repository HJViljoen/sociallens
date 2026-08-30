import Link from 'next/link'
import { canManageTenant, getSessionContext } from '@/lib/auth'
import { PageFrame, PageBar, BarPill } from '@/components/shell/page-grid'
import { MasterDetail } from '@/components/shell/master-detail'
import { PaneHeader, PaneBody, RailGroup, RailLink, ListRows, ListRow, PaneEmpty, DetailHeader, DetailSection } from '@/components/shell/master-list'
import { ListSearch } from '@/components/shell/list-search'
import { BuildButton } from '@/components/reports/build-button'
import { DeleteReport } from '@/components/reports/delete-report'
import { ShareLinks, type ShareLinkView } from '@/components/reports/share-links'
import { ScheduleForm, type TemplateChoice } from '@/components/schedules/schedule-form'
import { createReport } from '@/app/dashboard/studio/actions'
import { createAdminClient } from '@/lib/supabase-admin'
import { getBaseUrl } from '@/lib/site'
import { coverPlainText } from '@/lib/reports/cover'
import { catalogueTitle, studioCatalogue } from '@/lib/reports/catalogue'
import { STARTER_TEMPLATES } from '@/lib/reports/templates'
import { AUDIENCES, type CoverText, type FigureTable, type ReportSection } from '@/lib/reports/types'
import { CADENCES, type ScheduleRow } from '@/lib/schedules/types'

// The Studio (Reports & Exports Stage 3, Heinrich 2026-08-30): its own page.
// Templates — the starters and the workspace's own — each buildable into a
// PDF and a share link; and Schedules — which template goes to which people
// after which updates, PDF attached, link inside. Reports (the other page)
// is the archive of what went out and what was built.
//
// A workspace's own template is a `reports` row (Stage 2's editable
// arrangement); a starter lives in code. Any member may make a template;
// schedules send external email, so they are owner/admin.

export const dynamic = 'force-dynamic'

type Group = 'templates' | 'schedules'
const BASE = '/dashboard/studio'
const audienceLabel = (k: string) => AUDIENCES.find((a) => a.key === k)?.label ?? k
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const fmtBytes = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`)
const href = (group: Group, item?: string | null, extra?: Record<string, string>) => {
  const q = new URLSearchParams()
  if (group !== 'templates') q.set('group', group)
  if (item) q.set('item', item)
  for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v)
  const qs = q.toString()
  return qs ? `${BASE}?${qs}` : BASE
}

interface OwnTemplate { id: string; title: string; audience: string; status: 'draft' | 'built'; sections: ReportSection[]; latest_snapshot_id: string | null; updated_at: string }
interface BuildRow { id: string; title: string; created_at: string; cover: CoverText | null; figures: FigureTable | null; artifacts: { id: string; format: string; bytes: number; stale: boolean; rendered_at: string; version: number }[] }
interface SendRow { id: string; schedule_id: string; status: string; subject: string | null; recipients: string[]; sent_at: string | null; claimed_at: string; error: string | null }

const pagesOf = (sections: { page: string }[]) => [...new Set(sections.map((s) => catalogueTitle(s.page)))]

export default async function StudioPage({ searchParams }: { searchParams?: Promise<{ group?: string; item?: string; mine?: string; starter?: string; report?: string }> }) {
  const sp = (await searchParams) ?? {}
  const { supabase, clientId, role, email } = await getSessionContext()
  const canManage = canManageTenant(role)
  const group: Group = sp.group === 'schedules' ? 'schedules' : 'templates'

  const [{ data: ownData }, { data: scheduleData }, { data: sendData }, { data: runData }] = await Promise.all([
    supabase.from('reports').select('id, title, audience, status, sections, latest_snapshot_id, updated_at').eq('client_id', clientId).order('updated_at', { ascending: false }),
    supabase.from('report_schedules').select('*').eq('client_id', clientId).order('is_default', { ascending: false }).order('created_at'),
    supabase.from('report_sends').select('id, schedule_id, status, subject, recipients, sent_at, claimed_at, error').eq('client_id', clientId).order('claimed_at', { ascending: false }).limit(200),
    supabase.from('pipeline_runs').select('id').eq('client_id', clientId).in('status', ['completed', 'partial']).limit(1),
  ])
  const own = (ownData ?? []) as OwnTemplate[]
  const schedules = (scheduleData ?? []) as ScheduleRow[]
  const sends = (sendData ?? []) as SendRow[]
  const sendable = (runData ?? []).length > 0
  const catalogue = studioCatalogue()
  const tilesOf = (s: ReportSection) => (s.keys ?? catalogue.find((c) => c.page === s.page)?.tiles.map((t) => t.key) ?? []).length

  // ── templates ──────────────────────────────────────────────────────────
  const mine = sp.mine === '1'
  const starterItems = STARTER_TEMPLATES.map((t) => ({ key: `starter:${t.key}`, t }))
  const templateIds = [...(mine ? [] : starterItems.map((s) => s.key)), ...own.map((o) => o.id)]
  const templateId = group === 'templates' ? (sp.item && templateIds.includes(sp.item) ? sp.item : templateIds[0] ?? null) : null
  const selectedStarter = templateId?.startsWith('starter:') ? STARTER_TEMPLATES.find((t) => `starter:${t.key}` === templateId) ?? null : null
  const selectedOwn = templateId && !selectedStarter ? own.find((o) => o.id === templateId) ?? null : null

  let builds: BuildRow[] = []
  let shareLinks: ShareLinkView[] = []
  if (selectedOwn) {
    const { data: b } = await supabase.from('report_snapshots')
      .select('id, title, created_at, cover:data->cover, figures:data->figures, artifacts(id, format, bytes, stale, rendered_at, version)')
      .eq('client_id', clientId).eq('report_id', selectedOwn.id).order('created_at', { ascending: false }).limit(20)
    builds = (b ?? []) as unknown as BuildRow[]
    if (builds.length) {
      // The token is withheld from the workspace's own RLS reads; the page
      // reads links server-side, scoped to the tenant.
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

  // ── schedules ──────────────────────────────────────────────────────────
  const isNew = group === 'schedules' && sp.item === 'new'
  const scheduleId = group === 'schedules' && !isNew ? (sp.item && schedules.some((s) => s.id === sp.item) ? sp.item : schedules[0]?.id ?? null) : null
  const selectedSchedule = scheduleId ? schedules.find((s) => s.id === scheduleId) ?? null : null
  const templateChoices: TemplateChoice[] = [
    ...STARTER_TEMPLATES.map((t) => ({ value: `starter:${t.key}`, label: t.name, group: 'Starters' as const })),
    ...own.map((o) => ({ value: `report:${o.id}`, label: o.title, group: 'Your templates' as const })),
  ]
  const templateNameOf = (s: ScheduleRow) => (s.starter_key ? STARTER_TEMPLATES.find((t) => t.key === s.starter_key)?.name ?? s.starter_key : own.find((o) => o.id === s.report_id)?.title ?? 'a template that was deleted')
  const lastSent = new Map<string, SendRow>()
  for (const s of sends) if (s.status === 'sent' && !lastSent.has(s.schedule_id)) lastSent.set(s.schedule_id, s)
  const initialSource = sp.starter ? `starter:${sp.starter}` : sp.report ? `report:${sp.report}` : null

  const rail = (
    <>
      <PaneHeader title="Studio" meta={`${schedules.filter((s) => s.active).length} active schedule${schedules.filter((s) => s.active).length === 1 ? '' : 's'}`} />
      <PaneBody>
        <RailGroup label="Templates">
          <RailLink href={href('templates')} active={group === 'templates' && !mine} count={STARTER_TEMPLATES.length + own.length}>All templates</RailLink>
          <RailLink href={href('templates', null, { mine: '1' })} active={group === 'templates' && mine} count={own.length}>Your templates</RailLink>
        </RailGroup>
        <RailGroup label="Schedules">
          <RailLink href={href('schedules')} active={group === 'schedules'} count={schedules.length}>Who gets what</RailLink>
        </RailGroup>
      </PaneBody>
    </>
  )

  const LIST_ID = 'studio-list'
  const list = group === 'templates' ? (
    <>
      <PaneHeader title={mine ? 'Your templates' : 'Templates'} meta="arrange existing pages — never new analysis">
        {own.length > 5 && <ListSearch scope={LIST_ID} placeholder="Search templates…" />}
      </PaneHeader>
      <PaneBody>
        <div id={LIST_ID}>
          <ListRows>
            {!mine && starterItems.map(({ key, t }) => (
              <ListRow key={key} href={href('templates', key)} active={key === templateId} search={`${t.name} ${audienceLabel(t.audience)}`}>
                <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{t.name}</p>
                <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">starter · for {audienceLabel(t.audience)} · {pagesOf(t.sections).join(' · ')}</p>
              </ListRow>
            ))}
            {own.map((o) => (
              <ListRow key={o.id} href={href('templates', o.id, mine ? { mine: '1' } : undefined)} active={o.id === templateId} search={`${o.title} ${audienceLabel(o.audience)}`}>
                <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{o.title}</p>
                <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">yours · for {audienceLabel(o.audience)} · {o.status === 'built' ? 'built' : 'draft'} · {fmtWhen(o.updated_at)}</p>
              </ListRow>
            ))}
          </ListRows>
          {mine && own.length === 0 && <PaneEmpty>None yet. Open a starter and use it as your own — it becomes yours to arrange.</PaneEmpty>}
        </div>
      </PaneBody>
    </>
  ) : (
    <>
      <PaneHeader title="Schedules" meta={schedules.length ? 'after each update' : undefined} />
      <PaneBody>
        {schedules.length ? (
          <ListRows>
            {schedules.map((s) => {
              const last = lastSent.get(s.id)
              return (
                <ListRow key={s.id} href={href('schedules', s.id)} active={s.id === scheduleId}>
                  <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{s.name}{s.is_default ? <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">default</span> : null}</p>
                  <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                    {templateNameOf(s)} · {CADENCES.find((c) => c.key === s.cadence)?.label.toLowerCase()} · {s.recipients.length} {s.recipients.length === 1 ? 'person' : 'people'}{!s.active ? ' · paused' : ''}{last?.sent_at ? ` · last sent ${fmtWhen(last.sent_at)}` : ''}
                  </p>
                </ListRow>
              )
            })}
          </ListRows>
        ) : (
          <PaneEmpty>No schedules. Every workspace starts with a Weekly digest — add one to send a template to a list of people.</PaneEmpty>
        )}
      </PaneBody>
    </>
  )

  const detail = group === 'templates' ? (
    selectedStarter ? (
      <>
        <DetailHeader eyebrow={`Starter · for ${audienceLabel(selectedStarter.audience)}`} title={selectedStarter.name} meta={`${selectedStarter.sections.length} section${selectedStarter.sections.length === 1 ? '' : 's'} · ${pagesOf(selectedStarter.sections).join(' · ')}`} />
        <DetailSection>
          <p className="text-[13px] leading-relaxed text-secondary-foreground">{selectedStarter.description}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <form action={createReport}>
              <button type="submit" name="template" value={selectedStarter.key} className="inline-flex h-8 items-center rounded-full bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-accent-foreground">Use as my own</button>
            </form>
            {canManage && <Link href={href('schedules', 'new', { starter: selectedStarter.key })} className="inline-flex h-8 items-center rounded-full bg-tile px-3 text-[12px] font-medium text-secondary-foreground ring-1 ring-border hover:bg-inner">Send on a schedule</Link>}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">A starter is read-only. “Use as my own” copies it into your templates, where it can be arranged, built into a PDF and shared.</p>
        </DetailSection>
        <DetailSection label="Pages">
          <ul className="flex flex-col gap-2">
            {selectedStarter.sections.map((s, i) => (
              <li key={i} className="rounded-[4px] bg-inner px-4 py-2.5 text-[12.5px]">
                <span className="font-semibold">{catalogueTitle(s.page)}</span>
                <span className="font-mono text-[10.5px] text-muted-foreground"> · {tilesOf({ id: '', ...s })} tile{tilesOf({ id: '', ...s }) === 1 ? '' : 's'}{s.variant === 'full' ? ' · every item' : ''}{Object.keys(s.params).length ? ` · ${Object.entries(s.params).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}</span>
                {s.framing && <p className="mt-1 text-[12px] italic text-muted-foreground">{s.framing}</p>}
              </li>
            ))}
          </ul>
        </DetailSection>
      </>
    ) : selectedOwn ? (
      <>
        <DetailHeader eyebrow={`Your template · for ${audienceLabel(selectedOwn.audience)}`} title={selectedOwn.title}
          meta={`${selectedOwn.sections.length} section${selectedOwn.sections.length === 1 ? '' : 's'} · ${pagesOf(selectedOwn.sections).join(' · ') || 'empty'} · ${selectedOwn.status === 'built' ? 'built' : 'draft'} · edited ${fmtWhen(selectedOwn.updated_at)}`} />
        <DetailSection>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`${BASE}/edit/${selectedOwn.id}`} className="inline-flex h-8 items-center rounded-full bg-tile px-3 text-[12px] font-medium text-secondary-foreground ring-1 ring-border hover:bg-inner">Edit</Link>
            <BuildButton reportId={selectedOwn.id} />
            {canManage && <Link href={href('schedules', 'new', { report: selectedOwn.id })} className="inline-flex h-8 items-center rounded-full bg-tile px-3 text-[12px] font-medium text-secondary-foreground ring-1 ring-border hover:bg-inner">Send on a schedule</Link>}
            <DeleteReport id={selectedOwn.id} />
          </div>
        </DetailSection>
        <DetailSection label="Builds">
          {builds.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {builds.map((b) => (
                <li key={b.id} className="rounded-[4px] bg-inner px-4 py-3">
                  <p className="font-mono text-[10.5px] text-muted-foreground">built {fmtWhen(b.created_at)}{b.cover?.model ? '' : ' · cover written in code'}{b === builds[0] && selectedOwn.status === 'draft' ? ' · edited since — build again for a current PDF' : ''}</p>
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
      <PaneEmpty>Pick a template.</PaneEmpty>
    )
  ) : isNew ? (
    <>
      <DetailHeader eyebrow="New schedule" title="Who gets what, and when" meta="a template, to a list of people, after each update" />
      <DetailSection>
        <ScheduleForm key="new" schedule={null} templates={templateChoices} initialSource={initialSource} canManage={canManage} userEmail={email ?? null} sendable={sendable} />
      </DetailSection>
    </>
  ) : selectedSchedule ? (
    <>
      <DetailHeader eyebrow={selectedSchedule.is_default ? 'Schedule · the workspace default' : 'Schedule'} title={selectedSchedule.name}
        meta={`${templateNameOf(selectedSchedule)} · ${CADENCES.find((c) => c.key === selectedSchedule.cadence)?.label.toLowerCase()} · ${selectedSchedule.recipients.length} ${selectedSchedule.recipients.length === 1 ? 'person' : 'people'}${selectedSchedule.attach_pdf ? ' · PDF attached' : ''}${!selectedSchedule.active ? ' · paused' : ''}`} />
      <DetailSection>
        <ScheduleForm key={`${selectedSchedule.id}:${selectedSchedule.updated_at}`} schedule={selectedSchedule} templates={templateChoices} canManage={canManage} userEmail={email ?? null} sendable={sendable} />
      </DetailSection>
      <DetailSection label="Sent">
        {sends.filter((s) => s.schedule_id === selectedSchedule.id).length ? (
          <ul className="flex flex-col gap-1.5">
            {sends.filter((s) => s.schedule_id === selectedSchedule.id).slice(0, 8).map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline gap-x-3 text-[12.5px]">
                <Link href={`/dashboard/reports?group=sent&item=${s.id}`} className="font-medium underline-offset-2 hover:underline">{s.subject ?? 'Update'}</Link>
                <span className="font-mono text-[10.5px] text-muted-foreground">
                  {s.status === 'sent' && s.sent_at ? `sent ${fmtWhen(s.sent_at)} to ${s.recipients.length}` : s.status === 'failed' ? `failed ${fmtWhen(s.claimed_at)}${s.error ? ` · ${s.error.length > 90 ? `${s.error.slice(0, 90)}…` : s.error}` : ''}` : `${s.status} ${fmtWhen(s.claimed_at)}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-muted-foreground">Nothing sent yet. The first goes out after the next scheduled update — or send one now.</p>
        )}
      </DetailSection>
      {selectedSchedule.is_default && <DetailSection><p className="text-[11px] text-muted-foreground">A teammate who accepts an invite joins this schedule’s list.</p></DetailSection>}
    </>
  ) : (
    <PaneEmpty>Pick a schedule, or add one.</PaneEmpty>
  )

  return (
    <PageFrame className="min-h-0 flex-1">
      <PageBar title="Studio" context="templates, and who gets them when">
        {canManage && <Link href={href('schedules', 'new')}><BarPill primary>New schedule</BarPill></Link>}
      </PageBar>
      <MasterDetail id="studio" rail={rail} list={list} detail={detail} />
    </PageFrame>
  )
}
