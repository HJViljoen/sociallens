import { ReportDeck } from '@/components/print/report-deck'
import { FitWidth } from '@/components/reports/fit-width'
import type { ReportSnapshotData } from '@/lib/reports/types'

// The Studio's preview: the same deck component the PDF is printed from,
// under the same .vb-print root, scaled to the pane. Server-rendered from
// the saved definition at the tenant's current data — what a build would
// freeze right now.
export function ReportPreview({ data }: { data: ReportSnapshotData }) {
  return (
    <FitWidth base={1123}>
      <div className="vb-print vb-preview" data-print-variant="b">
        <ReportDeck data={data} />
      </div>
    </FitWidth>
  )
}
