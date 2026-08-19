import { describe, expect, it } from 'vitest'
import {
  assignPrevalence,
  filterToRealPhrases,
  buildPopulationCounts,
  buildThemeDigest,
  countDemographics,
  groundPersonas,
  type GroundedPersona,
  type RawPersona,
  type ThemeInput,
} from './persona-assembly'

// The evidence floors ARE the product contract (.agents/product-marketing.md
// bans invented personas), so they are tested as behaviour, not as arithmetic.
// A persona that survives here is one the page is allowed to draw a person for.

const theme = (id: string, over: Partial<ThemeInput> = {}): ThemeInput => ({
  id,
  bucket: 'industry-other',
  category: 'pain_point',
  label: `theme ${id}`,
  description: 'd',
  evidence_count: 10,
  supporting_insight_ids: [`i-${id}-1`, `i-${id}-2`],
  supporting_video_ids: [`v-${id}-1`],
  ...over,
})

const persona = (over: Partial<RawPersona> = {}): RawPersona => ({
  key: 'researcher',
  name: 'the first-time researcher',
  one_liner: 'weighing options before committing',
  scope: 'category',
  theme_refs: ['T1'],
  wants: ['a straight answer on fit'],
  blockers: ['cost'],
  triggers: ['a new diagnosis'],
  how_they_talk: ['"does it actually stay put"'],
  ...over,
})

const opts = { minInsights: 12, minVideos: 3, maxPersonas: 5 }

describe('buildThemeDigest', () => {
  it('orders by evidence so a large run loses its tail, not its spine', () => {
    // Run 2 produced 120 themes; a run past the cap must drop the weakest.
    const themes = [
      theme('a', { evidence_count: 3 }),
      theme('b', { evidence_count: 40 }),
      theme('c', { evidence_count: 12 }),
    ]
    const { rows } = buildThemeDigest(themes, { maxThemes: 2 })
    expect(rows.map((r) => r.themeId)).toEqual(['b', 'c'])
    expect(rows.map((r) => r.ref)).toEqual(['T1', 'T2'])
  })

  it('skips themes with no supporting insights — an uncitable ref only invites an ungrounded persona', () => {
    const themes = [theme('a', { supporting_insight_ids: [] }), theme('b')]
    const { rows } = buildThemeDigest(themes, { maxThemes: 10 })
    expect(rows.map((r) => r.themeId)).toEqual(['b'])
  })

  it('tolerates a null registry_id — THEME_REGISTRY may be off for a client', () => {
    const { rows } = buildThemeDigest([theme('a', { registry_id: null })], { maxThemes: 10 })
    expect(rows[0].registryId).toBeNull()
  })

  it('returns nothing rather than throwing on an empty run', () => {
    const { rows, byRef } = buildThemeDigest([], { maxThemes: 10 })
    expect(rows).toEqual([])
    expect(byRef.size).toBe(0)
  })
})

describe('buildPopulationCounts', () => {
  it('counts the axes the prompt reasons over, naming the gaps honestly', () => {
    const counts = buildPopulationCounts(
      [
        { category: 'pain_point', journey_stage: 'consideration', emotion: 'frustrated' },
        { category: 'question', journey_stage: null, emotion: 'curious' },
      ],
      ['industry-other', null],
    )
    expect(counts.total).toBe(2)
    expect(counts.byCategory).toEqual({ pain_point: 1, question: 1 })
    // journey_stage is nullable by design ("do not guess") — it reads as
    // unstated rather than being folded into a real stage.
    expect(counts.byJourneyStage).toEqual({ consideration: 1, unstated: 1 })
    // An insight carries no bucket of its own; an unreconstructed one must not
    // be silently attributed to the category.
    expect(counts.byBucket).toEqual({ 'industry-other': 1, unattributed: 1 })
  })
})

describe('groundPersonas — the evidence floors', () => {
  it('grounds a cited persona in the union of its themes’ insights and videos', () => {
    const { byRef } = buildThemeDigest(
      [
        theme('a', { supporting_insight_ids: ['i1', 'i2'], supporting_video_ids: ['v1', 'v2'] }),
        theme('b', { supporting_insight_ids: ['i2', 'i3'], supporting_video_ids: ['v2', 'v3'] }),
      ],
      { maxThemes: 10 },
    )
    const { kept } = groundPersonas([persona({ theme_refs: ['T1', 'T2'] })], byRef, {
      ...opts,
      minInsights: 3,
      minVideos: 3,
    })
    // Overlapping ids are counted once — a persona citing the same evidence
    // twice must not look twice as grounded.
    expect(kept[0].insightIds).toEqual(['i1', 'i2', 'i3'])
    expect(kept[0].evidenceCount).toBe(3)
    expect(kept[0].sourceVideoCount).toBe(3)
  })

  it('drops a persona that cites nothing resolvable, and says so', () => {
    const { byRef } = buildThemeDigest([theme('a')], { maxThemes: 10 })
    const { kept, dropped } = groundPersonas([persona({ theme_refs: ['T99'] })], byRef, opts)
    expect(kept).toEqual([])
    expect(dropped[0].reason).toBe('no-themes')
  })

  it('resolves refs whatever punctuation the model wraps them in', () => {
    // Second real Ossur run: five well-formed personas resolved to nothing
    // because the model wrote "[T12]" where the digest key was "T12". A ref
    // that fails on a bracket un-grounds the whole persona silently.
    const { byRef } = buildThemeDigest(
      [theme('a', { supporting_insight_ids: Array.from({ length: 12 }, (_, i) => `i${i}`), supporting_video_ids: ['v1', 'v2', 'v3'] })],
      { maxThemes: 10 },
    )
    for (const form of ['T1', '[T1]', 't1', ' T1 ']) {
      const { kept } = groundPersonas([persona({ theme_refs: [form] })], byRef, opts)
      expect(kept, `ref form ${form}`).toHaveLength(1)
    }
  })

  it('records unknown refs instead of throwing on them', () => {
    // Same lenient contract as every other bracket-ref pass: resolve what
    // matches, count what does not.
    const { byRef } = buildThemeDigest([theme('a', { supporting_insight_ids: Array.from({ length: 12 }, (_, i) => `i${i}`), supporting_video_ids: ['v1', 'v2', 'v3'] })], { maxThemes: 10 })
    const { kept } = groundPersonas([persona({ theme_refs: ['T1', 'T404'] })], byRef, opts)
    expect(kept).toHaveLength(1)
    expect(kept[0].unknownRefs).toEqual(['T404'])
  })

  it('drops a persona above the insight floor but below the video floor', () => {
    // 12 insights that all come from one video is one loud thread, not a
    // segment of people — the video floor is what catches that.
    const { byRef } = buildThemeDigest(
      [theme('a', { supporting_insight_ids: Array.from({ length: 12 }, (_, i) => `i${i}`), supporting_video_ids: ['v1'] })],
      { maxThemes: 10 },
    )
    const { kept, dropped } = groundPersonas([persona()], byRef, opts)
    expect(kept).toEqual([])
    expect(dropped[0]).toMatchObject({ reason: 'below-video-floor', evidenceCount: 12, sourceVideoCount: 1 })
  })

  it('drops a persona below the insight floor with the counts that failed', () => {
    const { byRef } = buildThemeDigest(
      [theme('a', { supporting_insight_ids: ['i1', 'i2'], supporting_video_ids: ['v1', 'v2', 'v3'] })],
      { maxThemes: 10 },
    )
    const { kept, dropped } = groundPersonas([persona()], byRef, opts)
    expect(kept).toEqual([])
    expect(dropped[0]).toMatchObject({ reason: 'below-insight-floor', evidenceCount: 2 })
  })

  it('caps per scope, keeping the best-grounded and recording the rest', () => {
    const themes = Array.from({ length: 7 }, (_, i) =>
      theme(`t${i}`, {
        supporting_insight_ids: Array.from({ length: 12 + i }, (_, j) => `i-${i}-${j}`),
        supporting_video_ids: ['v1', 'v2', 'v3'],
      }),
    )
    const { byRef } = buildThemeDigest(themes, { maxThemes: 10 })
    const raw = themes.map((_, i) => persona({ key: `p${i}`, name: `persona ${i}`, theme_refs: [`T${i + 1}`] }))
    const { kept, dropped } = groundPersonas(raw, byRef, { ...opts, maxPersonas: 5 })
    expect(kept).toHaveLength(5)
    // Digest order is evidence-desc, so T1 is the richest theme.
    expect(kept[0].evidenceCount).toBeGreaterThanOrEqual(kept[4].evidenceCount)
    expect(dropped.filter((d) => d.reason === 'over-cap')).toHaveLength(2)
  })

  it('caps scopes independently so a client persona is not squeezed out by category ones', () => {
    const themes = Array.from({ length: 6 }, (_, i) =>
      theme(`t${i}`, {
        supporting_insight_ids: Array.from({ length: 20 }, (_, j) => `i-${i}-${j}`),
        supporting_video_ids: ['v1', 'v2', 'v3'],
      }),
    )
    const { byRef } = buildThemeDigest(themes, { maxThemes: 10 })
    const raw = [
      ...Array.from({ length: 5 }, (_, i) => persona({ key: `c${i}`, scope: 'category', theme_refs: [`T${i + 1}`] })),
      persona({ key: 'own', scope: 'client', theme_refs: ['T6'] }),
    ]
    const { kept } = groundPersonas(raw, byRef, opts)
    expect(kept.filter((p) => p.scope === 'client')).toHaveLength(1)
    expect(kept.filter((p) => p.scope === 'category')).toHaveLength(5)
  })

  it('labels prevalence with a calibrated word, never a score', () => {
    const { byRef } = buildThemeDigest(
      [theme('a', { supporting_insight_ids: Array.from({ length: 50 }, (_, i) => `i${i}`), supporting_video_ids: ['v1', 'v2', 'v3'] })],
      { maxThemes: 10 },
    )
    const { kept } = groundPersonas([persona()], byRef, opts)
    // One persona holds all of the profiled population, so the ladder's top
    // rung is the honest word — and it is a WORD, never the number.
    expect(kept[0].prevalence).toBe('Dominant')
    expect(kept[0].prevalence).not.toMatch(/\d/)
  })

  it('treats an unknown scope as the category, never inventing a client persona', () => {
    // Claiming a persona is the client's own audience when the model said
    // something unrecognised would overstate what the data shows.
    const { byRef } = buildThemeDigest(
      [theme('a', { supporting_insight_ids: Array.from({ length: 12 }, (_, i) => `i${i}`), supporting_video_ids: ['v1', 'v2', 'v3'] })],
      { maxThemes: 10 },
    )
    const { kept } = groundPersonas([persona({ scope: 'nonsense' })], byRef, opts)
    expect(kept[0].scope).toBe('category')
  })

  it('counts demographics from the persona’s own evidence, not from the model', () => {
    // The model has no `who` field at all: on the first real run it returned
    // count:1 for every signal it named. These counts come from the persona's
    // own demographic_signal insights or they do not exist.
    const ids = Array.from({ length: 12 }, (_, i) => `i${i}`)
    const { byRef } = buildThemeDigest(
      [theme('a', { supporting_insight_ids: ids, supporting_video_ids: ['v1', 'v2', 'v3'] })],
      { maxThemes: 10 },
    )
    const demographicsByInsightId = new Map([
      ['i0', 'caregivers'], ['i1', 'caregivers'], ['i2', 'new amputees'],
      ['i99', 'not this persona'],
    ])
    const { kept } = groundPersonas([persona()], byRef, { ...opts, demographicsByInsightId })
    // 'new amputees' is seen once and does not survive WHO_MIN_COUNT: on real
    // data the slugs are near-duplicates, so a count of 1 is noise dressed as
    // a statistic.
    expect(kept[0].who).toEqual([{ signal: 'caregivers', count: 2 }])
  })

  it('returns empty rather than throwing when the model proposes nothing', () => {
    const { byRef } = buildThemeDigest([theme('a')], { maxThemes: 10 })
    expect(groundPersonas([], byRef, opts)).toEqual({ kept: [], dropped: [] })
  })
})

describe('countDemographics', () => {
  it('returns nothing when no demographic signals were extracted', () => {
    // Silence is honest: a category whose conversation never states who is
    // speaking must show no `who` block rather than an inferred one.
    expect(countDemographics(['i1', 'i2'], undefined)).toEqual([])
    expect(countDemographics(['i1'], new Map())).toEqual([])
  })

  it('ignores signals belonging to other personas', () => {
    const map = new Map([['mine', 'parents'], ['mine2', 'parents'], ['theirs', 'clinicians']])
    expect(countDemographics(['mine', 'mine2'], map)).toEqual([{ signal: 'parents', count: 2 }])
  })

  it('suppresses one-off signals rather than presenting them as findings', () => {
    const map = new Map([['a', 'swimmers'], ['b', 'beach users'], ['c', 'water users']])
    expect(countDemographics(['a', 'b', 'c'], map)).toEqual([])
  })
})

describe('assignPrevalence', () => {
  const p = (evidenceCount: number, insightIds: string[]): GroundedPersona => ({
    key: 'k', name: 'n', oneLiner: '', scope: 'category', wants: [], blockers: [], triggers: [],
    howTheyTalk: [], who: [], themeIds: [], registryIds: [], insightIds,
    evidenceCount, sourceVideoCount: 5, bucketMix: {}, prevalence: '', unknownRefs: [],
  })

  it('discriminates between personas instead of labelling them all the same', () => {
    // The defect this exists to fix: measured against the WHOLE corpus, all
    // five personas of the first real Ossur profile read "Recurring". A word
    // that cannot separate them is decoration, so the denominator is the
    // profiled population — the people the profile actually describes.
    const big = p(60, Array.from({ length: 60 }, (_, i) => `b${i}`))
    const small = p(4, Array.from({ length: 4 }, (_, i) => `s${i}`))
    const [a, b] = assignPrevalence([big, small])
    expect(a.prevalence).toBe('Dominant')
    expect(b.prevalence).not.toBe('Dominant')
  })

  it('never divides by zero on an empty profile', () => {
    expect(assignPrevalence([])).toEqual([])
  })
})

describe('duplicate refs (M8) — one theme cited three ways is still one theme', () => {
  it('does not inflate bucketMix or themeIds when refs repeat after normalisation', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `i${i}`)
    const { byRef } = buildThemeDigest(
      [theme('a', { supporting_insight_ids: ids, supporting_video_ids: ['v1', 'v2', 'v3'] })],
      { maxThemes: 10 },
    )
    const { kept } = groundPersonas([persona({ theme_refs: ['T1', '[T1]', 't1'] })], byRef, opts)
    expect(kept[0].evidenceCount).toBe(12)
    expect(kept[0].themeIds).toEqual(['a'])
    expect(kept[0].bucketMix).toEqual({ 'industry-other': 12 })
  })
})

describe('live-population intersection (H3) — evidence that no longer exists is not evidence', () => {
  // themes rows outlive the insights they cite: prune-stale-analysis deletes
  // superseded audience_insights after a run closes. Profiling an older run —
  // the documented offline mode — must not count the pruned rows.
  const ids = Array.from({ length: 20 }, (_, i) => `i${i}`)
  const digest = () =>
    buildThemeDigest([theme('a', { supporting_insight_ids: ids, supporting_video_ids: ['v1', 'v2', 'v3'] })], {
      maxThemes: 10,
    })

  it('counts only insights that still exist', () => {
    const live = new Set(ids.slice(0, 14))
    const { kept } = groundPersonas([persona()], digest().byRef, { ...opts, livePopulationIds: live })
    expect(kept[0].evidenceCount).toBe(14)
    expect(kept[0].bucketMix).toEqual({ 'industry-other': 14 })
  })

  it('drops a persona whose evidence has been pruned below the floor', () => {
    const live = new Set(ids.slice(0, 4))
    const { kept, dropped } = groundPersonas([persona()], digest().byRef, { ...opts, livePopulationIds: live })
    expect(kept).toEqual([])
    expect(dropped[0]).toMatchObject({ reason: 'below-insight-floor', evidenceCount: 4 })
  })

  it('counts everything when no population is supplied', () => {
    const { kept } = groundPersonas([persona()], digest().byRef, opts)
    expect(kept[0].evidenceCount).toBe(20)
  })
})

describe('filterToRealPhrases (H2) — "how they talk" must be things people said', () => {
  const valid = new Set(['it just will not stay on my leg', 'the socket rubs after an hour'])

  it('keeps a phrase that appears in a validated language sample', () => {
    expect(filterToRealPhrases(['the socket rubs after an hour'], valid)).toEqual(['the socket rubs after an hour'])
  })

  it('keeps a phrase that differs only by case, curly quotes or emoji', () => {
    // Same normalisation Pass A validates evidence with.
    expect(filterToRealPhrases(['It Just Will Not Stay On My Leg 😩'], valid)).toHaveLength(1)
  })

  it('drops a paraphrase the model wrote itself', () => {
    // The defect: a paraphrase rendered under a quote icon is an invented
    // verbatim, which is the one thing this feature must never produce.
    expect(filterToRealPhrases(['it tends to slip off during the day'], valid)).toEqual([])
  })

  it('drops everything when there are no validated samples to check against', () => {
    expect(filterToRealPhrases(['anything at all'], undefined)).toEqual([])
    expect(filterToRealPhrases(['anything at all'], new Set())).toEqual([])
  })
})

describe('persona keys — the switcher selector must survive whatever the model returns', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `i${i}`)
  const digest = () =>
    buildThemeDigest([theme('a', { supporting_insight_ids: ids, supporting_video_ids: ['v1', 'v2', 'v3'] })], {
      maxThemes: 10,
    })

  it('falls back to the name when the model returns an empty key', () => {
    const { kept } = groundPersonas([persona({ key: '' })], digest().byRef, opts)
    expect(kept[0].key).toBe('the-first-time-researcher')
  })

  it('makes repeated keys unique so no persona becomes unreachable', () => {
    const { kept } = groundPersonas(
      [persona({ key: 'same' }), persona({ key: 'same', name: 'another' })],
      digest().byRef,
      opts,
    )
    expect(new Set(kept.map((p) => p.key)).size).toBe(kept.length)
  })
})
