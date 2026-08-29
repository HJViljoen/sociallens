import { getSessionContext } from '@/lib/auth'
import { loadCompetitive, type CompetitiveParams } from '@/lib/pages/competitive'
import { CompetitivePage } from '@/components/pages/competitive'

// Competitive Intelligence — "where do we stand vs <competitor>?" Loader in
// lib/pages/competitive.ts, renderers in components/pages/competitive
// (Reports & Exports, 2026-08-29).

export default async function Page({ searchParams }: { searchParams?: Promise<CompetitiveParams> }) {
  const { supabase, clientId } = await getSessionContext()
  const sp = (await searchParams) ?? {}
  const data = await loadCompetitive({ supabase, clientId, params: sp })
  return <CompetitivePage data={data} detail={sp.detail} params={sp} />
}
