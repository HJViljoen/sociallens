import type { PageModule, Slide } from '../renderables/types'
import type { DeckSlide, ReportSection, ReportSnapshotData } from './types'

/**
 * From a page's own print pagination to a report's deck (Stage 2). A section
 * borrows the page's `slides(data, variant)` and keeps only the tiles it
 * named; a slide left with no tiles is dropped, a slide with fewer keeps its
 * layout (the grid reflows by data-col). Computed per-item keys (`voice.theme:2`)
 * belong to the page's `full` variant and pass through whenever the section
 * asked for `full`.
 */
export function sectionSlides(mod: Pick<PageModule<unknown>, 'slides'>, section: ReportSection, data: unknown): Slide[] {
  const all = mod.slides(data, section.variant ?? 'default')
  if (!section.keys) return all
  const wanted = new Set(section.keys)
  const out: Slide[] = []
  for (const s of all) {
    const keys = s.keys.filter((k) => wanted.has(k) || (k.includes(':') && section.variant === 'full'))
    if (keys.length) out.push({ ...s, keys })
  }
  return out
}

/** The whole deck: cover first, then every section's slides, numbered once
 *  across the report. `first` marks where the section's framing note goes. */
export function deckSlides(
  d: Pick<ReportSnapshotData, 'sections'>,
  moduleFor: (page: string) => Pick<PageModule<unknown>, 'slides'> | null,
): DeckSlide[] {
  const out: DeckSlide[] = [{ kind: 'cover', n: 1 }]
  let n = 1
  d.sections.forEach((sec, sectionIndex) => {
    const mod = moduleFor(sec.section.page)
    if (!mod) return
    sectionSlides(mod, sec.section, sec.data).forEach((slide, i) => {
      n += 1
      out.push({ kind: 'section', n, sectionIndex, slide, first: i === 0 })
    })
  })
  return out
}

/** Static keys only — the Studio's tile picker and the templates' contract. */
export const isStaticKey = (key: string): boolean => /^[a-z]+\.[A-Za-z]+$/.test(key)
