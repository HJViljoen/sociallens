import { NonRetriableError } from 'inngest'
import { inngest } from '../client'
import { createAdminClient } from '@/lib/supabase-admin'
import { appBaseUrl } from '@/lib/site'
import { buildContext, checkStep, DocumentBuildError, freezeStep, researchStep, writeStep } from '@/lib/reports/documents/steps'
import { failBuild } from '@/lib/reports/documents/builds'
import { BuildBlockedError } from '@/lib/reports/documents/research'
import { WriteFailedError } from '@/lib/reports/documents/write-model'

/**
 * build-document (T7, 2026-08-31): a document report written by the agent,
 * one step per phase so a transient failure retries only what failed and
 * every step's HTTP invocation stays well inside the route's 300 s.
 *
 * Steps (ids are a stability contract, see AGENTS.md): 'research' (signals +
 * questions + the agent, ≈ 100 s) → 'write' (one gpt-5.4 pass, ≈ 50 s) →
 * 'check' (the self-check, ≈ 20 s) → 'freeze' (compose + snapshot) →
 * 'render' (a fetch to /api/admin/documents/render, which prints; Chromium
 * never runs in a step). The step bodies live in lib/reports/documents/
 * steps.ts and are the same functions the script runs in process.
 *
 * Errors that a retry cannot fix (no searchable index, the writer failed
 * twice, not a document report) are NonRetriable; onFailure marks the row
 * failed with the message either way, so the Studio never polls forever.
 */

interface BuildEvent { buildId?: string; clientId?: string; reportId?: string; scheduleId?: string | null; sendId?: string | null }

const terminal = (e: unknown): never => {
  if (e instanceof BuildBlockedError || e instanceof WriteFailedError || e instanceof DocumentBuildError) throw new NonRetriableError(e.message, { cause: e })
  throw e
}

export const buildDocument = inngest.createFunction(
  {
    id: 'build-document',
    triggers: [{ event: 'report/build.requested' }],
    concurrency: { limit: 1, key: 'event.data.clientId' },
    retries: 1,
    onFailure: async ({ event }) => {
      const original = (event.data as { event?: { data?: BuildEvent } }).event
      const buildId = original?.data?.buildId
      if (!buildId) return
      // A NonRetriableError carries our own calibrated words (terminal());
      // anything else stays in the logs and the tenant reads a plain sentence.
      const err = (event.data as { error?: { name?: string; message?: string } }).error
      const message = err?.name === 'NonRetriableError' && err.message ? err.message : 'The build failed. Try again, or tell us if it keeps happening.'
      if (err?.name !== 'NonRetriableError') console.error('[build-document] failed:', err?.message)
      const admin = createAdminClient()
      await failBuild(admin, buildId, message)
      // A schedule is waiting on this one: its send row must say so too, or it
      // sits claimed until the stale window and the Studio shows nothing.
      const sendId = original?.data?.sendId
      if (sendId) await admin.from('report_sends').update({ status: 'failed', error: message.slice(0, 500) }).eq('id', sendId).in('status', ['claimed', 'ready'])
    },
  },
  async ({ event, step }) => {
    const { buildId } = event.data as BuildEvent
    if (!buildId) throw new NonRetriableError('report/build.requested missing buildId')

    const research = await step.run('research', async () => {
      const admin = createAdminClient()
      const ctx = await buildContext(admin, buildId).catch(terminal)
      return researchStep(admin, ctx).catch(terminal)
    })

    const write = await step.run('write', async () => {
      const admin = createAdminClient()
      const ctx = await buildContext(admin, buildId).catch(terminal)
      return writeStep(admin, ctx, { answers: research.answers, costUsd: research.costUsd }).catch(terminal)
    })

    const check = await step.run('check', async () => {
      const admin = createAdminClient()
      const ctx = await buildContext(admin, buildId).catch(terminal)
      return checkStep(admin, ctx, { written: write.written }, research.costUsd + write.costUsd).catch(terminal)
    })

    const freeze = await step.run('freeze', async () => {
      const admin = createAdminClient()
      const ctx = await buildContext(admin, buildId).catch(terminal)
      const costUsd = research.costUsd + write.costUsd + check.costUsd
      const timings = { ...research.timings, ...write.timings, ...check.timings }
      return freezeStep(admin, ctx, { answers: research.answers, written: check.written, check, costUsd, timings }).catch(terminal)
    })

    const render = await step.run('render', async () => {
      const r = await fetch(`${appBaseUrl()}/api/admin/documents/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-key': process.env.ADMIN_API_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '' },
        body: JSON.stringify({ buildId }),
      })
      const j = (await r.json().catch(() => ({}))) as { artifactId?: string; bytes?: number; ms?: number; error?: string }
      if (!r.ok) throw new Error(`documents/render ${r.status}: ${j.error ?? 'no body'}`)
      return { artifactId: j.artifactId ?? null, bytes: j.bytes ?? 0, ms: j.ms ?? 0 }
    })

    // A build a schedule asked for finishes the job: the email goes out, or
    // the send waits as `ready` for a person. A build someone started in the
    // Studio carries no send row and stops at the printing.
    //
    // The build row is already `done` (renderStep completes it): delivering is
    // the send row's business, and a send that fails is recorded there, so a
    // printed brief is never marked failed because an inbox refused it.
    const sendId = (event.data as BuildEvent).sendId ?? null
    const deliver = sendId
      ? await step.run('deliver', async () => {
          const r = await fetch(`${appBaseUrl()}/api/admin/schedules/deliver`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-admin-key': process.env.ADMIN_API_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '' },
            body: JSON.stringify({ sendId }),
          })
          const j = (await r.json().catch(() => ({}))) as { status?: string; error?: string }
          if (!r.ok) throw new Error(`schedules/deliver ${r.status}: ${j.error ?? 'no body'}`)
          return { status: j.status ?? 'sent' }
        })
      : null

    return { buildId, snapshotId: freeze.snapshotId, artifactId: render.artifactId, costUsd: research.costUsd + write.costUsd + check.costUsd, flagged: check.flagged, delivered: deliver?.status ?? null }
  },
)
