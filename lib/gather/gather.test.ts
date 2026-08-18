import { describe, it, expect } from 'vitest'
import { capSearchPlan } from './gather'
import type { SearchTask } from './gather'

const plan = (perPlatform: Record<string, number>): SearchTask[] => {
  const out: SearchTask[] = []
  for (const [platform, n] of Object.entries(perPlatform)) {
    for (let i = 0; i < n; i++) {
      out.push({ platform: platform as SearchTask['platform'], keyword: `${platform}-kw${i}`, bucket: 'industry' })
    }
  }
  return out
}

describe('capSearchPlan — the run-level spend ceiling (T0-2)', () => {
  it('leaves a plan under the cap untouched (Sealand ~57, Ossur ~33 today)', () => {
    const tasks = plan({ tiktok: 13, youtube: 13, instagram: 13, reddit: 13 })
    expect(capSearchPlan(tasks, 80)).toHaveLength(52)
  })

  it('never drops a whole platform — the bug a flat slice would have had', () => {
    const tasks = plan({ tiktok: 45, youtube: 45, instagram: 45, reddit: 45 })
    const kept = capSearchPlan(tasks, 80)
    const platforms = new Set(kept.map((t) => t.platform))
    expect(platforms.size).toBe(4)
    expect(kept).toHaveLength(80)
  })

  it('trims each platform from the tail, so brand and competitor keywords survive', () => {
    const tasks = plan({ tiktok: 45, youtube: 45 })
    const kept = capSearchPlan(tasks, 20)
    expect(kept.filter((t) => t.platform === 'tiktok').map((t) => t.keyword))
      .toEqual(Array.from({ length: 10 }, (_, i) => `tiktok-kw${i}`))
  })

  it('spends the remainder rather than under-using the budget', () => {
    const tasks = plan({ tiktok: 30, youtube: 2, instagram: 30 })
    const kept = capSearchPlan(tasks, 20)
    expect(kept).toHaveLength(20)
    expect(kept.filter((t) => t.platform === 'youtube')).toHaveLength(2)
  })

  it('a single platform over the cap is simply trimmed', () => {
    expect(capSearchPlan(plan({ tiktok: 200 }), 80)).toHaveLength(80)
  })
})
