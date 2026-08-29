import { createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'
import { signRenderToken, verifyRenderToken } from './render-token'

const SECRET = 'test-secret-do-not-use'
const at = (unixSeconds: number) => new Date(unixSeconds * 1000)

describe('render token', () => {
  it('round-trips a payload before expiry', () => {
    const token = signRenderToken({ snapshotId: 'snap-1', tileKey: 'dashboard.strip', exp: 1000 }, SECRET)
    expect(verifyRenderToken(token, SECRET, at(999))).toEqual({ snapshotId: 'snap-1', tileKey: 'dashboard.strip', exp: 1000 })
  })

  it('omits tileKey when the payload had none', () => {
    const token = signRenderToken({ snapshotId: 'snap-1', exp: 1000 }, SECRET)
    expect(verifyRenderToken(token, SECRET, at(1))).toEqual({ snapshotId: 'snap-1', exp: 1000 })
  })

  it('rejects at and after expiry', () => {
    const token = signRenderToken({ snapshotId: 'snap-1', exp: 1000 }, SECRET)
    expect(verifyRenderToken(token, SECRET, at(1000))).toBeNull()
    expect(verifyRenderToken(token, SECRET, at(5000))).toBeNull()
  })

  it('rejects a tampered payload', () => {
    const token = signRenderToken({ snapshotId: 'snap-1', exp: 1000 }, SECRET)
    const [payload, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ snapshotId: 'snap-2', exp: 1000 })).toString('base64url')
    expect(verifyRenderToken(`${forged}.${sig}`, SECRET, at(1))).toBeNull()
    expect(verifyRenderToken(`${payload}.${sig.slice(0, -2)}xx`, SECRET, at(1))).toBeNull()
  })

  it('rejects the wrong secret, garbage, and empties without throwing', () => {
    const token = signRenderToken({ snapshotId: 'snap-1', exp: 1000 }, SECRET)
    expect(verifyRenderToken(token, 'other', at(1))).toBeNull()
    expect(verifyRenderToken('', SECRET)).toBeNull()
    expect(verifyRenderToken(null, SECRET)).toBeNull()
    expect(verifyRenderToken('no-dot', SECRET)).toBeNull()
    expect(verifyRenderToken('a.', SECRET)).toBeNull()
    expect(verifyRenderToken('.b', SECRET)).toBeNull()
    expect(verifyRenderToken(token, '')).toBeNull()
  })

  it('rejects a well-signed payload of the wrong shape', () => {
    const bad = Buffer.from(JSON.stringify({ exp: 1000 })).toString('base64url')
    // Sign it properly, then confirm shape validation still refuses it.
    const sig = createHmac('sha256', SECRET).update(bad).digest('base64url')
    expect(verifyRenderToken(`${bad}.${sig}`, SECRET, at(1))).toBeNull()
  })

  it('refuses to sign with an empty secret', () => {
    expect(() => signRenderToken({ snapshotId: 's', exp: 1 }, '')).toThrow()
  })
})
