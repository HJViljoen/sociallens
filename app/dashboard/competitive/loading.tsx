import { PageFrame, PageGrid, PageBar } from '@/components/shell/page-grid'
import { SkeletonTile, Bone, BoneLines, BoneBars } from '@/components/shell/skeleton'

// Mirrors app/dashboard/competitive/page.tsx: the overview tiles (standings
// 4×3 · face-off 8×3 · share line 7×2 · full comparison 5×2), then the
// findings as rail · list · detail beneath.

function Pane({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={`flex min-h-0 flex-col overflow-hidden rounded-lg bg-tile shadow-tile ${className ?? ''}`}>{children}</section>
}

export default function Loading() {
  return (
    <PageFrame className="min-h-0 flex-1">
      <PageBar title="Competitive Intelligence" context={<Bone className="h-3 w-56" />} />
      <PageGrid>
        <SkeletonTile col={4} row={3} meta>
          <Bone className="h-8 w-28" />
          <BoneBars rows={5} />
        </SkeletonTile>
        <SkeletonTile col={8} row={3} meta>
          <div className="flex justify-between"><Bone className="h-4 w-32" /><Bone className="h-4 w-32" /></div>
          <BoneBars rows={6} />
        </SkeletonTile>
        <SkeletonTile col={7} row={2} meta><Bone className="h-full w-full" /></SkeletonTile>
        <SkeletonTile col={5} row={2} meta><BoneLines lines={5} /></SkeletonTile>
      </PageGrid>
      <div className="flex min-h-0 gap-3 md:h-[600px] md:flex-none">
        <Pane className="hidden w-[20%] md:flex">
          <div className="border-b border-border/70 px-4 pt-3.5 pb-3"><Bone className="h-2.5 w-20" /></div>
          <div className="flex flex-col gap-1.5 p-3">
            {Array.from({ length: 6 }, (_, i) => <Bone key={i} className={i === 0 ? 'h-7 w-full' : 'h-7 w-[85%]'} />)}
          </div>
        </Pane>
        <Pane className="w-full md:w-[34%]">
          <div className="flex flex-col gap-2 border-b border-border/70 px-4 pt-3.5 pb-3"><Bone className="h-2.5 w-28" /><Bone className="h-8 w-full" /></div>
          <div className="flex flex-col gap-1 p-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded-[4px] px-3 py-2.5">
                <Bone className="h-3.5 w-[90%]" /><Bone className="h-2.5 w-[70%]" /><Bone className="h-4 w-24" />
              </div>
            ))}
          </div>
        </Pane>
        <Pane className="hidden flex-1 md:flex">
          <div className="flex flex-col gap-2 border-b border-border/70 px-5 pt-4 pb-3.5"><Bone className="h-2.5 w-24" /><Bone className="h-5 w-[80%]" /><Bone className="h-4 w-40" /></div>
          <div className="flex flex-col gap-4 px-5 py-4"><BoneLines lines={4} /><BoneLines lines={3} /></div>
        </Pane>
      </div>
    </PageFrame>
  )
}
