import { describe, expect, it } from 'vitest'
import { validateSayVsHear, buildSystemPromptA, buildUserPromptA } from './pass-d'
import { indexThemes } from './pass-c'
import type { AggregatedTheme } from './types'
import type { SayVsHearItemOut } from './schemas'

// Say-vs-hear validation pins (Step 2b): S# resolution, the silent contract
// (silence carries NO invented audience voice — enforced, not trusted), the
// they_say requirement on non-silent verdicts, the cap, and the v5 prompt
// blocks appearing exactly when client claims exist.

const CLAIMS = [
  { competitor: null, claim: 'Upcycled materials', quote: 'materials that would have been thrown away' },
  { competitor: null, claim: 'Lifetime warranty', quote: 'lifetime warranty, handmade' },
]

const item = (over: Partial<SayVsHearItemOut> = {}): SayVsHearItemOut => ({
  you_say_ref: 'S1',
  audience: 'echoes',
  they_say: 'The audience celebrates the upcycled craftsmanship',
  gap: 'Your material story lands — keep leading with it',
  supporting_themes: ['T1'],
  ...over,
})

describe('validateSayVsHear', () => {
  it('resolves S# (case-insensitive) and keeps valid items', () => {
    const r = validateSayVsHear([item({ you_say_ref: 's2' })], CLAIMS)
    expect(r).toHaveLength(1)
    expect(r[0].claim.claim).toBe('Lifetime warranty')
  })

  it('drops unknown S# refs and empty gaps', () => {
    expect(validateSayVsHear([item({ you_say_ref: 'S9' })], CLAIMS)).toHaveLength(0)
    expect(validateSayVsHear([item({ gap: '  ' })], CLAIMS)).toHaveLength(0)
  })

  it('enforces the silent contract: no audience voice, no theme refs', () => {
    const r = validateSayVsHear(
      [item({ audience: 'silent', they_say: 'model tried to invent this', supporting_themes: ['T1', 'T2'] })],
      CLAIMS,
    )
    expect(r).toHaveLength(1)
    expect(r[0].they_say).toBeNull()
    expect(r[0].supporting_themes).toEqual([])
  })

  it('drops non-silent items without they_say', () => {
    expect(validateSayVsHear([item({ audience: 'contradicts', they_say: null })], CLAIMS)).toHaveLength(0)
    expect(validateSayVsHear([item({ they_say: '   ' })], CLAIMS)).toHaveLength(0)
  })

  it('caps at 3 items', () => {
    const r = validateSayVsHear([item(), item(), item(), item()], CLAIMS)
    expect(r).toHaveLength(3)
  })
})

describe('D-a v5 prompt blocks', () => {
  const theme: AggregatedTheme = {
    bucket: 'client', category: 'praise', theme: 'upcycled_craftsmanship', memberThemes: [],
    supportingVideoIds: ['v1'], supportingInsightIds: ['i1'], evidenceCount: 3, strengthScore: 7,
    dominantEmotion: 'excited', dominantSentimentImpact: 'positive', singleSource: false, sampleDescriptions: [],
  }

  it('system prompt gains say_vs_hear instructions only with claims', () => {
    expect(buildSystemPromptA('Sealand', true)).toContain('say_vs_hear')
    expect(buildSystemPromptA('Sealand', false)).not.toContain('say_vs_hear')
  })

  it('user prompt lists [S#] claims only when provided, byte-identical otherwise', () => {
    const idx = indexThemes([theme])
    const withClaims = buildUserPromptA(idx, new Map(), undefined, CLAIMS)
    expect(withClaims).toContain('WHAT THE BRAND SAYS IN ITS OWN VIDEOS')
    expect(withClaims).toContain('[S1] Upcycled materials — "materials that would have been thrown away"')
    expect(buildUserPromptA(idx, new Map(), undefined, [])).toBe(buildUserPromptA(idx, new Map(), undefined))
  })
})
