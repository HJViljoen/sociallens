import type { DocumentSnapshotData } from './types'

/**
 * What the overview says, derived from the document itself (T10, 2026-08-31).
 *
 * The three numbers, the in-short paragraph and the finding headlines are not
 * fields on the snapshot: they are read off the pages, so an edit flows
 * through. The printed deck and the email both read them HERE, so the paper
 * and the email can never drift apart.
 */

export interface OverviewTile {
  value: string
  label: string
}

/** The standing page packs its party names as JSON (a name may carry any
 *  separator we could have chosen). Anything unparseable degrades to none. */
function standingParties(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '')

/** The three numbers: conversations read, share of tracked conversation
 *  (paired with the first competitor when there is one), positive of judged.
 *  A number the run could not measure is simply absent. */
export function overviewTiles(data: DocumentSnapshotData): OverviewTile[] {
  const f = data.figures
  // The name to set the share against: the first competitor with a page, or,
  // for a template that prints none (the leadership brief's standing page),
  // the first one the standing page lists. A share with nothing beside it is
  // a number without a scale.
  const competitor =
    data.pages.find((p) => p.kind === 'competitor')?.meta?.name
    ?? standingParties(data.pages.find((p) => p.kind === 'standing')?.meta?.parties)[1]
  const compKey = competitor ? `${slugOf(competitor)}_share_pct` : null
  return [
    f.conversations && { value: f.conversations.value, label: `conversations read this update${f.videos ? `, on ${f.videos.value} videos` : ''}` },
    f.client_share_pct && {
      value: f.client_share_pct.value,
      label: compKey && f[compKey] ? `${data.company}'s share of tracked conversation · ${competitor} ${f[compKey].value}` : `${data.company}'s share of tracked conversation`,
    },
    f.positive_pct && { value: f.positive_pct.value, label: 'positive, of the conversations judged for tone' },
  ].filter(Boolean) as OverviewTile[]
}

/** The finding headlines, in page order — from the finding pages themselves,
 *  never the overview's own written-once list, so an edited headline shows. */
export function findingHeadlines(data: DocumentSnapshotData): string[] {
  return data.pages
    .filter((p) => p.kind === 'finding')
    .map((p) => p.blocks.find((b) => b.field === 'headline')?.text ?? '')
    .filter(Boolean)
}

/** The in-short paragraph, still carrying its [[key]] placeholders. */
export function inShortSummary(data: DocumentSnapshotData): string {
  const page = data.pages.find((p) => p.kind === 'in_short')
  return page?.blocks.find((b) => b.field === 'summary')?.text ?? ''
}
