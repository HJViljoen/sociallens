import { describe, it, expect } from 'vitest'
import { fetchTranscriptsIsolating } from './gather'
import { ApifyError, isActorRunFailedError } from './apify'
import type { FetchedTranscript } from './types'

const tx = (id: string): FetchedTranscript => ({ text: `transcript ${id}`, lang: 'en', source: 'youtube_caption' })
const RUN_FAILED = () => new ApifyError('Apify 400: {"error":{"type":"run-failed","message":"Actor run did not succeed (run ID: x, status: FAILED)."}}')

function fakeFetch(opts: { poison?: string[]; error?: () => Error }) {
  const calls: string[][] = []
  const fetch = async (ids: string[]) => {
    calls.push(ids)
    if (ids.some((id) => opts.poison?.includes(id))) throw (opts.error ?? RUN_FAILED)()
    return new Map(ids.map((id) => [id, tx(id)]))
  }
  return { fetch, calls }
}

describe('isActorRunFailedError', () => {
  it('matches only Apify 400 run-failed / run-aborted', () => {
    expect(isActorRunFailedError(RUN_FAILED())).toBe(true)
    expect(isActorRunFailedError(new ApifyError('Apify 400: {"error":{"type":"run-aborted"}}'))).toBe(true)
    for (const m of [
      'Apify 400: {"error":{"type":"actor-memory-limit-exceeded"}}',
      'Apify 401: {"error":{"type":"token-not-found"}}',
      'Apify 402: {"error":{"type":"monthly-usage-hard-limit-exceeded"}}',
      'Apify 403: forbidden',
      'Apify 404: {"error":{"type":"record-not-found"}}',
      'Apify 408: {"error":{"type":"run-timeout-exceeded"}}',
      'Apify 429: rate limited',
      'Apify 503: upstream',
      'APIFY_TOKEN not set',
    ]) expect(isActorRunFailedError(new ApifyError(m)), m).toBe(false)
    expect(isActorRunFailedError(new TypeError('fetch failed'))).toBe(false)
  })
})

describe('fetchTranscriptsIsolating', () => {
  it('healthy batch: one call, everything fetched, nothing failed', async () => {
    const f = fakeFetch({})
    const r = await fetchTranscriptsIsolating(f.fetch, ['a', 'b', 'c'], 8)
    expect(f.calls).toEqual([['a', 'b', 'c']])
    expect([...r.fetched.keys()]).toEqual(['a', 'b', 'c'])
    expect(r.failed.size).toBe(0)
  })

  it('poison id in a batch (run-failed): isolates per id — mates resolve, the poison is `failed`, nothing NULL', async () => {
    // Sealand f4c5d868: an 11-hour livestream crashed the caption actor and
    // took 7 healthy videos down with it on every Inngest retry.
    const f = fakeFetch({ poison: ['stream11h'] })
    const ids = ['a', 'b', 'stream11h', 'c']
    const r = await fetchTranscriptsIsolating(f.fetch, ids, 8)
    expect(f.calls[0]).toEqual(ids)
    expect(f.calls.slice(1)).toEqual([['a'], ['b'], ['stream11h'], ['c']])
    expect([...r.fetched.keys()].sort()).toEqual(['a', 'b', 'c'])
    expect(r.failed.get('stream11h')).toMatch(/run-failed/)
    for (const id of ids) expect(r.fetched.has(id) || r.failed.has(id)).toBe(true)
  })

  it('actor globally broken (every id run-fails alone): rethrows the batch error, stamps NOTHING', async () => {
    const f = fakeFetch({ poison: ['a', 'b', 'c'] })
    await expect(fetchTranscriptsIsolating(f.fetch, ['a', 'b', 'c'], 8)).rejects.toThrow(/run-failed/)
    expect(f.calls.length).toBe(4) // batch + 3 per-id probes, then give up
  })

  it('a chunk of one that run-fails: rethrows (no mate evidence possible), no stamp', async () => {
    const f = fakeFetch({ poison: ['x'] })
    await expect(fetchTranscriptsIsolating(f.fetch, ['x'], 8)).rejects.toThrow(/run-failed/)
    expect(f.calls).toEqual([['x']])
  })

  it('non-run-failed 4xx (402 usage limit, 404 actor, 408 timeout, 401): rethrows immediately, no per-id storm', async () => {
    for (const msg of [
      'Apify 402: {"error":{"type":"monthly-usage-hard-limit-exceeded"}}',
      'Apify 404: {"error":{"type":"record-not-found"}}',
      'Apify 408: {"error":{"type":"run-timeout-exceeded"}}',
      'Apify 401: {"error":{"type":"token-not-found"}}',
      'Apify 400: {"error":{"type":"actor-memory-limit-exceeded"}}',
    ]) {
      const f = fakeFetch({ poison: ['x'], error: () => new ApifyError(msg) })
      await expect(fetchTranscriptsIsolating(f.fetch, ['a', 'x'], 8)).rejects.toThrow(msg.slice(0, 9))
      expect(f.calls.length).toBe(1)
    }
  })

  it('transient (5xx/429) and network errors: rethrow immediately — the step must retry with backoff', async () => {
    for (const err of [() => new ApifyError('Apify 503: upstream'), () => new ApifyError('Apify 429: rate limited'), () => new TypeError('fetch failed')]) {
      const f = fakeFetch({ poison: ['x'], error: err })
      await expect(fetchTranscriptsIsolating(f.fetch, ['a', 'x'], 8)).rejects.toThrow()
      expect(f.calls.length).toBe(1)
    }
  })

  it('a non-run-failed error DURING isolation propagates (mates already resolved are discarded; retry re-runs the batch)', async () => {
    let n = 0
    const fetch = async (ids: string[]) => {
      n++
      if (ids.length > 1) throw RUN_FAILED()
      if (ids[0] === 'b') throw new ApifyError('Apify 503: upstream')
      return new Map(ids.map((id) => [id, tx(id)]))
    }
    await expect(fetchTranscriptsIsolating(fetch, ['a', 'b', 'c'], 8)).rejects.toThrow('Apify 503')
    expect(n).toBe(3) // batch, a, b — stopped at b
  })

  it('respects batchSize across chunks and only isolates the chunk that run-failed', async () => {
    const f = fakeFetch({ poison: ['p'] })
    const r = await fetchTranscriptsIsolating(f.fetch, ['a', 'b', 'p', 'c'], 2)
    expect(f.calls).toEqual([['a', 'b'], ['p', 'c'], ['p'], ['c']])
    expect([...r.fetched.keys()].sort()).toEqual(['a', 'b', 'c'])
    expect([...r.failed.keys()]).toEqual(['p'])
  })

  it('isolation pass past its wall-clock budget rethrows the batch error (chunk stays NULL for the retry)', async () => {
    let t = 0
    const now = () => t
    const fetch = async (ids: string[]) => {
      if (ids.length > 1) throw RUN_FAILED()
      t += 60_000 // each per-id call "takes" 60s
      return new Map(ids.map((id) => [id, tx(id)]))
    }
    await expect(fetchTranscriptsIsolating(fetch, ['a', 'b', 'c', 'd', 'e'], 8, { deadlineMs: 150_000, now })).rejects.toThrow(/run-failed/)
  })
})
