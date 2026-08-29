import { PAGES } from '../../components/pages/registry'
import { isStaticKey } from './compose'
import { SECTION_PAGES } from './types'
import type { PageKey } from '../renderables/types'

/** The Studio's picker: every page and its STATIC tiles, from the registry —
 *  the same catalogue the export menu and the render route use. Computed
 *  per-item keys never appear (they index loaded data). Plain data, so it can
 *  cross to the client outline. */
export interface CataloguePage {
  page: PageKey
  title: string
  tiles: { key: string; title: string }[]
}

export function studioCatalogue(): CataloguePage[] {
  const out: CataloguePage[] = []
  for (const page of SECTION_PAGES) {
    const mod = PAGES[page]
    if (!mod) continue
    const tiles = Object.keys(mod.renderables)
      .filter(isStaticKey)
      .map((key) => ({ key, title: mod.renderables[key].title }))
    out.push({ page, title: mod.title, tiles })
  }
  return out
}

export const catalogueTitle = (page: string): string => PAGES[page as PageKey]?.title ?? page
