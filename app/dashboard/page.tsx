import { getSessionContext } from '@/lib/auth'
import { loadDashboard } from '@/lib/pages/dashboard'
import { DashboardPage } from '@/components/pages/dashboard'

// Dashboard — "where do we stand?" The page is a loader and a renderer
// (Reports & Exports, 2026-08-29): lib/pages/dashboard.ts fetches and shapes,
// components/pages/dashboard renders — the same data feeds the app, the print
// route and a snapshot.

export default async function Page({ searchParams }: { searchParams?: Promise<{ detail?: string }> }) {
  const sp = (await searchParams) ?? {}
  const { supabase, clientId } = await getSessionContext()
  const data = await loadDashboard({ supabase, clientId, params: sp })
  return <DashboardPage data={data} detail={sp.detail} />
}
