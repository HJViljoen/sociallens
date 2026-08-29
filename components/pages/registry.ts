import type { PageKey, PageModule } from '@/lib/renderables/types'
import { dashboardPage } from './dashboard'

// The catalogue of renderables (plan D1): every page module, keyed. A tile is
// addressed as `<page>.<tile>` — the export route, the render page and, later,
// the Studio and the agent all look things up here and nowhere else.
//
// Pages join as they are split (T3–T8). The map is typed loosely on purpose:
// each module's data type is its own; callers that need the type import the
// module directly.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PAGES: Partial<Record<PageKey, PageModule<any>>> = {
  dashboard: dashboardPage,
}

export function pageModule(key: string): PageModule<unknown> | null {
  return (PAGES as Record<string, PageModule<unknown> | undefined>)[key] ?? null
}

/** `<page>.<tile>` → the page module and the renderable, or null. */
export function renderableByKey(key: string): { page: PageModule<unknown>; tileKey: string } | null {
  const dot = key.indexOf('.')
  if (dot <= 0) return null
  const page = pageModule(key.slice(0, dot))
  if (!page || !page.renderables[key]) return null
  return { page, tileKey: key }
}
