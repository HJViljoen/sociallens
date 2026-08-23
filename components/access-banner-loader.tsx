import { AccessBanner } from '@/components/access-banner'
import { getSessionContext } from '@/lib/auth'
import { billingAccess, type BillingClient } from '@/lib/billing'

/**
 * The async half of the workspace-state banner, so the dashboard LAYOUT can
 * stay synchronous. When the layout itself awaited the session + the clients
 * row, nothing below it — including every route's loading.tsx — could paint
 * until both round-trips were back (and the first DB hit of a cold request is
 * the one that pays the pool wake-up). Rendered inside <Suspense> with a null
 * fallback: the shell and the page skeleton stream at once; the banner slots
 * in when its row arrives. getSessionContext() is request-cached, so this
 * shares its resolution with the page.
 */
export async function AccessBannerLoader() {
  const { supabase, clientId } = await getSessionContext()
  // select('*'): the billing columns are optional on older rows, and this
  // must render whether or not a given migration has landed.
  const { data: clientRow } = await supabase.from('clients').select('*').eq('id', clientId).maybeSingle()
  // No row (RLS hiccup, transient failure) is NOT the same as "no access":
  // billingAccess would read the missing approved_at as pending and tell a
  // comped design partner their workspace was never switched on. Say nothing
  // rather than something wrong; the scheduler and pipeline gates are the ones
  // that actually stop spend.
  const access = clientRow
    ? billingAccess(clientRow as BillingClient)
    : { hasAccess: true, reason: 'comped' as const }
  return <AccessBanner access={access} />
}
