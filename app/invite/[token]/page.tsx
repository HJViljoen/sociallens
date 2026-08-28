import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase-admin'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { loadInvite } from './data'
import { AcceptButton, SignupAcceptForm } from './invite-ui'

// Public invite-acceptance page. Validates the token, then renders the right
// action based on the visitor's session. All authorization lives in
// acceptInvitation — this page only chooses what to show.

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-xl border bg-background p-8 shadow-sm">
        <h1 className="text-xl font-bold tracking-tight">Verbatim</h1>
        <h2 className="mt-4 mb-1 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { invite, reason } = await loadInvite(token)

  if (!invite) {
    return (
      <Shell title="Invite unavailable">
        <p className="text-sm text-muted-foreground">{reason}</p>
        <Link href="/login" className="mt-4 inline-block text-sm text-foreground underline">Go to sign in</Link>
      </Shell>
    )
  }

  // Company name for context (service role — the visitor has no tenant yet).
  const admin = createAdminClient()
  const { data: client } = await admin
    .from('clients').select('company_name').eq('id', invite.client_id).maybeSingle()
  const company = client?.company_name ?? 'a workspace'

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Signed in with a different email — must sign out first.
  if (user && (user.email ?? '').toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <Shell title={`Join ${company}`}>
        <p className="text-sm text-muted-foreground">
          This invite is for <strong>{invite.email}</strong>, but you’re signed in as{' '}
          <strong>{user.email}</strong>. Sign out and open this link again to accept.
        </p>
      </Shell>
    )
  }

  return (
    <Shell title={`Join ${company}`}>
      <p className="mb-5 text-sm text-muted-foreground">
        You’ve been invited to join <strong>{company}</strong> on Verbatim as a{' '}
        <strong>{invite.role}</strong>.
      </p>
      {user
        ? <AcceptButton token={token} />
        : <SignupAcceptForm token={token} email={invite.email} />}
    </Shell>
  )
}
