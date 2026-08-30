import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { digestSubject } from './subject'
import { firstSentence, htmlToText } from './text'
import { tokenHex } from './theme'
import { DeltaBlock } from '../../components/email/delta-block'
import { clip, dashboardEmail } from '../../components/email/tiles'
import type { RunDelta } from '../report-delta'
import type { DashboardData } from '../pages/dashboard'
import type { EmailContext } from '../renderables/types'
import { EMAIL } from './theme'

const delta: RunDelta = {
  prevRunDate: '2026-08-16T04:00:00Z',
  sentiment: { now: 87.2, prev: 83.8, verdict: { state: 'moved', change: 3.4, band: 2.1 }, nowJudged: 698, prevJudged: 640 },
  share: { now: { client: 5.1, clientVideos: 19, totalVideos: 374, competitor: { name: 'Ottobock', pct: 15 } }, prev: { client: 5.8, clientVideos: 22, totalVideos: 380, competitor: { name: 'Ottobock', pct: 14 } }, verdict: { state: 'no_clear_change', change: -0.7, band: 2 } },
  newThemes: { count: 3, labels: ['Socket pain and poor fit', 'Price and access questions'] },
  conversations: { now: 4626, prev: 6163 },
}

const ctx: EmailContext = { appUrl: 'https://app.verbatimintel.com', image: () => null, theme: EMAIL }

const hygiene = (html: string) => {
  expect(html).not.toContain('class=')
  expect(html).not.toContain('var(--')
  expect(html).not.toContain('<svg')
  expect(html).not.toMatch(/display:\s*(flex|grid)/)
}

describe('digestSubject', () => {
  it('names the movement when there is any, else it is the update', () => {
    expect(digestSubject('Ossur', null)).toBe('Ossur: your consumer intelligence baseline')
    expect(digestSubject('Ossur', delta)).toBe('Ossur: what changed — 3 new themes, sentiment up 3.4 pts')
    expect(digestSubject('Ossur', { ...delta, newThemes: null, sentiment: { ...delta.sentiment!, verdict: { state: 'no_clear_change', change: 1.1, band: 2 } } })).toBe('Ossur: your weekly update')
    expect(digestSubject('Ossur', { ...delta, newThemes: null, sentiment: null }, 'monthly')).toBe('Ossur: your monthly update')
  })
})

describe('the delta block', () => {
  it('leads with what changed, each proportion carrying its own verdict', () => {
    const html = renderToStaticMarkup(createElement(DeltaBlock, { delta, dashboard: null, appUrl: ctx.appUrl }))
    hygiene(html)
    expect(html).toContain('What changed since your last update')
    expect(html).toContain('▲ 3.4 pts')
    expect(html).toContain('no clear change')
    expect(html).toContain('Ottobock <strong>15%</strong>')
    expect(html).toContain('Socket pain and poor fit · Price and access questions and 1 more')
    expect(html).toContain('4,626')
    expect(html).toContain('href="https://app.verbatimintel.com/dashboard/competitive"')
  })
  it('says "where you stand" when nothing cleared its band, and on a first update', () => {
    const flat = { ...delta, sentiment: { ...delta.sentiment!, verdict: { state: 'too_little_data' as const, change: 0.4, band: 2 } } }
    const html = renderToStaticMarkup(createElement(DeltaBlock, { delta: flat, dashboard: null, appUrl: ctx.appUrl }))
    expect(html).toContain('Where you stand this update')
    expect(html).toContain('too little data')
    const first = renderToStaticMarkup(createElement(DeltaBlock, { delta: null, dashboard: { sentiment: { positivePct: 91.2, judged: 120, deltaText: null, tierLabel: null, segments: [] }, share: null } as unknown as DashboardData, appUrl: ctx.appUrl }))
    expect(first).toContain('your first update')
    expect(first).toContain('<strong>91%</strong>')
  })
})

describe('tile email renderers', () => {
  it('sentiment: a figure, a table bar in hex, the legend in words', () => {
    const d = { sentiment: { positivePct: 87.2, judged: 698, deltaText: { text: '+3.4 pt since last update', good: true }, tierLabel: 'Strongly positive', segments: [{ label: 'Positive', count: 609, pct: 87, color: 'bg-positive' }, { label: 'Negative', count: 11, pct: 2, color: 'bg-negative' }] } } as unknown as DashboardData
    const html = renderToStaticMarkup(createElement('div', null, dashboardEmail['dashboard.sentiment'](d, ctx)))
    hygiene(html)
    expect(html).toContain('87%')
    expect(html).toContain(`background:${EMAIL.green}`)
    expect(html).toContain(`background:${EMAIL.down}`)
    expect(html).toContain('Positive 609 · Negative 11')
  })
  it('themes: ranked rows with the bucket colour and a New badge', () => {
    const d = { themes: { rows: [{ label: 'Socket pain', bucket: 'category', conversations: 25, isNew: true, memberThemes: [], description: '', category: null }, { label: 'Ossur ads', bucket: 'client', conversations: 10, isNew: false, memberThemes: [], description: '', category: null }], max: 25, analysedConversations: 300, confirmed: 2, topCompetitorName: 'Ottobock' } } as unknown as DashboardData
    const html = renderToStaticMarkup(createElement('div', null, dashboardEmail['dashboard.themes'](d, ctx)))
    hygiene(html)
    expect(html).toContain('>New<')
    expect(html).toContain(`background:${EMAIL.cat}`)
    expect(html).toContain(`background:${EMAIL.green}`)
    expect(html).toContain('width="100%"')
  })
  it('movement without a picture still says the numbers', () => {
    const d = { movement: { dates: ['2026-07-21', '2026-08-23'], leadCompetitor: 'Ottobock', layer: 'period', rows: [{ key: 'yourShare', label: 'Your share', series: [5.8, 5.1], value: 5.1, delta: -0.7 }] }, updatesCount: 4 } as unknown as DashboardData
    const html = renderToStaticMarkup(createElement('div', null, dashboardEmail['dashboard.movement'](d, ctx)))
    expect(html).not.toContain('<img')
    expect(html).toContain('Your share')
    expect(html).toContain('−0.7 pt')
    const withImage = renderToStaticMarkup(createElement('div', null, dashboardEmail['dashboard.movement'](d, { ...ctx, image: (k) => (k === 'dashboard.movement' ? 'cid:dashboard-movement@verbatim' : null) })))
    expect(withImage).toContain('src="cid:dashboard-movement@verbatim"')
  })
})

describe('text helpers', () => {
  it('firstSentence keeps abbreviations and returns an unterminated reasoning whole', () => {
    expect(firstSentence('Launch the Access Navigator for insurance and fitter matching. People are asking.')).toBe('Launch the Access Navigator for insurance and fitter matching.')
    // "vs." is not a sentence end: a cut under 40 characters is extended once
    expect(firstSentence('It works vs. the old one. Then more follows here.')).toBe('It works vs. the old one.')
    expect(firstSentence('no terminator here')).toBe('no terminator here')
  })
  it('clip cuts a long quote at a word and marks it', () => {
    expect(clip('short one')).toBe('short one')
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
    const out = clip(long, 100)
    expect(out.length).toBeLessThanOrEqual(101)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toMatch(/\s…$/)
  })
  it('htmlToText breaks blocks, keeps links and decodes entities', () => {
    const text = htmlToText('<html><head><title>x</title></head><body><div>One &amp; two</div><table><tr><td>a</td><td>b</td></tr></table><a href="https://x.y/z">Open</a><p>Done&nbsp;now</p></body></html>')
    expect(text).toBe('One & two\na b\nOpen (https://x.y/z)\nDone now')
  })
  it('tokenHex maps tokens and classes to hex and never to nothing', () => {
    expect(tokenHex('var(--you)')).toBe(EMAIL.green)
    expect(tokenHex('bg-warning')).toBe(EMAIL.mixed)
    expect(tokenHex('#123456')).toBe('#123456')
    expect(tokenHex('var(--something-new)')).toBe(EMAIL.muted)
  })
})
