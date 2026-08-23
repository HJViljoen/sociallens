// Loading skeleton for app/dashboard/team/page.tsx — members, invites, roster.

import { Bone, BoneLines } from '@/components/shell/skeleton'
import { Card, CardContent } from '@/components/ui/card'

export default function TeamLoading() {
  return (
    <div className="space-y-6 max-w-3xl">
      <span role="status" className="sr-only">Loading…</span>
      <div>
        <h1 className="text-2xl font-bold">Team</h1>
        <Bone className="mt-1 h-3 w-32" />
      </div>

      <Card>
        <CardContent className="space-y-3">
          <Bone className="h-2.5 w-24" />
          <Bone className="h-8 w-full rounded-lg" />
          <Bone className="h-8 w-28 rounded-lg" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Bone className="h-3.5 w-1/3" />
                <Bone className="h-3 w-1/2" />
              </div>
              <Bone className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <BoneLines lines={2} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Bone className="h-3.5 w-1/2" />
                <Bone className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
