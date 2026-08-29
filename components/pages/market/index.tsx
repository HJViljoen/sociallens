import Link from 'next/link'
import type { ReactNode } from 'react'
import type { GateTier } from '@/lib/curation'
import { glossaryRule, priorityWord } from '@/lib/calibration'
import { fmtInt, weekdayDate, shortDate, platformLabel } from '@/lib/format'
import { claimVerdict, claimCountsLine, newsRingChip, type ClaimTone } from '@/lib/market-tiles'
import { HowToRead } from '@/components/how-to-read'
import { ExportMenu, ExportScope } from '@/components/export-menu'
import { PageFrame, PageBar, BarPill } from '@/components/shell/page-grid'
import { Tile, TileBlock, TileEmpty } from '@/components/shell/tile'
import { MasterDetail } from '@/components/shell/master-detail'
import { PaneHeader, PaneBody, RailGroup, RailLink, Segmented, ListRows, ListRow, PaneEmpty, DetailHeader, DetailSection, Verbatim } from '@/components/shell/master-list'
import { ListSearch } from '@/components/shell/list-search'
import {
  loadMarket, isMarketEmpty, marketHref, type MarketData, type MarketEmpty, type MarketDetail, type Group,
} from '@/lib/pages/market'
import type { PageModule, RenderMode, Renderable, Slide } from '@/lib/renderables/types'
import type { CiSummary } from '@/lib/pipeline/schemas'

// Market Intelligence renderers — the JSX half of the old page (split
// 2026-08-29, Reports & Exports T5), one pure function per pane/tile. `mode`
// changes only what has no meaning on paper: the rail/list selection Links,
// ListSearch, the cross-page link to Voice of Customer. The detail pane is
// laid out single-column in the app (the pane beside rail/list) and two-
// column when it stands alone on its own slide (dashboard.brief's pattern).

type D = MarketData
type R = (data: D, mode: RenderMode) => ReactNode

const prettyType = (s: string) => s.replace(/_/g, ' ')
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

const TONE: Record<ClaimTone | 'warning', string> = {
  positive: 'bg-accent text-accent-foreground',
  clay: 'bg-negative/12 text-negative',
  sand: 'bg-inner text-muted-foreground',
  warning: 'bg-warning/15 text-warning',
}

function Chip({ tone = 'sand', title, children }: { tone?: ClaimTone | 'warning'; title?: string; children: ReactNode }) {
  return <span title={title} className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-medium ${TONE[tone]}`}>{children}</span>
}

/** The score replacement: judgment as a word, never a number. */
function EvidenceChip({ tier }: { tier: GateTier }) {
  if (tier === 'confirmed') return <Chip tone="positive" title={glossaryRule('strong_evidence')}>Strong evidence</Chip>
  if (tier === 'early_signal') return <Chip tone="warning" title={glossaryRule('early_signal')}>Early signal</Chip>
  return null
}

const PRIORITY_TIP: Record<string, string> = {
  'Act now': glossaryRule('act_now'),
  'Plan next': glossaryRule('plan_next'),
  'Worth considering': glossaryRule('worth_considering'),
}

/** Calibrated, positional priority word — "Act now" appears once per update. */
function PriorityChip({ word }: { word: string }) {
  return <Chip tone={word === 'Act now' ? 'warning' : 'sand'} title={PRIORITY_TIP[word]}>{word}</Chip>
}

const voiceHref = (themes: string[]) => `/dashboard/voice?themes=${encodeURIComponent(themes.join(','))}#grounding`

/** Cross-page link to Voice of Customer — a link in the app, a plain chip row
 *  on paper (nothing there can be clicked). */
function ThemeChips({ themes, mode }: { themes: string[]; mode: RenderMode }) {
  if (themes.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {themes.map((t) => mode === 'app' ? (
        <Link key={t} href={`/dashboard/voice?themes=${encodeURIComponent(t)}`} className="rounded-full bg-inner px-2 py-px text-[10.5px] text-muted-foreground transition-colors hover:text-foreground">
          {prettyType(t)}
        </Link>
      ) : (
        <span key={t} className="rounded-full bg-inner px-2 py-px text-[10.5px] text-muted-foreground">{prettyType(t)}</span>
      ))}
    </div>
  )
}

const QUADRANTS: { key: keyof CiSummary; title: string; dot: string }[] = [
  { key: 'top_unmet_needs', title: 'Unmet needs', dot: 'bg-comp' },
  { key: 'top_buying_triggers', title: 'Buying triggers', dot: 'bg-you' },
  { key: 'top_differentiators', title: 'Who stands out', dot: 'bg-cat' },
  { key: 'threats', title: 'Threats to watch', dot: 'bg-warning' },
]

// ── the short read: four blocks across, above the fold ──────────────────
// On screen this tile sits outside the grid and grows to its content; on
// paper it is a grid item, and four quadrants of prose need three rows.
const shortRead: R = (d, mode) => (
  <Tile exportKey="market.shortRead" col={12} row={mode === 'print' ? 3 : 2} eyebrow="The short read" meta={weekdayDate(d.runDate)} bodyClassName="justify-center">
    {d.shortRead ? (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-print-cols="4">
        {QUADRANTS.map((q) => {
          const items = d.shortRead!.find((s) => s.key === q.key)?.items ?? []
          return (
            <TileBlock key={q.key} className="flex flex-col gap-2 shadow-block">
              <p className="flex items-center gap-1.5 text-[12.5px] font-semibold"><span className={`size-1.5 rounded-full ${q.dot}`} aria-hidden />{q.title}</p>
              {items.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {items.map((it, i) => <li key={i} className="text-[12.5px] leading-[1.45] text-secondary-foreground">{it}</li>)}
                </ul>
              ) : <p className="text-[12px] text-muted-foreground">— nothing stood out here this update</p>}
            </TileBlock>
          )
        })}
      </div>
    ) : <TileEmpty>The short read lands with your next update.</TileEmpty>}
  </Tile>
)

// ── in the news: a dated feed, headlines linking out ─────────────────────
const NEWS_ON_PAPER = 18 // three columns × six rows on a four-row slide

const news: R = (d, mode) => {
  // On paper the anchor wrapper must not be the grid item (it would span one
  // column): data-print-contents lifts the Tile into the print grid; with
  // headlines the feed takes a four-row slide of its own, capped at what fits.
  const items = mode === 'print' ? d.news.items.slice(0, NEWS_ON_PAPER) : d.news.items
  const more = d.news.items.length - items.length
  return (
  <div id="news" className="scroll-mt-3 xl:col-span-12 xl:row-span-2" data-print-contents="">
    <Tile exportKey="market.news" col={12} row={mode === 'print' ? (d.news.items.length ? 4 : 1) : 2} eyebrow="In the news"
      meta={d.news.total > 0 ? `${fmtInt(d.news.total)} ${plural(d.news.total, 'headline')} · newest first${more > 0 ? ` · ${more} more in the app` : ''}` : undefined}
      footerNote="Coverage of your brand, competitors and category — context beside the conversation, never a claimed cause of anything measured.">
      {items.length > 0 ? (
        <ol className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3" data-print-cols="3">
          {items.map((n, i) => {
            const chip = newsRingChip(n.ring)
            return (
              <li key={i} className="border-b border-border/70 py-2">
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="group block">
                  <p className="line-clamp-2 text-[12.5px] font-medium leading-[1.35] group-hover:underline">{n.title}</p>
                  <p className="mt-1 flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
                    <span className="shrink-0 font-sans font-medium text-secondary-foreground" title={glossaryRule('news')}>{chip.label}</span>
                    <span className="truncate">· {n.sourceRef}{n.publishedAt ? ` · ${shortDate(n.publishedAt)}` : ''}</span>
                  </p>
                </a>
              </li>
            )
          })}
        </ol>
      ) : <TileEmpty>Nothing in the news this week.</TileEmpty>}
    </Tile>
  </div>
)
}

// ── rail ────────────────────────────────────────────────────────────────
function RailGroupPrint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-2 py-2">
      <p className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/80">{label}</p>
      <ul className="flex flex-col gap-px">{children}</ul>
    </div>
  )
}
function RailRowPrint({ active, count, children }: { active?: boolean; count?: number; children: ReactNode }) {
  return (
    <li className={`flex items-center gap-2 rounded-[4px] px-2 py-1.5 text-[12.5px] ${active ? 'bg-inner font-semibold text-foreground' : 'text-secondary-foreground'}`}>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count != null && <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{count}</span>}
    </li>
  )
}

const rail: R = (d, mode) => {
  const app = mode === 'app'
  const { group } = d.selection
  const { rail: r } = d
  return app ? (
    <>
      <PaneHeader title="This update" meta={weekdayDate(d.runDate)} />
      <PaneBody>
        <RailGroup label="Decide">
          <RailLink href={marketHref('recs')} active={group === 'recs'} count={r.recs}>Recommendations</RailLink>
          <RailLink href={marketHref('insights')} active={group === 'insights'} count={r.insights}>Key insights</RailLink>
        </RailGroup>
        <RailGroup label="Your brand">
          <RailLink href={marketHref('claims')} active={group === 'claims'} count={r.claims}>Say vs hear</RailLink>
          <RailLink href={marketHref('about')} active={group === 'about'} count={r.about}>Said about you</RailLink>
        </RailGroup>
        <RailGroup label="Context">
          <RailLink href="#news" count={r.newsTotal}>In the news ↓</RailLink>
        </RailGroup>
      </PaneBody>
    </>
  ) : (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border/70 px-4 pt-3.5 pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-secondary-foreground">This update</h2>
          <span className="font-mono text-[11px] text-muted-foreground">{weekdayDate(d.runDate)}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <RailGroupPrint label="Decide">
          <RailRowPrint active={group === 'recs'} count={r.recs}>Recommendations</RailRowPrint>
          <RailRowPrint active={group === 'insights'} count={r.insights}>Key insights</RailRowPrint>
        </RailGroupPrint>
        <RailGroupPrint label="Your brand">
          <RailRowPrint active={group === 'claims'} count={r.claims}>Say vs hear</RailRowPrint>
          <RailRowPrint active={group === 'about'} count={r.about}>Said about you</RailRowPrint>
        </RailGroupPrint>
        <RailGroupPrint label="Context">
          <RailRowPrint count={r.newsTotal}>In the news</RailRowPrint>
        </RailGroupPrint>
      </div>
    </>
  )
}

// ── list ────────────────────────────────────────────────────────────────
const LIST_TITLE: Record<Group, string> = { recs: 'Recommendations', insights: 'Key insights', claims: 'What you say vs what they hear', about: 'Said about you' }
const LIST_ID = 'market-list'

function ListRowPrint({ active, search, children }: { href?: string; active?: boolean; search?: string; children: ReactNode; className?: string }) {
  return (
    <li data-search={search?.toLowerCase()} className="px-2 first:pt-2 last:pb-2">
      <div className={`block rounded-[4px] px-3 py-2.5 ${active ? 'bg-inner ring-1 ring-border' : ''}`}>{children}</div>
    </li>
  )
}

const list: R = (d, mode) => {
  const app = mode === 'app'
  const { group, itemId, filter } = d.selection
  const l = d.list
  const Row = app ? ListRow : ListRowPrint

  const meta =
    l.group === 'recs' ? (l.total > 0 ? `${l.total} ${plural(l.total, 'recommendation')} · ordered by evidence` : undefined)
    : l.group === 'insights' ? (l.total > 0 ? `${l.tierTotals.confirmed} confirmed · ${l.tierTotals.early} early · ${l.tierTotals.archive} below the bar` : undefined)
    : l.group === 'claims' ? (l.total > 0 ? claimCountsLine(l.counts) : undefined)
    : (l.total > 0 ? `${l.total} ${plural(l.total, 'mention')} in other people’s videos` : undefined)

  const tierFilter = (l.group === 'recs' || l.group === 'insights') && app ? (
    <Segmented items={[
      { href: marketHref(group, undefined, 'all'), label: 'All', active: filter === 'all' },
      { href: marketHref(group, undefined, 'strong'), label: 'Strong evidence', active: filter === 'strong', count: l.group === 'recs' ? l.filterCounts.strong : l.tierTotals.confirmed },
      { href: marketHref(group, undefined, 'early'), label: 'Early signal', active: filter === 'early', count: l.group === 'recs' ? l.filterCounts.early : l.tierTotals.early },
    ]} />
  ) : null

  return (
    <>
      <PaneHeader title={LIST_TITLE[l.group]} meta={meta}>
        {app && l.rows.length > 3 && <ListSearch scope={LIST_ID} placeholder={`Search ${LIST_TITLE[l.group].toLowerCase()}…`} />}
        {tierFilter}
      </PaneHeader>
      <PaneBody>
        <div id={LIST_ID}>
          {l.group === 'recs' && (l.rows.length > 0 ? (
            <ListRows>
              {l.rows.map((row) => (
                <Row key={row.id} href={marketHref('recs', row.id, filter)} active={row.id === itemId} search={`${row.title} ${row.reasoning} ${prettyType(row.type)}`}>
                  <div className="flex items-start gap-2.5">
                    <span className="w-4 shrink-0 font-mono text-[12px] font-semibold tabular-nums text-muted-foreground">{row.rank + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{row.title}</p>
                      <p className="mt-0.5 line-clamp-1 text-[11.5px] text-muted-foreground">{row.reasoning}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <PriorityChip word={priorityWord(row.rank)} />
                        <EvidenceChip tier={row.tier} />
                        {row.conversations > 0 && <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">{fmtInt(row.conversations)} conv.</span>}
                      </div>
                    </div>
                  </div>
                </Row>
              ))}
            </ListRows>
          ) : <PaneEmpty>{l.total > 0 ? 'Nothing at this evidence level.' : 'Recommendations land with your next update.'}</PaneEmpty>)}

          {l.group === 'insights' && (l.rows.length > 0 ? (
            <ListRows>
              {l.rows.map((row) => (
                <Row key={row.id} href={marketHref('insights', row.id, filter)} active={row.id === itemId} search={`${row.title} ${row.description} ${prettyType(row.type)}`}>
                  <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{row.title}</p>
                  <p className="mt-0.5 line-clamp-1 text-[11.5px] text-muted-foreground">{row.description}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <EvidenceChip tier={row.tier} />
                    <span className="text-[10.5px] capitalize text-muted-foreground">{prettyType(row.type)}</span>
                    {row.conversations > 0 && <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">· {fmtInt(row.conversations)} conv.</span>}
                  </div>
                </Row>
              ))}
            </ListRows>
          ) : <PaneEmpty>{l.total > 0 ? 'Nothing at this evidence level.' : 'Findings land with your next update.'}</PaneEmpty>)}

          {l.group === 'claims' && (l.rows.length > 0 ? (
            <ListRows>
              {l.rows.map((row) => {
                const v = claimVerdict(row.audience)
                return (
                  <Row key={row.id} href={marketHref('claims', row.id)} active={row.id === itemId} search={`${row.youSay} ${row.yourQuote} ${row.theySay ?? ''} ${row.gap}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-[13px] font-semibold leading-[1.3]">{row.youSay}</p>
                      <Chip tone={v.tone} title={glossaryRule('say_vs_hear')}>{v.label}</Chip>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-[11.5px] text-muted-foreground">{row.theySay ?? 'nobody in the tracked conversation mentions this yet'}</p>
                  </Row>
                )
              })}
            </ListRows>
          ) : <PaneEmpty>Lands once your own videos have been analysed.</PaneEmpty>)}

          {l.group === 'about' && (l.rows.length > 0 ? (
            <ListRows>
              {l.rows.map((row) => (
                <Row key={row.id} href={marketHref('about', row.id)} active={row.id === itemId} search={`${row.quote.text} ${row.claim} ${row.account}`}>
                  <p className="line-clamp-2 font-serif text-[13px] leading-[1.4]">“{row.quote.text}”</p>
                  <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">{row.account}{row.platform ? ` · ${platformLabel(row.platform)}` : ''}</p>
                </Row>
              ))}
            </ListRows>
          ) : <PaneEmpty>Nothing said about you in other people’s videos yet.</PaneEmpty>)}
        </div>
      </PaneBody>
    </>
  )
}

// ── detail: the selected item in full ──────────────────────────────────
/** Grounded-in stats + theme chips, shared by every kind that has grounding
 *  (recs, insights). */
function GroundedIn({ conv, voices, platforms, themes, mode }: { conv: number; voices: number; platforms: { label: string; count: number }[]; themes: string[]; mode: RenderMode }) {
  return (
    <>
      <p className="text-[12.5px] text-secondary-foreground">
        {conv > 0 ? <><span className="font-mono font-semibold text-foreground">{fmtInt(conv)}</span> {plural(conv, 'conversation')}</> : 'its supporting insights'}
        {voices > 0 && <> · <span className="font-mono font-semibold text-foreground">{fmtInt(voices)}</span> {plural(voices, 'voice')}</>}
      </p>
      {platforms.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10.5px] tabular-nums text-muted-foreground">
          {platforms.map((p) => <span key={p.label}>{p.label} {p.count}</span>)}
        </p>
      )}
      <div className="mt-2"><ThemeChips themes={themes} mode={mode} /></div>
    </>
  )
}

function QuoteList({ quotes }: { quotes: { text: string }[] }) {
  if (quotes.length === 0) return null
  return <div className="flex flex-col gap-2.5">{quotes.map((q, i) => <Verbatim key={i} quote={q.text} />)}</div>
}

/** The single-column pane version — the detail pane beside rail/list, app mode. */
function DetailPane({ d, mode }: { d: D; mode: RenderMode }) {
  const item = d.detail
  const app = mode === 'app'
  if (item.kind === 'empty') return <PaneEmpty>Select an item to read it in full.</PaneEmpty>

  if (item.kind === 'rec') {
    return (
      <>
        <DetailHeader eyebrow={`Recommendation ${item.rank + 1} of ${item.total}`} title={item.title}>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <PriorityChip word={priorityWord(item.rank)} />
            <EvidenceChip tier={item.tier} />
            <Chip>{prettyType(item.type)}</Chip>
          </div>
        </DetailHeader>
        <PaneBody>
          <DetailSection label="Why"><p className="text-[13px] leading-[1.55] text-foreground">{item.reasoning}</p></DetailSection>
          <DetailSection label="Grounded in"><GroundedIn conv={item.conversations} voices={item.voices} platforms={item.platforms} themes={item.themes} mode={mode} /></DetailSection>
          {item.quotes.length > 0 && <DetailSection label="In their words"><QuoteList quotes={item.quotes} /></DetailSection>}
          {app && item.themes.length > 0 && (
            <DetailSection><Link href={voiceHref(item.themes)} className="text-[12.5px] font-medium hover:underline">See all the voices in Voice of Customer →</Link></DetailSection>
          )}
        </PaneBody>
      </>
    )
  }

  if (item.kind === 'insight') {
    return (
      <>
        <DetailHeader eyebrow={prettyType(item.type)} title={item.title}>
          <div className="mt-2 flex flex-wrap items-center gap-1"><EvidenceChip tier={item.tier} />{item.tier === 'archive' && <Chip>Below the evidence bar this update</Chip>}</div>
        </DetailHeader>
        <PaneBody>
          <DetailSection label="What we heard"><p className="text-[13px] leading-[1.55] text-foreground">{item.description}</p></DetailSection>
          <DetailSection label="Grounded in"><GroundedIn conv={item.conversations} voices={item.voices} platforms={item.platforms} themes={item.themes} mode={mode} /></DetailSection>
          {item.quotes.length > 0 && <DetailSection label="In their words"><QuoteList quotes={item.quotes} /></DetailSection>}
          {app && item.themes.length > 0 && (
            <DetailSection><Link href={voiceHref(item.themes)} className="text-[12.5px] font-medium hover:underline">See supporting voices in Voice of Customer →</Link></DetailSection>
          )}
          {d.singleSourceThemes.length > 0 && d.selection.filter !== 'strong' && (
            <DetailSection label="Heard once this update">
              <div className="flex flex-wrap items-center gap-1">
                {d.singleSourceThemes.map((t, i) => (
                  <span key={i} title={t.description ?? undefined} className="rounded-full bg-inner px-2 py-px text-[10.5px] text-muted-foreground">{t.label}</span>
                ))}
                {d.singleSourceTotal > d.singleSourceThemes.length && <span className="text-[10.5px] text-muted-foreground">+{d.singleSourceTotal - d.singleSourceThemes.length} more</span>}
              </div>
            </DetailSection>
          )}
        </PaneBody>
      </>
    )
  }

  if (item.kind === 'claim') {
    const v = claimVerdict(item.audience)
    return (
      <>
        <DetailHeader eyebrow="You say" title={item.youSay}>
          <div className="mt-2"><Chip tone={v.tone} title={glossaryRule('say_vs_hear')}>{v.label}</Chip></div>
        </DetailHeader>
        <PaneBody>
          <DetailSection label="In your own video"><Verbatim quote={item.yourQuote} cite="your own video" /></DetailSection>
          <DetailSection label="They hear">
            {item.theySay ? <p className="text-[13px] leading-[1.55]">{item.theySay}</p> : <p className="text-[13px] text-muted-foreground">— nobody in the tracked conversation mentions this yet</p>}
          </DetailSection>
          <DetailSection label="The gap">
            <p className="text-[12.5px] leading-[1.5] text-secondary-foreground">{item.gap}</p>
            <div className="mt-2"><ThemeChips themes={item.themes} mode={mode} /></div>
            {app && item.themes.length > 0 && <Link href={voiceHref(item.themes)} className="mt-2 inline-block text-[12.5px] font-medium hover:underline">See the voices →</Link>}
          </DetailSection>
        </PaneBody>
      </>
    )
  }

  // about
  return (
    <>
      <DetailHeader eyebrow="Said about you" title={item.claim} meta={`${item.account}${item.platform ? ` · ${platformLabel(item.platform)}` : ''}`} />
      <PaneBody>
        <DetailSection label="In their words"><Verbatim quote={item.quote.text} cite={item.account} /></DetailSection>
        {item.url && (
          <DetailSection><a href={item.url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-medium hover:underline">Watch the video →</a></DetailSection>
        )}
      </PaneBody>
    </>
  )
}

/** The two-column slide version — the detail pane's content alone, print
 *  mode, matching dashboard.brief's `grid-cols-[3fr_2fr]` pattern. */
function DetailSlideBody({ d, item }: { d: D; item: MarketDetail }) {
  if (item.kind === 'empty') return <p className="text-[12px] text-muted-foreground">Nothing selected.</p>

  if (item.kind === 'rec' || item.kind === 'insight') {
    const eyebrow = item.kind === 'rec' ? `Recommendation ${item.rank + 1} of ${item.total}` : prettyType(item.type)
    const title = item.title
    const body = item.kind === 'rec' ? item.reasoning : item.description
    const bodyLabel = item.kind === 'rec' ? 'Why' : 'What we heard'
    return (
      <div className="grid h-full min-h-0 grid-cols-[3fr_2fr] gap-6">
        <div className="min-h-0 space-y-4 overflow-hidden">
          <div>
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-secondary-foreground">{eyebrow}</p>
            <h3 className="text-[15px] font-semibold leading-[1.3] tracking-[-0.005em] [text-wrap:pretty]">{title}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {item.kind === 'rec' && <PriorityChip word={priorityWord(item.rank)} />}
              <EvidenceChip tier={item.tier} />
              {item.kind === 'rec' && <Chip>{prettyType(item.type)}</Chip>}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{bodyLabel}</p>
            <p className="text-[13px] leading-[1.55] text-foreground">{body}</p>
          </div>
          {item.quotes.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">In their words</p>
              <QuoteList quotes={item.quotes} />
            </div>
          )}
        </div>
        <div className="min-h-0 overflow-hidden">
          <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Grounded in</p>
          <GroundedIn conv={item.conversations} voices={item.voices} platforms={item.platforms} themes={item.themes} mode="print" />
          {item.kind === 'insight' && d.singleSourceThemes.length > 0 && d.selection.filter !== 'strong' && (
            <div className="mt-4">
              <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Heard once this update</p>
              <div className="flex flex-wrap items-center gap-1">
                {d.singleSourceThemes.map((t, i) => <span key={i} className="rounded-full bg-inner px-2 py-px text-[10.5px] text-muted-foreground">{t.label}</span>)}
                {d.singleSourceTotal > d.singleSourceThemes.length && <span className="text-[10.5px] text-muted-foreground">+{d.singleSourceTotal - d.singleSourceThemes.length} more</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (item.kind === 'claim') {
    const v = claimVerdict(item.audience)
    return (
      <div className="grid h-full min-h-0 grid-cols-[3fr_2fr] gap-6">
        <div className="min-h-0 space-y-4 overflow-hidden">
          <div>
            <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-secondary-foreground">You say</p>
            <h3 className="text-[15px] font-semibold leading-[1.3] [text-wrap:pretty]">{item.youSay}</h3>
            <div className="mt-2"><Chip tone={v.tone}>{v.label}</Chip></div>
          </div>
          <div>
            <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">In your own video</p>
            <Verbatim quote={item.yourQuote} cite="your own video" />
          </div>
        </div>
        <div className="min-h-0 overflow-hidden space-y-4">
          <div>
            <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">They hear</p>
            {item.theySay ? <p className="text-[13px] leading-[1.55]">{item.theySay}</p> : <p className="text-[13px] text-muted-foreground">— nobody in the tracked conversation mentions this yet</p>}
          </div>
          <div>
            <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">The gap</p>
            <p className="text-[12.5px] leading-[1.5] text-secondary-foreground">{item.gap}</p>
            <div className="mt-2"><ThemeChips themes={item.themes} mode="print" /></div>
          </div>
        </div>
      </div>
    )
  }

  // about
  return (
    <div className="grid h-full min-h-0 grid-cols-[3fr_2fr] gap-6">
      <div className="min-h-0 overflow-hidden">
        <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-secondary-foreground">Said about you</p>
        <h3 className="text-[15px] font-semibold leading-[1.3] [text-wrap:pretty]">{item.claim}</h3>
        <div className="mt-3"><Verbatim quote={item.quote.text} cite={item.account} /></div>
      </div>
      <div className="min-h-0 overflow-hidden">
        <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Where</p>
        <p className="text-[12.5px] text-secondary-foreground">{item.account}{item.platform ? ` · ${platformLabel(item.platform)}` : ''}</p>
      </div>
    </div>
  )
}

const detail: R = (d, mode) => (mode === 'app' ? <DetailPane d={d} mode={mode} /> : <DetailSlideBody d={d} item={d.detail} />)

const renderables: Record<string, Renderable<D>> = {
  'market.shortRead': { key: 'market.shortRead', title: 'The short read', render: shortRead },
  'market.news': { key: 'market.news', title: 'In the news', render: news },
  'market.rail': { key: 'market.rail', title: 'This update', render: rail },
  'market.list': { key: 'market.list', title: 'The list', render: list },
  'market.detail': { key: 'market.detail', title: 'The selected item', render: detail },
}

/** One `full`-export item slide — key `market.item:<n>`, resolved through the
 *  Proxy below (Voice's pattern) so the module stays a fixed catalogue. */
const ITEM_SLIDE_PREFIX = 'market.item:'

export function marketItemSlide(n: number): Renderable<D> {
  return {
    key: `${ITEM_SLIDE_PREFIX}${n}`,
    title: 'Item',
    render: (d) => {
      const item = d.fullItems?.[n]
      return item ? <DetailSlideBody d={d} item={item} /> : null
    },
  }
}

const GROUP_TITLE: Record<Group, string> = { recs: 'Recommendation', insights: 'Insight', claims: 'Claim', about: 'Said about you' }

export const marketPage: PageModule<D> = {
  key: 'market',
  title: 'Market Intelligence',
  async load(scope) {
    const d = await loadMarket(scope)
    return isMarketEmpty(d) ? null : d
  },
  slides(d, variant): Slide[] {
    const slides: Slide[] = [
      // With headlines the feed takes its own slide (four rows); without, one
      // quiet row beneath the short read says so.
      ...(d.news.items.length
        ? [{ title: 'The short read', keys: ['market.shortRead'], layout: 'grid' as const }, { title: 'In the news', keys: ['market.news'], layout: 'grid' as const }]
        : [{ title: 'The short read', keys: ['market.shortRead', 'market.news'], layout: 'grid' as const }]),
      { title: 'The selected item', keys: ['market.detail'], layout: 'single' },
    ]
    if (variant === 'full') {
      const n = d.fullItems?.length ?? 0
      for (let i = 0; i < n; i++) slides.push({ title: `${GROUP_TITLE[d.selection.group]} · ${i + 1}`, keys: [`${ITEM_SLIDE_PREFIX}${i}`], layout: 'single' })
    }
    return slides
  },
  renderables: new Proxy(renderables, {
    get(target, key: string) {
      if (key in target) return target[key]
      if (typeof key === 'string' && key.startsWith(ITEM_SLIDE_PREFIX)) return marketItemSlide(Number(key.slice(ITEM_SLIDE_PREFIX.length)))
      return undefined
    },
  }),
  snapshotTitle: (d) => `Market Intelligence · ${d.brand} · ${weekdayDate(d.runDate)}`,
}

/** The app page: page bar, the short read, the master-detail, the news feed. */
export function MarketPage({ data: d, detail: detailParam, params }: { data: MarketData | MarketEmpty; detail?: string; params: Record<string, string | undefined> }) {
  const showLegend = detailParam === 'legend'
  if (isMarketEmpty(d)) {
    return (
      <PageFrame>
        <PageBar title="Market Intelligence" context={`What should we do? · ${d.brand}`}>
          <HowToRead items={d.legendItems} open={showLegend} basePath="/dashboard/market" />
        </PageBar>
        <section className="rounded-lg bg-tile p-6 shadow-tile">
          <p className="text-[12px] text-muted-foreground">Your market intelligence lands with your first update — check back then.</p>
        </section>
      </PageFrame>
    )
  }
  return (
    <ExportScope page="market" params={params} tiles={Object.values(renderables).map((r) => ({ key: r.key, title: r.title }))}>
    <PageFrame className="min-h-0 flex-1">
      <PageBar title="Market Intelligence" context={d.context}>
        <ExportMenu />
        <BarPill active>This update</BarPill>
        <HowToRead items={d.legendItems} open={showLegend} basePath="/dashboard/market" />
      </PageBar>
      {shortRead(d, 'app')}
      <MasterDetail id="market" className="md:h-[640px]" rail={rail(d, 'app')} list={list(d, 'app')} detail={detail(d, 'app')} />
      {news(d, 'app')}
    </PageFrame>
    </ExportScope>
  )
}
