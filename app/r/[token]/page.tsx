import { cookies, headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase-admin'
import { hydrateSnapshot } from '@/lib/snapshots'
import { renderTokenSecret } from '@/lib/render-token'
import { hashViewerIp, loadShareLink, shareCookieName, shareCookieValid } from '@/lib/reports/share'
import { ShareShell } from '@/components/share/share-shell'
import { PasswordForm } from '@/components/share/password-form'
import type { ReportSnapshotData } from '@/lib/reports/types'

// /r/<token> — a shared report (Stage 2, D5/D6). Public prefix in proxy.ts;
// everything else is checked here: the token, expiry, revocation, the
// password. The only reads are the link, its SNAPSHOT, and the quote texts
// the snapshot's refs resolve to — never a tenant table live. Every open is
// logged (hashed address, truncated agent) and counted on the link.

export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://verbatimintel.com'

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto mt-24 w-full max-w-md rounded-lg bg-tile p-6 shadow-tile">
      <h1 className="text-[17px] font-semibold">{title}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-secondary-foreground">{body}</p>
      <p className="mt-4 font-mono text-[11px] text-muted-foreground">Verbatim · <a href={APP_URL} className="underline underline-offset-2">verbatimintel.com</a></p>
    </main>
  )
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminClient()
  const found = await loadShareLink(admin, token)
  if (found.status === 'expired') return <Notice title="This link has expired" body="Links to a shared report are time-limited. Ask whoever sent it for a fresh one." />
  if (found.status === 'revoked') return <Notice title="This link was withdrawn" body="The report is no longer shared at this address. Ask whoever sent it." />
  if (found.status !== 'ok') return <Notice title="Nothing here" body="This link is not one we know. Check it was copied whole." />
  const { link, snapshot } = found
  if (snapshot.kind !== 'report') return <Notice title="Nothing here" body="This link does not point at a report." />

  if (link.password_hash) {
    const jar = await cookies()
    const ok = shareCookieValid(link, jar.get(shareCookieName(link.id))?.value, renderTokenSecret())
    if (!ok) {
      const d = snapshot.data as ReportSnapshotData
      return <PasswordForm token={token} title={d.title} company={d.company} />
    }
  }

  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip')
  const ua = (h.get('user-agent') ?? '').slice(0, 160)
  // Best effort, never in the reader's way.
  await Promise.all([
    admin.from('share_views').insert({ share_link_id: link.id, ip_hash: hashViewerIp(ip, renderTokenSecret()), user_agent: ua || null }),
    admin.from('share_links').update({ view_count: link.view_count + 1, last_viewed_at: new Date().toISOString() }).eq('id', link.id),
  ]).catch((e) => console.warn('[share] view log failed:', e))

  const data = await hydrateSnapshot<ReportSnapshotData>(admin, snapshot)
  return (
    <main>
      <ShareShell data={data} appUrl={APP_URL} />
    </main>
  )
}
