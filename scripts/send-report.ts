// The digest, by hand (Reports & Exports Stage 3).
//
//   node --env-file=.env.local --import tsx scripts/send-report.ts --client <uuid> [--schedule <id>] [--run <uuid>] [--out email-preview]
//     default: PREVIEW — builds the schedule's report (loaders + cover, no PDF, no link, no send),
//              writes <out>.html + <out>.txt, prints the subject and recipients; leaves no rows behind.
//   … --test <email>      one real send to that address only (PDF + link + email); nothing recorded
//   … --commit            the real thing for the latest completed update: claim, build, send to the list, record
//
// Without --schedule the workspace's default schedule (its digest) is used.
// Sending goes through lib/email.ts: with no RESEND_API_KEY the send is a
// logged stub and everything else still happens.

import { writeFileSync } from 'fs'
import { createAdminClient } from '../lib/supabase-admin'
import { resolveScheduleReport } from '../lib/schedules/resolve'
import { snapshotReport } from '../lib/reports/build'
import { renderDigestEmail } from '../lib/email/digest'
import type { ScheduleRow } from '../lib/schedules/types'

const args = process.argv.slice(2)
const flag = (name: string, dflt = '') => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt }
const has = (name: string) => args.includes(`--${name}`)

const clientId = flag('client', 'e52cac94-30e1-426a-9a36-31b11e0b30b6')
const out = flag('out', 'email-preview')
// Links in the email point at the app (production when NEXT_PUBLIC_APP_URL is
// set); the browser renders against the dev server unless RENDER_BASE_URL says otherwise.
const renderBaseUrl = (process.env.RENDER_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const appUrl = (process.env.NEXT_PUBLIC_APP_URL || renderBaseUrl).replace(/\/$/, '')

async function main() {
  const admin = createAdminClient()
  const q = admin.from('report_schedules').select('*').eq('client_id', clientId)
  const { data: schedule } = flag('schedule') ? await q.eq('id', flag('schedule')).maybeSingle() : await q.eq('is_default', true).maybeSingle()
  if (!schedule) throw new Error('no such schedule for that client')
  const s = schedule as ScheduleRow
  console.log(`${s.name} · ${s.starter_key ?? s.report_id} · ${s.cadence} · ${s.recipients.length} recipient(s) · pdf ${s.attach_pdf ? 'attached' : 'not attached'} · link ${s.share_days ?? 'never expires'}`)

  if (has('commit') || has('test')) {
    const { runSchedule } = await import('../lib/schedules/run')
    const runId = flag('run') || (await latestRun(admin))
    if (!runId) throw new Error('no completed update to send')
    const res = await runSchedule({ admin, schedule: s, runId, baseUrl: appUrl, renderBaseUrl, mode: has('test') ? 'test' : 'send', to: has('test') ? [flag('test')] : undefined })
    console.log(`${res.status} · ${res.ms} ms${res.subject ? ` · "${res.subject}"` : ''}${res.shareUrl ? ` · ${res.shareUrl}` : ''}${res.error ? ` · ${res.error}` : ''}`)
    return
  }

  const resolved = await resolveScheduleReport(admin, s)
  if (!resolved) throw new Error('the schedule points at a template that no longer exists')
  const t0 = Date.now()
  const snap = await snapshotReport({ admin, supabase: admin, clientId, userId: null, report: resolved.report, company: resolved.company })
  try {
    const email = renderDigestEmail({ data: snap.data, shareUrl: `${appUrl}/r/preview-link`, appUrl, attached: s.attach_pdf })
    writeFileSync(`${out}.html`, email.html)
    writeFileSync(`${out}.txt`, email.text)
    console.log(`subject: ${email.subject}`)
    console.log(`to: ${s.recipients.join(', ') || '(nobody)'}`)
    console.log(`sections ${snap.data.sections.length} · delta ${snap.data.delta ? `since ${snap.data.delta.prevRunDate.slice(0, 10)}` : 'none'} · ${Date.now() - t0} ms · ${email.html.length} chars → ${out}.html / ${out}.txt`)
  } finally {
    if (!has('keep')) await admin.from('report_snapshots').delete().eq('id', snap.snapshotId)
  }
}

async function latestRun(admin: ReturnType<typeof createAdminClient>): Promise<string | null> {
  const { data } = await admin.from('pipeline_runs').select('id').eq('client_id', clientId).in('status', ['completed', 'partial']).order('completed_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

main().catch((e) => { console.error(e); process.exit(1) })
