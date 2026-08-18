import { describe, it, expect } from 'vitest'
import { authorKey, filterSuppressed, handleVariants } from './suppression'

describe('authorKey', () => {
  it('lower-cases, trims, strips one leading @', () => {
    expect(authorKey('youtube', '  @Alice_Smith ')).toBe('alice_smith')
    expect(authorKey('tiktok', 'Alice_Smith')).toBe('alice_smith')
    expect(authorKey('youtube', '@@double')).toBe('@double') // only one @ is a prefix
  })
  it('strips Reddit u/ prefixes only for reddit', () => {
    expect(authorKey('reddit', 'u/someone')).toBe('someone')
    expect(authorKey('reddit', '/u/someone')).toBe('someone')
    expect(authorKey('tiktok', 'u/someone')).toBe('u/someone')
  })
  it('collapses inner whitespace (YouTube display names can carry it)', () => {
    expect(authorKey('youtube', 'Jane   Doe')).toBe('jane doe')
  })
  it('null / empty never match', () => {
    expect(authorKey('youtube', null)).toBeNull()
    expect(authorKey('youtube', '')).toBeNull()
    expect(authorKey('youtube', '@')).toBeNull()
  })
})

describe('handleVariants', () => {
  it('covers raw, bare, @-prefixed and lower-cased forms', () => {
    expect(new Set(handleVariants('@Alice'))).toEqual(new Set(['@Alice', 'Alice', 'alice', '@alice']))
    expect(new Set(handleVariants('bob'))).toEqual(new Set(['bob', '@bob']))
  })
})

describe('filterSuppressed', () => {
  const rows = [
    { comment_id: '1', author: '@Alice' },
    { comment_id: '2', author: 'bob' },
    { comment_id: '3', author: null },
    { comment_id: '4', author: 'ALICE' },
  ]
  it('drops every variant of a suppressed key and counts them', () => {
    const { kept, suppressed } = filterSuppressed(rows, new Set(['alice']), 'youtube')
    expect(kept.map((r) => r.comment_id)).toEqual(['2', '3'])
    expect(suppressed).toBe(2)
  })
  it('no keys → passthrough, same array', () => {
    const r = filterSuppressed(rows, new Set(), 'youtube')
    expect(r.kept).toBe(rows)
    expect(r.suppressed).toBe(0)
  })
})
