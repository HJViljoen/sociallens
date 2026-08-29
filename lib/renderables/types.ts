import type { ReactNode } from 'react'

/**
 * The spine of Reports & Exports (Stage 1, 2026-08-29).
 *
 * Every dashboard page is a LOADER (`load(scope) → data`, one per page, the
 * DB waves kept exactly as the page had them — round trips cost more than
 * rows, 2026-08-23) and a set of RENDERERS (`render(data, mode)`, pure, one per
 * tile or item). The same data feeds the app page, the print route that Chrome
 * turns into PDF/PNG, and — later — the Studio, email and the agent.
 *
 * Data is TILE-READY: the shape the renderers consume, after lib/*-tiles.ts
 * has done its work. That is what a snapshot stores (report_snapshots.data),
 * so an export renders the same numbers in October that it rendered in
 * August, whatever the `*_current` views say by then.
 */

export type RenderMode = 'app' | 'print'

export type PageKey = 'dashboard' | 'market' | 'voice' | 'competitive' | 'content' | 'profile' | 'agent'

/** Print variants: the default export is the overview plus the selected item;
 *  `full` appends one slide per item (capped, see EXPORT_FULL_MAX_ITEMS). */
export type PrintVariant = 'default' | 'full'

export interface Scope {
  /** The session client on the app path (RLS-scoped), the admin client on the
   *  export path — where the tenant is already pinned by the session and the
   *  loader runs server-to-server. Loaders never widen their own reads. */
  supabase: unknown
  clientId: string
  /** The page's own URL params, verbatim. Selection lives here (`?item=`,
   *  `?theme=`, `?vs=`, `?persona=`…), so a loader resolves the same selection
   *  the reader was looking at when they clicked export. */
  params: Record<string, string | undefined>
  variant?: PrintVariant
}

/**
 * A quote as it travels through the spine. `ref` says where the words come
 * from — `e:<insight_evidence.id>`, `c:<comments.id>` or `v:<videos.id>` — and
 * it is the ONLY thing a snapshot keeps: `text` is emptied on freeze and
 * resolved live on render (lib/renderables/quotes-freeze.ts). That is the
 * agent's rule, applied to every export: an erased voice cannot survive
 * inside a stored artifact.
 */
export interface Quote {
  ref: string
  text: string
}

export interface Slide {
  /** Slide title (the section, in the page's own words). */
  title: string
  /** Renderable keys placed on this slide, in order. */
  keys: string[]
  /** `grid` lays tiles on the 12-column grid using their own spans; `single`
   *  gives one renderable the whole slide; `item` is a detail pane (an item's
   *  full view) on its own slide. */
  layout: 'grid' | 'single' | 'item'
}

export interface Renderable<D> {
  /** `<page>.<tile>`, e.g. 'dashboard.strip'. Stable: it names PNG exports and
   *  registry entries; renaming one orphans stored artifacts' tile_key. */
  key: string
  title: string
  render(data: D, mode: RenderMode): ReactNode
}

export interface PageModule<D> {
  key: PageKey
  title: string
  /** null = first-run empty state; the page renders its own empty tile and an
   *  export is refused ("nothing to export yet"). */
  load(scope: Scope): Promise<D | null>
  /** Which renderables go on which slide, for this variant. Pagination is
   *  decided HERE, not by the browser — Puppeteer's PDF pipeline is unreliable
   *  with break-inside:avoid, so slides are fixed boxes with break-after. */
  slides(data: D, variant: PrintVariant): Slide[]
  renderables: Record<string, Renderable<D>>
  /** A human title for the snapshot, from the data (e.g. "Dashboard · Sealand · 23 Aug"). */
  snapshotTitle(data: D): string
  /** The short line in every slide's header; defaults to the snapshot title. */
  printContext?(data: D): string
}
