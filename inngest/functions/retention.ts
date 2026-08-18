import { inngest } from '@/inngest/client'
import { createAdminClient } from '@/lib/supabase-admin'
import {
  RAW_PAYLOAD_RETENTION_DAYS,
  AI_LOG_BODY_RETENTION_DAYS,
  YOUTUBE_RETENTION_DAYS,
} from '@/lib/config'

// Data retention (Tier 0 T0-9, 2026-08-18). Until now nothing in the product
// ever deleted source data: `video_raw` held whole actor payloads (Instagram
// owner names, tagged users with profile pictures, location names, TikTok POI
// latitude/longitude) that only the transcribe step reads and nothing prunes;
// `ai_call_log.request` held every prompt, comment text included, forever; and
// YouTube rows older than 30 days were never refreshed or purged, which the
// YouTube API Services Developer Policy (III.E.4.d) does not allow.
//
// The privacy notice now states these windows, so this cron is what makes the
// statement true. Runs 04:00 SAST, before the owned-snapshot and pipeline crons.
//
// Deliberately conservative: it deletes raw payloads and prompt bodies, never
// analysis. Comment text and insights live for the life of the workspace, which
// is what the notice says.
export const retentionDaily = inngest.createFunction(
  {
    id: 'retention-daily',
    retries: 2,
    triggers: [{ cron: 'TZ=Africa/Johannesburg 0 4 * * *' }],
  },
  async ({ step }) => {
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
        .not('request', 'is', null)
        .select('id')
      if (error) throw new Error(`strip ai_call_log bodies: ${error.message}`)
      return (data ?? []).length
    })

    // 3. YouTube rows past the refresh window. We do not re-fetch (the gather
    //    recheck already refreshes anything inside the window), so the policy
    //    answer is to drop the stored comments for those videos. The video row
    //    itself stays: it carries no personal data beyond the channel name,
    //    and the analysis built from it is already aggregated.
    const ytComments = await step.run('purge-stale-youtube-comments', async () => {
      const admin = createAdminClient()
      const { data, error } = await admin
        .from('comments')
        .delete()
        .eq('platform', 'youtube')
        .lt('created_at', cutoff(YOUTUBE_RETENTION_DAYS))
        .select('id')
      if (error) throw new Error(`purge youtube comments: ${error.message}`)
      return (data ?? []).length
    })

    const summary = { rawDeleted, bodiesStripped, ytComments }
    console.log(`[retention] ${JSON.stringify(summary)}`)

    // One line a day is noise; a day that deletes nothing at all after the
    // first sweep means the job has silently stopped working.
    if (rawDeleted === 0 && bodiesStripped === 0 && ytComments === 0) {
      console.log('[retention] nothing to delete today')
    }
    return summary
  },
)
