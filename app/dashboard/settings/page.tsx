import { AtSign } from 'lucide-react'
import { getSessionContext, canManageTenant } from '@/lib/auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SettingsForm, type TrackingConfig } from './settings-form'

const PLATFORM_LABEL: Record<string, string> = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' }

/** Read-only "your connected accounts" card (own_handles is operator-set —
 *  facts, not knobs). YouTube stores a channel ID, not a readable handle, so
 *  it shows as the platform name alone. */
function OwnAccountsCard({ handles }: { handles: Record<string, string> }) {
  const entries = Object.entries(handles).filter(([, v]) => v)
  if (entries.length === 0) return null
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AtSign className="size-4 text-primary" aria-hidden /> Your accounts
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The public profiles we follow for your own posting and audience — measured from what the
          platforms show publicly.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {entries.map(([platform, handle]) => (
          <span key={platform} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm">
            <span className="font-medium">{PLATFORM_LABEL[platform] ?? platform}</span>
            {platform !== 'youtube' && <span className="text-muted-foreground">@{handle}</span>}
          </span>
        ))}
      </CardContent>
    </Card>
  )
}

// Settings — edit the client's tracking_configs (what gather scrapes + report
// schedule). Owners/admins can save; members get a read-only form. Authorization
// is enforced server-side in the action and by RLS — the disabled fieldset is
// only UX.

export default async function SettingsPage() {
  // Auth + tenant + role via the RLS-enforced session client. See lib/auth.ts.
  const { supabase, clientId, role } = await getSessionContext()

  const [{ data: client }, { data: cfg }] = await Promise.all([
    supabase.from('clients').select('company_name, plan').eq('id', clientId).maybeSingle(),
    supabase.from('tracking_configs').select('*').eq('client_id', clientId).maybeSingle(),
  ])
  const c = cfg as TrackingConfig | null
  const canEdit = canManageTenant(role)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          {client?.company_name ?? 'Client'}
          {client?.plan ? ` · ${client.plan} plan` : ''}
          {!canEdit && ' · read-only'}
        </p>
      </div>

      {!c ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          No tracking config for this client — gather has nothing to scrape until this is set.
        </CardContent></Card>
      ) : (
        <>
          <OwnAccountsCard handles={(c as TrackingConfig & { own_handles?: Record<string, string> }).own_handles ?? {}} />
          <SettingsForm cfg={c} canEdit={canEdit} />
        </>
      )}
    </div>
  )
}
