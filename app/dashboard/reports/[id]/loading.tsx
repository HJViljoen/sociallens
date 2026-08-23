// Loading skeleton for app/dashboard/reports/[id]/page.tsx — a single stored report.

import { Bone } from '@/components/shell/skeleton'

export default function ReportLoading() {
  return (
    <div className="space-y-4">
      <span role="status" className="sr-only">Loading…</span>
      <div>
        <Bone className="h-3 w-24" />
        <Bone className="mt-1 h-6 w-2/3" />
        <Bone className="mt-1 h-3 w-1/3" />
      </div>

      <Bone className="h-[80vh] w-full rounded-xl border" />
    </div>
  )
}
