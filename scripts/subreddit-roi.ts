import { createAdminClient, selectAll } from '../lib/supabase-admin'
import { APIFY_COST_ESTIMATES, passAMinComments } from '../lib/config'
import { computeSubredditRoi, dropCandidates, type RoiVideo, type RoiInsight } from '../lib/pipeline/subreddit-roi'
import { subredditLabel } from '../lib/gather/subreddits'

// Operator read of per-subreddit ROI — the Reddit counterpart to keyword-roi.ts.
// Computed post-hoc from stored videos + insights (see lib/pipeline/subreddit-roi.ts
// for why this needs no table of its own). Prints worst-yield-first with an
// estimated Apify spend and a DROP-CANDIDATE marker.
//
// REPORTS ONLY — it never prunes. Dropping a data source on one run's numbers is
// the confounder trap: a quiet week and a dead community look identical here.
//
//   node --env-file=.env.local --import tsx scripts/subreddit-roi.ts --client <uuid>

function parseArgs(argv: string[]): { clientId: string | null } {
  const args = { clientId: null as string | null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--client') args.clientId = argv[++i]
    else throw new Error(`unknown flag: ${argv[i]}`)
  }
  return args
}

async function main() {
  const { clientId } = parseArgs(process.argv.slice(2))
  if (!clientId) throw new Error('--client <uuid> is required')
  const admin = createAdminClient()

  const videoRows = await selectAll<{ id: string; platform: string; account_name: string | null; video_id: string }>(() =>
    admin.from('videos').select('id, platform, account_name, video_id')
      .eq('client_id', clientId).eq('platform', 'reddit').order('id', { ascending: true }),
  )
  if (!videoRows.length) {
    console.log('No Reddit videos stored for this client yet.')
    return
  }

  // Comment counts by (platform, video_id) — the same join analysis uses.
  const commentRows = await selectAll<{ video_id: string }>(() =>
    admin.from('comments').select('video_id')
      .eq('client_id', clientId).eq('platform', 'reddit').order('id', { ascending: true }),
  )
  const counts = new Map<string, number>()
  for (const c of commentRows) counts.set(c.video_id, (counts.get(c.video_id) ?? 0) + 1)

  const videos: RoiVideo[] = videoRows.map((v) => ({
    id: v.id,
    platform: v.platform,
    account_name: v.account_name,
    comments: counts.get(v.video_id) ?? 0,
  }))

  const insights = await selectAll<RoiInsight>(() =>
    admin.from('audience_insights').select('source_video_id')
      .eq('client_id', clientId).order('id', { ascending: true }),
  )

  const rows = computeSubredditRoi(videos, insights, passAMinComments('reddit'))
  const drops = new Set(dropCandidates(rows).map((r) => r.subreddit))
  const cost = APIFY_COST_ESTIMATES.reddit ?? { search: 0, perVideoComments: 0 }

  console.log(`\nReddit ROI — ${rows.length} communities, ${videos.length} posts stored\n`)
  console.log('  subreddit               posts  elig  comments  insights  yield   $est');
  console.log('  ' + '-'.repeat(74))
  for (const r of rows) {
    // Coarse: every stored post implies its share of a search, every eligible
    // post implies a comment scrape. Ranking only — never an invoice.
    const est = r.posts * cost.search / 50 + r.eligible * cost.perVideoComments
    console.log(
      '  ' +
        subredditLabel(r.subreddit).padEnd(22) +
        String(r.posts).padStart(6) +
        String(r.eligible).padStart(6) +
        String(r.comments).padStart(10) +
        String(r.insights).padStart(10) +
        r.yield.toFixed(2).padStart(7) +
        ('$' + est.toFixed(2)).padStart(7) +
        (drops.has(r.subreddit) ? '  DROP-CANDIDATE' : ''),
    )
  }
  if (drops.size) {
    console.log(`\n  ${drops.size} DROP-CANDIDATE(s): enough posts to judge, zero insights.`)
    console.log('  Confirm against a second run before acting — a quiet week looks identical here.')
  }
  console.log()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
