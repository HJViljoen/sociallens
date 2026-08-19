import { describe, expect, it, afterEach } from 'vitest'
import { passAMinComments, PASS_A_MIN_COMMENTS_DEFAULT, captureRunFlags, transcriptsEnabled, PERSONA_MAX, PERSONA_MIN_INSIGHTS, PERSONA_MIN_VIDEOS, PERSONA_DIGEST_THEMES, EVIDENCE_FLOOR } from './config'

// Pass A's comment floor is per-platform (Wave 3). One global 5 was tuned for
// TikTok/Instagram; Reddit threads run 3-8 comments but are far denser per
// comment, so the same floor would skip most of the platform. The floor is
// applied at BOTH gates — the plan step (raw counts) and runPassA (kept counts).
describe('passAMinComments', () => {
  it('lowers the floor for Reddit only', () => {
    expect(passAMinComments('reddit')).toBe(3)
    expect(passAMinComments('tiktok')).toBe(5)
    expect(passAMinComments('instagram')).toBe(5)
    expect(passAMinComments('youtube')).toBe(5)
  })

  it('falls back to the default for an unlisted platform', () => {
    expect(passAMinComments('facebook')).toBe(PASS_A_MIN_COMMENTS_DEFAULT)
    expect(PASS_A_MIN_COMMENTS_DEFAULT).toBe(5)
  })

  it('admits a 3-comment Reddit thread and still rejects a 3-comment TikTok one', () => {
    const kept = 3
    expect(kept >= passAMinComments('reddit')).toBe(true)
    expect(kept >= passAMinComments('tiktok')).toBe(false)
  })
})

describe('reddit gather threshold vs Pass A floor', () => {
  it('scrapes comments down to the same depth Pass A will accept', async () => {
    // If the gather threshold sat above the Pass A floor, threads between the
    // two would never be scraped — so the lowered floor could never fire and
    // A5 would be dead letter. They must not drift apart.
    const { reddit } = await import('./gather/platforms/reddit')
    expect(reddit.commentThreshold).toBe(passAMinComments('reddit'))
  })
})


describe('captureRunFlags — a run must not change flags underneath itself (Tier 1)', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env.TRANSCRIPTS_ENABLED = saved.TRANSCRIPTS_ENABLED
    process.env.INCREMENTAL_PASS_A = saved.INCREMENTAL_PASS_A
    process.env.THEME_REGISTRY = saved.THEME_REGISTRY
    process.env.REDDIT_DISCOVERY_ENABLED = saved.REDDIT_DISCOVERY_ENABLED
    process.env.CONSUMER_PROFILE = saved.CONSUMER_PROFILE
  })

  it('reads every flag the run branches on', () => {
    process.env.TRANSCRIPTS_ENABLED = '1'
    process.env.INCREMENTAL_PASS_A = '1'
    process.env.THEME_REGISTRY = '0'
    process.env.REDDIT_DISCOVERY_ENABLED = '1'
    process.env.CONSUMER_PROFILE = '1'
    expect(captureRunFlags()).toEqual({
      transcripts: true, incrementalPassA: true, themeRegistry: false, redditDiscovery: true,
      consumerProfile: true,
    })
  })

  it('is a SNAPSHOT: flipping the environment afterwards cannot change it', () => {
    process.env.TRANSCRIPTS_ENABLED = '1'
    const captured = captureRunFlags()
    process.env.TRANSCRIPTS_ENABLED = '0'
    // The live reader moves; the captured snapshot does not. This is the whole
    // point — a deploy or an env edit mid-run used to split a run in two.
    expect(transcriptsEnabled()).toBe(false)
    expect(captured.transcripts).toBe(true)
  })
})

describe('persona evidence floors (Pass E) — the numbers that decide what a client sees', () => {
  it('keeps the floors above the single-source line the rest of the pipeline uses', () => {
    // EVIDENCE_FLOOR=2 is what makes a THEME real. A persona is a claim about
    // a kind of person, so it must rest on more than a theme does — otherwise
    // one loud thread becomes a segment.
    expect(PERSONA_MIN_VIDEOS).toBeGreaterThan(EVIDENCE_FLOOR)
    expect(PERSONA_MIN_INSIGHTS).toBeGreaterThan(PERSONA_MIN_VIDEOS)
  })

  it('caps personas at a number a switcher can still read as a set of people', () => {
    expect(PERSONA_MAX).toBeGreaterThanOrEqual(3)
    expect(PERSONA_MAX).toBeLessThanOrEqual(6)
  })

  it('sends enough theme lines to cover a normal run whole', () => {
    // Ossur run 2 produced 120 themes for the entire corpus.
    expect(PERSONA_DIGEST_THEMES).toBeGreaterThanOrEqual(120)
  })
})
