import { SkeletonPage, SkeletonTile, Bone, BoneLines, BoneBars } from '@/components/shell/skeleton'

// Mirrors app/dashboard/voice/page.tsx (2026-08-28): the conversation by theme
// (8×4 — filter row, category tabs, the map) · the theme pane (4×4) · gaining
// and fading (4×2) · how your customers talk (4×2) · audience mood (4×2) ·
// hear these voices (12×2, five quote cards across).
export default function VoiceLoading() {
  const blocks = ['col-span-3 row-span-2', 'col-span-2 row-span-2', 'col-span-2', 'col-span-2', 'col-span-3', 'col-span-2', 'col-span-2', 'col-span-2']
  return (
    <SkeletonPage title="Voice of Customer" pills={1}>
      <SkeletonTile col={8} row={4} meta>
        <div className="flex gap-2">
          {Array.from({ length: 4 }, (_, i) => <Bone key={i} className="h-7 w-28 rounded-full" />)}
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }, (_, i) => <Bone key={i} className="h-5 w-20 rounded-md" />)}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-3 gap-1.5">
          {blocks.map((c, i) => <Bone key={i} className={`h-full w-full rounded-[6px] ${c}`} />)}
        </div>
      </SkeletonTile>
      <SkeletonTile col={4} row={4} meta>
        <Bone className="h-5 w-3/4" />
        <div className="flex gap-1.5"><Bone className="h-4 w-20 rounded-full" /><Bone className="h-4 w-16 rounded-full" /></div>
        <BoneLines lines={3} />
        <Bone className="h-6 w-24" />
        <Bone className="h-1.5 w-full rounded-full" />
        <BoneLines lines={5} />
      </SkeletonTile>
      <SkeletonTile col={4} row={2} meta><BoneBars rows={6} /></SkeletonTile>
      <SkeletonTile col={4} row={2} meta>
        <div className="flex flex-wrap gap-1">{Array.from({ length: 8 }, (_, i) => <Bone key={i} className="h-5 w-24 rounded-[4px]" />)}</div>
      </SkeletonTile>
      <SkeletonTile col={4} row={2} meta><BoneBars rows={3} /></SkeletonTile>
      <SkeletonTile col={12} row={2} meta>
        <div className="grid flex-1 grid-cols-5 gap-4">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2"><Bone className="h-4 w-24 rounded-full" /><BoneLines lines={3} /></div>
          ))}
        </div>
      </SkeletonTile>
    </SkeletonPage>
  )
}
