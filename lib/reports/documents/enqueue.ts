import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest } from '../../../inngest/client'
import { failBuild, inFlightDecision, insertBuild, latestBuild } from './builds'

/**
 * Starting a document build (T9c, 2026-08-31): the one door, used by the
 * Studio's Build button and by a schedule that has come due. One build at a
 * time per report — a young unfinished build means busy (the caller decides
 * what to say), an old one is given up on and replaced.
 *
 * A schedule's build carries the schedule and its claimed send row, so the
 * function's deliver step knows where to send it when the printing is done.
 */

export type EnqueueResult =
  | { status: 'enqueued'; buildId: string }
  | { status: 'busy'; buildId: string }

export async function enqueueDocumentBuild(
  admin: SupabaseClient,
  args: { clientId: string; reportId: string; runId: string | null; requestedBy: string | null; scheduleId?: string | null; sendId?: string | null },
): Promise<EnqueueResult> {
  const last = await latestBuild(admin, args.reportId)
  const decision = inFlightDecision(last)
  if (decision === 'busy' && last) return { status: 'busy', buildId: last.id }
  if (decision === 'takeover' && last) await failBuild(admin, last.id, 'Took too long and was given up on.')

  let build
  try {
    build = await insertBuild(admin, args)
  } catch (e) {
    // Two clicks raced: the partial unique index kept one; hand back the other.
    if (e instanceof Error && /duplicate key|23505/.test(e.message)) {
      const racing = await latestBuild(admin, args.reportId)
      if (racing) return { status: 'busy', buildId: racing.id }
    }
    throw e
  }

  try {
    await inngest.send({
      name: 'report/build.requested',
      data: {
        buildId: build.id,
        clientId: args.clientId,
        reportId: args.reportId,
        ...(args.scheduleId ? { scheduleId: args.scheduleId } : {}),
        ...(args.sendId ? { sendId: args.sendId } : {}),
      },
    })
  } catch (e) {
    await failBuild(admin, build.id, 'Could not start the build.')
    throw e
  }
  return { status: 'enqueued', buildId: build.id }
}
