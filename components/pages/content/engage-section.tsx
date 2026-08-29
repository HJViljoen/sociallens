import Link from 'next/link'
import type { ReactNode } from 'react'
import { Tile, TileEmpty } from '@/components/shell/tile'
import { PlatformIcon } from '@/components/charts/platform-icon'
import { platformLabel } from '@/lib/format'
import { INTENT_LABEL, INTENT_PLURAL, type Intent } from '@/lib/content-tiles'
import type { ContentData, ContentInboxRow, EngageInsightDetail } from '@/lib/pages/content'
import type { RenderMode } from '@/lib/renderables/types'

// "Worth a reply" — the engagement digest (2026-08-10, Anne's ask, weekly by
// design; renderers split from the loader 2026-08-29, Reports & Exports T7).
// Evidence-only v1: surfaces comments the analysis already cited under
// question / buying-signal insights, hard-limited to the update's own window
// (lib/pages/content.ts). Anchored on the latest COMPLETED update — unlike the
// page's video tiles, this needs analysis output, so the two anchors can
// differ while an update is mid-flight. Misinformation is listed apart,
// awareness-only: recommending a reply would invite a public argument under
// someone else's post, so those rows carry no Reply link.

export const basePath = '/dashboard/videos'

/** Rows shown inside the tile before "N more →" takes over. */
const INBOX_SHOWN = 5

// Intent chips — the page's greens / warm reds-golds only: buying signals
// green, questions gold, objections clay, misinformation red (the negative).
const INTENT_CHIP: Record<Intent, string> = {
  buying: 'bg-accent text-accent-foreground',
  question: 'bg-warning/15 text-warning',
  objection: 'bg-negative/12 text-negative',
  misinformation: 'bg-foreground/10 text-foreground',
}

const clampQuote = (text: string, max = 220) => (text.length > max ? `${text.slice(0, max)}…` : text)

/** audience_insights.theme is a snake_case machine slug — humanize before it
 *  reaches a client's eyes (dashboard-page precedent). */
export const prettyTheme = (slug: string) => {
  const s = slug.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const windowWord = (days: number) =>
  days === 7 ? 'this week' : days === 30 ? 'this month' : `in the past ${days} days`

function IntentChip({ intent }: { intent: Intent }) {
  return (
    <span className={`inline-flex h-[20px] shrink-0 items-center rounded-full px-2 text-[10.5px] font-semibold whitespace-nowrap ${INTENT_CHIP[intent]}`}>
      {INTENT_LABEL[intent]}
    </span>
  )
}

/** The reply deep link — real navigation, so it renders only in app mode; on
 *  paper (and for misinformation, which carries no link) it is an empty span
 *  that keeps the row's layout. */
function ReplyLink({ row, mode, className }: { row: ContentInboxRow; mode: RenderMode; className?: string }) {
  if (mode !== 'app' || !row.href) return <span className={className} />
  return (
    <a href={row.href} target="_blank" rel="noopener noreferrer" className={`font-medium text-foreground hover:underline ${className ?? ''}`} title={row.commentLevel ? 'Open the comment' : 'Open the post'}>
      Reply →
    </a>
  )
}

/** One inbox row: intent · platform · age · where it sits (one line, Reply at
 *  the right), then the quote clamped to two lines. */
function InboxRowView({ row, mode }: { row: ContentInboxRow; mode: RenderMode }) {
  return (
    <div className="flex flex-col gap-1 rounded-[4px] bg-inner px-3 py-2">
      <div className="flex items-center gap-2">
        <IntentChip intent={row.intent} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted-foreground">
          <PlatformIcon platform={row.platform} className="shrink-0 text-secondary-foreground" />
          <span className="truncate">
            {platformLabel(row.platform)} · <span className="font-mono tabular-nums">{row.age ?? '—'}</span> · {row.context}
          </span>
        </span>
        <ReplyLink row={row} mode={mode} className="shrink-0 text-[11.5px]" />
      </div>
      <p className="line-clamp-2 font-serif text-[12.5px] leading-[1.4]" title={row.text}>
        “{clampQuote(row.text)}”
      </p>
    </div>
  )
}

/** One filter chip — a Link in app mode (so the server re-filters), an inert
 *  pill on paper (voice.ts's TabLink precedent). */
function FilterChip({ active, href, label, mode }: { active: boolean; href: string; label: string; mode: RenderMode }) {
  const cls = `inline-flex h-[20px] shrink-0 items-center rounded-full px-2 text-[10.5px] font-medium whitespace-nowrap ${active ? 'bg-foreground text-tile' : 'bg-inner text-secondary-foreground hover:text-foreground'}`
  return mode === 'app' ? <Link href={href} scroll={false} className={cls}>{label}</Link> : <span className={cls}>{label}</span>
}

/** The inbox tile (col 5 × row 4, top-right) — `content.inbox`. */
export function inboxTile(d: ContentData, mode: RenderMode): ReactNode {
  const app = mode === 'app'
  const { rows, counts, windowDays, total } = d.inbox
  const filter = d.selection.intent
  const shown = filter ? rows.filter((r) => r.intent === filter) : rows
  const visible = shown.slice(0, INBOX_SHOWN)
  const more = shown.length - visible.length
  // `total` is the digest's pick (capped per intent and overall), not a count
  // of everything said — say so.
  const meta = windowDays != null ? `top ${total} picked ${windowWord(windowDays)}` : undefined

  return (
    <Tile
      col={5} row={4}
      eyebrow="Worth a reply"
      meta={meta}
      bodyClassName="gap-2"
      footer={total > 0 ? (
        app ? (
          <Link href={`${basePath}?detail=replies${filter ? `&intent=${filter}` : ''}`} scroll={false}>
            {more > 0 ? `${more} more →` : `All ${total} in one list →`}
          </Link>
        ) : <span>{more > 0 ? `${more} more` : `All ${total} in one list`}</span>
      ) : undefined}
    >
      {windowDays == null ? (
        <TileEmpty>Your first reply inbox lands with your first analysed update.</TileEmpty>
      ) : total === 0 ? (
        <TileEmpty>Nothing fresh to jump into this update — new conversations land with the next one.</TileEmpty>
      ) : (
        <>
          <div className="flex items-center gap-1 overflow-hidden">
            <FilterChip active={filter == null} href={basePath} label={`All ${total}`} mode={mode} />
            {counts.map((c) => (
              <FilterChip key={c.intent} active={filter === c.intent} href={`${basePath}?intent=${c.intent}`} label={`${INTENT_PLURAL[c.intent]} ${c.count}`} mode={mode} />
            ))}
          </div>
          {visible.length > 0 ? (
            <div className="flex min-h-0 flex-col gap-1.5 overflow-hidden">
              {visible.map((row) => <InboxRowView key={row.id} row={row} mode={mode} />)}
            </div>
          ) : (
            <TileEmpty>No {filter ? INTENT_PLURAL[filter].toLowerCase() : 'moments'} in this update’s window.</TileEmpty>
          )}
        </>
      )}
    </Tile>
  )
}

/** The full inbox — `content.replies`: the "?detail=replies" drawer body in
 *  the app, one slide in the `full` export. */
export function repliesBody(d: ContentData, mode: RenderMode): ReactNode {
  const app = mode === 'app'
  const filter = d.selection.intent
  const listed = filter ? d.inbox.rows.filter((r) => r.intent === filter) : d.inbox.rows
  const replyable = listed.filter((r) => r.intent !== 'misinformation')
  const flagged = listed.filter((r) => r.intent === 'misinformation')

  return (
    <div className="space-y-4">
      {replyable.length > 0 && (
        <div className="space-y-2.5">
          {replyable.map((row) => (
            <div key={row.id} className="rounded-lg bg-inner/40 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <IntentChip intent={row.intent} />
                <span className="truncate text-[11px] text-muted-foreground">{row.context}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                  <PlatformIcon platform={row.platform} className="text-secondary-foreground" />{platformLabel(row.platform)} · {row.age ?? '—'}
                </span>
              </div>
              <p className="mt-1.5 border-l-2 border-border/80 pl-2 text-[12.5px] italic leading-[1.45]">“{row.text}”</p>
              <div className="mt-1.5 flex items-center gap-3 text-[11.5px]">
                {app ? (
                  <Link href={`${basePath}?detail=engage-${row.insightId}${filter ? `&intent=${filter}` : ''}`} scroll={false} className="text-muted-foreground underline-offset-2 hover:underline">
                    Why it surfaced: {prettyTheme(row.theme)}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Why it surfaced: {prettyTheme(row.theme)}</span>
                )}
                <ReplyLink row={row} mode={mode} className="ml-auto" />
              </div>
            </div>
          ))}
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
              <p key={row.id} className="border-l-2 border-border/80 pl-2 text-[12.5px] italic leading-[1.45]">
                “{row.text}”
                <span className="ml-2 not-italic text-[11px] text-muted-foreground">{platformLabel(row.platform)} · {row.age ?? '—'}</span>
              </p>
            ))}
          </div>
        </div>
      )}
      {listed.length === 0 && <p className="text-muted-foreground">Nothing fresh to jump into this update.</p>}
      {app && (
        <p className="text-[11px] text-muted-foreground">
          The commenter’s own handle is never shown — the link is how a reply gets written.
        </p>
      )}
    </div>
  )
}

/** "Why it surfaced" — one insight's evidence (?detail=engage-&lt;id&gt;),
 *  app-only (never printed, so it carries no renderable key). */
export function EngageDetailBody({ detail }: { detail: EngageInsightDetail }) {
  return (
    <div className="space-y-3">
      {detail.description && <p className="text-[12.5px] text-muted-foreground">{detail.description}</p>}
      <div className="space-y-1.5">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">In their words</p>
        {detail.quotes.map((q, i) => (
          <p key={i} className="border-l-2 border-border/80 pl-2 text-[12.5px] italic leading-[1.45]">
            “{q.text}”
            <span className="ml-2 not-italic text-[11px] text-muted-foreground">{platformLabel(q.platform)}</span>
          </p>
        ))}
      </div>
    </div>
  )
}
