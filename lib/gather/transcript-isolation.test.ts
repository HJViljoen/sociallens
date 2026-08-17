import { describe, it, expect } from 'vitest'
import { fetchTranscriptsIsolating } from './gather'
import { ApifyError } from './apify'
import type { FetchedTranscript } from './types'

const tx = (id: string): FetchedTranscript => ({ text: `transcript ${id}`, lang: 'en', source: 'youtube_caption' })

function fakeFetch(opts: { poison?: string[]; batchError?: Error; perIdError?: (id: string) => Error | null }) {
  const calls: string[][] = []
  const fetch = async (ids: string[]) => {
    calls.push(ids)
    const poisoned = ids.filter((id) => opts.poison?.includes(id))
    if (poisoned.length) {
      const err = opts.perIdError?.(poisoned[0]) ?? opts.batchError ?? new ApifyError('Apify 400: {"error":{"type":"run-failed"}}')
      throw err
    }
    return new Map(ids.map((id) => [id, tx(id)]))
  }
  return { fetch, calls }
}

describe('fetchTranscriptsIsolating', () => {
  it('healthy batch: one call, everything fetched, nothing failed', async () => {
    const f = fakeFetch({})
    const r = await fetchTranscriptsIsolating(f.fetch, ['a', 'b', 'c'], 8)
    expect(f.calls).toEqual([['a', 'b', 'c']])
    expect([...r.fetched.keys()]).toEqual(['a', 'b', 'c'])
    expect(r.failed.size).toBe(0)
  })

  it('poison id in a batch (definitive 4xx): isolates per id — mates resolve, the poison is `failed`, nothing NULL', async () => {
    // Sealand f4c5d868: an 11-hour livestream crashed the caption actor and
    // took 7 healthy videos down with it on every Inngest retry.
    const f = fakeFetch({ poison: ['stream11h'] })
    const ids = ['a', 'b', 'stream11h', 'c']
    const r = await fetchTranscriptsIsolating(f.fetch, ids, 8)
    expect(f.calls[0]).toEqual(ids) // batch attempt first
    expect(f.calls.slice(1)).toEqual([['a'], ['b'], ['stream11h'], ['c']]) // then per id
    expect([...r.fetched.keys()].sort()).toEqual(['a', 'b', 'c'])
    expect(r.failed.get('stream11h')).toMatch(/Apify 400/)
    for (const id of ids) expect(r.fetched.has(id) || r.failed.has(id)).toBe(true)
  })

  it('transient batch failure (5xx/429): rethrows immediately, no per-id storm — the step must retry with backoff', async () => {
    for (const msg of ['Apify 503: upstream', 'Apify 429: rate limited']) {
      const f = fakeFetch({ poison: ['x'], batchError: new ApifyError(msg) })
      await expect(fetchTranscriptsIsolating(f.fetch, ['a', 'x'], 8)).rejects.toThrow(msg)
      expect(f.calls.length).toBe(1)
    }
  })

  it('non-Apify error (network): rethrows, no isolation', async () => {
    const f = fakeFetch({ poison: ['x'], batchError: new TypeError('fetch failed') })
    await expect(fetchTranscriptsIsolating(f.fetch, ['a', 'x'], 8)).rejects.toThrow('fetch failed')
    expect(f.calls.length).toBe(1)
  })

  it('a chunk of one that fails definitively is `failed` directly (no redundant retry)', async () => {
    const f = fakeFetch({ poison: ['x'] })
    const r = await fetchTranscriptsIsolating(f.fetch, ['x'], 8)
    expect(f.calls).toEqual([['x']])
    expect(r.failed.has('x')).toBe(true)
    expect(r.fetched.size).toBe(0)
  })

  it('respects batchSize across chunks and only isolates the chunk that failed', async () => {
    const f = fakeFetch({ poison: ['p'] })
    const r = await fetchTranscriptsIsolating(f.fetch, ['a', 'b', 'p', 'c'], 2)
    // chunks: [a,b] ok · [p,c] fails → per id [p] failed, [c] ok
    expect(f.calls).toEqual([['a', 'b'], ['p', 'c'], ['p'], ['c']])
    expect([...r.fetched.keys()].sort()).toEqual(['a', 'b', 'c'])
    expect([...r.failed.keys()]).toEqual(['p'])
  })
})
