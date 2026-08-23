// Loading skeleton for app/dashboard/reports/page.tsx — the reports archive list.

import { Bone } from '@/components/shell/skeleton'
import { Card, CardContent } from '@/components/ui/card'

export default function ReportsLoading() {
  return (
    <div className="space-y-6">
      <span role="status" className="sr-only">Loading…</span>
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
      </div>

      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i}>
            <CardContent className="py-4">
              <div className="flex items-baseline justify-between gap-4">
                <Bone className="h-4 w-1/3" />
                <Bone className="h-3 w-20" />
              </div>
              <div className="mt-1 flex justify-between">
                <Bone className="h-3 w-1/4" />
                <Bone className="h-3 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
