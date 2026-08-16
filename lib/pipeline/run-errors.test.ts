import { describe, it, expect } from 'vitest'
import { summariseRunErrors, RUN_ERROR_CAP } from './run-errors'

describe('summariseRunErrors', () => {
  it('returns null for a clean run so error_message stays NULL', () => {
    expect(summariseRunErrors(0, [])).toBeNull()
  })

  it('names the failing step — the thing the 2026-08-16 partial run could not tell us', () => {
    expect(summariseRunErrors(1, ['owned-posts:tiktok: upsert failed'])).toBe(
      '1 step error: owned-posts:tiktok',
    )
  })

  it('groups repeats of the same step with a count', () => {
    expect(
      summariseRunErrors(3, [
        'comments:tiktok:4: timeout',
        'comments:tiktok:4: timeout',
        'owned-posts:tiktok: boom',
      ]),
    ).toBe('3 step errors: comments:tiktok:4 ×2, owned-posts:tiktok')
  })

  it('orders by frequency, then alphabetically for a stable read', () => {
    expect(summariseRunErrors(3, ['b: x', 'a: x', 'a: x'])).toBe('3 step errors: a ×2, b')
  })

  it('stays honest when the cap truncates the recorded list', () => {
    const recorded = Array.from({ length: RUN_ERROR_CAP }, () => 'comments:instagram:1: 429')
    expect(summariseRunErrors(120, recorded)).toBe(
      `120 step errors (first ${RUN_ERROR_CAP} recorded): comments:instagram:1 ×${RUN_ERROR_CAP}`,
    )
  })

  it('still reports a count when nothing was recorded', () => {
    expect(summariseRunErrors(2, [])).toBe('2 step errors')
  })

  it('handles entries with no detail suffix', () => {
    expect(summariseRunErrors(1, ['owned-posts:tiktok'])).toBe('1 step error: owned-posts:tiktok')
  })
})
