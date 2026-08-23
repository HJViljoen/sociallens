import { SkeletonPage, SkeletonTile, Bone, BoneLines, BoneBars, BoneTable, BoneStat } from '@/components/shell/skeleton'

// Mirrors app/dashboard/videos/page.tsx: what works right now (7×3) · worth a
// reply (5×4) · the field this update (4×3, a four-column table) · top voices
// (3×3) · on your accounts (5×2).
export default function ContentLoading() {
  return (
    <SkeletonPage title="Content" pills={2}>
      <SkeletonTile col={7} row={3} meta>
        <div className="grid flex-1 grid-cols-2 gap-4">
          <BoneBars rows={4} />
          <BoneBars rows={4} />
          <div className="flex flex-col gap-2"><Bone className="h-2.5 w-20" /><BoneStat /></div>
          <div className="flex flex-col gap-2"><Bone className="h-2.5 w-20" /><BoneStat /></div>
        </div>
      </SkeletonTile>

      <SkeletonTile col={5} row={4} meta>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Bone className="h-4 w-16 rounded-full" />
                <Bone className="h-3 w-1/3" />
              </div>
              <BoneLines lines={2} />
            </div>
          ))}
        </div>
      </SkeletonTile>

      <SkeletonTile col={4} row={3} meta>
        <BoneTable rows={7} cols={4} />
      </SkeletonTile>

      <SkeletonTile col={3} row={3} meta>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Bone className="h-8 w-8 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Bone className="h-3 w-3/4" />
                <Bone className="h-2.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </SkeletonTile>

      <SkeletonTile col={5} row={2} meta>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Bone className="h-5 w-5 shrink-0 rounded-full" />
              <Bone className="h-6 flex-1" />
              <Bone className="h-4 w-14" />
            </div>
          ))}
          <Bone className="h-3 w-2/3" />
        </div>
      </SkeletonTile>
    </SkeletonPage>
  )
}
