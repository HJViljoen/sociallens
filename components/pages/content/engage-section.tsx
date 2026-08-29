import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Tile, TileEmpty } from '@/components/shell/tile'
import { DetailDrawer } from '@/components/shell/detail-drawer'
import { PlatformIcon } from '@/components/charts/platform-icon'
import { platformLabel } from '@/lib/format'
import { periodWindowDays } from '@/lib/config'
import {
  ENGAGE_CATEGORY_LABEL,
  engageDeepLink,
  engageVocab,
  loadEngageCandidates,
  rankEngageCandidates,
  type EngageCandidate,
} from '@/lib/engage'
import {
  inboxRows, intentCounts, INTENT_LABEL, INTENT_PLURAL,
  type Intent, type InboxRow, type VoiceRole,
} from '@/lib/content-tiles'

// "Worth a reply" — the engagement digest (2026-08-10, Anne's ask, weekly by
// design), now the Content page's inbox beside the playbook (one-screen
// redesign; hooks and formats lead, the inbox sits top-right). Evidence-
// only v1: surfaces comments the analysis already cited under question /
// buying-signal insights, hard-limited to the update's own window
// (lib/engage.ts). Anchored on the latest COMPLETED update — unlike the page's
// video tiles, this needs analysis output, so the two anchors can differ while
// an update is mid-flight. Misinformation is listed apart, awareness-only:
// recommending a reply would invite a public argument under someone else's
// post, so those rows carry no Reply link.

export interface EngageDigest {
  runStartedAt: string
  windowDays: number
  /** Reply-worthy rows, ranked (lib/engage.ts caps apply). */
  engage: EngageCandidate[]
  /** Misinformation, awareness only. */
  flagged: EngageCandidate[]
  /** Every candidate — the per-insight drawer reads its evidence from here. */
  candidates: EngageCandidate[]
}

/** The digest's data, ready to shape — null before the first completed update. */
export async function loadEngageDigest(supabase: SupabaseClient, clientId: string): Promise<EngageDigest | null> {
  const { data: run } = await supabase
    .from('pipeline_runs')
    .select('id, started_at')
    .eq('client_id', clientId)
    .in('status', ['completed', 'partial'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!run) return null

  const { data: config } = await supabase
    .from('tracking_configs')
    .select('report_period, brand_keywords, competitor_keywords, industry_keywords')
    .eq('client_id', clientId)
    .maybeSingle()
  const windowDays = periodWindowDays((config?.report_period as string) ?? 'weekly')
  const windowStart = new Date(Date.parse(run.started_at as string) - windowDays * 86_400_000).toISOString()
  const vocab = engageVocab([config?.brand_keywords, config?.competitor_keywords, config?.industry_keywords])

  const candidates = await loadEngageCandidates(supabase, clientId, run.id as string)
  const engage = rankEngageCandidates(
    candidates.filter((c) => c.category !== 'misinformation'),
    { windowStart, vocab },
  )
  const flagged = rankEngageCandidates(
    candidates.filter((c) => c.category === 'misinformation'),
    { windowStart, perCategoryCap: 3, totalCap: 3, vocab },
  )
  return { runStartedAt: run.started_at as string, windowDays, engage, flagged, candidates }
}

// Intent chips — the page's greens / warm reds-golds only: buying signals
// green, questions gold, objections clay, misinformation red (the negative).
const INTENT_CHIP: Record<Intent, string> = {
  buying: 'bg-accent text-accent-foreground',
  question: 'bg-warning/15 text-warning',
  objection: 'bg-negative/12 text-negative',
  misinformation: 'bg-foreground/10 text-foreground',
}

const quote = (text: string, max = 220) => (text.length > max ? `${text.slice(0, max)}…` : text)

/** audience_insights.theme is a snake_case machine slug — humanize before it
 *  reaches a client's eyes (dashboard-page precedent). */
const prettyTheme = (slug: string) => {
  const s = slug.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const windowWord = (days: number) =>
  days === 7 ? 'this week' : days === 30 ? 'this month' : `in the past ${days} days`

/** Rows shown inside the tile before "N more →" takes over. */
const INBOX_SHOWN = 5

export type InboxItem = InboxRow<EngageCandidate & { id: string; commentDate: string | null; likes: number; account: string | null }>

/** Shape the digest into ordered inbox rows (intent first, then recency). */
export function shapeInbox(
  digest: EngageDigest,
  opts: { now: string; ownHandles: Set<string>; roleByAccount: Map<string, VoiceRole> },
): InboxItem[] {
  const sources = [...digest.engage, ...digest.flagged].map((c) => ({
    ...c,
    id: c.comment.id,
    commentDate: c.comment.commentDate,
    likes: c.comment.likes,
    account: c.comment.account,
  }))
  return inboxRows(sources, opts)
}

function IntentChip({ intent }: { intent: Intent }) {
  return (
    <span className={`inline-flex h-[20px] shrink-0 items-center rounded-full px-2 text-[10.5px] font-semibold whitespace-nowrap ${INTENT_CHIP[intent]}`}>
      {INTENT_LABEL[intent]}
    </span>
  )
}

function ReplyLink({ c, className }: { c: EngageCandidate; className?: string }) {
  if (c.category === 'misinformation') return <span className={className} />
  const link = engageDeepLink(c.comment)
  if (!link.href) return <span className={className} />
  return (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className={`font-medium text-foreground hover:underline ${className ?? ''}`} title={link.commentLevel ? 'Open the comment' : 'Open the post'}>
      Reply →
    </a>
  )
}

/** One inbox row: intent · platform · age · where it sits (one line, Reply at
 *  the right), then the quote clamped to two lines. */
function InboxRowView({ row }: { row: InboxItem }) {
  const c = row.src
  return (
    <div className="flex flex-col gap-1 rounded-[4px] bg-inner px-3 py-2">
      <div className="flex items-center gap-2">
        <IntentChip intent={row.intent} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted-foreground">
          <PlatformIcon platform={c.comment.platform} className="shrink-0 text-secondary-foreground" />
          <span className="truncate">
            {platformLabel(c.comment.platform)} · <span className="font-mono tabular-nums">{row.age ?? '—'}</span> · {row.context}
          </span>
        </span>
        <ReplyLink c={c} className="shrink-0 text-[11.5px]" />
      </div>
      <p className="line-clamp-2 font-serif text-[12.5px] leading-[1.4]" title={c.comment.text}>
        “{quote(c.comment.text)}”
      </p>
    </div>
  )
}

/** The inbox tile (col 5 × row 4, top-right). */
export function EngageInboxTile({
  digest, rows, filter,
}: {
  digest: EngageDigest | null
  rows: InboxItem[]
  filter: Intent | null
}) {
  const total = rows.length
  const counts = intentCounts(rows)
  const shown = filter ? rows.filter((r) => r.intent === filter) : rows
  const visible = shown.slice(0, INBOX_SHOWN)
  const more = shown.length - visible.length
  // `total` is the digest's pick (capped per intent and overall), not a count
  // of everything said — say so.
  const meta = digest ? `top ${total} picked ${windowWord(digest.windowDays)}` : undefined
  const chip = (active: boolean, href: string, label: string) => (
    <Link
      key={href}
      href={href}
      scroll={false}
      className={`inline-flex h-[20px] shrink-0 items-center rounded-full px-2 text-[10.5px] font-medium whitespace-nowrap ${active ? 'bg-foreground text-tile' : 'bg-inner text-secondary-foreground hover:text-foreground'}`}
    >
      {label}
    </Link>
  )

  return (
    <Tile
      col={5} row={4}
      eyebrow="Worth a reply"
      meta={meta}
      bodyClassName="gap-2"
      footer={total > 0 ? (
        <Link href={`/dashboard/videos?detail=replies${filter ? `&intent=${filter}` : ''}`} scroll={false}>
          {more > 0 ? `${more} more →` : `All ${total} in one list →`}
        </Link>
      ) : undefined}
    >
      {digest == null ? (
        <TileEmpty>Your first reply inbox lands with your first analysed update.</TileEmpty>
      ) : total === 0 ? (
        <TileEmpty>Nothing fresh to jump into this update — new conversations land with the next one.</TileEmpty>
      ) : (
        <>
          <div className="flex items-center gap-1 overflow-hidden">
            {chip(filter == null, '/dashboard/videos', `All ${total}`)}
            {counts.map((c) => chip(filter === c.intent, `/dashboard/videos?intent=${c.intent}`, `${INTENT_PLURAL[c.intent]} ${c.count}`))}
          </div>
          {visible.length > 0 ? (
            <div className="flex min-h-0 flex-col gap-1.5 overflow-hidden">
              {visible.map((row) => <InboxRowView key={row.src.comment.id} row={row} />)}
            </div>
          ) : (
            <TileEmpty>No {filter ? INTENT_PLURAL[filter].toLowerCase() : 'moments'} in this update’s window.</TileEmpty>
          )}
        </>
      )}
    </Tile>
  )
}

/** The two drawers: the full digest (?detail=replies) and one insight's
 *  evidence (?detail=engage-<insightId>, reached from "Why it surfaced"). */
export function EngageDrawers({
  digest, rows, detail, filter,
}: {
  digest: EngageDigest | null
  rows: InboxItem[]
  detail?: string
  filter: Intent | null
}) {
  const closeHref = filter ? `/dashboard/videos?intent=${filter}` : '/dashboard/videos'
  const showAll = detail === 'replies'
  const detailInsightId = detail?.startsWith('engage-') ? detail.slice('engage-'.length) : null
  const detailCandidates = detailInsightId && digest ? digest.candidates.filter((c) => c.insightId === detailInsightId) : []
  const detailInsight = detailCandidates[0] ?? null
  const listed = filter ? rows.filter((r) => r.intent === filter) : rows
  const replyable = listed.filter((r) => r.intent !== 'misinformation')
  const flagged = listed.filter((r) => r.intent === 'misinformation')

  return (
    <>
      <DetailDrawer
        open={showAll}
        closeHref={closeHref}
        title="Worth a reply"
        description={digest ? `${listed.length} ${filter ? INTENT_PLURAL[filter].toLowerCase() : 'moments'} ${windowWord(digest.windowDays)} · each links to where it happened` : undefined}
      >
        <div className="space-y-4">
          {replyable.length > 0 && (
            <div className="space-y-2.5">
              {replyable.map((row) => {
                const c = row.src
                return (
                  <div key={c.comment.id} className="rounded-lg bg-inner/40 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <IntentChip intent={row.intent} />
                      <span className="truncate text-[11px] text-muted-foreground">{row.context}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                        <PlatformIcon platform={c.comment.platform} className="text-secondary-foreground" />{platformLabel(c.comment.platform)} · {row.age ?? '—'}
                      </span>
                    </div>
                    <p className="mt-1.5 border-l-2 border-border/80 pl-2 text-[12.5px] italic leading-[1.45]">“{c.comment.text}”</p>
                    <div className="mt-1.5 flex items-center gap-3 text-[11.5px]">
                      <Link href={`/dashboard/videos?detail=engage-${c.insightId}${filter ? `&intent=${filter}` : ''}`} scroll={false} className="text-muted-foreground underline-offset-2 hover:underline">
                        Why it surfaced: {prettyTheme(c.theme)}
                      </Link>
                      <ReplyLink c={c} className="ml-auto" />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {flagged.length > 0 && (
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">Flagged for awareness</p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Claims about the space that don’t hold up. Better answered in your own content than argued under someone else’s post.
              </p>
              <div className="mt-2 space-y-2">
                {flagged.map((row) => (
                  <p key={row.src.comment.id} className="border-l-2 border-border/80 pl-2 text-[12.5px] italic leading-[1.45]">
                    “{row.src.comment.text}”
                    <span className="ml-2 not-italic text-[11px] text-muted-foreground">{platformLabel(row.src.comment.platform)} · {row.age ?? '—'}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
          {listed.length === 0 && <p className="text-muted-foreground">Nothing fresh to jump into this update.</p>}
          <p className="text-[11px] text-muted-foreground">
            The commenter’s own handle is never shown — the link is how a reply gets written.
          </p>
        </div>
      </DetailDrawer>

      <DetailDrawer
        open={detailInsight != null}
        closeHref={`/dashboard/videos?detail=replies${filter ? `&intent=${filter}` : ''}`}
        title={detailInsight ? prettyTheme(detailInsight.theme) : 'Why it surfaced'}
        description={detailInsight ? (ENGAGE_CATEGORY_LABEL[detailInsight.category] ?? 'Flagged') : undefined}
      >
        {detailInsight && (
          <div className="space-y-3">
            {detailInsight.description && <p className="text-[12.5px] text-muted-foreground">{detailInsight.description}</p>}
            <div className="space-y-1.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">In their words</p>
              {detailCandidates.map((c) => (
                <p key={c.comment.id} className="border-l-2 border-border/80 pl-2 text-[12.5px] italic leading-[1.45]">
                  “{c.comment.text}”
                  <span className="ml-2 not-italic text-[11px] text-muted-foreground">{platformLabel(c.comment.platform)}</span>
                </p>
              ))}
            </div>
          </div>
        )}
      </DetailDrawer>
    </>
  )
}
