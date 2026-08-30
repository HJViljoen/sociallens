import { describe, it, expect } from 'vitest'
import { composeDocument, documentFigures, documentSlides, heardLine, pickQuote, thinWeek } from './compose'
import { buildWriterPrompts, deltaInWords, type WriterOutput } from './write'
import { SALES_BRIEF } from './templates'
import { DEFAULT_DOCUMENT_SETTINGS } from './types'
import { freezeQuotes } from '../../renderables/quotes-freeze'
import type { Signals } from './signals'
import type { ResearchAnswer } from './research'

const point = (id: string, n: number, text: string, quotes: { ref: string; text: string; commentId: string | null }[] = []): ResearchAnswer['grounded'][number] => ({
  id, text, insightIds: [`i-${id}`], themeLabels: ['Insurance blocks needed care'], conversationCount: n, questionId: 'stops',
  quotes: quotes.map((q) => ({ ...q, videoId: null })),
})

const answers: ResearchAnswer[] = [
  {
    question: { id: 'stops', text: 'What stops people?', purpose: 'anchor' }, answer: 'Price and comfort.', outcome: 'answered', silent: false, conversationCount: 20, costUsd: 0.06, ms: 30000,
    grounded: [
      point('G1', 11, 'Price and financial access are a direct barrier.', [
        { ref: 'c:aaa', text: 'How can a prosthetic leg cost more than a modern car?! Justify the 90k', commentId: 'aaa' },
        { ref: 'c:bbb', text: 'ราคาเท่าไหร่', commentId: 'bbb' },
      ]),
      point('G2', 9, 'Comfort is a source of hesitation.', [{ ref: 'v:vid', text: 'the socket rubbed raw by the afternoon and I had to take it off at work', commentId: null }]),
    ],
    judgement: [{ text: 'A route answers the money question.', basedOn: ['G1'] }],
  },
  {
    question: { id: 'trigger', text: 'What makes it time?', purpose: 'anchor' }, answer: '', outcome: 'silent', silent: true, conversationCount: 0, costUsd: 0.02, ms: 9000, grounded: [], judgement: [],
  },
]

const signals = {
  clientId: 'c', runId: 'r', runDate: '2026-08-30', runStatus: 'completed', company: 'Ossur', brandKeywords: ['ossur'], industryKeywords: ['prosthetic leg'], trackedCompetitors: ['Ottobock'], updatesCount: 5,
  run: { conversations: 3270, videos: 469, clientVideos: 13, competitorVideos: 42, positivePct: 69.4, judged: 147, clientSharePct: 2.8, summary: {} as Signals['run']['summary'] },
  delta: { prevRunDate: '2026-08-23', sentiment: { now: 69.4, prev: 66, verdict: { state: 'no_clear_change', change: 3.4, band: 8 }, nowJudged: 147, prevJudged: 120 }, share: null, newThemes: { count: 15, labels: ['Confidence about visible limb loss'] }, conversations: { now: 3270, prev: 2100 } },
  themes: [], trajectoryOf: () => null,
  concerns: [{ id: 'S1', label: 'Insurance and Medicare barriers', description: 'People are frustrated that coverage rules block access.', buckets: [{ bucket: 'client', themeId: 't1', label: 'Insurance and Medicare barriers', evidenceCount: 3 }, { bucket: 'industry-other', themeId: 't2', label: 'Insurance blocks needed care', evidenceCount: 8 }], total: 11, categories: ['pain_point'], rankScore: 2, themeIds: ['t1', 't2'], registryIds: [], insightIds: [], videoIds: [], trajectory: 'seen 2 updates running' }],
  competitors: [{ name: 'Ottobock', bucket: 'competitor:Ottobock', claims: [{ competitor: 'Ottobock', claim: 'Arrange a trial fitting.', quote: 'arrange a trial fitting' }], praise: [], hurt: [], asks: [], shareNow: 9, shareAll: 12.4, videosNow: 42, thin: false }],
  sayVsHear: [{ you_say: 'Terrain adaptation adjusts the foot.', your_quote: 'x', audience: 'echoes', they_say: 'People talk about stairs and falls.', gap: 'Show the terrain.', supporting_theme_ids: [] }],
  brandVoice: null, ciSummary: null,
  personas: [{ key: 'first-time-buyer', name: 'First-time buyer', oneLiner: 'At the start.', scope: 'category', wants: 'Confidence.', blockers: 'Cost.', triggers: 'Plain answers.', howTheyTalk: [], who: [], insightIds: [], evidenceCount: 10, sourceVideoCount: 8, prevalence: 'common', platformMix: null, bucketMix: {}, themeIds: [] }],
  phrases: [{ quote: { ref: 'p:1', text: 'is it comfortable.' }, platform: 'tiktok' }],
  heldBackPhrases: 192,
  competitiveInsights: [],
} as unknown as Signals

const written: WriterOutput = {
  in_short: { summary: 'The money question leads again, heard in [[conversations]] conversations. Most people — really — say 90% of them.' },
  findings: [
    { headline: 'The sale is decided at the clinic, not on the knee.', saw: 'The conversation shows [[g1_conversations]] conversations on price [G1].\n\nA second paragraph on coverage.', means: 'A route beats a brochure.', practice: ['Open with the coverage route.', 'Name the insurance team — as part of the product.', 'A third line that is cut.'], sure_note: 'Two strands agree.', based_on: ['G1', 'G2', 'S1', 'G99'], quote_from: 'G1', continued_from: null },
    { headline: 'A thin one', saw: 'Something.', means: 'Nothing.', practice: [], sure_note: '', based_on: ['G7'], quote_from: null, continued_from: null },
    { headline: 'Comfort by evening', saw: 'People describe fit changing by evening.', means: 'Fit is the buyer\'s measure.', practice: ['Ask how the fit holds by evening.'], sure_note: 'One strand.', based_on: ['G2'], quote_from: 'G2', continued_from: 'Comfort by evening' },
  ],
  competitors: [{ name: 'ottobock', pitch: 'They sell the trial fitting.', praise: 'Knee technology.', hurt: 'Programming quality.', read: 'Ask about programming before comparing knees.', based_on: ['G1'] }],
  persona_lines: [{ name: 'First-time buyer', line: 'Make the category legible.' }],
  care: ['"no excuses": the category jokes about batteries.'],
  not_sure_yet: ['Whether approval times differ by clinic.'],
}

describe('documentFigures', () => {
  it('computes every number in code: the update, competitors, each point and concern', () => {
    const f = documentFigures(signals, answers)
    expect(f.conversations.value).toBe('3,270')
    expect(f.positive_pct.value).toBe('69.4%')
    expect(f.ottobock_share_pct.value).toBe('9%')
    expect(f.g1_conversations.value).toBe('11')
    expect(documentFigures(signals, [{ ...answers[0], grounded: [{ ...answers[0].grounded[0], id: 'G9', conversationCount: 2 }] }]).g9_conversations).toBeUndefined()
    expect(f.s1_conversations.value).toBe('11')
    expect(f.new_themes.value).toBe('15')
    expect(f.prev_conversations.value).toBe('2,100')
  })
})

describe('buildWriterPrompts', () => {
  it('sends keys not values, the agent\'s prose not the comments, and the previous headlines', () => {
    const figures = documentFigures(signals, answers)
    const { system, user } = buildWriterPrompts({ template: SALES_BRIEF, settings: DEFAULT_DOCUMENT_SETTINGS, company: 'Ossur', period: 'Update of 30 Aug 2026', reader: 'the US sales team', figures, signals, answers, previous: { summary: 'Last time.', headlines: ['Comfort by evening'] }, thin: false })
    expect(user).not.toMatch(/3,?270|69\.4|\b11\b/)
    expect(user).not.toContain('modern car')
    expect(user).not.toContain('socket rubbed')
    expect(user).toContain('[[g1_conversations]]')
    expect(user).toContain('G1 (from question "stops"')
    expect(user).toContain('Previous brief\'s headlines:\n- Comfort by evening')
    expect(user).toContain('S1 (count key [[s1_conversations]]; heard from Ossur\'s audience, the category; seen 2 updates running)')
    expect(user).toContain('G2 (from question "stops"; count key [[g2_conversations]]')
    expect(user).toContain('Questions the conversation could not answer:\n- What makes it time?')
    expect(system).toContain('Written for: the US sales team')
    expect(system).toContain('No dashes between clauses')
    expect(system).not.toMatch(/[—–]/)
    expect(user).toContain('Arrange a trial fitting.')
  })
  it('says the update was thin and asks for fewer findings', () => {
    const { system, user } = buildWriterPrompts({ template: SALES_BRIEF, settings: DEFAULT_DOCUMENT_SETTINGS, company: 'Ossur', period: 'p', reader: null, figures: {}, signals: { ...signals, runStatus: 'partial' }, answers: [], previous: null, thin: true })
    expect(system).toContain('at most 3 findings')
    expect(user).toContain('finished partially')
    expect(system).toContain('This is the first brief')
  })
})

describe('deltaInWords', () => {
  it('speaks in verdicts and keys, never numbers', () => {
    const words = deltaInWords(signals)
    expect(words.join(' ')).toContain('about where it was (key [[positive_pct]])')
    expect(words.join(' ')).toContain('[[new_themes]]')
    expect(words.join(' ')).not.toMatch(/\d/)
    expect(deltaInWords({ delta: null, updatesCount: 1, trackedCompetitors: [] })[0]).toContain('first update')
  })
})

describe('composeDocument', () => {
  const figures = documentFigures(signals, answers)
  const { data, workings } = composeDocument({ template: SALES_BRIEF, settings: DEFAULT_DOCUMENT_SETTINGS, reportId: 'rep', title: 'Sales brief', period: 'Update of 30 Aug 2026', signals, answers, written, figures, model: 'gpt-5.4', promptVersion: 'sales_brief_v1', costUsd: 0.9, timings: { research: 100 } })

  it('keeps the skeleton and orders findings by evidence, dropping the thin one to not sure yet', () => {
    expect(data.pages.map((p) => p.kind)).toEqual(['in_short', 'finding', 'finding', 'competitor', 'personas', 'language', 'method'])
    expect(data.pages[0].blocks.find((b) => b.field === 'findings')!.items).toEqual(['The sale is decided at the clinic, not on the knee', 'Comfort by evening'])
    expect(data.pages[0].blocks.find((b) => b.field === 'not_sure')!.items).toEqual(['Whether approval times differ by clinic.', 'A thin one'])
    const f1 = data.pages[1]
    expect(f1.blocks.find((b) => b.field === 'headline')!.text).toBe('The sale is decided at the clinic, not on the knee')
    expect(f1.meta?.sure).toBe('solid')
    expect(data.pages[2].meta?.sure).toBe('reasonable')
    expect(data.pages[2].meta?.continuedFrom).toBe('Comfort by evening')
    expect(workings.dropped).toEqual([{ headline: 'A thin one', reason: 'rests on no grounded point' }])
  })

  it('scrubs the words: digits gone, handles gone, dashes gone, unknown indices dropped, paragraphs kept, practice capped at two', () => {
    expect(data.pages[0].blocks[0].text).toBe('The money question leads again, heard in [[conversations]] conversations.')
    const saw = data.pages[1].blocks.find((b) => b.field === 'saw')!
    expect(saw.text).toBe('The conversation shows [[g1_conversations]] conversations on price.\n\nA second paragraph on coverage.')
    expect(data.pages[1].blocks.find((b) => b.field === 'practice')!.items).toEqual(['Open with the coverage route.', 'Name the insurance team, as part of the product.'])
    expect(data.pages[1].blocks.find((b) => b.field === 'heard')!.text).toBe("20 conversations across 2 strands of the research · heard from Ossur's audience, the category · seen 2 updates running.")
    expect(workings.blocks.find((b) => b.blockId === 'f1.saw')!.basedOn).toEqual(['G1', 'G2', 'S1'])
  })

  it('leads with an English comment, freezes to refs, and keeps the workings\' quotes as refs too', () => {
    const saw = data.pages[1].blocks.find((b) => b.field === 'saw')!
    expect(saw.quote).toEqual({ ref: 'c:aaa', text: 'How can a prosthetic leg cost more than a modern car?! Justify the 90k' })
    const frozen = freezeQuotes(data)
    expect(JSON.stringify(frozen.data)).not.toContain('modern car')
    expect(frozen.refs).toContain('c:aaa')
    expect(JSON.stringify(freezeQuotes(workings).data)).not.toContain('modern car')
  })

  it('writes the competitor page from the writer, matching by name, the personas from the profile, the method in code', () => {
    const c = data.pages[3]
    expect(c.meta?.name).toBe('Ottobock')
    expect(c.blocks.find((b) => b.field === 'read')!.text).toBe('Ask about programming before comparing knees.')
    const p = data.pages[4].blocks[0]
    expect(p.label).toBe('First-time buyer')
    expect(p.text).toBe('Make the category legible.')
    expect(p.items).toEqual(['At the start.', 'Confidence.', 'Cost.', 'Plain answers.'])
    expect(data.pages[5].blocks[0].items).toEqual(['"no excuses": the category jokes about batteries.'])
    const method = data.pages[6].blocks[0].items!
    expect(method).toHaveLength(4)
    expect(method[0]).toContain('3,270 conversations on 469 videos')
    expect(method[0]).toContain('Ottobock')
    expect(method[2]).toContain('192 phrases in other languages')
    expect(method[3]).toContain('update 5')
    expect(data.method.heldBack).toBe(192)
  })

  it('paginates one page per skeleton page, personas two a page', () => {
    expect(documentSlides(data).map((s) => s.keys[0])).toEqual(['in_short', 'f1', 'f2', 'c_ottobock', 'personas_1', 'language', 'method'])
    const many = { ...signals, personas: [1, 2, 3, 4, 5].map((n) => ({ ...signals.personas[0], key: `p${n}`, name: `P${n}` })) } as unknown as Signals
    const d = composeDocument({ template: SALES_BRIEF, settings: DEFAULT_DOCUMENT_SETTINGS, reportId: 'rep', title: 't', period: 'p', signals: many, answers, written, figures, model: 'm', promptVersion: 'v', costUsd: 0, timings: {} }).data
    expect(d.pages.filter((p) => p.kind === 'personas').map((p) => p.blocks.length)).toEqual([2, 2, 1])
  })

  it('writes where a finding was heard from its points and concerns', () => {
    expect(heardLine({ points: [{ conversationCount: 1 } as never], concerns: [], company: 'X' })).toBe('1 conversation across 1 strand of the research.')
  })
})

describe('pickQuote and thinWeek', () => {
  it('prefers a comment that reads as English and skips one already used', () => {
    const used = new Set<string>(['c:aaa'])
    expect(pickQuote(answers[0].grounded[0], used)).toBeNull()
    expect(pickQuote(answers[0].grounded[1], new Set())?.ref).toBe('v:vid')
  })
  it('calls a partial run or a quiet period thin', () => {
    expect(thinWeek(signals)).toBe(false)
    expect(thinWeek({ ...signals, runStatus: 'partial' })).toBe(true)
    expect(thinWeek({ ...signals, run: { ...signals.run, conversations: 120 } })).toBe(true)
  })
})
