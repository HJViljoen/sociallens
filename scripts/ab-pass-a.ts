import { createAdminClient, selectAll } from '../lib/supabase-admin'
import { runPassA, type RunPassASummary } from '../lib/pipeline/pass-a'
import type { VideoRow } from '../lib/pipeline/types'

// A/B measurement harness for Pass A v4 (video transcripts Step 2 Phase 3).
// Runs Pass A twice over the SAME transcript-ok test-bed videos — arm A
// without transcripts (v3 behaviour), arm B with (v4) — into two fresh runs,
// then reports the comparison as JSON. The bed is deliberately stratified:
// report lift PER BUCKET, never pooled.
//
//   node --env-file=.env.local --import tsx scripts/ab-pass-a.ts [flags]
//
// Flags:
//   --client <uuid>   client_id (default: Sealand)
//   --limit <n>       cap bed size (default: all transcript-ok videos)
//   --smoke           2-video persistence smoke, arm B only (1 industry +
//                     1 client/competitor) — verifies source='video' evidence
//                     and video_claims writes end-to-end
//   --dry-run         assemble prompts only, no GPT calls, no writes
//
// Arm order matters: A first, then B, so the videos table's classification
// columns end up holding the v4 (transcript-grounded) values.
// Synthesis comparison happens separately via run-cd.ts --run <each arm>.

const SEALAND = 'ac16988e-c4f3-4baf-b388-73895852a554'

type Bucket = 'client' | 'competitor' | 'industry'
const bucketOf = (v: Pick<VideoRow, 'is_client' | 'is_competitor'>): Bucket =>
  v.is_client ? 'client' : v.is_competitor ? 'competitor' : 'industry'

interface Opts {
  clientId: string
  limit?: number
  smoke: boolean
  dryRun: boolean
}

function parseArgs(argv: string[]): Opts {
  const o: Opts = { clientId: SEALAND, smoke: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--client') o.clientId = next()
    else if (a === '--limit') o.limit = Number(next())
    else if (a === '--smoke') o.smoke = true
    else if (a === '--dry-run') o.dryRun = true
    else throw new Error(`unknown flag: ${a}`)
  }
  return o
}

interface Classification {
  classified_type: string | null
  hook_style: string | null
  hook_text: string | null
  topics: string[] | null
  sentiment: string | null
}

async function classificationSnapshot(admin: ReturnType<typeof createAdminClient>, ids: string[]): Promise<Map<string, Classification>> {
  const map = new Map<string, Classification>()
  for (let i = 0; i < ids.length; i += 120) {
    const { data, error } = await admin
      .from('videos')
      .select('id, classified_type, hook_style, hook_text, topics, sentiment')
      .in('id', ids.slice(i, i + 120))
    if (error) throw new Error(`snapshot: ${error.message}`)
    for (const r of data ?? []) map.set(r.id as string, r as unknown as Classification)
  }
  return map
}

/** Per-arm DB tallies, bucketed via the source video (never pooled). */
async function armTallies(admin: ReturnType<typeof createAdminClient>, clientId: string, runId: string, byVideo: Map<string, Bucket>) {
  const insights = await selectAll<{ id: string; source_video_id: string }>(() =>
    admin.from('audience_insights').select('id, source_video_id').eq('client_id', clientId).eq('run_id', runId).order('id', { ascending: true }),
  )
  const insightBucket = new Map<string, Bucket>()
  const insightsPerBucket: Record<Bucket, number> = { client: 0, competitor: 0, industry: 0 }
  for (const i of insights) {
    const b = byVideo.get(i.source_video_id) ?? 'industry'
    insightBucket.set(i.id, b)
    insightsPerBucket[b]++
  }
  const evidence = await selectAll<{ audience_insight_id: string; source: string | null }>(() =>
    admin.from('insight_evidence').select('audience_insight_id, source').in('audience_insight_id', insights.length ? insights.map((i) => i.id) : ['00000000-0000-0000-0000-000000000000']).order('audience_insight_id', { ascending: true }),
  )
  const evidenceTotals = { comment: 0, video: 0 }
  const videoEvidencePerBucket: Record<Bucket, number> = { client: 0, competitor: 0, industry: 0 }
  for (const e of evidence) {
    const src = e.source === 'video' ? 'video' : 'comment'
    evidenceTotals[src]++
    if (src === 'video') videoEvidencePerBucket[insightBucket.get(e.audience_insight_id) ?? 'industry']++
  }
  return { insightsPerBucket, evidenceTotals, videoEvidencePerBucket }
}

function summarySlice(s: RunPassASummary) {
  return {
    runId: s.runId,
    videosProcessed: s.videosProcessed,
    videosAnalyzed: s.videosAnalyzed,
    videosSkipped: s.videosSkipped,
    insightsKept: s.insightsKept,
    insightsDropped: s.insightsDropped,
    evidenceDropped: s.evidenceDropped,
    claimsKept: s.claimsKept,
    claimsDropped: s.claimsDropped,
    promptTokens: s.promptTokens,
    completionTokens: s.completionTokens,
    costUsd: Number(s.costUsd.toFixed(4)),
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const admin = createAdminClient()

  // The bed: every transcript-ok video for the client (Pass A itself skips
  // <5-kept-comment videos — identically in both arms).
  let bed = await selectAll<VideoRow>(() =>
    admin.from('videos').select('*').eq('client_id', opts.clientId).eq('transcript_status', 'ok').order('comments_count', { ascending: false, nullsFirst: false }).order('id', { ascending: true }),
  )
  if (opts.limit) bed = bed.slice(0, opts.limit)
  const byVideo = new Map(bed.map((v) => [v.id, bucketOf(v)]))
  const perBucket: Record<Bucket, number> = { client: 0, competitor: 0, industry: 0 }
  for (const b of byVideo.values()) perBucket[b]++
  console.error(`bed: ${bed.length} transcript-ok videos (client ${perBucket.client} · competitor ${perBucket.competitor} · industry ${perBucket.industry})`)

  if (opts.smoke) {
    const industry = bed.find((v) => bucketOf(v) === 'industry')
    const brand = bed.find((v) => bucketOf(v) !== 'industry')
    if (!industry || !brand) throw new Error('smoke needs one industry and one client/competitor transcript-ok video')
    const ids = [industry.id, brand.id]
    console.error(`smoke (arm B only): industry=${industry.video_url} brand=${brand.video_url}`)
    const s = await runPassA({ clientId: opts.clientId, videoIds: ids, transcripts: true, dryRun: opts.dryRun })
    const tallies = opts.dryRun ? null : await armTallies(admin, opts.clientId, s.runId, byVideo)
    const claims = opts.dryRun
      ? []
      : (await admin.from('video_claims').select('entity, competitor_name, claim, quote').eq('run_id', s.runId)).data ?? []
    console.log(JSON.stringify({ mode: 'smoke', summary: summarySlice(s), tallies, claims, perVideo: s.perVideo }, null, 2))
    return
  }

  const ids = bed.map((v) => v.id)

  // Arm A — no transcripts (v3 behaviour).
  console.error('arm A (no transcripts)…')
  const armA = await runPassA({ clientId: opts.clientId, videoIds: ids, transcripts: false, dryRun: opts.dryRun })
  const snapA = opts.dryRun ? new Map<string, Classification>() : await classificationSnapshot(admin, ids)

  // Arm B — transcripts on (v4).
  console.error('arm B (transcripts)…')
  const armB = await runPassA({ clientId: opts.clientId, videoIds: ids, transcripts: true, dryRun: opts.dryRun })
  const snapB = opts.dryRun ? new Map<string, Classification>() : await classificationSnapshot(admin, ids)

  if (opts.dryRun) {
    console.log(JSON.stringify({ mode: 'dry-run', armA: summarySlice(armA), armB: summarySlice(armB) }, null, 2))
    return
  }

  // Classification deltas (all buckets — classification reads the transcript
  // on every video in arm B). Only videos actually analyzed in BOTH arms count
  // toward the denominators; topics compare order-insensitively (review findings).
  const analyzedBoth = new Set(
    armA.perVideo.filter((r) => r.status === 'analyzed').map((r) => r.videoId).filter((id) => armB.perVideo.some((r) => r.videoId === id && r.status === 'analyzed')),
  )
  const topicsKey = (t: string[] | null) => [...(t ?? [])].sort().join('|')
  const classificationChanges: Record<Bucket, { videos: number; changed: number; hookTextChanged: number; typeChanged: number; topicsChanged: number }> = {
    client: { videos: 0, changed: 0, hookTextChanged: 0, typeChanged: 0, topicsChanged: 0 },
    competitor: { videos: 0, changed: 0, hookTextChanged: 0, typeChanged: 0, topicsChanged: 0 },
    industry: { videos: 0, changed: 0, hookTextChanged: 0, typeChanged: 0, topicsChanged: 0 },
  }
  for (const v of bed) {
    if (!analyzedBoth.has(v.id)) continue
    const b = bucketOf(v)
    const a = snapA.get(v.id)
    const bb = snapB.get(v.id)
    if (!a || !bb) continue
    classificationChanges[b].videos++
    const typeChanged = a.classified_type !== bb.classified_type
    const hookChanged = (a.hook_text ?? '') !== (bb.hook_text ?? '')
    const topicsChanged = topicsKey(a.topics) !== topicsKey(bb.topics)
    if (typeChanged) classificationChanges[b].typeChanged++
    if (hookChanged) classificationChanges[b].hookTextChanged++
    if (topicsChanged) classificationChanges[b].topicsChanged++
    if (typeChanged || hookChanged || topicsChanged || a.hook_style !== bb.hook_style || a.sentiment !== bb.sentiment) classificationChanges[b].changed++
  }

  const talliesA = await armTallies(admin, opts.clientId, armA.runId, byVideo)
  const talliesB = await armTallies(admin, opts.clientId, armB.runId, byVideo)
  const claimsB = (await admin.from('video_claims').select('entity, competitor_name, claim, quote, source_video_id').eq('run_id', armB.runId)).data ?? []

  // Junk-leak check (query, not trust): video-sourced evidence must trace to a
  // transcript that passed BOTH gates — count of rows whose source video is not
  // status 'ok' must be zero across both arms. selectAll: rows accumulate
  // across harness invocations and a bare select caps at 1000 (review finding).
  const leak = await selectAll<{ id: string; source_video_id: string; videos: unknown }>(() =>
    admin
      .from('insight_evidence')
      .select('id, source_video_id, videos!insight_evidence_source_video_id_fkey(transcript_status)')
      .eq('source', 'video')
      .not('source_video_id', 'is', null)
      .order('id', { ascending: true }),
  )
  // supabase-js types the many-to-one embed as an array without schema info —
  // normalise both shapes before reading the status.
  const junkLeaks = leak.filter((r) => {
    const rel = r.videos as { transcript_status: string | null } | { transcript_status: string | null }[] | null
    const status = Array.isArray(rel) ? rel[0]?.transcript_status : rel?.transcript_status
    return status !== 'ok'
  })

  // The named check: the Telugu ₹350-bag video (July's CORRECTION case).
  const telugu = bed.filter((v) => v.transcript_lang === 'te').map((v) => ({
    id: v.id,
    url: v.video_url,
    bucket: bucketOf(v),
    armA: snapA.get(v.id) ?? null,
    armB: snapB.get(v.id) ?? null,
  }))

  console.log(
    JSON.stringify(
      {
        mode: 'ab',
        bed: { total: bed.length, perBucket },
        armA: summarySlice(armA),
        armB: summarySlice(armB),
        classificationChanges,
        talliesA,
        talliesB,
        claimsB,
        junkLeakCount: junkLeaks.length,
        junkLeaks: junkLeaks.slice(0, 10),
        telugu,
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
