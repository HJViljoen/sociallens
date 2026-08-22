import { describe, it, expect } from 'vitest'
import { findSpan, anchorClaims } from './anchor'
import type { ClaimResult } from './types'

const claim = (ref: string, source: string | null): ClaimResult => ({
  ref,
  claim: `claim ${ref}`,
  verdict: 'echoes',
  theySay: null,
  conversationCount: 0,
  themeRefs: [],
  insightIds: [],
  source,
})

describe('findSpan', () => {
  const doc = 'Our buyers care most about price.\nComfort is secondary for them.'

  it('finds a span that is exactly present', () => {
    const hit = findSpan(doc, 'Our buyers care most about price.')
    expect(hit).not.toBeNull()
    expect(doc.slice(hit![0], hit![1])).toBe('Our buyers care most about price.')
  })

  it('finds a span the PDF extractor broke across a line', () => {
    // The whole reason normalising exists: extraction inserts newlines mid
    // sentence, so a plain indexOf misses text that is plainly there.
    const broken = 'Our buyers care most\nabout price.'
    const hit = findSpan(broken, 'Our buyers care most about price.')
    expect(hit).not.toBeNull()
    // The range maps back to the ORIGINAL characters, newline included.
    expect(broken.slice(hit![0], hit![1])).toBe('Our buyers care most\nabout price.')
  })

  it('refuses a span that was paraphrased rather than copied', () => {
    // The model tidying a sentence must not become a "quote" of the client's
    // own document.
    expect(findSpan(doc, 'Our buyers care mostly about the price.')).toBeNull()
  })

  it('refuses a span that is not there at all', () => {
    expect(findSpan(doc, 'We will run a Black Friday promotion.')).toBeNull()
  })

  it('refuses a span too short to anchor safely', () => {
    // "price" appears, but highlighting one word is noise and could land
    // anywhere it happens to occur.
    expect(findSpan(doc, 'price')).toBeNull()
  })
})

describe('anchorClaims', () => {
  const doc = 'Our buyers care most about price. Comfort is secondary for them. Delivery speed wins deals.'

  it('cuts the document into plain and highlighted segments, in order', () => {
    const { segments, anchored } = anchorClaims(doc, [
      claim('C1', 'Our buyers care most about price.'),
      claim('C2', 'Delivery speed wins deals.'),
    ])
    expect(anchored).toEqual(new Set(['C1', 'C2']))
    expect(segments.map((s) => s.ref)).toEqual(['C1', null, 'C2'])
    // Rejoining the segments must reproduce the document exactly — a renderer
    // that silently drops or duplicates the client's words is worse than no
    // highlighting.
    expect(segments.map((s) => s.text).join('')).toBe(doc)
  })

  it('leaves an unstated claim unanchored instead of guessing', () => {
    const { segments, anchored } = anchorClaims(doc, [claim('C1', null), claim('C2', 'Nowhere in here.')])
    expect(anchored.size).toBe(0)
    expect(segments).toHaveLength(1)
    expect(segments[0].ref).toBeNull()
  })

  it('gives an overlapping span to the first claim only', () => {
    // Two claims from one sentence cannot both be a flat range; the second goes
    // unanchored rather than producing interleaved markup.
    const { anchored } = anchorClaims(doc, [
      claim('C1', 'Our buyers care most about price.'),
      claim('C2', 'buyers care most about price. Comfort is secondary'),
    ])
    expect(anchored.has('C1')).toBe(true)
    expect(anchored.has('C2')).toBe(false)
  })

  it('always reproduces the document, whatever the claims', () => {
    const { segments } = anchorClaims(doc, [
      claim('C1', 'Comfort is secondary for them.'),
      claim('C2', 'Our buyers care most about price.'),
    ])
    expect(segments.map((s) => s.text).join('')).toBe(doc)
  })

  it('handles an empty document and no claims', () => {
    expect(anchorClaims('', []).segments).toEqual([])
    expect(anchorClaims('some text', []).segments).toEqual([{ text: 'some text', ref: null }])
  })
})
