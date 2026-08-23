import { SkeletonPage, SkeletonTile, Bone, BoneLines, BoneBars } from '@/components/shell/skeleton'

// Mirrors app/dashboard/voice/page.tsx: the conversation by theme (8×4, a
// filter row, category tabs and the theme map) · gaining and fading (4×2) ·
// how your customers talk (4×1) · audience mood (4×1) · hear these voices
// (12×2, five quote cards across).
export default function VoiceLoading() {
  const blocks = ['col-span-3 row-span-2', 'col-span-2 row-span-2', 'col-span-2', 'col-span-2', 'col-span-3', 'col-span-2', 'col-span-2', 'col-span-2']
  return (
    <SkeletonPage title="Voice of Customer" pills={2}>
      <SkeletonTile col={8} row={4} meta>
        <div className="flex gap-2">
          <Bone className="h-7 w-32 rounded-md" />
          <Bone className="h-7 w-28 rounded-md" />
          <Bone className="h-7 w-24 rounded-md" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }, (_, i) => <Bone key={i} className="h-5 w-20 rounded-full" />)}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-3 gap-1.5">
          {blocks.map((c, i) => <Bone key={i} className={`h-full min-h-8 rounded-[6px] ${c}`} />)}
        </div>
      </SkeletonTile>

      <SkeletonTile col={4} row={2} meta>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Bone className="h-3 w-1/2" />
              <Bone className="ml-auto h-3 w-10" />
              <Bone className="h-3 w-8" />
            </div>
          ))}
        </div>
      </SkeletonTile>

      <SkeletonTile col={4} row={1} meta>
        <div className="flex flex-wrap gap-1.5">
          {['w-16', 'w-24', 'w-14', 'w-20', 'w-28', 'w-12', 'w-20'].map((w, i) => <Bone key={i} className={`h-5 rounded-full ${w}`} />)}
        </div>
      </SkeletonTile>

      <SkeletonTile col={4} row={1} meta>
        <BoneBars rows={3} />
      </SkeletonTile>

      <SkeletonTile col={12} row={2}>
        <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-5 sm:divide-x sm:divide-border/80">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2 sm:px-3 first:sm:pl-0">
              <Bone className="h-5 w-24 rounded-full" />
              <BoneLines lines={3} />
              <Bone className="mt-auto h-2.5 w-1/2" />
            </div>
          ))}
        </div>
      </SkeletonTile>
    </SkeletonPage>
  )
}
