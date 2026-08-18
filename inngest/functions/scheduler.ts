import { inngest } from '@/inngest/client'
import { createAdminClient } from '@/lib/supabase-admin'
import { billingAccess, type BillingClient } from '@/lib/billing'

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
