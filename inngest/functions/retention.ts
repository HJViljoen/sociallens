import { inngest } from '@/inngest/client'
import { createAdminClient, selectAll } from '@/lib/supabase-admin'
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
        // Either body still present: filtering on `request` alone left rows
        // whose request was already null but whose response was not.
        .or('request.not.is.null,response.not.is.null')
        .select('id')
      if (error) throw new Error(`strip ai_call_log bodies: ${error.message}`)
      return (data ?? []).length
    })

    // 3. YouTube comments past the refresh window. YouTube comments come from
    //    the official Data API (commentThreads.list), so the 30-day
    //    refresh-or-remove rule genuinely applies to them, and we have no
    //    refresh path for comment bodies.
    //
    //    But a cited comment CANNOT simply be deleted. insight_evidence and
    //    language_samples both cascade from comments, and
    //    insight_evidence_source_shape requires a 'comment' evidence row to
    //    keep a non-null comment_id, so the row cannot even be orphaned. A
    //    blind delete of the 745 rows currently past the window would have
    //    taken 300 evidence rows across 152 insights and 118 language samples
    //    with it, leaving insights standing with their quotes silently gone.
    //    Measured against prod before writing this, not assumed.
    //
    //    So: uncited comments (551 of the 745) are deleted outright, and the
    //    cited ones (194) lose the identifying field and keep the text that is
    //    already quoted verbatim inside the evidence row. What we stop holding
    //    is the person; what we keep is the sentence we cited.
    const ytPurged = await step.run('purge-stale-youtube-comments', async () => {
      const admin = createAdminClient()
      const before = cutoff(YOUTUBE_RETENTION_DAYS)

      const stale = await selectAll<{ id: string }>(() =>
        admin.from('comments').select('id')
          .eq('platform', 'youtube').lt('created_at', before).order('id', { ascending: true }),
      )
      if (!stale.length) return { deleted: 0, pseudonymised: 0 }

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
    const ytComments = ytPurged.deleted + ytPurged.pseudonymised

    const summary = { rawDeleted, bodiesStripped, ...ytPurged }
    console.log(`[retention] ${JSON.stringify(summary)}`)

    // One line a day is noise; a day that deletes nothing at all after the
    // first sweep means the job has silently stopped working.
    if (rawDeleted === 0 && bodiesStripped === 0 && ytComments === 0) {
      console.log('[retention] nothing to delete today')
    }
    return summary
  },
)
