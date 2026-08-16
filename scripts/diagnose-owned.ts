import { createAdminClient } from '../lib/supabase-admin'
import { fetchOwnProfile, ownedCommentRefs, OWN_POSTS_LIMIT } from '../lib/gather/owned'
import { resolveGatherWindow, scrapeCommentsBatch } from '../lib/gather/gather'
import { COMMENT_THRESHOLD } from '../lib/config'
import type { Platform } from '../lib/gather/types'

/** Mirrors the pipeline's COMMENT_BATCH — one Apify actor run per video. */
const COMMENT_BATCH = 3

// Diagnostic for the owned-post ingestion (2026-08-16: the first scheduled run
// closed 'partial' and no owned rows ever landed for the real tenant). Replays
// the owned-posts step body OUTSIDE Inngest so the actual throw is visible.
// Read-only by default; --commit performs the real upsert.
//   node --env-file=.env.local --import tsx scripts/diagnose-owned.ts \
//     --client <uuid> --run <uuid> [--platform tiktok] [--commit]

function parseArgs(argv: string[]) {
  const args = { clientId: '', runId: '', platform: '', commit: false, comments: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--client') args.clientId = argv[++i]
    else if (argv[i] === '--run') args.runId = argv[++i]
    else if (argv[i] === '--platform') args.platform = argv[++i]
    else if (argv[i] === '--commit') args.commit = true
    else if (argv[i] === '--comments') args.comments = true
    else throw new Error(`unknown flag: ${argv[i]}`)
  }
  if (!args.clientId || !args.runId) throw new Error('--client and --run are required')
  if (args.comments && !args.commit) throw new Error('--comments requires --commit (it spends Apify money)')
  return args
}

async function main() {
  const { clientId, runId, platform: only, commit, comments } = parseArgs(process.argv.slice(2))
  const admin = createAdminClient()

  const { data: cfg } = await admin
    .from('tracking_configs')
    .select('own_handles, report_period')
    .eq('client_id', clientId)
    .maybeSingle()
  const handles = (cfg?.own_handles ?? {}) as Record<string, string>
  const period = (cfg?.report_period as string | null) ?? 'weekly'
  // Same window the pipeline's owned step would have used, so a backfill lands
  // exactly the refs the run should have scraped — not a wider all-time sweep.
  const window = await resolveGatherWindow(clientId, runId, period)
  console.log(`own_handles: ${JSON.stringify(handles)}  report_period: ${period}  windowStart: ${window.since}`)

  for (const [platform, handle] of Object.entries(handles)) {
    if (only && platform !== only) continue
    console.log(`\n=== ${platform} @${handle} ===`)
    if (!['tiktok', 'youtube', 'instagram'].includes(platform)) {
      console.log('  skipped (no owned-profile concept)')
      continue
    }

    let profile
    try {
      profile = await fetchOwnProfile(platform, handle, { clientId, runId })
    } catch (e) {
      console.log(`  FETCH THREW: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    console.log(`  followers=${profile.followers} postsCount=${profile.postsCount} recentPosts=${profile.recentPosts.length} (limit ${OWN_POSTS_LIMIT})`)
    if (!profile.recentPosts.length) {
      console.log('  NO RECENT POSTS PARSED — nothing would be written, no error raised')
      continue
    }
    console.log(`  sample row: ${JSON.stringify(profile.recentPosts[0])}`)

    const { data: existing, error: exErr } = await admin
      .from('videos')
      .select('video_id')
      .eq('client_id', clientId)
      .eq('platform', platform)
      .in('video_id', profile.recentPosts.map((p) => p.video_id))
    if (exErr) {
      console.log(`  EXISTING-CHECK ERROR: ${exErr.message}`)
      continue
    }
    const known = new Set((existing ?? []).map((r) => r.video_id as string))
    console.log(`  already known: ${known.size}/${profile.recentPosts.length} → ${profile.recentPosts.length - known.size} would be stamped source:'owned'`)

    const refs = ownedCommentRefs(profile.recentPosts, {
      windowStart: window.since,
      threshold: platform === 'youtube' ? 1 : COMMENT_THRESHOLD,
    })
    console.log(`  comment refs in window (threshold ${platform === 'youtube' ? 1 : COMMENT_THRESHOLD}): ${refs.length}`)

    if (!commit) {
      console.log('  (dry run — no write attempted)')
      continue
    }
    const rows = profile.recentPosts.map((p) =>
      known.has(p.video_id) ? p : { ...p, source: 'owned' as const },
    )
    const { error } = await admin.from('videos').upsert(rows, { onConflict: 'client_id,platform,video_id' })
    if (error) {
      console.log(`  UPSERT ERROR: ${error.code} ${error.message}`)
      console.log(`  details: ${error.details}  hint: ${error.hint}`)
      continue
    }
    console.log(`  upsert OK (${rows.length} rows)`)

    if (!comments || !refs.length) continue
    // COSTS APIFY MONEY: one actor run per video, same as the pipeline.
    let scraped = 0
    for (let w = 0; w < refs.length; w += COMMENT_BATCH) {
      const batch = refs.slice(w, w + COMMENT_BATCH)
      try {
        const r = await scrapeCommentsBatch({
          clientId, runId, platform: platform as Platform, refs: batch, source: 'owned',
        })
        scraped += r.comments
        if (r.errors.length) console.log(`  comment batch ${w / COMMENT_BATCH + 1} errors: ${r.errors.join('; ')}`)
      } catch (e) {
        console.log(`  comment batch ${w / COMMENT_BATCH + 1} THREW: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    console.log(`  owned comments scraped: ${scraped}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
