import { describe, expect, it } from 'vitest'
import { STARTER_TEMPLATES, instantiate, starterTemplate } from './templates'
import { isStaticKey } from './compose'
import { SECTION_PAGES } from './types'

describe('starter templates', () => {
  it('are four, name only static keys of their own page, and every audience is real', () => {
    expect(STARTER_TEMPLATES.map((t) => t.key)).toEqual(['monthly_marketing_review', 'leadership_one_pager', 'sales_objections_competitors', 'content_what_to_make_next'])
    for (const t of STARTER_TEMPLATES) {
      for (const s of t.sections) {
        expect(SECTION_PAGES).toContain(s.page)
        expect(s.page).not.toBe('agent')
        for (const k of s.keys ?? []) {
          expect(isStaticKey(k)).toBe(true)
          expect(k.startsWith(`${s.page}.`)).toBe(true)
        }
      }
    }
  })
  it('instantiates with fresh ids', () => {
    const secs = instantiate(starterTemplate('leadership_one_pager')!.sections)
    expect(secs).toHaveLength(1)
    expect(secs[0].id).toMatch(/^[a-z0-9-]{8}$/)
  })
})
