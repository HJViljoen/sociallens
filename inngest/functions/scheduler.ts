import { inngest } from '@/inngest/client'
import { createAdminClient } from '@/lib/supabase-admin'
import { billingAccess, type BillingClient } from '@/lib/billing'
import { cadenceReliability } from '@/lib/pipeline/cadence'
import { sendAlertEmail } from '@/lib/email'

// Daily cron that decides which clients are due a run today and dispatches one
// `pipeline/run.requested` event each (runPipeline handles a single client).
//
// Schedule is read per client from tracking_configs: weekly runs fire on
// report_day; monthly runs fire on the 1st. Evaluated in Africa/Johannesburg so
// report_day matches the user's local week. Runs 06:00 SAST.

const WEEKDAYS = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
] as const

function localToday(tz = 'Africa/Johannesburg') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', day: 'numeric',
  }).formatToParts(new Date())
  const weekday = (parts.find((p) => p.type === 'weekday')?.value ?? '').toLowerCase()
  const dayOfMonth = Number(parts.find((p) => p.type === 'day')?.value ?? '0')
  return { weekday, dayOfMonth }
}

export const scheduledPipelineDispatcher = inngest.createFunction(
  {
    id: 'scheduled-pipeline-dispatcher',
    triggers: [{ cron: 'TZ=Africa/Johannesburg 0 6 * * *' }],
  },
  async ({ step }) => {
    const dueClientIds = await step.run('find-due-clients', async () => {
      const admin = createAdminClient()
      const { weekday, dayOfMonth } = localToday()

      const [{ data: clients }, { data: configs }] = await Promise.all([
        admin.from('clients')
          .select('id, is_active, is_comped, trial_ends_at, subscription_status, approved_at')
          .eq('is_active', true),
        admin.from('tracking_configs').select('client_id, report_period, report_day'),
      ])

      const cfgByClient = new Map((configs ?? []).map((c) => [c.client_id, c]))
      const due: string[] = []
      for (const client of (clients ?? []) as (BillingClient & { id: string })[]) {
        const cfg = cfgByClient.get(client.id)
        if (!cfg) continue
        // Billing gate (T0-2): is_active alone let an expired trial or a
        // cancelled subscription keep drawing paid runs every week. Comped
        // tenants (all four live ones today) pass unchanged.
        const access = billingAccess(client)
        if (!access.hasAccess) {
          console.log(`[scheduler] skipping ${client.id}: no access (${access.reason})`)
          continue
        }
        const isWeeklyDue = cfg.report_period === 'weekly' && cfg.report_day === weekday
        const isMonthlyDue = cfg.report_period === 'monthly' && dayOfMonth === 1
        if (isWeeklyDue || isMonthlyDue) due.push(client.id)
      }
      return due
    })

    // Cadence check (Tier 2). The product is sold as a weekly update and
    // nothing measured whether the update arrived: on the live corpus Össur had
    // 10 reportable runs and 2 emailed reports. A run that finishes and emails
    // nobody is indistinguishable, in every dashboard and every log, from one
    // that delivers — so this runs each morning, before today's dispatch, and
    // names yesterday's silent misses.
    //
    // Only runs dispatched WITH sendReport are counted: Sealand is the internal
    // iteration tenant and the demo is seeded, and both finish runs and email
    // nobody entirely on purpose. An alert that cannot tell those from a real
    // miss is an alert nobody reads.
    await step
      .run('check-cadence', async () => {
        const admin = createAdminClient()
        const since = new Date(Date.now() - 36 * 3600_000).toISOString()
        const [{ data: runs }, { data: reports }] = await Promise.all([
          admin.from('pipeline_runs')
            .select('id, client_id, status, options, completed_at')
            .gte('completed_at', since),
          admin.from('weekly_reports').select('run_id, sent_at').gte('sent_at', since),
        ])
        const stats = cadenceReliability(
          ((runs ?? []) as { id: string; status: string; options: { sendReport?: boolean } | null; completed_at: string | null }[])
            .map((r) => ({ id: r.id, status: r.status, options: r.options, completedAt: r.completed_at })),
          ((reports ?? []) as { run_id: string | null; sent_at: string | null }[])
            .map((r) => ({ runId: r.run_id, sentAt: r.sent_at })),
        )
        if (!stats.missed) return { missed: 0 }
        const byClient = new Map(
          ((runs ?? []) as { id: string; client_id: string }[]).map((r) => [r.id, r.client_id]),
        )
        const names = await admin.from('clients').select('id, company_name')
          .in('id', [...new Set(stats.missedRunIds.map((id) => byClient.get(id)).filter(Boolean) as string[])])
        const nameById = new Map(((names.data ?? []) as { id: string; company_name: string }[]).map((c) => [c.id, c.company_name]))
        const lines = stats.missedRunIds.map((id) => `  ${nameById.get(byClient.get(id) ?? '') ?? '?'} — run ${id}`)
        await sendAlertEmail(
          `Verbatim: ${stats.missed} scheduled update${stats.missed === 1 ? '' : 's'} did not reach anyone`,
          `A run finished and no report was emailed. The client's week produced nothing they can see.\n\n${lines.join('\n')}\n\n` +
          `Delivered on schedule: ${stats.delivered}/${stats.owed}.\n` +
          `Re-send: POST /api/admin/send-report {"clientId":"...","runId":"..."}`,
        )
        return { missed: stats.missed }
      })
      .catch((e) => {
        console.error(`[scheduler] cadence check failed: ${e instanceof Error ? e.message : String(e)}`)
        return { missed: 0 }
      })

    if (dueClientIds.length > 0) {
      await step.sendEvent(
        'dispatch-due-runs',
        dueClientIds.map((clientId) => ({
          name: 'pipeline/run.requested',
          // sendReport: emit the periodic report once this scheduled run completes.
          data: { clientId, options: { sendReport: true } },
        })),
      )
    }

    return { dispatched: dueClientIds.length, clientIds: dueClientIds }
  },
)
