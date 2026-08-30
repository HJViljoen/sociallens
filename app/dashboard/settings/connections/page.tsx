import Link from 'next/link'
import { getSessionContext } from '@/lib/auth'
import { platformLabel } from '@/lib/format'
import { SettingsFrame, SettingsCard, ConnectionRow } from '@/components/settings-frame'
import { createAdminClient } from '@/lib/supabase-admin'
import { recipientsBySchedule } from '@/lib/schedules/default'

// Connections (component-map §3): where Verbatim reads from and where its
// reports go, as status rows. Every status is a fact about this workspace —
// nothing here is a switch that does nothing. Sources are operator-set
// (facts, not knobs); destinations beyond email and the ad/commerce platforms
// are named so the roadmap is visible, and labelled exactly as far as they are.

const SOURCES = ['tiktok', 'instagram', 'youtube'] as const

export default async function ConnectionsPage() {
  const { supabase, clientId } = await getSessionContext()
  const [{ data: client }, { data: tc }, schedules] = await Promise.all([
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    supabase.from('tracking_configs').select('platforms, own_handles, report_period').eq('client_id', clientId).maybeSingle(),
    recipientsBySchedule(createAdminClient(), clientId),
  ])
  const platforms = new Set<string>((tc?.platforms as string[] | null) ?? [])
  const handles = (tc?.own_handles as Record<string, string> | null) ?? {}
  const activeSchedules = schedules.filter((s) => s.active)
  const scheduleCount = activeSchedules.filter((s) => s.recipients.length > 0).length
  const addressCount = activeSchedules.reduce((n, s) => n + s.recipients.length, 0)
  const hasRecipients = addressCount > 0
  const paused = tc?.report_period === 'paused'

  return (
    <SettingsFrame active="connections" title="Settings" context={client?.company_name ?? undefined} contentTitle="Connections" contentMeta="what we read · where reports go">
      <div className="flex flex-col gap-3">
        <SettingsCard title="Sources we read" description="The public conversation we track for you. Set up with you at onboarding, tell us to change them.">
          {SOURCES.map((p) => (
            <ConnectionRow
              key={p}
              name={platformLabel(p)}
              what={platforms.has(p) ? (handles[p] ? `Comments and videos · following ${p === 'youtube' ? 'your channel' : `@${handles[p]}`}` : 'Comments and what is said in the videos') : 'Not tracked for this workspace'}
              status={platforms.has(p) ? 'connected' : 'not-connected'}
            />
          ))}
          <ConnectionRow name="Reddit" what={platforms.has('reddit') ? 'Threads and comments' : 'Threads and comments, on request'} status={platforms.has('reddit') ? 'connected' : 'in-development'} />
        </SettingsCard>

        <SettingsCard title="Where reports go" description="Scheduled updates go out by email, each schedule to its own list. Chat destinations are next.">
          <ConnectionRow
            name="Email"
            what={paused ? 'Updates are paused for this workspace, nothing is being sent' : hasRecipients ? `${scheduleCount} schedule${scheduleCount === 1 ? '' : 's'} · ${addressCount} address${addressCount === 1 ? '' : 'es'}` : 'no addresses yet'}
            status={paused ? 'paused' : hasRecipients ? 'connected' : 'not-connected'}
            action={<Link href="/dashboard/studio" className="text-[12px] font-medium hover:underline">Edit →</Link>}
          />
          <ConnectionRow name="Slack" what="The weekly report and movement alerts in a channel" status="coming-soon" />
          <ConnectionRow name="Microsoft Teams" what="The weekly report and movement alerts in a channel" status="coming-soon" />
        </SettingsCard>

        <SettingsCard title="Ad & commerce platforms" description="For checking what you say and spend against what your market hears. Not connected to anything yet.">
          <ConnectionRow name="Meta Ads" what="Campaign claims and spend beside the conversation" status="coming-soon" />
          <ConnectionRow name="Google Ads" what="Campaign claims and spend beside the conversation" status="coming-soon" />
          <ConnectionRow name="Shopify" what="Products and stock beside purchase intent" status="coming-soon" />
        </SettingsCard>

        <SettingsCard title="API" description="Programmatic access to your insights.">
          <ConnectionRow name="API keys" what="No API yet, ask if you need one" status="coming-soon" />
        </SettingsCard>
      </div>
    </SettingsFrame>
  )
}
