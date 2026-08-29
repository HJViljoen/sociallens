import { describe, expect, it } from 'vitest'
import { collectQuoteRefs, freezeQuotes, isQuote, parseRef, quoteRef, resolveQuotes } from './quotes-freeze'

const data = {
  title: 'Dashboard',
  count: 3,
  brief: {
    lead: { ref: 'e:aaa', text: 'first voice' },
    voices: [
      { ref: 'e:bbb', text: 'second voice' },
      { ref: 'c:ccc', text: 'third voice' },
    ],
  },
  items: [
    { id: 'x', quotes: [{ ref: 'v:vid', text: 'transcript line' }], notAQuote: { ref: 'nope', text: 'keep' } },
  ],
  nothing: null,
  when: 'later',
}

describe('quote freeze / resolve', () => {
  it('recognises quotes only by prefixed ref + text', () => {
    expect(isQuote({ ref: 'e:1', text: 'x' })).toBe(true)
    expect(isQuote({ ref: 'c:1', text: '' })).toBe(true)
    expect(isQuote({ ref: 'nope', text: 'x' })).toBe(false)
    expect(isQuote({ ref: 'e:1' })).toBe(false)
    expect(isQuote([{ ref: 'e:1', text: 'x' }])).toBe(false)
    expect(isQuote('e:1')).toBe(false)
  })

  it('freezes text to empty and collects distinct refs, leaving everything else intact', () => {
    const { data: frozen, refs } = freezeQuotes(data)
    expect(refs.sort()).toEqual(['c:ccc', 'e:aaa', 'e:bbb', 'v:vid'])
    expect(frozen.brief.lead).toEqual({ ref: 'e:aaa', text: '' })
    expect(frozen.brief.voices.map((q) => q.text)).toEqual(['', ''])
    expect(frozen.items[0].quotes[0]).toEqual({ ref: 'v:vid', text: '' })
    expect(frozen.items[0].notAQuote).toEqual({ ref: 'nope', text: 'keep' })
    expect(frozen.count).toBe(3)
    expect(frozen.nothing).toBeNull()
    // The original is untouched.
    expect(data.brief.lead.text).toBe('first voice')
  })

  it('resolves text back and drops what no longer resolves', () => {
    const { data: frozen } = freezeQuotes(data)
    const texts = new Map([
      ['e:aaa', 'first voice'],
      ['e:bbb', 'second voice'],
      // c:ccc erased; v:vid erased
    ])
    const thawed = resolveQuotes(frozen, texts)
    expect(thawed.brief.lead).toEqual({ ref: 'e:aaa', text: 'first voice' })
    expect(thawed.brief.voices).toEqual([{ ref: 'e:bbb', text: 'second voice' }])
    expect(thawed.items[0].quotes).toEqual([])
    expect(thawed.items[0].notAQuote).toEqual({ ref: 'nope', text: 'keep' })
  })

  it('nulls a standalone quote that does not resolve', () => {
    const { data: frozen } = freezeQuotes({ lead: { ref: 'e:gone', text: 'x' } })
    expect(resolveQuotes(frozen, new Map())).toEqual({ lead: null })
  })

  it('freeze → resolve with every ref present is the identity', () => {
    const { data: frozen } = freezeQuotes(data)
    const texts = new Map<string, string>()
    for (const ref of collectQuoteRefs(data)) {
      // gather the original text by ref
      const find = (n: unknown): string | undefined => {
        if (isQuote(n)) return n.ref === ref ? n.text : undefined
        if (Array.isArray(n)) for (const i of n) { const t = find(i); if (t) return t }
        else if (n && typeof n === 'object') for (const v of Object.values(n)) { const t = find(v); if (t) return t }
        return undefined
      }
      texts.set(ref, find(data)!)
    }
    expect(resolveQuotes(frozen, texts)).toEqual(data)
  })

  it('builds and parses refs', () => {
    expect(quoteRef.evidence('1')).toBe('e:1')
    expect(parseRef('c:abc')).toEqual({ kind: 'c', id: 'abc' })
    expect(parseRef('x:abc')).toBeNull()
    expect(quoteRef.hero('recommendations', 'r1')).toBe('h:recommendations:r1')
    expect(parseRef('h:recommendations:r1')).toEqual({ kind: 'h', table: 'recommendations', id: 'r1' })
    expect(isQuote({ ref: 'h:recommendations:r1', text: 'x' })).toBe(true)
    expect(isQuote({ ref: 'h:r1', text: 'x' })).toBe(false)
    expect(quoteRef.brandVoice('run-1', 2)).toBe('b:run-1:2')
    expect(parseRef('b:run-1:2')).toEqual({ kind: 'b', runId: 'run-1', index: 2 })
    expect(isQuote({ ref: 'b:run-1:2', text: 'x' })).toBe(true)
    expect(isQuote({ ref: 'b:run-1:x', text: 'x' })).toBe(false)
    expect(quoteRef.message('c9')).toBe('m:c9')
    expect(parseRef('m:c9')).toEqual({ kind: 'm', id: 'c9' })
    expect(isQuote({ ref: 'm:c9', text: 'x' })).toBe(true)
    expect(quoteRef.phrase('ls1')).toBe('p:ls1')
    expect(isQuote({ ref: 'p:ls1', text: 'x' })).toBe(true)
  })
})
