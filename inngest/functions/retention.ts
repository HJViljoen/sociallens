import { inngest } from '@/inngest/client'
import { createAdminClient, selectAll } from '@/lib/supabase-admin'
import {
  retentionEnabled,
  RAW_PAYLOAD_RETENTION_DAYS,
  AI_LOG_BODY_RETENTION_DAYS,
  YOUTUBE_RETENTION_DAYS,
  YOUTUBE_REFRESH_NIGHTLY_CAP,
  YOUTUBE_VIDEO_REFRESH_NIGHTLY_CAP,
} from '@/lib/config'
import { refreshYoutubeComments, refreshYoutubeVideos } from '@/lib/retention/youtube-refresh-io'

// Data retention (Tier 0 T0-9, 2026-08-18; YouTube refresh Tier 1.5,
// 2026-08-22). Until Tier 0 nothing in the product ever deleted source data:
// `video_raw` held whole actor payloads (Instagram owner names, tagged users
// with profile pictures, location names, TikTok POI latitude/longitude) that
// only the transcribe step reads and nothing prunes; `ai_call_log.request` held
// every prompt, comment text included, forever; and YouTube rows older than 30
// days were never refreshed or purged, which the YouTube API Services Developer
// Policy (III.E.4.d) does not allow.
//
// The privacy notice states these windows, so this cron is what makes the
// statement true. Runs 04:00 SAST, before the owned-snapshot and pipeline crons.
//
// Steps (ids are a stability contract — see AGENTS.md):
//   1. purge-video-raw            — raw payloads past 30 days: deleted.
//   2. strip-ai-call-bodies       — prompt/response bodies past 30 days: nulled.
//   3. refresh-youtube-comments   — comments 25+ days since last read: re-fetched
//                                   from the API (III.E.4.d "delete OR refresh").
//                                   Deleted/hidden on YouTube → deleted here,
//                                   evidence cascades, hero_quote copies nulled.
//                                   Edited → updated, non-verifying quotes dropped.
//   4. refresh-youtube-videos     — video statistics likewise; a video the API
//                                   no longer returns is tombstoned (never
//                                   deleted: videos(id) cascades into the whole
//                                   analysis) and its comments deleted.
//   5. purge-stale-youtube-comments — the BACKSTOP: anything still unrefreshed
//                                   at 30 days (five failed nights) takes the
//                                   Tier 0 path — uncited deleted, cited lose
//                                   `author`. It should delete nothing on a
//                                   healthy night; if it does, refresh is failing.
//
// Deliberately conservative: nothing analytical is deleted on any platform
// except YouTube rows YouTube itself no longer serves. Comment text and
// insights live for the life of the workspace, which is what the notice says.
// Preview: `node --env-file=.env.local --import tsx scripts/retention-dry.ts`.
export const retentionDaily = inngest.createFunction(
  {
    id: 'retention-daily',
    retries: 2,
    triggers: [{ cron: 'TZ=Africa/Johannesburg 0 4 * * *' }],
  },
  async ({ step }) => {
    // Dormant until switched on. The privacy notice states these windows, so
    // this must be enabled deliberately and soon after deploy — not left off
    // and forgotten. scripts/retention-dry.ts reports what a sweep would do.
    if (!retentionEnabled()) {
      console.log('[retention] RETENTION_ENABLED is not set; skipping sweep')
      return { skipped: 'disabled', rawDeleted: 0, bodiesStripped: 0, deleted: 0, pseudonymised: 0 }
    }
    const cutoff = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

    // 1. Raw actor payloads. The durable artifact is videos.transcript; the
    //    media and subtitle URLs inside `raw` are signed and expire anyway.
    const rawDeleted = await step.run('purge-video-raw', async () => {
      const admin = createAdminClient()
      const { data, error } = await admin
        .from('video_raw')
        .delete()
        .lt('captured_at', cutoff(RAW_PAYLOAD_RETENTION_DAYS))
        .select('id')
      if (error) throw new Error(`purge video_raw: ${error.message}`)
      return (data ?? []).length
    })

    // 2. Prompt and response bodies. The row survives with its cost, tokens,
    //    timing and validation status, which is everything the audit trail is
    //    for; the comment text inside the prompt does not need to.
    const bodiesStripped = await step.run('strip-ai-call-bodies', async () => {
      const admin = createAdminClient()
      const { data, error } = await admin
        .from('ai_call_log')
        .update({ request: null, response: null })
        .lt('created_at', cutoff(AI_LOG_BODY_RETENTION_DAYS))
        // Either body still present: filtering on `request` alone left rows
        // whose request was already null but whose response was not.
        .or('request.not.is.null,response.not.is.null')
        .select('id')
      if (error) throw new Error(`strip ai_call_log bodies: ${error.message}`)
      return (data ?? []).length
    })

    // 3. YouTube comments: refresh, don't delete. Costs 1 quota unit per 50
    //    ids (~115 units a month for the whole corpus as of 2026-08-18).
    //    A refresh step that is out of retries (quota, key, network) is caught
    //    so the BACKSTOP below still runs — it exists for exactly the night the
    //    API fails — and the run is then failed at the end so it stays visible.
    const refreshErrors: string[] = []
    const emptyComments = { due: 0, distinctIds: 0, refreshed: 0, textChanged: 0, evidenceDropped: 0, samplesDropped: 0, missing: 0, deleted: 0, insightsAffected: 0, heroQuotesNulled: 0, missingExamples: [] as string[] }
    const ytComments = await step
      .run('refresh-youtube-comments', async () => {
        const admin = createAdminClient()
        return refreshYoutubeComments(admin, { cap: YOUTUBE_REFRESH_NIGHTLY_CAP })
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e)
        console.error(`[retention] refresh-youtube-comments failed: ${message}`)
        refreshErrors.push(`comments: ${message.slice(0, 200)}`)
        return emptyComments
      })

    // 4. YouTube video statistics: same rule (III.E.4.b/d), same cadence.
    const emptyVideos = { due: 0, refreshed: 0, missing: 0, tombstoned: 0, commentsDeleted: 0, insightsAffected: 0, heroQuotesNulled: 0 }
    const ytVideos = await step
      .run('refresh-youtube-videos', async () => {
        const admin = createAdminClient()
        return refreshYoutubeVideos(admin, { cap: YOUTUBE_VIDEO_REFRESH_NIGHTLY_CAP })
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e)
        console.error(`[retention] refresh-youtube-videos failed: ${message}`)
        refreshErrors.push(`videos: ${message.slice(0, 200)}`)
        return emptyVideos
      })

    // 5. Backstop — the Tier 0 path, now scoped to rows the refresh has failed
    //    to reach for 30 days. A cited comment CANNOT simply be deleted:
    //    insight_evidence and language_samples both cascade from comments, and
    //    insight_evidence_source_shape requires a 'comment' evidence row to keep
    //    a non-null comment_id, so the row cannot even be orphaned. Uncited
    //    rows are deleted; cited ones lose the identifying field and keep the
    //    text that is already quoted verbatim inside the evidence row.
    const ytPurged = await step.run('purge-stale-youtube-comments', async () => {
      const admin = createAdminClient()
      const before = cutoff(YOUTUBE_RETENTION_DAYS)

      const stale = await selectAll<{ id: string }>(() =>
        admin.from('comments').select('id')
          .eq('platform', 'youtube')
          .or(`and(refreshed_at.is.null,created_at.lt.${before}),refreshed_at.lt.${before}`)
          .order('id', { ascending: true }),
      )
      if (!stale.length) return { deleted: 0, pseudonymised: 0 }
      console.warn(`[retention] BACKSTOP firing on ${stale.length} unrefreshed YouTube rows — the refresh step has not reached them in ${YOUTUBE_RETENTION_DAYS} days`)

      const staleIds = stale.map((c) => c.id)
      const cited = new Set<string>()
      // Chunked: ~500 uuids in an `in.()` filter overflows the PostgREST URL cap.
      for (let i = 0; i < staleIds.length; i += 200) {
        const chunk = staleIds.slice(i, i + 200)
        const [ev, ls] = await Promise.all([
          admin.from('insight_evidence').select('comment_id').in('comment_id', chunk),
          admin.from('language_samples').select('comment_id').in('comment_id', chunk),
        ])
        for (const r of (ev.data ?? []) as { comment_id: string | null }[]) if (r.comment_id) cited.add(r.comment_id)
        for (const r of (ls.data ?? []) as { comment_id: string | null }[]) if (r.comment_id) cited.add(r.comment_id)
      }

      const deletable = staleIds.filter((id) => !cited.has(id))
      let deleted = 0
      for (let i = 0; i < deletable.length; i += 200) {
        const chunk = deletable.slice(i, i + 200)
        const { error } = await admin.from('comments').delete().in('id', chunk)
        if (error) throw new Error(`purge youtube comments: ${error.message}`)
        deleted += chunk.length
      }

      // Cited rows: drop the identity, keep the sentence.
      const citedIds = [...cited]
      let pseudonymised = 0
      for (let i = 0; i < citedIds.length; i += 200) {
        const chunk = citedIds.slice(i, i + 200)
        const { error } = await admin.from('comments')
          .update({ author: null })
          .in('id', chunk)
          .not('author', 'is', null)
        if (error) throw new Error(`pseudonymise youtube comments: ${error.message}`)
        pseudonymised += chunk.length
      }
      return { deleted, pseudonymised }
    })

    const summary = { rawDeleted, bodiesStripped, ytComments, ytVideos, ...ytPurged }
    console.log(`[retention] ${JSON.stringify(summary)}`)

    // One line a day is noise; a day that touches nothing at all after the
    // first sweep means the job has silently stopped working.
    if (rawDeleted === 0 && bodiesStripped === 0 && ytComments.due === 0 && ytVideos.due === 0 && ytPurged.deleted + ytPurged.pseudonymised === 0) {
      console.log('[retention] nothing due today')
    }
    // Every step ran; now surface a refresh failure as a failed run (retries
    // replay memoised steps, so nothing is redone — it just stays red).
    if (refreshErrors.length) throw new Error(`retention: refresh failed — ${refreshErrors.join(' | ')}`)
    return summary
  },
)
