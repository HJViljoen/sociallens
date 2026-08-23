// Loading skeleton for app/dashboard/agent/[id]/page.tsx — a thread transcript (normal branch).

import { Bone, BoneLines } from '@/components/shell/skeleton'
import { Card, CardContent } from '@/components/ui/card'

export default function AgentThreadLoading() {
  return (
    <div className="space-y-6">
      <span role="status" className="sr-only">Loading…</span>
      <div>
        <Bone className="h-3 w-24" />
        <Bone className="mt-2 h-5 w-2/3" />
      </div>

      <div className="space-y-5">
        <BoneLines lines={2} />
        <Card className="bg-popover"><CardContent className="py-5"><BoneLines lines={5} /></CardContent></Card>
        <BoneLines lines={1} />
        <Card className="bg-popover"><CardContent className="py-5"><BoneLines lines={4} /></CardContent></Card>
      </div>

      <Bone className="h-14 w-full rounded-2xl" />
    </div>
  )
}
