import { fmtInt } from '@/lib/format'

// The method-note footer on every printed slide (spec §4): period, sources,
// sample sizes, one How-to-read line. It is what makes a page read as
// research rather than a dashboard print — the reader has no glossary drawer.
// Client-led: the artifact is the operator's work; Verbatim is provenance.

export interface MethodNoteData {
  company: string
  /** e.g. "Update of 23 Aug 2026" or "Week to 23 Aug 2026". */
  period: string
  platforms: string[]
  videos: number | null
  comments: number | null
  /** One calibrated line from the page's glossary, e.g. how "conversations" are counted. */
  note?: string | null
}

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram', reddit: 'Reddit',
}

export function MethodNote({ data }: { data: MethodNoteData }) {
  const parts: string[] = [data.period]
  if (data.platforms.length) parts.push(data.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(', '))
  if (data.videos != null) parts.push(`${fmtInt(data.videos)} videos`)
  if (data.comments != null) parts.push(`${fmtInt(data.comments)} comments`)
  return (
    <div className="flex min-w-0 flex-col gap-0.5 font-mono text-[9.5px] leading-[1.35] text-muted-foreground">
      <p className="truncate">
        <span className="text-secondary-foreground">Prepared by {data.company}</span>
        <span aria-hidden> · </span>
        <span>with Verbatim</span>
        <span aria-hidden> · </span>
        {parts.join(' · ')}
      </p>
      {data.note && <p className="truncate">{data.note}</p>}
    </div>
  )
}
