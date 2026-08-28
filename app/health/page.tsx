import { connection } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'

// Keep-warm target (2026-08-23). A page, not a route handler, on purpose: it
// has to run in the SAME Vercel function bundle as the dashboard pages, so a
// ping here is what keeps that instance warm — a cold instance added ~0.75s
// to the first navigation after a quiet spell (/login measured 1.0s cold vs
// 0.25s warm). The one cheap read also opens a DB connection, which helps
// only marginally (the DB's own warmth decays within ~15s; that part is the
// Supabase compute tier, not something a pinger fixes). Pinged every 5 min by
// inngest/functions/keep-warm.ts. Public in proxy.ts; noindex; returns text.

export const metadata = { robots: { index: false, follow: false } }

/** One cheap read, timed. Lives outside the component so the timing calls
 *  stay out of render (the React Compiler lint treats Date.now() there as
 *  impure, even in a server component). */
async function probeDb(): Promise<string> {
  const t0 = Date.now()
  const { error } = await createAdminClient().from('clients').select('id').limit(1)
  return error ? `db:error ${error.message}` : `db:${Date.now() - t0}ms`
}

export default async function HealthPage() {
  await connection()
  const db = await probeDb()
  return <pre style={{ fontFamily: 'monospace', fontSize: 12, padding: 16 }}>ok · {db}</pre>
}
