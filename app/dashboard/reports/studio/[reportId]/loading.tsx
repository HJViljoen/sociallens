import { PageFrame, PageBar } from '@/components/shell/page-grid'
import { Bone, BoneLines } from '@/components/shell/skeleton'

// Mirrors the Studio: outline pane (380px) · preview pane.
export default function Loading() {
  return (
    <PageFrame className="min-h-0 flex-1">
      <PageBar title={<Bone className="h-4 w-48" /> as unknown as string} context={<Bone className="h-3 w-40" />} />
      <div className="flex min-h-0 flex-1 gap-3 md:h-[calc(100dvh_-_6.75rem)]">
        <section className="hidden min-h-0 flex-col overflow-hidden rounded-lg bg-tile shadow-tile md:flex md:w-[380px] md:shrink-0">
          <div className="border-b border-border/70 px-4 pt-3.5 pb-3"><Bone className="h-2.5 w-20" /></div>
          <div className="flex flex-col gap-3 p-3"><Bone className="h-8 w-full" /><Bone className="h-8 w-full" />{Array.from({ length: 4 }, (_, i) => <Bone key={i} className="h-10 w-full" />)}</div>
        </section>
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-tile shadow-tile">
          <div className="border-b border-border/70 px-4 pt-3.5 pb-3"><Bone className="h-2.5 w-24" /></div>
          <div className="flex flex-col gap-4 bg-inner p-4"><Bone className="aspect-[297/167] w-full" /><BoneLines lines={2} /></div>
        </section>
      </div>
    </PageFrame>
  )
}
