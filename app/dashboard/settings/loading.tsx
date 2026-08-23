// Loading skeleton for app/dashboard/settings/page.tsx — connected accounts + tracking config form.

import { Bone } from '@/components/shell/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export default function SettingsLoading() {
  return (
    <div className="space-y-6">
      <span role="status" className="sr-only">Loading…</span>
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <Bone className="mt-1 h-3 w-40" />
      </div>

      <Card>
        <CardHeader>
          <Bone className="h-4 w-32" />
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Bone key={i} className="h-7 w-24 rounded-full" />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-1.5">
              <Bone className="h-2.5 w-24" />
              <Bone className="h-8 w-full rounded-lg" />
            </div>
          ))}
          <Bone className="h-8 w-28 rounded-lg" />
        </CardContent>
      </Card>
    </div>
  )
}
