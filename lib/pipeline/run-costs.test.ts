import { describe, it, expect } from 'vitest'
import { attributeApifySpend } from './run-costs'

const run = (startedAt: string, usd: number) => ({ startedAt, usageTotalUsd: usd })

describe('attributeApifySpend (Tier 1)', () => {
  const start = '2026-08-23T04:00:00Z'
  const end = '2026-08-23T07:00:00Z'

  it('sums only the actor runs inside the pipeline run window', () => {
    const r = attributeApifySpend(
      [
        run('2026-08-23T03:59:00Z', 5), // before
        run('2026-08-23T04:30:00Z', 3),
        run('2026-08-23T06:59:00Z', 1.5),
        run('2026-08-23T07:30:00Z', 9), // after
      ],
      start, end,
    )
    expect(r.usd).toBe(4.5)
    expect(r.attribution).toBe('exact')
  })

  it('labels the total ambiguous when another pipeline run overlapped', () => {
    // Apify bills per ACCOUNT, so two tenants running at once cannot be split.
    // Recording the total and saying so beats presenting it as one run's spend.
    const r = attributeApifySpend([run('2026-08-23T05:00:00Z', 8)], start, end, 2)
    expect(r.usd).toBe(8)
    expect(r.attribution).toBe('ambiguous')
  })

  it('treats a missing or null usage figure as zero, not NaN', () => {
    const r = attributeApifySpend(
      [{ startedAt: '2026-08-23T05:00:00Z' }, { startedAt: '2026-08-23T05:00:00Z', usageTotalUsd: null }],
      start, end,
    )
    expect(r.usd).toBe(0)
  })

  it('ignores an unparseable timestamp rather than counting it', () => {
    expect(attributeApifySpend([run('not-a-date', 12)], start, end).usd).toBe(0)
  })

  it('an empty account list costs nothing', () => {
    expect(attributeApifySpend([], start, end)).toEqual({ usd: 0, attribution: 'exact' })
  })
})
