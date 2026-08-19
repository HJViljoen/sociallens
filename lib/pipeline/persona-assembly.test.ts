import { describe, expect, it } from 'vitest'
import {
  buildPopulationCounts,
  buildThemeDigest,
  groundPersonas,
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
  who: [{ signal: 'new to the category', count: 12 }],
  ...over,
})

const opts = { minInsights: 12, minVideos: 3, maxPersonas: 5, populationInsights: 400 }

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
    const { kept } = groundPersonas([persona()], byRef, { ...opts, populationInsights: 100 })
    expect(['Dominant', 'Widespread', 'Recurring', 'Early signal']).toContain(kept[0].prevalence)
    expect(kept[0].prevalence).toBe('Dominant')
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

  it('drops zero and negative demographic counts rather than showing an empty signal', () => {
    const { byRef } = buildThemeDigest(
      [theme('a', { supporting_insight_ids: Array.from({ length: 12 }, (_, i) => `i${i}`), supporting_video_ids: ['v1', 'v2', 'v3'] })],
      { maxThemes: 10 },
    )
    const { kept } = groundPersonas(
      [persona({ who: [{ signal: 'clinicians', count: 0 }, { signal: 'parents', count: 4 }] })],
      byRef,
      opts,
    )
    expect(kept[0].who).toEqual([{ signal: 'parents', count: 4 }])
  })

  it('returns empty rather than throwing when the model proposes nothing', () => {
    const { byRef } = buildThemeDigest([theme('a')], { maxThemes: 10 })
    expect(groundPersonas([], byRef, opts)).toEqual({ kept: [], dropped: [] })
  })
})
