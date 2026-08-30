import type { RunDelta } from '../../lib/report-delta'
import type { DeltaVerdict } from '../../lib/report-bands'
import type { DashboardData } from '../../lib/pages/dashboard'
import { fmtInt, shortDate } from '../../lib/format'
import { Chip, Row, Section } from './primitives'

/**
 * The block the digest leads with: what moved since the previous update, each
 * proportion carrying its own banded verdict (T0-8 — an arrow means it
 * cleared a 2×SE band on denominators big enough to carry it; anything else
 * says so in words). On a first update there is nothing to compare, so it
 * says where you stand.
 */

function verdictChip(v: DeltaVerdict, unit: string) {
  if (v.state === 'too_little_data') return <Chip tone="neutral">too little data</Chip>
  if (v.state === 'no_clear_change') return <Chip tone="neutral">no clear change</Chip>
  const up = v.change > 0
  return <Chip tone={up ? 'up' : 'down'}>{up ? '▲' : '▼'} {Math.abs(Math.round(v.change * 10) / 10)}{unit}</Chip>
}

export function DeltaBlock({ delta, dashboard, appUrl }: { delta: RunDelta | null | undefined; dashboard: DashboardData | null; appUrl: string }) {
  if (delta) {
    const moved = [delta.sentiment?.verdict.state, delta.share?.verdict.state].includes('moved')
    const rows = []
    if (delta.sentiment) {
      const s = delta.sentiment
      rows.push(
        <Row key="s" label="Sentiment" chip={verdictChip(s.verdict, ' pts')} href={`${appUrl}/dashboard`} linkText="See where you stand">
          <strong>{s.now}%</strong> of the {fmtInt(s.nowJudged)} conversations rated for sentiment read positive
        </Row>,
      )
    }
    if (delta.share) {
      const sh = delta.share
      const comp = sh.now.competitor
      rows.push(
        <Row key="sh" label="Share of tracked conversation" chip={verdictChip(sh.verdict, ' pts')} href={`${appUrl}/dashboard/competitive`} linkText="See the competitive picture">
          You <strong>{sh.now.client}%</strong>{comp ? <> · {comp.name} <strong>{comp.pct}%</strong></> : null} of the {fmtInt(sh.now.totalVideos)} videos tracked
        </Row>,
      )
    }
    if (delta.newThemes && delta.newThemes.count > 0) {
      const n = delta.newThemes
      rows.push(
        <Row key="t" label="New themes" chip={<Chip tone="neutral">{n.count} new</Chip>} href={`${appUrl}/dashboard/voice`} linkText="Hear them">
          {n.labels.length ? <>{n.labels.join(' · ')}{n.count > n.labels.length ? ` and ${n.count - n.labels.length} more` : ''}</> : `${n.count} theme${n.count === 1 ? '' : 's'} not heard in your previous update`}
        </Row>,
      )
    }
    if (delta.conversations) {
      const c = delta.conversations
      const diff = c.now - c.prev
      rows.push(
        <Row key="c" label="Comments read" chip={diff !== 0 ? <Chip tone="neutral">{diff > 0 ? '+' : '−'}{fmtInt(Math.abs(diff))}</Chip> : undefined}>
          <strong>{fmtInt(c.now)}</strong> this update, against {fmtInt(c.prev)} last time
        </Row>,
      )
    }
    if (!rows.length) return null
    return (
      <Section title={moved ? 'What changed since your last update' : 'Where you stand this update'} meta={`since ${shortDate(delta.prevRunDate)}`}>
        {rows}
      </Section>
    )
  }

  // A first update: a baseline, framed as state.
  const s = dashboard?.sentiment ?? null
  const sh = dashboard?.share ?? null
  if (!s && !sh) return null
  return (
    <Section title="Where you stand" meta="your first update">
      {s ? (
        <Row label="Sentiment" href={`${appUrl}/dashboard`} linkText="See where you stand">
          <strong>{Math.round(s.positivePct)}%</strong> of the {fmtInt(s.judged)} conversations rated for sentiment read positive
        </Row>
      ) : null}
      {sh?.client ? (
        <Row label="Share of tracked conversation" href={`${appUrl}/dashboard/competitive`} linkText="See the competitive picture">
          You <strong>{Math.round(sh.client.pct * 10) / 10}%</strong>{sh.topCompetitor ? <> · {sh.topCompetitor.name} <strong>{Math.round(sh.topCompetitor.pct * 10) / 10}%</strong></> : null} of the videos tracked
        </Row>
      ) : null}
    </Section>
  )
}
