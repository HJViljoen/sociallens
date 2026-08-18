import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, buildUserPrompt, indexThemes } from './pass-c'
import type { AggregatedTheme } from './types'

// Pins for the v5 claims block: present exactly when competitor claims exist,
// and the claim-less prompt carries no trace of it (data-driven gating — no
// flag; tenants without claims keep an effectively-v4 prompt).

const theme = (over: Partial<AggregatedTheme> = {}): AggregatedTheme => ({
  bucket: 'competitor:cotopaxi',
  category: 'praise',
  theme: 'lifetime_warranty',
  memberThemes: [],
  supportingVideoIds: ['v1'],
  meanStrength: 7,
  rankScore: 1,
  supportingInsightIds: ['i1'],
  evidenceCount: 3,
  strengthScore: 7,
  dominantEmotion: 'excited',
  dominantSentimentImpact: 'positive',
  singleSource: false,
  sampleDescriptions: [],
  ...over,
})

const tc = { brand_keywords: ['sealand'], competitor_names: ['Cotopaxi'], industry_keywords: [] }
const CLAIM = { competitor: 'Cotopaxi', claim: 'Lifetime warranty on bags', quote: 'They have a lifetime warranty' }

describe('pass C v5 claims block', () => {
  it('system prompt gains the claims rules only when claims exist', () => {
    expect(buildSystemPrompt(tc, 'Sealand', true)).toContain('WHAT COMPETITORS SAY')
    expect(buildSystemPrompt(tc, 'Sealand', false)).not.toContain('WHAT COMPETITORS SAY')
  })

  it('user prompt lists claims as [Name] claim — "quote" lines before THEMES', () => {
    const idx = indexThemes([theme()])
    const withClaims = buildUserPrompt(idx, undefined, [CLAIM])
    expect(withClaims).toContain('WHAT COMPETITORS SAY IN THEIR OWN VIDEOS')
    expect(withClaims).toContain('- [Cotopaxi] Lifetime warranty on bags — "They have a lifetime warranty"')
    expect(withClaims.indexOf('WHAT COMPETITORS SAY')).toBeLessThan(withClaims.indexOf('THEMES (1)'))
  })

  it('claim-less user prompt is byte-identical to the pre-claims shape', () => {
    const idx = indexThemes([theme()])
    expect(buildUserPrompt(idx, undefined, [])).toBe(buildUserPrompt(idx, undefined))
    expect(buildUserPrompt(idx, undefined)).not.toContain('WHAT COMPETITORS SAY')
  })
})
