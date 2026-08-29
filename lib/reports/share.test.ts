import { describe, expect, it } from 'vitest'
import { expiryFromDays, hashSharePassword, hashViewerIp, mintShareToken, SHARE_TOKEN_RE, shareCookieName, shareCookieValid, shareCookieValue, shareStatus, verifySharePassword } from './share'

describe('share token', () => {
  it('is 43 url-safe chars, never a dot, never twice the same', () => {
    const a = mintShareToken(), b = mintShareToken()
    expect(a).toMatch(SHARE_TOKEN_RE)
    expect(a).not.toContain('.')
    expect(a).not.toBe(b)
  })
})

describe('share password', () => {
  it('round-trips and rejects the wrong one, a bad store, and nothing', async () => {
    const stored = await hashSharePassword('open sesame')
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/)
    expect(await verifySharePassword('open sesame', stored)).toBe(true)
    expect(await verifySharePassword('open sesamE', stored)).toBe(false)
    expect(await verifySharePassword('open sesame', 'garbage')).toBe(false)
    expect(await verifySharePassword('open sesame', null)).toBe(false)
    expect(await hashSharePassword('open sesame')).not.toBe(stored) // fresh salt
  })
})

describe('unlock cookie', () => {
  const link = { id: 'a1b2c3d4-0000-4000-8000-000000000000', password_hash: 'salt:hash' }
  it('is deterministic per link+hash+secret and never holds the password', () => {
    const v = shareCookieValue(link, 's1')
    expect(v).toBe(shareCookieValue(link, 's1'))
    expect(v).not.toBe(shareCookieValue(link, 's2'))
    expect(v).not.toBe(shareCookieValue({ ...link, password_hash: 'salt:other' }, 's1'))
    expect(shareCookieValid(link, v, 's1')).toBe(true)
    expect(shareCookieValid(link, v, 's2')).toBe(false)
    expect(shareCookieValid(link, null, 's1')).toBe(false)
    expect(shareCookieName(link.id)).toBe('vb_share_a1b2c3d4000040008000000000000000')
  })
  it('refuses an empty secret', () => {
    expect(() => shareCookieValue(link, '')).toThrow()
  })
})

describe('shareStatus / expiry', () => {
  const now = new Date('2026-08-30T12:00:00Z')
  it('orders revoked over expired over ok', () => {
    expect(shareStatus(null, now)).toBe('invalid')
    expect(shareStatus({ expires_at: null, revoked_at: null }, now)).toBe('ok')
    expect(shareStatus({ expires_at: '2026-08-30T12:00:00Z', revoked_at: null }, now)).toBe('expired')
    expect(shareStatus({ expires_at: '2026-09-30T00:00:00Z', revoked_at: null }, now)).toBe('ok')
    expect(shareStatus({ expires_at: '2026-01-01T00:00:00Z', revoked_at: '2026-08-01T00:00:00Z' }, now)).toBe('revoked')
  })
  it('turns days into an expiry, null into none', () => {
    expect(expiryFromDays(30, now)).toBe('2026-09-29T12:00:00.000Z')
    expect(expiryFromDays(null, now)).toBeNull()
  })
  it('hashes a viewer address to a short opaque id', () => {
    expect(hashViewerIp('203.0.113.9', 's')).toHaveLength(16)
    expect(hashViewerIp('203.0.113.9', 's')).not.toBe(hashViewerIp('203.0.113.10', 's'))
    expect(hashViewerIp(null, 's')).toBeNull()
  })
})
