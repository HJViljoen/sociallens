import { describe, expect, it } from 'vitest'
import { selectClaims, ownVoice, shapeBrandVoice, MAX_CLAIMS_PER_ENTITY, ABOUT_YOU_MAX } from './claims'

const TRACKED = ['Cotopaxi', 'Topo Designs']

const row = (over: Partial<Parameters<typeof selectClaims>[0][number]> = {}) => ({
  run_id: 'run-new',
  source_video_id: 'v1',
  entity: 'competitor',
  competitor_name: 'Cotopaxi',
  claim: 'Lifetime warranty on bags',
  quote: 'They have a lifetime warranty on their bags',
  ...over,
})

describe('selectClaims', () => {
  it('splits client and named-competitor claims', () => {
    const r = selectClaims([
      row({ entity: 'client', competitor_name: null, source_video_id: 'c1', claim: 'Upcycled materials' }),
      row(),
    ], TRACKED)
    expect(r.client).toEqual([{ competitor: null, claim: 'Upcycled materials', quote: row().quote }])
    expect(r.competitors).toEqual([{ competitor: 'Cotopaxi', claim: 'Lifetime warranty on bags', quote: row().quote }])
  })

  it('newest-run-wins per video: older runs\' paraphrase variants vanish entirely', () => {
    const r = selectClaims([
      row({ run_id: 'run-new', claim: 'Democratises shipping rates for all merchants' }),
      row({ run_id: 'run-old', claim: 'Democratises shipping rates so merchants get the same price' }),
      row({ run_id: 'run-old', claim: 'A completely different old claim' }),
    ], TRACKED)
    expect(r.competitors).toHaveLength(1)
    expect(r.competitors[0].claim).toBe('Democratises shipping rates for all merchants')
  })

  it('newest-run-wins is per video — other videos keep their own newest run', () => {
    const r = selectClaims([
      row({ source_video_id: 'v1', run_id: 'run-new' }),
      row({ source_video_id: 'v2', run_id: 'run-old', claim: 'Free People collab collection' }),
    ], TRACKED)
    expect(r.competitors).toHaveLength(2)
  })

  it('drops claims from competitors no longer tracked (fold-compared)', () => {
    const r = selectClaims([
      row({ competitor_name: 'cotopaxi' }),
      row({ competitor_name: 'Patagonia', source_video_id: 'v2' }),
    ], TRACKED)
    expect(r.competitors).toHaveLength(1)
    expect(r.competitors[0].competitor).toBe('cotopaxi')
  })

  it('excludes unnamed competitor claims; client claims unaffected by tracking', () => {
    const r = selectClaims([
      row({ competitor_name: null }),
      row({ competitor_name: 'unknown', source_video_id: 'v2' }),
      row({ entity: 'client', competitor_name: null, source_video_id: 'c1', claim: 'Handmade' }),
    ], [])
    expect(r.competitors).toHaveLength(0)
    expect(r.client).toHaveLength(1)
  })

  it('dedupes same video+normalized claim and caps per entity', () => {
    const dup = selectClaims([row({ quote: 'newest quote' }), row({ claim: ' lifetime   WARRANTY on bags ' })], TRACKED)
    expect(dup.competitors).toHaveLength(1)
    expect(dup.competitors[0].quote).toBe('newest quote')

    const rows = [
      ...Array.from({ length: 4 }, (_, i) => row({ source_video_id: `a${i}`, claim: `claim ${i}` })),
      ...Array.from({ length: 4 }, (_, i) => row({ source_video_id: `b${i}`, claim: `claim ${i}`, competitor_name: 'Topo Designs' })),
      ...Array.from({ length: 4 }, (_, i) => row({ source_video_id: `c${i}`, claim: `claim ${i}`, entity: 'client', competitor_name: null })),
    ]
    const capped = selectClaims(rows, TRACKED, 3)
    expect(capped.competitors.filter((c) => c.competitor === 'Cotopaxi')).toHaveLength(3)
    expect(capped.competitors.filter((c) => c.competitor === 'Topo Designs')).toHaveLength(3)
    expect(capped.client).toHaveLength(3)
  })
})

describe('ownVoice — is this client-bucket video the client speaking?', () => {
  const OSSUR = ['Össur', 'ossur']
  it('an owned post is own voice regardless of account name', () => {
    expect(ownVoice({ source: 'owned', account_name: 'whatever' }, OSSUR)).toBe(true)
  })
  it("a discovered video from one of the client's own accounts is own voice (name folds to a brand keyword)", () => {
    expect(ownVoice({ source: 'discovered', account_name: 'ÖSSUR' }, OSSUR)).toBe(true)
    expect(ownVoice({ source: 'discovered', account_name: 'Össur Academy' }, OSSUR)).toBe(true)
    expect(ownVoice({ source: 'discovered', account_name: 'Össur DE' }, OSSUR)).toBe(true)
  })
  it('a third party talking about the client is NOT own voice — the 2026-08-16 misattribution', () => {
    expect(ownVoice({ source: 'discovered', account_name: 'McMorris Prosthetic Services' }, OSSUR)).toBe(false)
    expect(ownVoice({ source: 'discovered', account_name: 'The Sport Verdict' }, OSSUR)).toBe(false)
    expect(ownVoice({ source: 'discovered', account_name: 'tunl.to' }, ['Sealand', 'Sealand Gear'])).toBe(false)
  })
  it('null account, empty keywords, or a too-short keyword never match', () => {
    expect(ownVoice({ source: 'discovered', account_name: null }, OSSUR)).toBe(false)
    expect(ownVoice({ source: 'discovered', account_name: 'ÖSSUR' }, [])).toBe(false)
    expect(ownVoice({ source: 'discovered', account_name: 'ÖSSUR' }, null)).toBe(false)
    expect(ownVoice({ source: 'discovered', account_name: 'Sport Verdict' }, ['or'])).toBe(false)
  })
})

describe('selectClaims — voice split', () => {
  it('routes client claims by voice: own → client, about → about; competitors untouched', () => {
    const r = selectClaims([
      row({ entity: 'client', competitor_name: null, source_video_id: 'own1', claim: 'Proprio Foot adapts to terrain', voice: 'own', account: 'ÖSSUR', platform: 'youtube', url: 'https://youtu.be/x' }),
      row({ entity: 'client', competitor_name: null, source_video_id: 'rev1', claim: 'ProFlex is the model they base all their feet on', voice: 'about', account: 'McMorris Prosthetic Services', platform: 'youtube', url: 'https://youtu.be/y' }),
      row(),
    ], TRACKED)
    expect(r.client.map((c) => c.claim)).toEqual(['Proprio Foot adapts to terrain'])
    expect(r.about).toEqual([{ competitor: null, claim: 'ProFlex is the model they base all their feet on', quote: row().quote, voice: 'about', account: 'McMorris Prosthetic Services', platform: 'youtube', url: 'https://youtu.be/y' }])
    expect(r.competitors).toHaveLength(1)
  })

  it('a client row without a voice is treated as own voice (pre-voice callers)', () => {
    const r = selectClaims([row({ entity: 'client', competitor_name: null, source_video_id: 'c1' })], TRACKED)
    expect(r.client).toHaveLength(1)
    expect(r.about).toHaveLength(0)
  })

  it('caps own and about separately — a busy reviewer cannot crowd out the client\'s own words', () => {
    const rows = [
      ...Array.from({ length: MAX_CLAIMS_PER_ENTITY + 3 }, (_, i) => row({ entity: 'client', competitor_name: null, source_video_id: `rev${i}`, claim: `review claim ${i}`, voice: 'about' as const })),
      row({ entity: 'client', competitor_name: null, source_video_id: 'own1', claim: 'own claim', voice: 'own' as const }),
    ]
    const r = selectClaims(rows, TRACKED)
    expect(r.about).toHaveLength(MAX_CLAIMS_PER_ENTITY)
    expect(r.client.map((c) => c.claim)).toEqual(['own claim'])
  })
})

describe('selectClaims counts + shapeBrandVoice', () => {
  const about = (i: number, url = `https://youtu.be/v${i}`, claim = `about claim ${i}`) =>
    row({ entity: 'client', competitor_name: null, source_video_id: `rev${i}`, claim, voice: 'about' as const, account: `Reviewer ${i}`, platform: 'youtube', url })

  it('counts are post-hygiene but PRE-cap, so the roll-up stays honest past 12', () => {
    const rows = [
      ...Array.from({ length: 15 }, (_, i) => about(i)),
      row({ entity: 'client', competitor_name: null, source_video_id: 'own1', claim: 'own', voice: 'own' as const }),
      row(),
    ]
    const r = selectClaims(rows, TRACKED)
    expect(r.counts).toEqual({ own: 1, about: 15, competitors: 1 })
    expect(r.about).toHaveLength(MAX_CLAIMS_PER_ENTITY)
  })

  it('shapes the About-you block: ≤2 per video, claim-text dedupe, capped, speaker + platform + url carried', () => {
    const rows = [
      about(1, 'https://youtu.be/A', 'A first'), about(2, 'https://youtu.be/A', 'A second'), about(3, 'https://youtu.be/A', 'A third'),
      about(4, 'https://youtu.be/B', 'Same words'), about(5, 'https://youtu.be/C', 'same  words'),
      ...Array.from({ length: 10 }, (_, i) => about(10 + i, `https://youtu.be/D${i}`, `unique ${i}`)),
    ]
    const snap = shapeBrandVoice(selectClaims(rows, TRACKED, 100))
    expect(snap.about.filter((e) => e.url === 'https://youtu.be/A')).toHaveLength(2)
    expect(snap.about.filter((e) => e.claim.toLowerCase().replace(/\s+/g, ' ') === 'same words')).toHaveLength(1)
    expect(snap.about).toHaveLength(ABOUT_YOU_MAX)
    expect(snap.about[0]).toEqual({ claim: 'A first', quote: row().quote, account: 'Reviewer 1', platform: 'youtube', url: 'https://youtu.be/A' })
    expect(snap.counts.about).toBe(15)
  })

  it('an empty about side yields an empty block but keeps the counts', () => {
    const snap = shapeBrandVoice(selectClaims([row()], TRACKED))
    expect(snap).toEqual({ counts: { own: 0, about: 0, competitors: 1 }, about: [] })
  })
})
