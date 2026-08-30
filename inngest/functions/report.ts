import { inngest } from '@/inngest/client'
import { createAdminClient } from '@/lib/supabase-admin'
import { appBaseUrl } from '@/lib/site'
import { scheduleDue } from '@/lib/schedules/due'
import type { ScheduleRow } from '@/lib/schedules/types'

// After a scheduled update: every schedule of the workspace that is due
// builds its report and emails its list (Stage 3). Decoupled from the
// pipeline by an event so a slow report never blocks a run: runPipeline emits
// `report/send.requested` { clientId, runId } after a scheduled run (manual
// "Run now" runs don't, so they never email).
//
// This function only ORCHESTRATES. The work — loaders, cover, Chromium,
// Storage, share link, Resend — happens in POST /api/admin/schedules/run, one call
// per schedule, because a Chromium render inside an Inngest step would sit
// in the account's 5-slot concurrency budget next to the pipeline itself.
// Each step is a fetch; a retry after a lost response is safe because the
// runner claims (schedule, run) before it renders.
//
// Steps (ids are a stability contract — see AGENTS.md): 'find-due-schedules',
// then one `send:<scheduleId>` per schedule (stable per schedule).

export const sendWeeklyReport = inngest.createFunction(
  {
    id: 'send-weekly-report',
    triggers: [{ event: 'report/send.requested' }],
    concurrency: { limit: 1, key: 'event.data.clientId' },
    retries: 2,
  },
  async ({ event, step }) => {
    const { clientId, runId } = event.data as { clientId?: string; runId?: string }
    if (!clientId) throw new Error('report/send.requested missing clientId')
    if (!runId) throw new Error('report/send.requested missing runId')

    const due = await step.run('find-due-schedules', async () => {
      const admin = createAdminClient()
      const [{ data: schedules }, { data: run }] = await Promise.all([
        admin.from('report_schedules').select('id, name, cadence, active, last_sent_at').eq('client_id', clientId).order('created_at'),
        admin.from('pipeline_runs').select('completed_at, started_at').eq('id', runId).maybeSingle(),
      ])
      const r = run as { completed_at: string | null; started_at: string | null } | null
      const runDate = r?.completed_at ?? r?.started_at ?? new Date().toISOString()
      return ((schedules ?? []) as Pick<ScheduleRow, 'id' | 'name' | 'cadence' | 'active' | 'last_sent_at'>[])
        .filter((s) => scheduleDue(s, s.last_sent_at, runDate))
        .map((s) => ({ id: s.id, name: s.name }))
    })

    const results: { id: string; name: string; status: string; ms?: number; error?: string }[] = []
    for (const s of due) {
      const res = await step.run(`send:${s.id}`, async () => {
        const r = await fetch(`${appBaseUrl()}/api/admin/schedules/run`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-admin-key': process.env.ADMIN_API_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '' },
          body: JSON.stringify({ scheduleId: s.id, runId }),
        })
        const j = (await r.json().catch(() => ({}))) as { status?: string; ms?: number; error?: string }
        if (!r.ok && r.status !== 500) throw new Error(`schedules/run ${r.status}: ${j.error ?? 'no body'}`)
        return { status: j.status ?? `http ${r.status}`, ms: j.ms, error: j.error }
      })
      results.push({ id: s.id, name: s.name, ...res })
    }
    return { clientId, runId, due: due.length, results }
  },
)
