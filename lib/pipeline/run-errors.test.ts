import { describe, it, expect } from 'vitest'
import { summariseRunErrors, partialRunAlert, RUN_ERROR_CAP, ALERT_ERROR_LIST_CAP } from './run-errors'

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

describe('partialRunAlert', () => {
  const base = {
    runId: '147899d3-0000-0000-0000-000000000000',
    clientName: 'Össur',
    total: 2,
    recorded: ['owned-posts:tiktok: 22P02 invalid input syntax', 'owned-posts:instagram: profile returned 0 posts'],
    reportSent: true,
  }

  it('names the client in the subject so the inbox scan reads it', () => {
    expect(partialRunAlert(base).subject).toBe('Verbatim run PARTIAL — Össur')
  })

  it('carries the run id, the step summary and every recorded error', () => {
    const { text } = partialRunAlert(base)
    expect(text).toContain(base.runId)
    expect(text).toContain('2 step errors: owned-posts:instagram, owned-posts:tiktok')
    expect(text).toContain('- owned-posts:tiktok: 22P02 invalid input syntax')
    expect(text).toContain('- owned-posts:instagram: profile returned 0 posts')
  })

  it('says whether the client report still went out', () => {
    expect(partialRunAlert(base).text).toContain('The client report was still sent')
    expect(partialRunAlert({ ...base, reportSent: false }).text).toContain('No client report was requested')
  })

  it('caps the listed errors and points at pipeline_runs.errors for the rest', () => {
    const recorded = Array.from({ length: 40 }, (_, i) => `comments:instagram:${i + 1}: 429`)
    const { text } = partialRunAlert({ ...base, total: 40, recorded })
    expect(text).toContain(`- comments:instagram:${ALERT_ERROR_LIST_CAP}: 429`)
    expect(text).not.toContain(`- comments:instagram:${ALERT_ERROR_LIST_CAP + 1}: 429`)
    expect(text).toContain(`…and ${40 - ALERT_ERROR_LIST_CAP} more in pipeline_runs.errors`)
  })
})
