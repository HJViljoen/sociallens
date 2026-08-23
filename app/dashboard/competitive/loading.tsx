import { SkeletonPage, SkeletonTile, Bone, BoneLines } from '@/components/shell/skeleton'

// Mirrors app/dashboard/competitive/page.tsx: the face-off (12×2, you | them
// over mirrored metric rows) · share of tracked conversation over time (7×4,
// a line chart) · what the voices say about the match-up (5×4).
export default function CompetitiveLoading() {
  return (
    <SkeletonPage title="Competitive Intelligence" pills={2}>
      <SkeletonTile col={12} row={2} eyebrow={false}>
        <div className="flex items-center justify-between gap-4">
          <Bone className="h-5 w-40" />
          <Bone className="h-3 w-24" />
          <Bone className="h-5 w-40" />
        </div>
        <div className="flex flex-1 flex-col justify-between gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
              <Bone className="h-3 w-full" />
              <Bone className="h-2.5 w-28" />
              <Bone className="h-3 w-full" />
            </div>
          ))}
        </div>
      </SkeletonTile>

      <SkeletonTile col={7} row={4}>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex gap-3">
            <Bone className="h-3 w-20" />
            <Bone className="h-3 w-24" />
          </div>
          <Bone className="min-h-0 flex-1 rounded-[6px]" />
          <div className="flex justify-between">
            {Array.from({ length: 5 }, (_, i) => <Bone key={i} className="h-2.5 w-10" />)}
          </div>
        </div>
      </SkeletonTile>

      <SkeletonTile col={5} row={4}>
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Bone className="h-4 w-16 rounded-full" />
                <Bone className="h-3.5 w-1/2" />
              </div>
              <BoneLines lines={2} />
              <div className="ml-3 border-l border-border/80 pl-3"><BoneLines lines={2} widths={['w-11/12', 'w-3/4']} /></div>
            </div>
          ))}
        </div>
      </SkeletonTile>
    </SkeletonPage>
  )
}
