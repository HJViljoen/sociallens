import { UserPlus, Users, Clock, Mail } from 'lucide-react'
import { getSessionContext, canManageTenant } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { getBaseUrl } from '@/lib/site'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { InviteForm, RevokeButton, MemberControls, CopyLinkButton } from './team-ui'

// Team management — list members + pending invites, invite teammates, manage
// roles. Owners/admins can invite + revoke; only owners change roles or remove
// members. Members see a read-only roster. Authorization is enforced in the
// server actions and by RLS — the UI gating below is only UX.

interface MemberRow { id: string; full_name: string | null; email: string; role: 'owner' | 'admin' | 'member' }
interface InviteRow { id: string; email: string; role: 'owner' | 'admin' | 'member'; expires_at: string; token: string | null }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function RoleBadge({ role }: { role: string }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {cap(role)}
    </span>
  )
}

export default async function TeamPage() {
  const { supabase, clientId, role, userId } = await getSessionContext()
  const canManage = canManageTenant(role)
  const isOwner = role === 'owner'

  const [{ data: client }, { data: members }, { data: cfg }] = await Promise.all([
    supabase.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    supabase.from('users').select('id, full_name, email, role').eq('client_id', clientId).order('created_at'),
    // Who actually receives the update. Accepting an invite adds you to this
    // list (T0-10); showing it here is what makes "your team gets the update"
    // checkable instead of a claim.
    supabase.from('tracking_configs').select('report_emails').eq('client_id', clientId).maybeSingle(),
  ])
  const reportEmails = ((cfg?.report_emails ?? []) as string[]).map((e) => e.trim()).filter(Boolean)

  // Pending invites + their shareable links are only fetched/built for managers.
  // The invite TOKEN is only fetched for the person who sent that invite
  // (T0-11). It is a live credential: the link it forms creates an account for
  // the invited address and signs it in. Every owner and admin used to see
  // every pending invite's token rendered as plain text, so any admin could
  // take over any pending invitation on the tenant, including an owner one.
  let invites: InviteRow[] = []
  let baseUrl = ''
  if (canManage) {
    // The list comes through RLS (session client) and deliberately does NOT
    // select `token`: the column is revoked from `authenticated`, so it is
    // unreadable from PostgREST with a tenant JWT at all. Nulling it in
    // JavaScript was not a control — any admin could have read every pending
    // token directly, and the not-signed-in accept path turns a stolen OWNER
    // token into a takeover with no mailbox access.
    const { data } = await supabase
      .from('invitations')
      .select('id, email, role, expires_at, invited_by')
      .eq('client_id', clientId).eq('status', 'pending')
      .order('created_at', { ascending: false })
    const rows = ((data as (Omit<InviteRow, 'token'> & { invited_by: string | null })[] | null) ?? [])

    // Tokens for the invites YOU sent, read with the service role.
    const mine = rows.filter((r) => r.invited_by === userId).map((r) => r.id)
    const tokenById = new Map<string, string>()
    if (mine.length) {
      const { data: withTokens } = await createAdminClient()
        .from('invitations').select('id, token').in('id', mine)
      for (const t of ((withTokens ?? []) as { id: string; token: string }[])) tokenById.set(t.id, t.token)
    }
    invites = rows.map((r) => ({ ...r, token: tokenById.get(r.id) ?? null }))
    baseUrl = await getBaseUrl()
  }

  const memberRows = (members as MemberRow[] | null) ?? []
  const recipientSet = new Set(reportEmails.map((e) => e.toLowerCase()))
  const membersOffReport = memberRows.filter((m) => !recipientSet.has((m.email ?? '').toLowerCase()))

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Team</h1>
        <p className="text-sm text-muted-foreground">
          {client?.company_name ?? 'Workspace'}
          {!canManage && ' · read-only'}
        </p>
      </div>

      {canManage && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><UserPlus className="size-4 text-primary" aria-hidden /> Invite a teammate</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <InviteForm inviterRole={role} />
            <p className="text-[11px] text-muted-foreground/70">
              We email the invite link directly. You can also copy the generated link and share it
              yourself. It signs the person in and adds them to {client?.company_name ?? 'your workspace'}.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Users className="size-4 text-primary" aria-hidden /> Members ({memberRows.length})</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {memberRows.map((m) => {
            const isSelf = m.id === userId
            return (
              <div key={m.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.full_name || m.email}
                    {isSelf && <span className="ml-2 text-[11px] text-muted-foreground">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.email}
                    {recipientSet.has((m.email ?? '').toLowerCase())
                      ? <span className="ml-2 text-[11px] text-primary">gets the update</span>
                      : <span className="ml-2 text-[11px] text-muted-foreground/70">not on the update</span>}
                  </p>
                </div>
                {isOwner && !isSelf
                  ? <MemberControls userId={m.id} currentRole={m.role} />
                  : <RoleBadge role={m.role} />}
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Mail className="size-4 text-primary" aria-hidden /> Who gets the update ({reportEmails.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {reportEmails.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody. Add an address in Settings, or invite a teammate and they are added when they join.</p>
          ) : (
            <p className="text-sm">{reportEmails.join(' · ')}</p>
          )}
          {membersOffReport.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {membersOffReport.length} teammate{membersOffReport.length === 1 ? '' : 's'} on this workspace {membersOffReport.length === 1 ? 'is' : 'are'} not on the list.
              {canManage ? ' Add them in Settings.' : ''}
            </p>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Clock className="size-4 text-primary" aria-hidden /> Pending invites ({invites.length})</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {invites.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground first:pt-0">No pending invites.</p>
            ) : invites.map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.email}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {cap(inv.role)} · expires {new Date(inv.expires_at).toLocaleDateString()}
                  </p>
                  {inv.token ? (
                    <code className="mt-1 block truncate text-[11px] text-muted-foreground/70">
                      {baseUrl}/invite/{inv.token}
                    </code>
                  ) : (
                    <p className="mt-1 text-[11px] text-muted-foreground/70">
                      Link is visible to whoever sent this invite. We emailed it to them.
                    </p>
                  )}
                </div>
                {inv.token && <CopyLinkButton url={`${baseUrl}/invite/${inv.token}`} />}
                <RevokeButton id={inv.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
