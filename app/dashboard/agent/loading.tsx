// Loading skeleton for app/dashboard/agent/page.tsx — the centred composer stage.

import { Bone } from '@/components/shell/skeleton'

export default function AgentLoading() {
  return (
    <div className="agent-fixed relative flex-1 min-h-0">
      <span role="status" className="sr-only">Loading…</span>
      <div className="relative z-10 grid h-full place-items-center">
        <Bone className="mx-auto h-14 w-full max-w-2xl rounded-2xl" />
      </div>
      <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-3xl">
        <Bone className="h-10 w-full rounded-t-xl" />
      </div>
    </div>
  )
}
