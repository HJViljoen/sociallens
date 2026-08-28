import { PageFrame, PageBar } from '@/components/shell/page-grid'
import { Bone, BoneLines } from '@/components/shell/skeleton'

// One skeleton for every page on the settings rail (components/settings-frame.tsx):
// the rail on the left, a content pane with `cards` blocks on the right.
export function SettingsSkeleton({ title, cards = 3 }: { title: string; cards?: number }) {
  return (
    <PageFrame className="min-h-0 flex-1">
      <PageBar title={title} context={<Bone className="h-3 w-32" />} />
      <div className="flex min-h-0 flex-col gap-3 md:h-[calc(100dvh_-_6.75rem)] md:flex-none md:flex-row">
        <section className="flex shrink-0 flex-col overflow-hidden rounded-lg bg-tile shadow-tile md:w-[220px]">
          <div className="border-b border-border/70 px-4 pt-3.5 pb-3"><Bone className="h-2.5 w-16" /></div>
          <div className="flex flex-col gap-1.5 p-3">
            {Array.from({ length: 5 }, (_, i) => <Bone key={i} className={i === 0 ? 'h-7 w-full' : 'h-7 w-[80%]'} />)}
          </div>
        </section>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-tile shadow-tile">
          <div className="flex items-center justify-between border-b border-border/70 px-4 pt-3.5 pb-3"><Bone className="h-2.5 w-28" /><Bone className="h-2.5 w-24" /></div>
          <div className="flex flex-col gap-3 px-5 py-4">
            {Array.from({ length: cards }, (_, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-md bg-inner px-4 py-3.5">
                <Bone className="h-3.5 w-32" /><Bone className="h-2.5 w-2/3" /><BoneLines lines={3} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </PageFrame>
  )
}
