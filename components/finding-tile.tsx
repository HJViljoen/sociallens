import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { categoryTint, PREVALENCE_BADGE } from '@/lib/ui-colors'
import { PREVALENCE_LABEL, glossaryRule, type PrevalenceTier } from '@/lib/calibration'

// A supporting "finding" tile — a category-tinted, evidence-anchored theme card
// that routes to its voices. Extracted prop-driven from the Dashboard's top-theme
// cards so Voice/Market can share the same tile. Prevalence badge is optional
// (rendered only when a calibrated tier is supplied).

export interface Finding {
  label: string
  description: string
  category: string
  /** Where the tile routes (e.g. /dashboard/voice?themes=…). */
  href: string
  /** e.g. "in 42 conversations" — already computed + calibrated by the caller. */
  evidenceLabel: string
  ctaLabel?: string
  /** 1-based editorial numeral; omit to hide. */
  rank?: number
  isNew?: boolean
  prevalence?: PrevalenceTier | null
}

export function FindingTile({ finding }: { finding: Finding }) {
  const { label, description, category, href, evidenceLabel, ctaLabel = 'hear these voices →', rank, isNew, prevalence } = finding
  return (
    <Link href={href} className="group">
      <Card className="h-full transition-colors group-hover:bg-muted/30">
        <CardHeader className="pb-2">
          <div className="flex items-start gap-3">
            {rank != null && (
              <span className="text-3xl font-bold leading-none text-muted-foreground/40" aria-hidden>{rank}</span>
            )}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${categoryTint(category)}`}>
                  {category.replace(/_/g, ' ')}
                </span>
                {prevalence && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PREVALENCE_BADGE[prevalence]}`}>
                    {PREVALENCE_LABEL[prevalence]}
                  </span>
                )}
                {isNew && (
                  <span title={glossaryRule('new')} className="px-2 py-0.5 rounded-full text-xs font-semibold bg-warning/15 text-warning">
                    New
                  </span>
                )}
              </div>
              <CardTitle className="text-sm">{label}</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">{description}</p>
          <p className="text-[10px] text-muted-foreground">
            {evidenceLabel} · <span className="font-medium text-foreground">{ctaLabel}</span>
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}
