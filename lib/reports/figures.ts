import { fmtInt, fmtPct, listNames } from '../format'
import type { PageKey } from '../renderables/types'
import type { Figure, FigureTable } from './types'

/**
 * The figures a cover may cite, computed from a section's tile-ready data —
 * the same numbers the tiles show, in the same words. The model never sees a
 * raw number to copy; it names a figure by key and the code writes it in
 * (lib/reports/cover.ts). Only what a page carries is offered, so a leadership
 * one-pager that holds the dashboard cannot cite a competitor finding count.
 */
export function figuresFor(page: PageKey, data: unknown): FigureTable {
  const d = data as Record<string, unknown>
  const out: FigureTable = {}
  const pct = (n: number) => fmtPct(n, n % 1 === 0 ? 0 : 1)
  const put = (key: string, label: string, value: string | number | null | undefined, fmt?: (n: number) => string) => {
    if (value === null || value === undefined || value === '') return
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return
      out[key] = { label, value: fmt ? fmt(value) : fmtInt(value), kind: fmt === pct ? 'pct' : 'count' }
    } else out[key] = { label, value, kind: 'name' }
  }

  switch (page) {
    case 'dashboard': {
      const strip = d.strip as { videos?: { now: number | null }; comments?: { now: number | null }; tiers?: { confirmed: number }; platformsTracked?: string[] } | undefined
      put('videos', 'conversations analysed', strip?.videos?.now)
      put('comments', 'comments read', strip?.comments?.now)
      put('themes_confirmed', 'confirmed themes', strip?.tiers?.confirmed)
      if (strip?.platformsTracked?.length) put('platforms', 'platforms tracked', listNames(strip.platformsTracked))
      const sent = d.sentiment as { positivePct: number; judged: number } | null | undefined
      if (sent) {
        put('sentiment_positive_pct', 'positive sentiment', sent.positivePct, pct)
        put('sentiment_judged', 'conversations rated for sentiment', sent.judged)
      }
      const share = d.share as { client: { pct: number } | null; topCompetitor: { name: string; pct: number } | null } | null | undefined
      if (share?.client && share.topCompetitor) {
        put('share_of_voice_pct', 'share of the tracked conversation', share.client.pct, pct)
        put('top_competitor', 'most-talked-about competitor', share.topCompetitor.name)
        put('top_competitor_share_pct', "that competitor's share", share.topCompetitor.pct, pct)
      }
      const themes = d.themes as { rows: { label: string; conversations: number }[] } | undefined
      if (themes?.rows?.[0]) {
        put('top_theme', 'the theme heard most', themes.rows[0].label)
        put('top_theme_conversations', 'conversations carrying that theme', themes.rows[0].conversations)
      }
      const hero = d.hero as { oneThing: { title: string } | null; headline: string } | undefined
      put('top_recommendation', 'the top recommendation', hero?.oneThing?.title)
      break
    }
    case 'competitive': {
      const st = d.standings as { competitors: { name: string; pct: number }[]; client: { pct: number } | null } | null | undefined
      if (st?.client && st.competitors[0]) {
        put('your_share_pct', 'your share of the tracked conversation', st.client.pct, pct)
        put('lead_competitor', 'the competitor talked about most', st.competitors[0].name)
        put('lead_competitor_share_pct', "that competitor's share", st.competitors[0].pct, pct)
      }
      const rail = d.rail as { insightsCount: number } | undefined
      put('competitive_findings', 'competitive findings this update', rail?.insightsCount)
      break
    }
    case 'voice': {
      const map = d.map as { shownCount: number; tiersAll: { confirmed: number }; blocks: { label: string; count: number }[] } | undefined
      put('themes_confirmed', 'confirmed themes', map?.tiersAll?.confirmed)
      const top = map?.blocks?.length ? [...map.blocks].sort((a, b) => b.count - a.count)[0] : null
      if (top) {
        put('top_theme', 'the theme heard most', top.label)
        put('top_theme_conversations', 'conversations carrying that theme', top.count)
      }
      const moods = d.moods as { emotion: string; pct: number }[] | undefined
      if (moods?.[0]) {
        put('top_mood', 'the mood heard most', moods[0].emotion)
        put('top_mood_pct', 'share of rated conversations in that mood', moods[0].pct, pct)
      }
      const phrases = d.phrases as { total: number } | undefined
      put('customer_phrases', 'customer phrases on record', phrases?.total)
      break
    }
    case 'market': {
      const rail = d.rail as { recs: number; insights: number; claims: number; newsTotal: number } | undefined
      put('recommendations', 'recommendations this update', rail?.recs)
      put('market_insights', 'market insights this update', rail?.insights)
      put('news_items', 'news items matched', rail?.newsTotal)
      break
    }
    case 'content': {
      const inbox = d.inbox as { total: number } | undefined
      put('comments_worth_a_reply', 'comments worth a reply', inbox?.total)
      const catalog = d.catalog as { total: number } | undefined
      put('videos_in_field', 'videos in the field this update', catalog?.total)
      const works = d.works as { topSound: { name: string } | null } | undefined
      put('top_sound', 'the sound used most', works?.topSound?.name)
      break
    }
    case 'profile': {
      const personas = d.personas as { name: string }[] | undefined
      put('personas', 'personas in the profile', personas?.length)
      const active = d.active as { name: string; share: number } | undefined
      if (active) {
        put('lead_persona', 'the persona shown', active.name)
        put('lead_persona_share_pct', 'their share of the profile', active.share, pct)
      }
      break
    }
    case 'agent':
      break
  }
  return out
}

/** Merge per-section tables; the first section to name a key keeps it (the
 *  dashboard, usually first, is the authority on the shared numbers). */
export function mergeFigures(tables: FigureTable[]): FigureTable {
  const out: FigureTable = {}
  for (const t of tables) for (const [k, v] of Object.entries(t)) if (!(k in out)) out[k] = v
  return out
}

export const figureLine = (f: Figure) => `${f.value} ${f.label}`
