import { createAdminClient } from '../supabase-admin'
import { gatherNewsItems } from './fetch'
import type { NewsConfig } from './types'

// News persistence (Wave 2, 2026-08-11) — the step the ingestion foundation
// was waiting for. Fetch + ring-assign this period's items, upsert on
// (client_id, url_hash) so re-runs refresh run_id without duplicating. Ring 3
// (thematic — needs embeddings + confirm gate) stays deferred; nothing here
// correlates or explains, the panel is context only.

/** Fetch and store this run's news items. Free (RSS only). */
export async function persistRunNews(
  clientId: string,
  runId: string,
): Promise<{ fetched: number; stored: number }> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tracking_configs')
    .select('brand_keywords, competitor_keywords, competitor_names, industry_keywords, report_period')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new Error(`news config load: ${error.message}`)
  if (!data) return { fetched: 0, stored: 0 }

  const config: NewsConfig = {
    brand_keywords: data.brand_keywords ?? [],
    competitor_keywords: data.competitor_keywords ?? [],
    competitor_names: data.competitor_names ?? [],
    industry_keywords: data.industry_keywords ?? [],
    report_period: data.report_period ?? 'weekly',
  }
  const items = await gatherNewsItems(config)
  if (items.length === 0) return { fetched: 0, stored: 0 }

  const rows = items.map((n) => ({
    client_id: clientId,
    run_id: runId,
    source: n.source,
    source_ref: n.source_ref,
    url: n.url,
    url_hash: n.url_hash,
    title: n.title,
    summary: n.summary,
    published_at: n.published_at,
    ring: n.ring,
    bucket: '',
  }))
  const { error: upErr } = await admin
    .from('news_items')
    .upsert(rows, { onConflict: 'client_id,url_hash' })
  if (upErr) throw new Error(`news upsert: ${upErr.message}`)
  return { fetched: items.length, stored: rows.length }
}
