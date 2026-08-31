import { describe, expect, it } from 'vitest'
import { claimDecision, pruneInlineImages } from './claim'
import { SCHEDULE_CLAIM_STALE_MS } from '../config'

const now = Date.parse('2026-09-06T04:10:00Z')
const at = (msAgo: number) => new Date(now - msAgo).toISOString()

describe('claimDecision — one email per schedule per update', () => {
  it('a sent row is never sent again', () => {
    expect(claimDecision({ id: 'a', status: 'sent', claimed_at: at(60_000) }, now)).toBe('already_sent')
  })
  it('a young claim belongs to whoever is on it', () => {
    expect(claimDecision({ id: 'a', status: 'claimed', claimed_at: at(SCHEDULE_CLAIM_STALE_MS - 1000) }, now)).toBe('skipped')
  })
  it('a build waiting for review is never taken over, however old', () => {
    // Taking it over would discard a reviewed brief and its edits, and pay to
    // write another one.
    expect(claimDecision({ id: 'a', status: 'ready', claimed_at: at(SCHEDULE_CLAIM_STALE_MS * 10) }, now)).toBe('waiting')
  })
  it('a stale claim, a failure or a skip is taken over', () => {
    expect(claimDecision({ id: 'a', status: 'claimed', claimed_at: at(SCHEDULE_CLAIM_STALE_MS + 1000) }, now)).toBe('takeover')
    expect(claimDecision({ id: 'a', status: 'failed', claimed_at: at(1000) }, now)).toBe('takeover')
    expect(claimDecision({ id: 'a', status: 'skipped', claimed_at: at(1000) }, now)).toBe('takeover')
  })
})

describe('pruneInlineImages', () => {
  const png = (cid: string) => ({ filename: `${cid}.png`, content: Buffer.alloc(1), contentType: 'image/png', contentId: cid })
  it('drops a picture the email never referenced, keeps the ones it did and any plain attachment', () => {
    const html = '<img src="cid:dashboard-movement@verbatim">'
    const out = pruneInlineImages(html, [png('dashboard-movement@verbatim'), png('dashboard-accounts@verbatim'), { filename: 'update.pdf', content: Buffer.alloc(1) }])
    expect(out.map((a) => a.filename)).toEqual(['dashboard-movement@verbatim.png', 'update.pdf'])
  })
})
