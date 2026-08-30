import { SettingsFrame, SettingsCard, FactRow } from '@/components/settings-frame'
import { platformLabel } from '@/lib/format'
import { getSessionContext, canManageTenant } from '@/lib/auth'
import { SettingsForm, type TrackingConfig } from './settings-form'

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

  // The facts beyond the four editable fields ride on the same row (read-only).
  const facts = (cfg ?? null) as { brand_keywords?: string[] | null; industry_keywords?: string[] | null; platforms?: string[] | null; own_handles?: Record<string, string> | null } | null
  const brandTerms = facts?.brand_keywords ?? []
  const categoryTerms = facts?.industry_keywords ?? []
  const platforms = facts?.platforms ?? []
  const handles = facts?.own_handles ?? {}

  return (
    <SettingsFrame active="tracking" title="Settings" context={`${client?.company_name ?? 'Client'}${client?.plan ? ` · ${client.plan} plan` : ''}${!canEdit ? ' · read-only' : ''}`} contentTitle="Tracking & reports" contentMeta={c ? `${brandTerms.length} brand · ${(c.competitor_names ?? []).length} competitor · ${categoryTerms.length} category terms` : undefined}>
      {!c ? (
        <p className="text-[12px] text-muted-foreground">No tracking config for this client, nothing is tracked until this is set up with you.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <SettingsCard title="What we track" description="The facts your updates are built on. Set up with you at onboarding; competitor names are yours to change below.">
            <FactRow label="Brand terms">{brandTerms.length > 0 ? brandTerms.join(' · ') : <span className="text-muted-foreground">none yet</span>}</FactRow>
            <FactRow label="Category terms">{categoryTerms.length > 0 ? categoryTerms.join(' · ') : <span className="text-muted-foreground">none yet</span>}</FactRow>
            <FactRow label="Platforms">{platforms.length > 0 ? platforms.map(platformLabel).join(' · ') : <span className="text-muted-foreground">none yet</span>}</FactRow>
            <FactRow label="Your accounts">
              {Object.entries(handles).filter(([, v]) => v).length > 0
                ? Object.entries(handles).filter(([, v]) => v).map(([p, h]) => `${platformLabel(p)}${p !== 'youtube' ? ` @${h}` : ''}`).join(' · ')
                : <span className="text-muted-foreground">none yet</span>}
            </FactRow>
          </SettingsCard>
          <SettingsForm cfg={c} canEdit={canEdit} />
        </div>
      )}
    </SettingsFrame>
  )
}
