import { createAdminClient } from '../lib/supabase-admin'
import { RAW_PAYLOAD_RETENTION_DAYS, AI_LOG_BODY_RETENTION_DAYS, YOUTUBE_RETENTION_DAYS, YOUTUBE_REFRESH_NIGHTLY_CAP, YOUTUBE_VIDEO_REFRESH_NIGHTLY_CAP } from '../lib/config'
import { refreshYoutubeComments, refreshYoutubeVideos } from '../lib/retention/youtube-refresh-io'
import { refreshCutoffs } from '../lib/retention/youtube-refresh'

// What tonight's retention sweep (inngest/functions/retention.ts) would do —
// READ-ONLY. The job's own comments have promised `npm run retention:dry` since
// Tier 0 without the script existing; this is it. Nothing is written, ever.
//
//   node --env-file=.env.local --import tsx scripts/retention-dry.ts [--refresh-sample N]
//
// --refresh-sample N additionally calls the YouTube API for N due comment ids
// (1 quota unit per 50) and reports found / missing / text-changed, plus what
// the missing ones would take with them. Still read-only: the refresh runs with
// dryRun, so no upsert, no delete.

function parseArgs(argv: string[]): { sample: number } {
  const args = { sample: 0 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--refresh-sample') args.sample = Number(argv[++i])
    else throw new Error(`unknown flag: ${argv[i]}`)
  }
  if (!Number.isFinite(args.sample) || args.sample < 0) throw new Error('--refresh-sample must be a non-negative integer')
  return args
}

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function main() {
  const { sample } = parseArgs(process.argv.slice(2))
  const admin = createAdminClient()
  const now = new Date()
  const cutoff = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()
  const { due, backstop } = refreshCutoffs(now)

  console.log(`retention dry-run @ ${now.toISOString()} (nothing is written)\n`)

  const rawDue = await count(admin.from('video_raw').select('id', { count: 'exact', head: true }).lt('captured_at', cutoff(RAW_PAYLOAD_RETENTION_DAYS)))
  const bodiesDue = await count(admin.from('ai_call_log').select('id', { count: 'exact', head: true }).lt('created_at', cutoff(AI_LOG_BODY_RETENTION_DAYS)).or('request.not.is.null,response.not.is.null'))
  const ytDue = await count(admin.from('comments').select('id', { count: 'exact', head: true }).eq('platform', 'youtube').or(`and(refreshed_at.is.null,created_at.lt.${due}),refreshed_at.lt.${due}`))
  const ytVideosDue = await count(admin.from('videos').select('id', { count: 'exact', head: true }).eq('platform', 'youtube').is('unavailable_at', null).or(`and(refreshed_at.is.null,scraped_at.lt.${due}),refreshed_at.lt.${due}`))
  const ytBackstop = await count(admin.from('comments').select('id', { count: 'exact', head: true }).eq('platform', 'youtube').or(`and(refreshed_at.is.null,created_at.lt.${backstop}),refreshed_at.lt.${backstop}`))

  console.log(`1. purge-video-raw            ${rawDue} payload(s) past ${RAW_PAYLOAD_RETENTION_DAYS}d → deleted`)
  console.log(`2. strip-ai-call-bodies       ${bodiesDue} row(s) past ${AI_LOG_BODY_RETENTION_DAYS}d with a body → nulled`)
  console.log(`3. refresh-youtube-comments   ${ytDue} row(s) 25d+ since last read → re-fetched (cap ${YOUTUBE_REFRESH_NIGHTLY_CAP} ids/night)`)
  console.log(`4. refresh-youtube-videos     ${ytVideosDue} video(s) 25d+ since last read → stats re-fetched (cap ${YOUTUBE_VIDEO_REFRESH_NIGHTLY_CAP}/night)`)
  console.log(`5. purge-stale-youtube-comments (BACKSTOP) ${ytBackstop} row(s) unrefreshed at ${YOUTUBE_RETENTION_DAYS}d → uncited deleted, cited lose author`)
  if (ytBackstop > 0 && ytDue > 0) console.log('   (expected before the first refresh has run; should be 0 every night after)')

  if (sample > 0) {
    console.log(`\n--refresh-sample ${sample}: calling YouTube for ${sample} due comment ids (read-only) …`)
    const c = await refreshYoutubeComments(admin, { now, cap: YOUTUBE_REFRESH_NIGHTLY_CAP, dryRun: true, sample })
    console.log(`   due rows ${c.due} · sampled ids ${c.distinctIds} · found ${c.refreshed} row(s) · missing ${c.missing} row(s) · text changed ${c.textChanged}`)
    console.log(`   would drop: ${c.evidenceDropped} evidence row(s) (edited quotes), ${c.samplesDropped} language sample(s); would delete ${c.deleted} gone row(s) touching ${c.insightsAffected} insight(s), nulling ${c.heroQuotesNulled} hero quote(s)`)
    if (c.missingExamples.length) console.log(`   gone examples: ${c.missingExamples.join(', ')}`)
    const v = await refreshYoutubeVideos(admin, { now, cap: Math.min(sample, YOUTUBE_VIDEO_REFRESH_NIGHTLY_CAP), dryRun: true })
    console.log(`   videos: due ${v.due} · sampled ${Math.min(sample, v.due)} · found ${v.refreshed} · missing ${v.missing} (would tombstone ${v.tombstoned}, deleting ${v.commentsDeleted} of their comments)`)
    console.log(`   quota spent by this sample: ~${Math.ceil(c.distinctIds / 50) + Math.ceil(Math.min(sample, v.due) / 50)} unit(s)`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
