import { createAdminClient, selectAll } from '../lib/supabase-admin'
import { classifyRelevance } from '../lib/gather/relevance'
import type { GatherConfig } from '../lib/gather/types'

// Post-hoc relevance re-gate of a client's STORED corpus (teardown 2026-07-09
// §Run 1, defect 2): run 1 gathered with the pre-fix gate ("competitor content
// always relevant" + one giant truncating GPT call), so keyword homonyms
// polluted the stored corpus — Poler→pole dancing, Patagonia→the region/its
// marathons. This applies the FIXED gate (homonym rule, 60-video batches) to
// what's already in the DB and, with --apply, removes what the gate would never
// have let in: the video, its comments, its Pass A insights and their evidence.
// Aggregates (themes, market_insights, run_summary) are left alone — the
// analysis-only re-run regenerates them from the cleaned corpus.
//
// Dry-run by default: prints the would-drop list. The client's OWN videos
// (is_client) are reported but NEVER deleted — attribution already confirmed
// them as the company's; a gate drop there is a flag for human eyes, not a
// delete. Run with env loaded:
//   node --env-file=.env.local --import tsx scripts/regate-corpus.ts [--client <uuid>] [--apply]

const SEALAND = 'ac16988e-c4f3-4baf-b388-73895852a554'

function parseArgs(argv: string[]): { clientId: string; apply: boolean } {
  const args = { clientId: SEALAND as string, apply: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--client') args.clientId = argv[++i]
    else if (argv[i] === '--apply') args.apply = true
    else throw new Error(`unknown flag: ${argv[i]}`)
  }
  return args
}

interface StoredVideo {
  id: string
  platform: string
  video_id: string
  account_name: string
  caption: string | null
  hashtags: string[] | null
  is_client: boolean
  is_competitor: boolean
  competitor_name: string | null
  comments_count: number | null
}

const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

async function main() {
  const { clientId, apply } = parseArgs(process.argv.slice(2))
  const admin = createAdminClient()

  const { data: tc, error: tcErr } = await admin
    .from('tracking_configs').select('*').eq('client_id', clientId).maybeSingle()
  if (tcErr || !tc) throw new Error(`tracking_config: ${tcErr?.message ?? 'none'}`)
  const config: GatherConfig = {
    brand_keywords: tc.brand_keywords ?? [],
    competitor_keywords: tc.competitor_keywords ?? [],
    competitor_names: tc.competitor_names ?? [],
    industry_keywords: tc.industry_keywords ?? [],
    platforms: tc.platforms ?? ['tiktok', 'youtube', 'instagram'],
    max_videos: tc.max_videos ?? 25,
    comment_depth: tc.comment_depth ?? 50,
    report_period: tc.report_period ?? 'weekly',
    own_handles: tc.own_handles ?? {},
  }

  const videos = (await selectAll<StoredVideo>(() =>
    admin.from('videos')
      .select('id, platform, video_id, account_name, caption, hashtags, is_client, is_competitor, competitor_name, comments_count')
      .eq('client_id', clientId).order('id', { ascending: true }),
  ))
  console.log(`client ${clientId} · ${videos.length} stored videos · mode: ${apply ? 'APPLY' : 'dry-run'}\n`)

  const candidates = videos.map((v) => ({ video_id: v.video_id, account_name: v.account_name, caption: v.caption ?? '', hashtags: v.hashtags ?? [] }))
  const { verdicts, costUsd } = await classifyRelevance(candidates, { method: 'gpt', config })
  const dropped = videos.filter((v) => verdicts.get(v.video_id)?.relevant === false)
  const clientFlagged = dropped.filter((v) => v.is_client)
  const deletable = dropped.filter((v) => !v.is_client)

  const bucketOf = (v: StoredVideo) => (v.is_client ? 'client' : v.is_competitor ? `competitor:${v.competitor_name}` : 'industry-other')
  const byReason = new Map<string, StoredVideo[]>()
  for (const v of deletable) {
    const key = `${verdicts.get(v.video_id)?.reason}`
    byReason.set(key, [...(byReason.get(key) ?? []), v])
  }
  console.log(`gate verdict: DROP ${dropped.length}/${videos.length} (gpt cost $${costUsd.toFixed(3)})\n`)
  for (const [reason, vs] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`— ${vs.length}× ${reason}`)
    for (const v of vs.slice(0, 4)) console.log(`    [${v.platform}/${bucketOf(v)}] ${v.account_name}: ${(v.caption ?? '').replace(/\s+/g, ' ').slice(0, 80)}`)
    if (vs.length > 4) console.log(`    … +${vs.length - 4} more`)
  }
  if (clientFlagged.length) {
    console.log(`\n⚠ ${clientFlagged.length} is_client video(s) flagged by the gate — NOT deleted, review by hand:`)
    for (const v of clientFlagged) console.log(`    [${v.platform}] ${v.account_name}: ${verdicts.get(v.video_id)?.reason}`)
  }
  if (!deletable.length) {
    console.log('\nnothing to delete.')
    return
  }

  // Count the blast radius (insights + comments) before touching anything.
  const uuidChunks = chunk(deletable.map((v) => v.id), 120)
  let insightIds: string[] = []
  for (const ids of uuidChunks) {
    const rows = await selectAll<{ id: string }>(() =>
      admin.from('audience_insights').select('id').in('source_video_id', ids).order('id', { ascending: true }))
    insightIds = insightIds.concat(rows.map((r) => r.id))
  }
  let commentCount = 0
  const byPlatform = new Map<string, string[]>()
  for (const v of deletable) byPlatform.set(v.platform, [...(byPlatform.get(v.platform) ?? []), v.video_id])
  for (const [platform, vids] of byPlatform) {
    for (const ids of chunk(vids, 120)) {
      const { count } = await admin.from('comments')
        .select('id', { head: true, count: 'exact' })
        .eq('client_id', clientId).eq('platform', platform).in('video_id', ids)
      commentCount += count ?? 0
    }
  }
  console.log(`\nblast radius: ${deletable.length} videos · ${commentCount} comments · ${insightIds.length} insights (+ their evidence rows)`)

  if (!apply) {
    console.log('\ndry-run — nothing deleted. Re-run with --apply to remove the rows above.')
    return
  }

  // Delete in dependency order: evidence → insights → comments → videos.
  for (const ids of chunk(insightIds, 120)) {
    const { error } = await admin.from('insight_evidence').delete().in('audience_insight_id', ids)
    if (error) throw new Error(`delete insight_evidence: ${error.message}`)
  }
  for (const ids of chunk(insightIds, 120)) {
    const { error } = await admin.from('audience_insights').delete().in('id', ids)
    if (error) throw new Error(`delete audience_insights: ${error.message}`)
  }
  for (const [platform, vids] of byPlatform) {
    for (const ids of chunk(vids, 120)) {
      const { error } = await admin.from('comments').delete()
        .eq('client_id', clientId).eq('platform', platform).in('video_id', ids)
      if (error) throw new Error(`delete comments: ${error.message}`)
    }
  }
  for (const ids of uuidChunks) {
    const { error } = await admin.from('videos').delete().in('id', ids)
    if (error) throw new Error(`delete videos: ${error.message}`)
  }
  console.log('applied. Stale aggregates (themes/insights/run_summary) will be regenerated by the analysis-only re-run.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
