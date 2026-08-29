import type { SupabaseClient } from '@supabase/supabase-js'
import { hydrateSnapshot, type SnapshotRow } from '../snapshots'
import type { ShareLinkRow } from './share'

/** How long a hydrated share is served from memory before the quote texts are
 *  read again (erasure latency on a link — a minute, not instant). */
export const SHARE_HYDRATION_TTL_MS = 60_000
/** A viewer counts once per this window per link (reloads are not readers). */
export const SHARE_VIEW_DEDUPE_MS = 10 * 60_000

const cache = new Map<string, { at: number; data: unknown }>()

export async function hydratedShare<T>(admin: SupabaseClient, snapshot: SnapshotRow): Promise<T> {
  const hit = cache.get(snapshot.id)
  const now = Date.now()
  if (hit && now - hit.at < SHARE_HYDRATION_TTL_MS) return hit.data as T
  const data = await hydrateSnapshot<T>(admin, snapshot)
  cache.set(snapshot.id, { at: now, data })
  // Keep the map small on a long-lived instance.
  if (cache.size > 200) for (const [k, v] of cache) if (now - v.at >= SHARE_HYDRATION_TTL_MS) cache.delete(k)
  return data
}

/** Log an open: skipped when the same hashed address opened this link within
 *  the window; the link's count is incremented in the database (an RPC), so
 *  concurrent opens never lose one. Errors are logged, never thrown. */
export async function recordShareView(admin: SupabaseClient, link: Pick<ShareLinkRow, 'id'>, v: { ipHash: string | null; userAgent: string | null }): Promise<void> {
  try {
    if (v.ipHash) {
      const since = new Date(Date.now() - SHARE_VIEW_DEDUPE_MS).toISOString()
      const { data: recent } = await admin.from('share_views').select('id').eq('share_link_id', link.id).eq('ip_hash', v.ipHash).gte('viewed_at', since).limit(1)
      if (recent && recent.length) return
    }
    const [ins, inc] = await Promise.all([
      admin.from('share_views').insert({ share_link_id: link.id, ip_hash: v.ipHash, user_agent: v.userAgent }),
      admin.rpc('increment_share_view', { link_id: link.id }),
    ])
    if (ins.error) console.warn('[share] view insert failed:', ins.error.message)
    if (inc.error) console.warn('[share] view count failed:', inc.error.message)
  } catch (e) {
    console.warn('[share] view log failed:', e)
  }
}
