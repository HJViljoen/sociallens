import { SkeletonPage, SkeletonTile, Bone, BoneLines } from '@/components/shell/skeleton'

// Mirrors app/dashboard/market/page.tsx: what to do (5×6) · the short read
// (7×2) · what you say vs what they hear (7×2) · key insights (4×2) · said
// about you (3×1) · in the news (3×1).
export default function MarketLoading() {
  return (
    <SkeletonPage title="Market Intelligence" pills={1}>
      <SkeletonTile col={5} row={6} meta>
        <div className="flex flex-col gap-3">
          <Bone className="h-4 w-5/6" />
          <div className="flex gap-2">
            <Bone className="h-5 w-20 rounded-full" />
            <Bone className="h-5 w-16 rounded-full" />
          </div>
          <BoneLines lines={4} />
          <Bone className="h-3 w-24" />
        </div>
        <div className="mt-2 flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Bone className="h-3 w-4" />
              <Bone className="h-3 flex-1" />
              <Bone className="h-3 w-10" />
              <Bone className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </SkeletonTile>

      <SkeletonTile col={7} row={2}>
        <div className="grid flex-1 grid-cols-2 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Bone className="h-2.5 w-20" />
              <BoneLines lines={2} />
            </div>
          ))}
        </div>
      </SkeletonTile>

      <SkeletonTile col={7} row={2}>
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="grid grid-cols-[1fr_108px_1.3fr] gap-3">
              <Bone className="h-3 w-full" />
              <Bone className="h-3 w-16" />
              <Bone className="h-3 w-5/6" />
            </div>
          ))}
        </div>
      </SkeletonTile>

      <SkeletonTile col={4} row={2}>
        <div className="flex flex-col gap-4">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Bone className="h-3.5 w-2/3" />
              <BoneLines lines={2} />
            </div>
          ))}
        </div>
      </SkeletonTile>

      <SkeletonTile col={3} row={1} lines={3} />
      <SkeletonTile col={3} row={1} meta>
        <Bone className="h-5 w-24 rounded-full" />
        <BoneLines lines={2} />
      </SkeletonTile>
    </SkeletonPage>
  )
}
