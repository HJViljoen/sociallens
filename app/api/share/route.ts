import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getRouteSession } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { getBaseUrl } from '@/lib/site'
import { SHARE_DEFAULT_EXPIRY_DAYS, SHARE_EXPIRY_CHOICES } from '@/lib/config'
import { expiryFromDays, hashSharePassword, mintShareToken } from '@/lib/reports/share'

// POST /api/share { snapshotId, expiresDays?: 7|30|90|null, password?: string }
// → { id, url, expiresAt }. The snapshot must be the session tenant's and a
// report; the token is minted here and returned once — the row withholds it
// from the workspace's own reads, the Reports page shows it through the
// service role on the server.

const body = z.object({
  snapshotId: z.uuid(),
  expiresDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.null()]).optional(),
  password: z.string().max(200).optional(),
})

export async function POST(req: Request) {
  const session = await getRouteSession()
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  const { snapshotId, password } = parsed.data
  const days = parsed.data.expiresDays === undefined ? SHARE_DEFAULT_EXPIRY_DAYS : parsed.data.expiresDays
  if (!SHARE_EXPIRY_CHOICES.includes(days as (typeof SHARE_EXPIRY_CHOICES)[number])) return NextResponse.json({ error: 'Bad request.' }, { status: 400 })

  const admin = createAdminClient()
  const { data: snap } = await admin.from('report_snapshots').select('id, kind, title').eq('id', snapshotId).eq('client_id', session.clientId).maybeSingle()
  if (!snap || snap.kind !== 'report') return NextResponse.json({ error: 'Only a built report can be shared.' }, { status: 404 })

  const token = mintShareToken()
  const expiresAt = expiryFromDays(days)
  const passwordHash = password?.trim() ? await hashSharePassword(password.trim()) : null
  const { data, error } = await admin
    .from('share_links')
    .insert({ client_id: session.clientId, snapshot_id: snapshotId, token, title: snap.title as string, expires_at: expiresAt, password_hash: passwordHash, created_by: session.userId })
    .select('id')
    .single()
  if (error || !data) return NextResponse.json({ error: 'Could not create the link — try again.' }, { status: 503 })
  const url = `${await getBaseUrl()}/r/${token}`
  return NextResponse.json({ id: data.id, url, expiresAt, protected: Boolean(passwordHash) })
}
