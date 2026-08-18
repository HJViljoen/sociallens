import { describe, it, expect, afterEach } from 'vitest'
import { checkSignupCode } from './signup-gate'

const original = process.env.SIGNUP_INVITE_CODE
afterEach(() => { process.env.SIGNUP_INVITE_CODE = original })

describe('checkSignupCode', () => {
  it('fails closed when no code is configured', () => {
    delete process.env.SIGNUP_INVITE_CODE
    expect(checkSignupCode('anything').ok).toBe(false)
  })
  it('accepts the configured code, case- and whitespace-insensitively', () => {
    process.env.SIGNUP_INVITE_CODE = 'Verbatim-2026'
    expect(checkSignupCode('  verbatim-2026 ').ok).toBe(true)
  })
  it('rejects a wrong or missing code', () => {
    process.env.SIGNUP_INVITE_CODE = 'Verbatim-2026'
    expect(checkSignupCode('nope').ok).toBe(false)
    expect(checkSignupCode('').ok).toBe(false)
    expect(checkSignupCode(null).ok).toBe(false)
  })
  it('an all-whitespace configured code counts as unset', () => {
    process.env.SIGNUP_INVITE_CODE = '   '
    expect(checkSignupCode('   ').ok).toBe(false)
  })
})
