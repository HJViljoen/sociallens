import Link from 'next/link'
import { ExternalLink, MessageSquareReply, ShieldAlert } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DetailOverlay } from '@/components/detail-overlay'
import { periodWindowDays } from '@/lib/config'
import {
  ENGAGE_CATEGORY_LABEL,
  engageDeepLink,
  engageVocab,
  loadEngageCandidates,
  rankEngageCandidates,
} from '@/lib/engage'

// "Worth a reply" — the engagement digest (2026-08-10, Anne's ask, weekly by
// design). Evidence-only v1: surfaces comments the analysis already cited under
// question / buying-signal insights, hard-limited to the update's own window
// (lib/engage.ts). Anchored on the latest COMPLETED run — unlike the page's
// corpus sections, this needs analysis output, so the two anchors can differ
// while a run is mid-flight. Misinformation renders apart, awareness-only:
// recommending a reply would invite a public argument under someone else's post.

const CATEGORY_CHIP: Record<string, string> = {
  purchase_intent: 'bg-positive/12 text-positive',
  question: 'bg-primary/10 text-primary',
  objection: 'bg-clay/10 text-clay',
  switching_signal: 'bg-clay/10 text-clay',
  buying_trigger: 'bg-positive/12 text-positive',
}

const quote = (text: string) => (text.length > 220 ? `${text.slice(0, 220)}…` : text)

/** audience_insights.theme is a snake_case machine slug — humanize before it
 *  reaches a client's eyes (dashboard-page precedent). */
const prettyTheme = (slug: string) => {
  const s = slug.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const windowLabel = (days: number) =>
  days === 7 ? 'the past week' : days === 30 ? 'the past month' : `the past ${days} days`

export async function EngageSection({
  supabase,
  clientId,
  detail,
}: {
  supabase: SupabaseClient
  clientId: string
  detail?: string
}) {
  // Latest completed analysis — nothing to digest before the first one.
  const { data: run } = await supabase
    .from('pipeline_runs')
    .select('id, started_at')
    .eq('client_id', clientId)
    .in('status', ['completed', 'partial'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!run) return null

  const { data: config } = await supabase
    .from('tracking_configs')
    .select('report_period, brand_keywords, competitor_keywords, industry_keywords')
    .eq('client_id', clientId)
    .maybeSingle()
  const windowDays = periodWindowDays((config?.report_period as string) ?? 'weekly')
  const windowStart = new Date(
    Date.parse(run.started_at as string) - windowDays * 86_400_000,
  ).toISOString()
  const vocab = engageVocab([config?.brand_keywords, config?.competitor_keywords, config?.industry_keywords])

  const candidates = await loadEngageCandidates(supabase, clientId, run.id as string)
  const engage = rankEngageCandidates(
    candidates.filter((c) => c.category !== 'misinformation'),
    { windowStart, vocab },
  )
  const flagged = rankEngageCandidates(
    candidates.filter((c) => c.category === 'misinformation'),
    { windowStart, perCategoryCap: 3, totalCap: 3, vocab },
  )
  if (engage.length === 0 && flagged.length === 0) return <EmptyDigest />

  // ?detail=engage-<insightId> → overlay with the full insight + its evidence.
  const detailInsightId = detail?.startsWith('engage-') ? detail.slice('engage-'.length) : null
  const detailCandidates = detailInsightId
    ? candidates.filter((c) => c.insightId === detailInsightId)
    : []
  const detailInsight = detailCandidates[0] ?? null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareReply className="size-4 text-primary" aria-hidden /> Worth a reply
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Questions and buying signals from conversations in {windowLabel(windowDays)} — each links
          to where it happened, so your team can join in.
        </p>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {engage.map((c) => {
          const link = engageDeepLink(c.comment)
          return (
            <div key={c.comment.id} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_CHIP[c.category] ?? 'bg-muted text-muted-foreground'}`}>
                    {ENGAGE_CATEGORY_LABEL[c.category] ?? c.category}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {c.comment.author ? `@${c.comment.author}` : 'Someone'}
                    {c.comment.account ? <> on @{c.comment.account}&rsquo;s post</> : null}
                    <span className="capitalize"> · {c.comment.platform}</span>
                    {c.comment.commentDate ? ` · ${c.comment.commentDate.slice(0, 10)}` : ''}
                    {c.comment.likes > 0 ? ` · ${c.comment.likes} likes` : ''}
                  </span>
                </div>
                <p className="mt-1 text-sm" title={c.comment.text}>&ldquo;{quote(c.comment.text)}&rdquo;</p>
                <Link
                  href={`/dashboard/videos?detail=engage-${c.insightId}`}
                  scroll={false}
                  className="mt-0.5 inline-block text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  Why it surfaced: {prettyTheme(c.theme)}
                </Link>
              </div>
              {link.href && (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-muted"
                >
                  {link.commentLevel ? 'Open comment' : 'Open post'}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </div>
          )
        })}

        {flagged.length > 0 && (
          <div className="mt-3 rounded-md border bg-muted/40 px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldAlert className="size-4 text-clay" aria-hidden /> Flagged for awareness
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Claims about the space that don&rsquo;t hold up. Better answered in your own
              content than argued under someone else&rsquo;s post.
            </p>
            <div className="mt-2 space-y-1.5">
              {flagged.map((c) => (
                <p key={c.comment.id} className="text-sm" title={c.comment.text}>
                  &ldquo;{quote(c.comment.text)}&rdquo;
                  <span className="ml-2 text-xs text-muted-foreground">
                    {c.comment.platform} · {c.comment.commentDate?.slice(0, 10) ?? ''}
                  </span>
                </p>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      {detailInsight && (
        <DetailOverlay closeHref="/dashboard/videos">
          <div className="space-y-3">
            <div>
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_CHIP[detailInsight.category] ?? 'bg-muted text-muted-foreground'}`}>
                {ENGAGE_CATEGORY_LABEL[detailInsight.category] ?? 'Flagged'}
              </span>
              <h3 className="mt-2 font-semibold">{prettyTheme(detailInsight.theme)}</h3>
              {detailInsight.description && (
                <p className="mt-1 text-sm text-muted-foreground">{detailInsight.description}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium uppercase text-muted-foreground">In their words</div>
              {detailCandidates.map((c) => (
                <p key={c.comment.id} className="text-sm">
                  &ldquo;{c.comment.text}&rdquo;
                  <span className="ml-2 text-xs text-muted-foreground">
                    {c.comment.author ? `@${c.comment.author} · ` : ''}
                    {c.comment.platform}
                  </span>
                </p>
              ))}
            </div>
          </div>
        </DetailOverlay>
      )}
    </Card>
  )
}

function EmptyDigest() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareReply className="size-4 text-primary" aria-hidden /> Worth a reply
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-6 text-sm text-muted-foreground">
        Nothing fresh to jump into this update — new conversations land with the next one.
      </CardContent>
    </Card>
  )
}
