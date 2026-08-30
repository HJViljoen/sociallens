import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { runPipeline } from '@/inngest/functions/pipeline'
import { scheduledPipelineDispatcher } from '@/inngest/functions/scheduler'
import { sendWeeklyReport } from '@/inngest/functions/report'
import { ownedSnapshotsDaily } from '@/inngest/functions/owned-snapshots'
import { retentionDaily } from '@/inngest/functions/retention'
import { keepWarm } from '@/inngest/functions/keep-warm'
import { buildDocument } from '@/inngest/functions/build-document'

// Inngest endpoint. Inngest Cloud calls this route (GET to sync, PUT to
// register, POST to invoke) using its own signing-key auth — it carries no
// Supabase session, so `proxy.ts` excludes this path from the auth redirect.

// The pipeline runs gather + several GPT passes, but Inngest invokes this route
// once per step (each step returns quickly), so a single invocation never needs
// long. Capped at 300s for the Hobby plan; raise toward 800 on Pro if a single
// step ever needs it.
export const maxDuration = 300

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [runPipeline, scheduledPipelineDispatcher, sendWeeklyReport, ownedSnapshotsDaily, retentionDaily, keepWarm, buildDocument],
})
