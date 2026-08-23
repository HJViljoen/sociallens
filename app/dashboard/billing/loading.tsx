// Loading skeleton for app/dashboard/billing/page.tsx — plan status + billing controls.

import { Bone, BoneLines } from '@/components/shell/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export default function BillingLoading() {
  return (
    <div className="space-y-6">
      <span role="status" className="sr-only">Loading…</span>
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <Bone className="mt-1 h-3 w-40" />
      </div>

      <Card>
        <CardHeader className="flex items-center gap-2">
          <Bone className="size-4 rounded" />
          <Bone className="h-4 w-40" />
        </CardHeader>
        <CardContent className="space-y-4">
          <BoneLines lines={2} />
          <Bone className="h-8 w-32 rounded-lg" />
        </CardContent>
      </Card>
    </div>
  )
}
