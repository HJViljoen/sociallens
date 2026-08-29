import { getSessionContext } from '@/lib/auth'
import { loadMarket, type MarketParams } from '@/lib/pages/market'
import { MarketPage } from '@/components/pages/market'

// Market Intelligence — "what should we do?" Loader in lib/pages/market.ts,
// renderers in components/pages/market (Reports & Exports, 2026-08-29).

export default async function Page({ searchParams }: { searchParams?: Promise<MarketParams> }) {
  const { supabase, clientId } = await getSessionContext()
  const sp = (await searchParams) ?? {}
  const data = await loadMarket({ supabase, clientId, params: sp })
  return <MarketPage data={data} detail={sp.detail} params={sp} />
}
