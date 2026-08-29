import { notFound } from 'next/navigation'
import { PrintRoot, printStyleFrom } from '@/components/print/print-root'
import { Slide } from '@/components/print/slide'
import { MethodNote } from '@/components/print/method-note'
import { PrintTile } from '@/components/print/print-tile'
import { Tile, TileBlock, StripCell } from '@/components/shell/tile'
import { StatValue, Delta } from '@/components/charts/stat'
import { Sparkline } from '@/components/charts/sparkline'
import { RankedBar } from '@/components/charts/ranked-bar'
import { Ring } from '@/components/charts/ring'

// Development-only fixture for the print frame: real shell and chart
// components, made-up numbers. `scripts/render-smoke.ts` prints it to PDF and
// PNG so the frame can be checked without a snapshot. 404 in production.

export default async function SmokePage({ searchParams }: { searchParams: Promise<{ style?: string; tile?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  const chrome = {
    context: 'Dashboard · Sealand · 23 Aug 2026',
    footer: (
      <MethodNote
        data={{ company: 'Sealand', period: 'Update of 23 Aug 2026', platforms: ['tiktok', 'instagram', 'youtube'], videos: 412, comments: 4950, note: 'A conversation is one video and the comments beneath it; a theme is heard when at least two conversations carry it.' }}
      />
    ),
  }
  const strip = (
    <Tile col={12} row={1} variant="strip">
      <StripCell eyebrow="Tracking"><StatValue size="sm">3</StatValue><span className="text-[11.5px] text-muted-foreground">brands · 4 keywords</span></StripCell>
      <StripCell eyebrow="Videos"><div className="flex items-end gap-3"><StatValue>412</StatValue><Sparkline values={[120, 180, 210, 260, 330, 412]} color="var(--you)" /></div><Delta value={82} good="up" unit="count" /></StripCell>
      <StripCell eyebrow="Comments"><div className="flex items-end gap-3"><StatValue>4,950</StatValue><Sparkline values={[900, 1800, 2400, 3100, 4200, 4950]} color="var(--you)" /></div><Delta value={750} good="up" unit="count" /></StripCell>
      <StripCell eyebrow="Themes heard"><StatValue>27</StatValue><span className="text-[11.5px] text-muted-foreground">9 confirmed · 11 early · 7 once</span></StripCell>
    </Tile>
  )
  if (sp.tile) {
    return (
      <PrintRoot style={printStyleFrom(sp.style)}>
        <PrintTile>{strip}</PrintTile>
      </PrintRoot>
    )
  }
  return (
    <PrintRoot style={printStyleFrom(sp.style)}>
      <Slide title="Where the conversation is" chrome={chrome} page={1} pages={2}>
        {strip}
        <Tile col={7} row={3} variant="hero" eyebrow="Executive brief" meta="9 confirmed themes" lead="Comfort on long wear is the conversation your market keeps having — and the one competitor answer to it is losing ground.">
          <p className="text-[12.5px] text-secondary-foreground">Three of the five strongest themes this update are about wear over time; two of them are new since July. The share ring on the right is the one figure that moved.</p>
          <TileBlock><p className="font-serif italic text-[12.5px]">“It gets really heavy to carry on your back after the first hour, which nobody tells you.”</p></TileBlock>
        </Tile>
        <Tile col={5} row={1} eyebrow="Audience sentiment" meta="1,204 judged">
          <div className="flex items-baseline gap-2"><StatValue>61%</StatValue><span className="text-[12px] text-muted-foreground">positive</span><Delta value={3} good="up" unit="pt" /></div>
        </Tile>
        <Tile col={5} row={2} eyebrow="Share of tracked conversation">
          <div className="flex items-center gap-4">
            <Ring segments={[{ label: 'You', value: 38, color: 'var(--you)' }, { label: 'Brand B', value: 27, color: 'var(--comp)' }, { label: 'Others', value: 35, color: 'var(--neutral-seg)' }]} center="38%" sub="you" />
            <ul className="flex flex-col gap-1 text-[12px]"><li>You · 38%</li><li>Brand B · 27%</li><li>Others · 35%</li></ul>
          </div>
        </Tile>
      </Slide>
      <Slide title="What your market is talking about" chrome={chrome} page={2} pages={2}>
        <Tile col={5} row={2} eyebrow="Themes" meta="by conversations">
          <div className="flex flex-col gap-1.5">
            <RankedBar label="Comfort on long wear" pct={100} color="var(--you)" count="41" />
            <RankedBar label="Strap durability" pct={70} color="var(--cat)" count="29" />
            <RankedBar label="Price vs. Brand B" pct={45} color="var(--comp)" count="18" />
          </div>
        </Tile>
        <Tile col={4} row={2} eyebrow="Since your first update"><p className="text-[12.5px]">Lead competitor: Brand B · share −4 pt</p></Tile>
        <Tile col={3} row={1} eyebrow="Top recommendation"><p className="text-[12.5px] font-medium">Answer the long-wear question in your own content.</p></Tile>
        <Tile col={3} row={1} eyebrow="On your accounts"><p className="text-[12.5px]">Instagram +212 followers</p></Tile>
      </Slide>
    </PrintRoot>
  )
}
