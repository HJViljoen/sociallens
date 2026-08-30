import { Fragment, type ReactNode } from 'react'
import type { EmailContext } from '../../lib/renderables/types'
import { BUCKET_COLOR, priorityLabel, type DashboardData } from '../../lib/pages/dashboard'
import type { ContentData } from '../../lib/pages/content'
import type { CompetitiveData } from '../../lib/pages/competitive'
import { INTENT_LABEL } from '../../lib/content-tiles'
import { fmtCompact, fmtInt, fmtPct, platformLabel, shortDate } from '../../lib/format'
import { firstSentence } from '../../lib/email/text'
import { EMAIL, FONT, tokenHex } from '../../lib/email/theme'
import { Badge, Bar, Columns, DeltaText, Img, Quote, RankedRow, Stat, text } from './primitives'

/**
 * Email renderers (Stage 3) — the same tile-ready data the dashboard and the
 * paper draw from, said in tables and inline styles. Each returns the tile's
 * CONTENT; the document wraps it in a titled section. A chart that needs a
 * line (a sparkline) comes as a PNG the runner rendered, with the numbers in
 * words beside it so an image-blocking client still reads the tile.
 */

type E<D> = (data: D, ctx: EmailContext) => ReactNode

const row = (cells: ReactNode[], opts: { widths?: (string | number | undefined)[]; aligns?: ('left' | 'right')[] } = {}) => (
  <tr>
    {cells.map((c, i) => (
      <td key={i} width={opts.widths?.[i]} align={opts.aligns?.[i] ?? 'left'} style={{ ...text.body, fontSize: 12.5, padding: '4px 0', verticalAlign: 'middle', whiteSpace: opts.aligns?.[i] === 'right' ? 'nowrap' : undefined }}>{c}</td>
    ))}
  </tr>
)
const table = (rows: ReactNode[]) => (
  <table width="100%" role="presentation" cellPadding={0} cellSpacing={0} border={0} style={{ borderCollapse: 'collapse' }}>
    <tbody>{rows.map((r, i) => <Fragment key={i}>{r}</Fragment>)}</tbody>
  </table>
)
const empty = (s: string) => <div style={text.small}>{s}</div>
/** A quote in an inbox is read in a glance; the app shows the whole comment. */
export function clip(s: string, max = 280): string {
  const t = s.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const at = cut.lastIndexOf(' ')
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:—-]+$/, '')}…`
}

// ── dashboard ──────────────────────────────────────────────────────────────

const strip: E<DashboardData> = ({ strip: s }) => (
  <div>
    <Columns
      cells={[
        s.videos.now != null
          ? <Stat value={fmtInt(s.videos.now)} unit={s.videos.period ? 'videos this update' : 'videos tracked'} note={s.videos.prev != null ? <DeltaText value={s.videos.now - s.videos.prev} /> : null} />
          : empty('Counted with the first update.'),
        s.comments.now != null
          ? <Stat value={fmtInt(s.comments.now)} unit={s.comments.period ? 'comments analysed' : 'comments read'} note={s.comments.prev != null ? <DeltaText value={s.comments.now - s.comments.prev} good="up" /> : null} />
          : empty('Counted with the first update.'),
        s.tiers.confirmed + s.tiers.early + s.tiers.once > 0
          ? <Stat value={fmtInt(s.tiers.confirmed)} unit="themes confirmed" note={`${s.tiers.early} early · ${s.tiers.once} heard once`} />
          : empty('Themes land with the first analysed update.'),
      ]}
    />
    {s.platforms.length > 0 ? (
      <div style={{ ...text.small, marginTop: 10 }}>
        {s.termTotal > 0 ? `${s.termTotal} terms tracked · ` : ''}where the conversation is: {s.platforms.slice(0, 4).map((p) => `${platformLabel(p.platform)} ${fmtInt(p.count)}`).join(' · ')}
      </div>
    ) : null}
  </div>
)

const hero: E<DashboardData> = ({ hero: h }) => {
  if (!h.show) return empty('Your first brief lands with the next update.')
  return (
    <div>
      <div style={{ fontFamily: FONT.serif, fontSize: 18, fontWeight: 500, lineHeight: '1.35', color: EMAIL.ink }}>{h.headline}</div>
      {h.beats.slice(0, 3).map((b) => (
        <p key={b.metric} style={{ ...text.body, fontSize: 13, margin: '8px 0 0' }}>{b.before}<strong>{b.figure}</strong>{b.after}</p>
      ))}
      {h.quotes.slice(0, 2).map((q, i) => <Quote key={i} text={q.text} />)}
      {h.quotes.length > 0 && h.voices > 0 ? <div style={{ ...text.small, fontSize: 11, marginTop: 4 }}>{h.quotes.length > 1 ? 'two' : 'one'} of {fmtInt(h.voices)} voices behind the top recommendation</div> : null}
    </div>
  )
}

const sentiment: E<DashboardData> = ({ sentiment: s }) => {
  if (!s) return empty('Sentiment lands with the next update.')
  return (
    <div>
      <Stat value={fmtPct(s.positivePct, 0)} unit="positive" note={<>{fmtInt(s.judged)} conversations rated{s.deltaText ? <> · <span style={{ color: s.deltaText.good === null ? EMAIL.muted : s.deltaText.good ? EMAIL.up : EMAIL.down }}>{s.deltaText.text}</span></> : null}{s.tierLabel ? ` · ${s.tierLabel}` : ''}</>} />
      <div style={{ marginTop: 10 }}>
        <Bar segments={s.segments.map((seg) => ({ pct: seg.pct, color: tokenHex(seg.color), label: `${seg.label} ${fmtInt(seg.count)}` }))} />
      </div>
      <div style={{ ...text.small, marginTop: 6 }}>{s.segments.map((seg) => `${seg.label} ${fmtInt(seg.count)}`).join(' · ')}</div>
    </div>
  )
}

const share: E<DashboardData> = ({ share: s }) => {
  if (!s || !s.segments.length) return empty('Share lands once a competitor is tracked and analysed.')
  return (
    <div>
      <Bar segments={s.segments.map((seg) => ({ pct: seg.pct, color: tokenHex(seg.color), label: `${seg.label} ${fmtPct(seg.pct)}` }))} height={10} />
      <div style={{ marginTop: 8 }}>
        {table(s.segments.map((seg) => row([
          <span key="l"><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: tokenHex(seg.color), marginRight: 6, verticalAlign: 'middle' }} /><span style={{ verticalAlign: 'middle' }}>{seg.label}</span></span>,
          <span key="p" style={{ ...text.mono, fontWeight: 600 }}>{fmtPct(seg.pct)}</span>,
          <DeltaText key="d" value={seg.delta} unit=" pt" decimals={1} good={seg.good === 'up' ? 'up' : 'neutral'} />,
        ], { aligns: ['left', 'right', 'right'], widths: [undefined, 60, 70] })))}
      </div>
      <div style={{ ...text.small, marginTop: 6 }}>
        {s.client ? `${fmtInt(s.client.videos)} of your videos` : 'none of your videos'}{s.topCompetitor ? ` · ${fmtInt(s.topCompetitor.videos)} ${s.topCompetitor.name}` : ''}{s.rest ? ` · ${fmtInt(s.rest.videos)} category` : ''}.
        {s.client && s.topCompetitor ? (s.client.pct >= s.topCompetitor.pct ? ` You lead the tracked brands; ${s.topCompetitor.name} follows.` : ` ${s.topCompetitor.name} leads the tracked brands.`) : ''}
      </div>
    </div>
  )
}

const themes: E<DashboardData> = ({ themes: t }) => {
  if (!t.rows.length) return empty('Themes land with the first analysed update.')
  return (
    <div>
      {t.rows.map((r, i) => (
        <RankedRow key={`${i}-${r.label}`} label={r.label} dot color={tokenHex(BUCKET_COLOR[r.bucket])} pct={(r.conversations / t.max) * 100} count={fmtInt(r.conversations)} badge={r.isNew ? <Badge>New</Badge> : undefined} />
      ))}
      <div style={{ ...text.small, fontSize: 11, marginTop: 6 }}>conversations per theme · green you · grey category{t.topCompetitorName ? ` · orange ${t.topCompetitorName}` : ''}</div>
    </div>
  )
}

const MOVE: Record<string, { unit: string; good: 'up' | 'down' | 'neutral'; fmt: (n: number) => string; decimals: 0 | 1 }> = {
  yourShare: { unit: ' pt', good: 'up', fmt: (n) => fmtPct(n), decimals: 1 },
  compShare: { unit: ' pt', good: 'down', fmt: (n) => fmtPct(n), decimals: 1 },
  positive: { unit: ' pt', good: 'up', fmt: (n) => fmtPct(n, 0), decimals: 1 },
  volume: { unit: '', good: 'up', fmt: fmtCompact, decimals: 0 },
  themes: { unit: '', good: 'up', fmt: fmtInt, decimals: 0 },
}

const movement: E<DashboardData> = ({ movement: mv, updatesCount }, ctx) => {
  if (!mv) return empty('Your first comparison lands with the next update — two updates are needed to show movement.')
  return (
    <div>
      <Img src={ctx.image('dashboard.movement')} alt={`Movement since your first update, ${updatesCount} updates`} width={544} />
      <div style={{ marginTop: 8 }}>
        {table(mv.rows.map((r) => {
          const st = MOVE[r.key]
          return row([r.label, <span key="v" style={{ ...text.mono, fontWeight: 600 }}>{st.fmt(r.value)}</span>, <DeltaText key="d" value={r.delta} unit={st.unit} decimals={st.decimals} good={st.good} />], { aligns: ['left', 'right', 'right'], widths: [undefined, 64, 70] })
        }))}
      </div>
      <div style={{ ...text.small, fontSize: 11, marginTop: 4 }}>{updatesCount} updates · {shortDate(mv.dates[0])} → {shortDate(mv.dates[mv.dates.length - 1])} · change vs the previous update</div>
    </div>
  )
}

const recommendation: E<DashboardData> = ({ hero: h }, ctx) => {
  if (!h.oneThing) return empty('Recommendations land with the next update.')
  const why = firstSentence(h.oneThing.reasoning)
  return (
    <div>
      <div style={text.eyebrow}>{priorityLabel(h.oneThing.priority)}</div>
      <div style={{ ...text.body, fontSize: 15, fontWeight: 600, lineHeight: '1.3', marginTop: 4 }}>{h.oneThing.title}</div>
      {why ? <p style={{ ...text.body, fontSize: 13, margin: '6px 0 0', color: EMAIL.ink2 }}>{why}</p> : null}
      <div style={{ marginTop: 6 }}>
        <a href={`${ctx.appUrl}/dashboard/market?rec=${encodeURIComponent(h.oneThing.id)}`} style={{ color: EMAIL.link, fontFamily: FONT.sans, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
          {h.voices > 0 ? `Grounded in ${fmtInt(h.voices)} voices${h.platforms.length > 1 ? ` · ${h.platforms.length} platforms` : ''}` : 'Why, and the voices'} →
        </a>
      </div>
    </div>
  )
}

const accounts: E<DashboardData> = ({ accounts: a }, ctx) => {
  if (!a.series.length) return empty('Add your own handles in Settings to follow your accounts here.')
  return (
    <div>
      <Img src={ctx.image('dashboard.accounts')} alt="Followers over the last 30 days" width={300} />
      <div style={{ marginTop: 6 }}>
        {table(a.series.slice(0, 3).map((s) => row([platformLabel(s.platform), <span key="v" style={{ ...text.mono, fontWeight: 600 }}>{fmtCompact(s.latest)}</span>, <DeltaText key="d" value={s.deltaPct} unit="%" decimals={1} good="up" />], { aligns: ['left', 'right', 'right'], widths: [undefined, 64, 70] })))}
      </div>
      <div style={{ ...text.small, fontSize: 11, marginTop: 4 }}>followers · 30 days{a.topEvent ? ` · ${a.topEvent.magnitude_label}` : ''}</div>
    </div>
  )
}

export const dashboardEmail: Record<string, E<DashboardData>> = {
  'dashboard.strip': strip,
  'dashboard.hero': hero,
  'dashboard.sentiment': sentiment,
  'dashboard.share': share,
  'dashboard.themes': themes,
  'dashboard.movement': movement,
  'dashboard.recommendation': recommendation,
  'dashboard.accounts': accounts,
}

// ── content: worth a reply ─────────────────────────────────────────────────

const inbox: E<ContentData> = ({ inbox: ib }) => {
  if (!ib.rows.length) return empty('Nothing waiting for a reply this update.')
  return (
    <div>
      {ib.rows.slice(0, 3).map((r) => (
        <div key={r.id} style={{ marginBottom: 10 }}>
          <div style={text.eyebrow}>{INTENT_LABEL[r.intent]} · {platformLabel(r.platform)}{r.age ? ` · ${r.age}` : ''}</div>
          <Quote text={clip(r.text)} cite={<>{r.context}{r.href ? <> · <a href={r.href} style={{ color: EMAIL.link, fontWeight: 600, textDecoration: 'none' }}>Reply →</a></> : null}</>} />
        </div>
      ))}
      {ib.total > 3 ? <div style={{ ...text.small, fontSize: 11 }}>{ib.total - 3} more in the app</div> : null}
    </div>
  )
}

export const contentEmail: Record<string, E<ContentData>> = { 'content.inbox': inbox }

// ── competitive: where you stand ───────────────────────────────────────────

const standings: E<CompetitiveData> = ({ standings: st }) => {
  if (!st) return empty('Standings land once a competitor is tracked and analysed.')
  const rows = [...(st.client ? [{ ...st.client, you: true }] : []), ...st.competitors.map((c) => ({ ...c, you: false }))]
  return (
    <div>
      {rows.map((r) => (
        <RankedRow key={r.name} label={r.you ? <strong>You</strong> : r.name} color={r.you ? EMAIL.green : EMAIL.comp} pct={st.maxPct > 0 ? (r.pct / st.maxPct) * 100 : 0} count={fmtPct(r.pct)} badge={r.delta != null && r.delta !== 0 ? <DeltaText value={r.delta} unit=" pt" decimals={1} good={r.you ? 'up' : 'down'} /> : undefined} />
      ))}
      <div style={{ ...text.small, fontSize: 11, marginTop: 6 }}>share of the tracked conversation, by videos · change vs the previous update</div>
    </div>
  )
}

export const competitiveEmail: Record<string, E<CompetitiveData>> = { 'competitive.standings': standings }
