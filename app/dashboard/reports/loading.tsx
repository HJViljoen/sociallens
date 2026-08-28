import { PageFrame, PageBar } from '@/components/shell/page-grid'
import { Bone, BoneLines } from '@/components/shell/skeleton'

// Mirrors app/dashboard/reports/page.tsx as a page inside the page: rail ·
// list · detail. Widths match MasterDetail's defaults (20 / 34 / rest) so the
// real panes land in place.

function Pane({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={`flex min-h-0 flex-col overflow-hidden rounded-lg bg-tile shadow-tile ${className ?? ''}`}>{children}</section>
}

export default function Loading() {
  return (
    <PageFrame className="min-h-0 flex-1">
      <PageBar title="Reports" context={<Bone className="h-3 w-56" />} />
      <div className="flex min-h-0 flex-1 gap-3">
        <Pane className="hidden w-[20%] md:flex">
          <div className="border-b border-border/70 px-4 pt-3.5 pb-3"><Bone className="h-2.5 w-20" /></div>
          <div className="flex flex-col gap-1.5 p-3">
            {Array.from({ length: 6 }, (_, i) => <Bone key={i} className={i === 0 ? 'h-7 w-full' : 'h-7 w-[85%]'} />)}
          </div>
        </Pane>
        <Pane className="w-full md:w-[34%]">
          <div className="flex flex-col gap-2 border-b border-border/70 px-4 pt-3.5 pb-3"><Bone className="h-2.5 w-28" /><Bone className="h-8 w-full" /></div>
          <div className="flex flex-col gap-1 p-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded-[4px] px-3 py-2.5">
                <Bone className="h-3.5 w-[90%]" /><Bone className="h-2.5 w-[70%]" /><Bone className="h-4 w-24" />
              </div>
            ))}
          </div>
        </Pane>
        <Pane className="hidden flex-1 md:flex">
          <div className="flex flex-col gap-2 border-b border-border/70 px-5 pt-4 pb-3.5"><Bone className="h-2.5 w-24" /><Bone className="h-5 w-[80%]" /><Bone className="h-4 w-40" /></div>
          <div className="flex flex-col gap-4 px-5 py-4"><BoneLines lines={4} /><BoneLines lines={3} /><BoneLines lines={2} /></div>
        </Pane>
      </div>
    </PageFrame>
  )
}
