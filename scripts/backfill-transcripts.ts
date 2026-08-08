import { createAdminClient, selectAll } from '../lib/supabase-admin'
import { runActor } from '../lib/gather/apify'
import { adapters } from '../lib/gather/platforms'
import { resolveTranscript, classifyTranscript } from '../lib/gather/transcript'
import type { Platform, RawItem } from '../lib/gather/types'

// Transcript backfill for videos ALREADY in the corpus (Step 2 test bed).
//
//   node --env-file=.env.local --import tsx scripts/backfill-transcripts.ts [flags]
//
// Why this exists: gather resolves transcripts inline because every media URL is
// signed and expiring, so a video stored by an earlier run has no live handle
// left. This re-fetches known videos BY URL (adapter.refetchByUrl), transcribes,
// and writes the transcript columns — giving Pass A a with/without test bed on
// the run-1 corpus whose comments are already stored, with no new gather, no new
// videos, and no corpus pollution.
//
// Flags:
//   --client <uuid>      client_id (default: Sealand)
//   --limit <n>          videos to transcribe (default 60)
//   --platform <name>    tiktok | instagram (default: both)
//   --min-comments <n>   min stored comments to qualify (default 5)
//   --batch <n>          urls per actor call (default 10)
//   --force              re-transcribe videos that already have a status
//   --retry-failed       re-try only the ones that errored (failed / no_media)
//   --regate             re-run the CONTENT GATE over stored transcripts only —
//                        no refetch, no Whisper. Use after the gate changes.
//   --dry-run            pick + report the sample only; no actor calls, no writes

const SEALAND = 'ac16988e-c4f3-4baf-b388-73895852a554'
const PLATFORMS: Platform[] = ['tiktok', 'instagram']

type Bucket = 'client' | 'competitor' | 'industry'

interface Candidate {
  id: string
  run_id: string | null
  platform: Platform
  video_id: string
  video_url: string
  bucket: Bucket
  comments: number
}

interface Opts {
  clientId: string
  limit: number
  platform?: Platform
  minComments: number
  batch: number
  force: boolean
  retryFailed: boolean
  regate: boolean
  dryRun: boolean
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    clientId: SEALAND,
    limit: 60,
    minComments: 5,
    batch: 10,
    force: false,
    retryFailed: false,
    regate: false,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--client') o.clientId = next()
    else if (a === '--limit') o.limit = Number(next())
    else if (a === '--platform') o.platform = next() as Platform
    else if (a === '--min-comments') o.minComments = Number(next())
    else if (a === '--batch') o.batch = Number(next())
    else if (a === '--force') o.force = true
    else if (a === '--retry-failed') o.retryFailed = true
    else if (a === '--regate') o.regate = true
    else if (a === '--dry-run') o.dryRun = true
    else throw new Error(`unknown flag: ${a}`)
  }
  return o
}

/** Platform id from a canonical video url — used to match an actor's echoed
 *  input url back to the row we asked for (both actors echo it, but under
 *  different keys and sometimes in /reel/ vs /p/ form). */
function idFromUrl(platform: Platform, url: string): string | null {
  if (platform === 'tiktok') return url.match(/video\/(\d+)/)?.[1] ?? null
  return url.match(/\/(?:p|reel|tv)\/([^/?]+)/)?.[1] ?? null
}

function rawUrl(raw: RawItem): string {
  const v = raw as Record<string, unknown>
  for (const k of ['inputSource', 'inputUrl', 'postPage', 'url']) {
    const s = v[k]
    if (typeof s === 'string' && s) return s
  }
  return ''
}

/**
 * Stratified pick. Client- and competitor-owned videos are a small slice of the
 * corpus but a whole half of the design (their speech is brand voice, not
 * customer voice), so they're taken in full first; industry fills the rest,
 * split in proportion to its pool and richest-first. Deliberately NOT a
 * representative sample — report lift per bucket, never pooled.
 */
function pickSample(pool: Candidate[], limit: number): Candidate[] {
  const brand = pool.filter((c) => c.bucket !== 'industry').sort((a, b) => b.comments - a.comments)
  const industry = pool.filter((c) => c.bucket === 'industry')
  const taken = brand.slice(0, Math.floor(limit / 2))

  const remaining = limit - taken.length
  const byPlatform = new Map<Platform, Candidate[]>()
  for (const c of industry) {
    const arr = byPlatform.get(c.platform)
    if (arr) arr.push(c)
    else byPlatform.set(c.platform, [c])
  }
  const total = industry.length
  for (const [, arr] of byPlatform) {
    arr.sort((a, b) => b.comments - a.comments)
    const quota = total ? Math.round((arr.length / total) * remaining) : 0
    taken.push(...arr.slice(0, quota))
  }
  return taken.slice(0, limit)
}

async function loadCandidates(admin: ReturnType<typeof createAdminClient>, o: Opts): Promise<Candidate[]> {
  interface VRow {
    id: string
    run_id: string | null
    platform: string
    video_id: string
    video_url: string
    is_client: boolean
    is_competitor: boolean
    transcript_status: string | null
  }
  const videos = await selectAll<VRow>(() => {
    let q = admin
      .from('videos')
      .select('id, run_id, platform, video_id, video_url, is_client, is_competitor, transcript_status')
      .eq('client_id', o.clientId)
      .order('id', { ascending: true })
    if (o.platform) q = q.eq('platform', o.platform)
    return q
  })

  // Comment counts come from what we actually STORED, not videos.comments_count
  // (the platform-reported number) — Pass A's >=5 threshold is on stored rows,
  // and a candidate Pass A would skip is useless as a test bed.
  const counts = new Map<string, number>()
  const comments = await selectAll<{ platform: string; video_id: string }>(() =>
    admin
      .from('comments')
      .select('platform, video_id')
      .eq('client_id', o.clientId)
      .order('id', { ascending: true }),
  )
  for (const c of comments) {
    const k = `${c.platform}::${c.video_id}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }

  const out: Candidate[] = []
  for (const v of videos) {
    if (!PLATFORMS.includes(v.platform as Platform)) continue
    // 'ok'/'no_speech'/'lyrics'/'garbled' are settled answers about the audio;
    // 'failed'/'no_media' mean the FETCH broke, so those are the only ones worth
    // spending another refetch on.
    const retryable = v.transcript_status === 'failed' || v.transcript_status === 'no_media'
    if (o.retryFailed ? !retryable : !o.force && v.transcript_status) continue
    const n = counts.get(`${v.platform}::${v.video_id}`) ?? 0
    if (n < o.minComments) continue
    out.push({
      id: v.id,
      run_id: v.run_id,
      platform: v.platform as Platform,
      video_id: v.video_id,
      video_url: v.video_url,
      bucket: v.is_client ? 'client' : v.is_competitor ? 'competitor' : 'industry',
      comments: n,
    })
  }
  return out
}

/**
 * Re-judge transcripts we already hold. The text is durable even though the
 * media urls that produced it are long dead, so improving the content gate never
 * needs another paid fetch — the same reasoning as scripts/regate-corpus.ts for
 * the relevance gate. Only rows the gate could plausibly move are touched.
 */
async function regate(admin: ReturnType<typeof createAdminClient>, o: Opts): Promise<void> {
  const { data, error } = await admin
    .from('videos')
    .select('id, account_name, transcript, transcript_status')
    .eq('client_id', o.clientId)
    .in('transcript_status', ['ok', 'lyrics', 'garbled'])
    .not('transcript', 'is', null)
  if (error) throw new Error(`load transcripts: ${error.message}`)
  const rows = (data ?? []) as { id: string; account_name: string; transcript: string; transcript_status: string }[]
  console.log(`re-gating ${rows.length} stored transcripts (no refetch, no Whisper)`)

  const moves = new Map<string, number>()
  for (const r of rows) {
    const { verdict } = await classifyTranscript(r.transcript)
    const status = verdict === 'speech' ? 'ok' : verdict
    if (status === r.transcript_status) continue
    moves.set(`${r.transcript_status}→${status}`, (moves.get(`${r.transcript_status}→${status}`) ?? 0) + 1)
    console.log(`  ${r.transcript_status} → ${status.padEnd(8)} ${r.account_name}`)
    if (!o.dryRun) await admin.from('videos').update({ transcript_status: status }).eq('id', r.id)
  }
  console.log(`\nchanged: ${[...moves.entries()].map(([k, n]) => `${k}=${n}`).join(' · ') || 'none'}`)
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  const admin = createAdminClient()

  if (o.regate) {
    await regate(admin, o)
    return
  }

  const pool = await loadCandidates(admin, o)
  const sample = pickSample(pool, o.limit)

  const tally = (rows: Candidate[]) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(`${r.platform}/${r.bucket}`, (m.get(`${r.platform}/${r.bucket}`) ?? 0) + 1)
    return [...m.entries()].sort().map(([k, n]) => `${k}=${n}`).join(' · ')
  }
  console.log(`client=${o.clientId} platform=${o.platform ?? 'both'} min-comments=${o.minComments}`)
  console.log(`pool:   ${pool.length} — ${tally(pool)}`)
  console.log(`sample: ${sample.length} — ${tally(sample)}`)
  if (o.dryRun) {
    console.log('\n--- dry run, nothing fetched ---')
    for (const c of sample.slice(0, 10)) console.log(`  ${c.platform} ${c.bucket} ${c.comments}c ${c.video_url}`)
    if (sample.length > 10) console.log(`  … +${sample.length - 10} more`)
    return
  }

  const stats = { ok: 0, no_speech: 0, lyrics: 0, garbled: 0, no_media: 0, failed: 0, missing: 0 }
  const langs = new Map<string, number>()
  const bySource = new Map<string, number>()

  for (const platform of PLATFORMS) {
    const rows = sample.filter((c) => c.platform === platform)
    if (!rows.length) continue
    const adapter = adapters[platform]
    if (!adapter?.refetchByUrl || !adapter.extractMedia) {
      console.log(`[${platform}] no refetch/extract route — skipped`)
      continue
    }

    for (let i = 0; i < rows.length; i += o.batch) {
      const batch = rows.slice(i, i + o.batch)
      const { actor, input } = adapter.refetchByUrl(batch.map((c) => c.video_url))
      console.log(`\n[${platform}] batch ${Math.floor(i / o.batch) + 1} — refetching ${batch.length}`)

      let items: RawItem[] = []
      try {
        items = await runActor(actor, input)
      } catch (e) {
        console.warn(`[${platform}] refetch failed: ${(e as Error).message}`)
      }

      const byId = new Map<string, RawItem>()
      for (const it of items) {
        const id = idFromUrl(platform, rawUrl(it))
        if (id) byId.set(id, it)
      }

      // Transcribe inside the batch loop: the media urls the actor just handed
      // back are signed and short-lived, so they must be used before the next
      // batch is fetched.
      for (const c of batch) {
        const raw = byId.get(c.video_id)
        if (!raw) {
          stats.missing++
          console.log(`  ✗ ${c.video_id} — not returned (deleted/private?)`)
          await admin.from('videos').update({ transcript_status: 'failed' }).eq('id', c.id)
          continue
        }

        const t = await resolveTranscript(adapter.extractMedia(raw))
        stats[t.status]++
        if (t.status === 'ok') {
          langs.set(t.lang ?? 'unknown', (langs.get(t.lang ?? 'unknown') ?? 0) + 1)
          bySource.set(t.source ?? 'unknown', (bySource.get(t.source ?? 'unknown') ?? 0) + 1)
        }

        const { error } = await admin
          .from('videos')
          .update({
            transcript: t.text || null,
            transcript_lang: t.lang,
            transcript_source: t.source,
            transcript_status: t.status,
          })
          .eq('id', c.id)
        if (error) console.warn(`  ! ${c.video_id} update: ${error.message}`)

        // Keep the raw item so a re-derivation doesn't need another paid fetch.
        // run_id is NOT NULL on video_raw; a video with no run can't be filed.
        if (c.run_id) {
          await admin.from('video_raw').upsert(
            { client_id: o.clientId, run_id: c.run_id, platform, video_id: c.video_id, raw },
            { onConflict: 'client_id,platform,video_id,run_id' },
          )
        }

        const mark = t.status === 'ok' ? '✓' : '·'
        console.log(`  ${mark} ${c.bucket.padEnd(10)} ${c.video_id} — ${t.status} ${t.source ?? ''} (${t.text.length} chars)`)
      }
    }
  }

  console.log('\n=== SUMMARY ===')
  console.log(`ok:        ${stats.ok}`)
  console.log(`no_speech: ${stats.no_speech}   (silent/music-only — the letter gate)`)
  console.log(`lyrics:    ${stats.lyrics}   (song, not narration — the content gate)`)
  console.log(`garbled:   ${stats.garbled}   (noise/watermarks — the content gate)`)
  console.log(`no_media:  ${stats.no_media}`)
  console.log(`failed:    ${stats.failed}`)
  console.log(`missing:   ${stats.missing}   (actor returned nothing for the url)`)
  console.log(`sources:   ${[...bySource.entries()].map(([k, n]) => `${k}=${n}`).join(' · ') || '—'}`)
  console.log(`languages: ${[...langs.entries()].map(([k, n]) => `${k}=${n}`).join(' · ') || '—'}`)
}

main().catch((e) => {
  console.error('backfill failed:', e)
  process.exit(1)
})
