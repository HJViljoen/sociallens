import { describe, expect, it } from 'vitest'
import { applyEdits, blockToText, textToBlock } from './edits'
import type { DocumentSnapshotData } from './types'

const doc = (): DocumentSnapshotData => ({
  version: 1, kind: 'document', template: 'sales_brief', reportId: 'r', title: 'Sales brief', audience: 'sales', company: 'Össur', period: 'Update of 30 Aug 2026', runId: 'run',
  figures: {}, delta: null, notSureYet: [], generatedAt: '2026-08-31T00:00:00Z', model: 'm', promptVersion: 'v1',
  method: { conversations: 1, videos: 1, clientVideos: 1, competitorVideos: 0, period: 'p', sources: [], heldBack: 0, thin: false },
  pages: [
    { id: 'f1', kind: 'finding', title: 'Finding', blocks: [
      { id: 'f1.headline', field: 'headline', text: 'Comfort decides' },
      { id: 'f1.saw', field: 'saw', text: 'What we saw, with [[conversations]] conversations.', quote: { ref: 'e:1', text: '' } },
      { id: 'f1.practice', field: 'practice', text: '', items: ['Ask about fit', 'Offer a trial'] },
    ] },
  ],
})

describe('applyEdits', () => {
  it('replaces exactly the edited block, keeps the quote and every other block, and never mutates the input', () => {
    const before = doc()
    const frozen = JSON.stringify(before)
    const out = applyEdits(before, [{ block_id: 'f1.saw', text: 'What the operator wrote.' }])
    expect(out.pages[0].blocks[1].text).toBe('What the operator wrote.')
    expect(out.pages[0].blocks[1].quote).toEqual({ ref: 'e:1', text: '' })
    expect(out.pages[0].blocks[0].text).toBe('Comfort decides')
    expect(out.pages[0].blocks[2].items).toEqual(['Ask about fit', 'Offer a trial'])
    expect(JSON.stringify(before)).toBe(frozen)
  })
  it('an items block edits as one item per line; blank lines drop', () => {
    const out = applyEdits(doc(), [{ block_id: 'f1.practice', text: 'One\n\n  Two  \n' }])
    expect(out.pages[0].blocks[2].items).toEqual(['One', 'Two'])
    expect(out.pages[0].blocks[2].text).toBe('')
  })
  it('no edits, an unknown block, or a non-document comes back untouched', () => {
    const d = doc()
    expect(applyEdits(d, [])).toBe(d)
    expect(applyEdits(d, [{ block_id: 'nope', text: 'x' }])).toBe(d)
    const arranged = { version: 1, sections: [] }
    expect(applyEdits(arranged, [{ block_id: 'f1.saw', text: 'x' }])).toBe(arranged)
  })
})

describe('blockToText / textToBlock', () => {
  it('round-trip a prose block and an items block', () => {
    const prose = { id: 'a', field: 'saw' as const, text: 'Hello' }
    expect(textToBlock(prose, blockToText(prose))).toEqual(prose)
    const items = { id: 'b', field: 'practice' as const, text: '', items: ['x', 'y'] }
    expect(textToBlock(items, blockToText(items))).toEqual(items)
  })
})
