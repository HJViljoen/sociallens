import { SkeletonPage, SkeletonStrip, SkeletonTile, Bone, BoneLines, BoneStat, BoneBars } from '@/components/shell/skeleton'

// Mirrors app/dashboard/page.tsx tile for tile: strip · executive brief (hero,
// 7×3) · sentiment (5×1) · share of conversation (5×2) · what the market is
// talking about (5×2) · movement since the first update (4×2) · top
// recommendation (3×1) · your accounts (3×1).
export default function DashboardLoading() {
  return (
    <SkeletonPage title="Dashboard" pills={1}>
      <SkeletonStrip cells={5} />

      <SkeletonTile col={7} row={3} variant="hero" meta>
        <div className="flex flex-col gap-3">
          <Bone tone="dark" className="h-5 w-4/5" />
          <BoneLines tone="dark" lines={4} />
        </div>
        <div className="mt-auto flex flex-col gap-2">
          <Bone tone="dark" className="h-3 w-2/3" />
          <Bone tone="dark" className="h-3 w-1/2" />
        </div>
      </SkeletonTile>

      <SkeletonTile col={5} row={1} meta>
        <div className="flex items-center gap-4">
          <BoneStat size="lg" />
          <Bone className="h-2.5 flex-1" />
        </div>
      </SkeletonTile>

      <SkeletonTile col={5} row={2} meta>
        <div className="flex items-center gap-5">
          <Bone className="h-[92px] w-[92px] shrink-0 rounded-full" />
          <BoneBars rows={3} />
        </div>
      </SkeletonTile>

      <SkeletonTile col={5} row={2} meta>
        <BoneBars rows={5} />
      </SkeletonTile>

      <SkeletonTile col={4} row={2}>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <Bone className="h-3 w-1/3" />
              <Bone className="h-3 w-12" />
            </div>
          ))}
        </div>
      </SkeletonTile>

      <SkeletonTile col={3} row={1} meta lines={2} />

      <SkeletonTile col={3} row={1} meta>
        <div className="flex items-center gap-3">
          <BoneStat />
          <Bone className="h-6 flex-1" />
        </div>
      </SkeletonTile>
    </SkeletonPage>
  )
}
