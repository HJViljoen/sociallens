import { createAdminClient } from './supabase-admin'
import { sendReportEmail } from './email'
import {
  ENGAGE_CATEGORY_LABEL,
  engageDeepLink,
  engageVocab,
  loadEngageCandidates,
  rankEngageCandidates,
} from './engage'
import {
  computeRunDelta,
  loadRunSummary,
  readShare,
  type RunDelta,
  type RunSummaryRow,
  type ShareSide,
} from './report-delta'
import type { DeltaVerdict } from './report-bands'

// Weekly (or monthly) consumer-intelligence report (Redesign Spec §7).
//
// The email is the product's delta surface: it leads with "what changed since
// your last update" — sentiment shift, share shift, new themes, the top
// recommendation — computed from consecutive run_summary rows, and every item
// deep-links to its page section so the report drives logins without the site
// repeating its prose. A first report (no previous run_summary) leads with a
// "where you stand" baseline instead, so nothing renders half-empty.
//
// Client-facing language rules (§1) apply throughout: no pipeline jargon
// (run/scraped/analysed-videos), no raw confidence/opportunity scores.
//
// Sending goes through lib/email.ts (Resend, optional): with no provider the
// report is still built + stored to weekly_reports for the in-app Reports page.

// Matches the site's warm green-refresh tokens (app/globals.css :root) — the
// email must read as the same product: cream canvas, green-black ink, sage
// muted text, warm sand borders. No cool grays next to the green.
const GREEN = '#14503A'
const CREAM = '#F6F1E7'
const CARD = '#FDFAF3'
const INK = '#14291F'
const MUTED = '#5F6B5E'
const BORDER = '#E4DCCC'
const UP = '#2E8B5E'
const DOWN = '#B4472F'

// The app lives on the app. subdomain — the apex is the marketing site.
const DEFAULT_APP_URL = 'https://app.verbatimintel.com'
const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 }

interface ThemeItem {
  label: string
  description: string | null
  evidenceCount: number
  firstSeen: boolean
  slug: string | null
}
interface RecItem {
  title: string
  reasoning: string | null
  /** The verbatim comment the recommendation rests on. The app has shown this
   *  since 2026-07-07 and the site promises "every recommendation leads with a
   *  verbatim quote" — the email never selected the column until T0-10. */
  heroQuote: string | null
}
interface CompetitiveItem {
  competitorName: string | null
  title: string
  finding: string | null
}
/** A Step 2c owned-account event (Owned-Data-Plan): explained movement on the
 *  client's own accounts — the report carries the explanation, never metric rows. */
interface OwnedEventItem {
  platform: string
  magnitudeLabel: string
  explained: boolean
  explanation: string | null
  heroQuote: string | null
}

interface EngageItem {
  categoryLabel: string
  text: string
  platform: string
  href: string | null
}

interface ReportData {
  companyName: string
  period: 'weekly' | 'monthly'
  runDate: string
  weekStart: string
  weekEnd: string
  recipients: string[]
  appUrl: string
  summary: RunSummaryRow | null
  delta: RunDelta | null
  share: ShareSide | null
  themes: ThemeItem[]
  rec: RecItem | null
  competitive: CompetitiveItem | null
  ownedEvents: OwnedEventItem[]
  /** Top "worth a reply" comments (misinformation excluded by design — the
   *  email never nudges anyone toward a public correction fight). */
  engage: EngageItem[]
}

export interface ReportResult {
  reportId: string | null
  runId: string | null
  subject: string
  recipients: string[]
  sent: boolean
  reason?: string
}

/**
 * Build, send, and persist a client's report for a run.
 * @param clientId tenant
 * @param runId    pipeline run to report on; defaults to the latest completed/partial run
 * @param send     actually attempt email delivery (default true); when false the report is only stored
 */
export async function generateWeeklyReport(opts: {
  clientId: string
  runId?: string
  send?: boolean
}): Promise<ReportResult> {
  const { clientId } = opts
  const send = opts.send ?? true
  const admin = createAdminClient()

  const runId = await resolveRunId(admin, clientId, opts.runId)
  if (!runId) {
    return {
      reportId: null,
      runId: null,
      subject: '',
      recipients: [],
      sent: false,
      reason: 'no completed run to report on',
    }
  }

  // Idempotency (T0-6). The send used to happen first, with a plain insert
  // after it, inside a step that retries twice: a lost step response after a
  // successful send delivered the client a second copy of the same update.
  // Now the row is claimed FIRST (unique on client_id + run_id), so a retry
  // finds it and stops. An already-sent report is never re-sent.
  const existing = await admin
    .from('weekly_reports')
    .select('id, sent_at, subject, sent_to')
    .eq('client_id', clientId).eq('run_id', runId)
    .maybeSingle()
  if (existing.data?.sent_at) {
    return {
      reportId: existing.data.id as string,
      runId,
      subject: (existing.data.subject as string) ?? '',
      recipients: (existing.data.sent_to as string[]) ?? [],
      sent: true,
      reason: 'already sent for this run',
    }
  }

  const data = await buildReportData(admin, clientId, runId)
  const subject = reportSubject(data)
  const html = renderReportHtml(data, subject)
  const text = renderReportText(data, subject)

  // Claim the row before sending. On a retry after a crash mid-send this row
  // already exists with sent_at null, and the upsert refreshes its content
  // rather than colliding.
  const { data: claimed, error: claimErr } = await admin
    .from('weekly_reports')
    .upsert({
      client_id: clientId,
      run_id: runId,
      subject,
      html_content: html,
      week_start: data.weekStart,
      week_end: data.weekEnd,
      sent_to: [],
      sent_at: null,
    }, { onConflict: 'client_id,run_id' })
    .select('id')
    .maybeSingle()
  if (claimErr) throw new Error(`weekly_reports upsert: ${claimErr.message}`)
  const reportId = (claimed?.id as string) ?? null

  let sent = false
  if (send) {
    const res = await sendReportEmail({ to: data.recipients, subject, html, text })
    sent = res.sent
  }

  if (sent && reportId) {
    const { error: markErr } = await admin
      .from('weekly_reports')
      .update({ sent_to: data.recipients, sent_at: new Date().toISOString() })
      .eq('id', reportId)
    // A failed stamp is not a failed send: say so rather than throwing, which
    // would retry the step and send a second copy — the exact bug being fixed.
    if (markErr) console.error(`[report] sent but not stamped (${reportId}): ${markErr.message}`)
  }

  return {
    reportId,
    runId,
    subject,
    recipients: data.recipients,
    sent,
    reason:
      data.recipients.length === 0
        ? 'no report_emails configured'
        : sent
          ? undefined
          : 'email provider not configured, report stored only',
  }
}

/** Build the report (subject + html + text) without sending or persisting — for previews/tests. */
export async function previewWeeklyReport(opts: {
  clientId: string
  runId?: string
}): Promise<{ runId: string; subject: string; html: string; text: string; recipients: string[] } | null> {
  const admin = createAdminClient()
  const runId = await resolveRunId(admin, opts.clientId, opts.runId)
  if (!runId) return null
  const data = await buildReportData(admin, opts.clientId, runId)
  const subject = reportSubject(data)
  return {
    runId,
    subject,
    html: renderReportHtml(data, subject),
    text: renderReportText(data, subject),
    recipients: data.recipients,
  }
}

// Latest completed/partial run for a client, or the explicit one if given.
async function resolveRunId(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  explicit?: string,
): Promise<string | undefined> {
  if (explicit) return explicit
  const { data: run } = await admin
    .from('pipeline_runs')
    .select('id')
    .eq('client_id', clientId)
    .in('status', ['completed', 'partial'])
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  return (run?.id as string) ?? undefined
}

async function buildReportData(
  admin: ReturnType<typeof createAdminClient>,
  clientId: string,
  runId: string,
): Promise<ReportData> {
  const [clientRes, cfgRes, summary] = await Promise.all([
    admin.from('clients').select('company_name').eq('id', clientId).maybeSingle(),
    admin.from('tracking_configs').select('report_emails, report_period, brand_keywords, competitor_keywords, industry_keywords').eq('client_id', clientId).maybeSingle(),
    loadRunSummary(admin, clientId, runId),
  ])

  const [delta, recRes, themeRes, ciRes, eventsRes] = await Promise.all([
    summary ? computeRunDelta(admin, clientId, summary) : Promise.resolve(null),
    admin.from('recommendations')
      .select('title, reasoning, priority, hero_quote')
      .eq('client_id', clientId).eq('run_id', runId),
    admin.from('themes')
      .select('label, description, evidence_count, first_seen, member_themes')
      .eq('client_id', clientId).eq('run_id', runId).eq('single_source', false)
      // The three themes the client reads: widest-heard first (Tier 1).
      .order('rank_score', { ascending: false, nullsFirst: false })
      .order('evidence_count', { ascending: false })
      .limit(3),
    admin.from('competitive_insights')
      .select('competitor_name, title, finding, impact_level')
      .eq('client_id', clientId).eq('run_id', runId),
    admin.from('account_events')
      .select('platform, magnitude_label, explained, explanation, hero_quote, severity')
      .eq('client_id', clientId).eq('run_id', runId)
      .order('severity', { ascending: false })
      .limit(3),
  ])

  const recs = ((recRes.data ?? []) as {
    title: string; reasoning: string | null; priority: string | null; hero_quote: string | null
  }[]).map((r) => ({ title: r.title, reasoning: r.reasoning, priority: r.priority, heroQuote: r.hero_quote }))
  const rec =
    recs.sort((a, b) => (PRIORITY_RANK[b.priority ?? ''] ?? 0) - (PRIORITY_RANK[a.priority ?? ''] ?? 0))[0] ?? null

  const themes = ((themeRes.data ?? []) as {
    label: string; description: string | null; evidence_count: number
    first_seen: boolean; member_themes: string[]
  }[]).map((t) => ({
    label: t.label,
    description: t.description,
    evidenceCount: t.evidence_count,
    firstSeen: t.first_seen,
    slug: t.member_themes[0] ?? null,
  }))

  const comps = (ciRes.data ?? []) as {
    competitor_name: string | null; title: string; finding: string | null; impact_level: string | null
  }[]
  const topComp =
    comps.sort((a, b) => (PRIORITY_RANK[b.impact_level ?? ''] ?? 0) - (PRIORITY_RANK[a.impact_level ?? ''] ?? 0))[0] ?? null

  const period: 'weekly' | 'monthly' = cfgRes.data?.report_period === 'monthly' ? 'monthly' : 'weekly'
  const runDate = summary?.run_date ?? new Date().toISOString()
  const end = new Date(runDate)
  const start = new Date(end)
  start.setDate(end.getDate() - (period === 'monthly' ? 30 : 7))

  const recipients = ((cfgRes.data?.report_emails ?? []) as string[])
    .map((e) => e.trim())
    .filter(Boolean)

  // Top 3 "worth a reply" comments, same ranking + on-topic gate as the
  // Content page section.
  const engageCandidates = await loadEngageCandidates(admin, clientId, runId)
  const vocab = engageVocab([
    cfgRes.data?.brand_keywords, cfgRes.data?.competitor_keywords, cfgRes.data?.industry_keywords,
  ])
  const engage = rankEngageCandidates(
    engageCandidates.filter((c) => c.category !== 'misinformation'),
    { windowStart: start.toISOString(), totalCap: 3, vocab },
  ).map((c) => ({
    categoryLabel: ENGAGE_CATEGORY_LABEL[c.category] ?? c.category,
    text: c.comment.text.length > 180 ? `${c.comment.text.slice(0, 180)}…` : c.comment.text,
    // The commenter's handle is deliberately NOT carried into the email (T0-9):
    // the deep link is how a reply gets written, and an emailed handle is
    // personal data leaving the platform it was posted on.
    platform: c.comment.platform,
    href: engageDeepLink(c.comment).href,
  }))

  return {
    companyName: (clientRes.data?.company_name as string) || 'your brand',
    period,
    runDate,
    weekStart: start.toISOString().slice(0, 10),
    weekEnd: end.toISOString().slice(0, 10),
    recipients,
    appUrl: (process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/$/, ''),
    summary,
    delta,
    share: readShare(summary?.share_of_voice ?? null),
    themes,
    rec: rec ? { title: rec.title, reasoning: rec.reasoning, heroQuote: rec.heroQuote } : null,
    competitive: topComp
      ? { competitorName: topComp.competitor_name, title: topComp.title, finding: topComp.finding }
      : null,
    ownedEvents: ((eventsRes.data ?? []) as {
      platform: string; magnitude_label: string; explained: boolean
      explanation: string | null; hero_quote: string | null
    }[]).map((e) => ({
      platform: e.platform,
      magnitudeLabel: e.magnitude_label,
      explained: e.explained,
      explanation: e.explanation,
      heroQuote: e.hero_quote,
    })),
    engage,
  }
}

/**
 * Subject line. Names movement ONLY when it cleared the band (T0-8): the old
 * rule fired on any shift >= 0.5 pts, and the sent "sentiment up 6.2pts"
 * compared 129 judged videos against 414 (z ~ 1.7). "New themes" appears only
 * once the theme registry can tell a new theme from a relabel.
 */
function reportSubject(d: ReportData): string {
  const cadence = d.period === 'monthly' ? 'monthly' : 'weekly'
  if (!d.delta) return `${d.companyName}: your consumer intelligence baseline`
  const bits: string[] = []
  if (d.delta.newThemes && d.delta.newThemes.count > 0) {
    const n = d.delta.newThemes.count
    bits.push(`${n} new theme${n === 1 ? '' : 's'}`)
  }
  if (d.delta.sentiment && d.delta.sentiment.verdict.state === 'moved') {
    const s = d.delta.sentiment.verdict.change
    bits.push(`sentiment ${s > 0 ? 'up' : 'down'} ${Math.abs(s)}pts`)
  }
  return bits.length
    ? `${d.companyName}: what changed. ${bits.join(', ')}`
    : `${d.companyName}: your ${cadence} update`
}

// ---------- rendering ----------

/**
 * First sentence of a recommendation's reasoning, for the email (T0-10).
 *
 * The app shows the full rationale; the email leads with the action and needs
 * one line of why before the quote, or the quote falls below the fold on a
 * 390px phone. Ossur's live recommendations run to five sentences.
 * Abbreviations that end in a period are not sentence ends, and a reasoning
 * with no terminator at all is returned whole.
 */
export function firstSentence(text: string, maxChars = 240): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const match = trimmed.match(/^[\s\S]*?[.!?](?=\s|$)/)
  let out = match ? match[0].trim() : trimmed
  // Guard against an abbreviation ("e.g.", "vs.", "U.S.") cutting mid-thought.
  if (match && out.length < 40 && trimmed.length > out.length) {
    const second = trimmed.slice(out.length).match(/^\s*[\s\S]*?[.!?](?=\s|$)/)
    if (second) out = (out + second[0]).trim()
  }
  if (out.length > maxChars) out = `${out.slice(0, maxChars).trimEnd()}…`
  return out
}

const fmtNum = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 10_000 ? `${(n / 1_000).toFixed(0)}K`
  : n.toLocaleString('en-US')

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Neutral chip: a state, not a movement. */
function stateChip(text: string): string {
  return `<span style="display:inline-block;background:#ECE7DA;color:${MUTED};font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;white-space:nowrap">${escapeHtml(text)}</span>`
}

/**
 * Movement chip driven by the verdict, never by the raw difference (T0-8).
 * An arrow now means "this cleared a 2xSE band on denominators big enough to
 * carry it"; anything else says so in words.
 */
function changeChip(verdict: DeltaVerdict, unit: string): string {
  if (verdict.state === 'too_little_data') return stateChip('too little data')
  if (verdict.state === 'no_clear_change') return stateChip('no clear change')
  const up = verdict.change > 0
  const color = up ? UP : DOWN
  const bg = up ? '#E1E8DA' : '#F2DFD8'
  return `<span style="display:inline-block;background:${bg};color:${color};font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap">${up ? '▲' : '▼'} ${Math.abs(verdict.change)}${unit}</span>`
}

interface Row {
  label: string
  text: string
  chip?: string
  href?: string
  linkText?: string
}

function rowBlock(r: Row): string {
  const link = r.href
    ? `<div style="margin-top:4px"><a href="${r.href}" style="color:${GREEN};font-size:12px;font-weight:600;text-decoration:none">${escapeHtml(r.linkText ?? 'See the detail')} →</a></div>`
    : ''
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${BORDER}">
      <tr>
        <td style="padding:12px 0;vertical-align:top">
          <div style="font-size:11px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:.5px">${escapeHtml(r.label)}</div>
          <div style="font-size:14px;color:${INK};line-height:1.5;margin-top:3px">${r.text}</div>
          ${link}
        </td>
        ${r.chip ? `<td style="padding:12px 0 12px 12px;vertical-align:top;text-align:right;white-space:nowrap">${r.chip}</td>` : ''}
      </tr>
    </table>`
}

function sectionTitle(title: string): string {
  return `
    <div style="margin:22px 0 2px">
      <div style="font-size:13px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:.6px">${escapeHtml(title)}</div>
    </div>`
}

/** The lead block: "what changed" when a previous update exists, else "where you stand". */
function leadRows(d: ReportData): { title: string; rows: Row[] } {
  const rows: Row[] = []

  if (d.delta) {
    const { sentiment, share } = d.delta
    if (sentiment) {
      rows.push({
        label: 'Sentiment',
        text: `<strong>${sentiment.now}%</strong> of the ${fmtNum(sentiment.nowJudged)} videos we rated on audience reaction read positive`,
        chip: changeChip(sentiment.verdict, 'pts'),
        href: `${d.appUrl}/dashboard`,
        linkText: 'See where you stand',
      })
    }
    if (share) {
      const comp = share.now.competitor
      rows.push({
        label: 'Share of tracked videos',
        text: comp
          ? `You <strong>${share.now.client}%</strong> · ${escapeHtml(comp.name)} <strong>${comp.pct}%</strong> of ${fmtNum(share.now.totalVideos)} videos we track`
          : `You hold <strong>${share.now.client}%</strong> of the ${fmtNum(share.now.totalVideos)} videos we track`,
        chip: changeChip(share.verdict, 'pts'),
        href: `${d.appUrl}/dashboard/competitive`,
        linkText: 'See the competitive picture',
      })
    }
    // New themes and Coverage rows dropped from the lead (T0-10): the count of
    // new themes lives in the subject and as NEW badges on the themes below,
    // and a coverage count is not "what changed". The block keeps the two
    // measured proportions, each carrying its own verdict.
    const moved = [d.delta.sentiment?.verdict.state, d.delta.share?.verdict.state].includes('moved')
    return { title: moved ? 'What changed since your last update' : 'Where you stand this update', rows }
  }

  // First report — a baseline, framed as state. Sentiment comes from the
  // audience family only (T0-8): overall_sentiment_* on rows written before
  // 2026-08-18 blended in classify-meta's framing read.
  const audience = d.summary?.audience_sentiment ?? null
  if (audience?.positive != null && audience.judged > 0) {
    rows.push({
      label: 'Sentiment',
      text: `<strong>${audience.positive}%</strong> of the ${fmtNum(audience.judged)} videos we rated on audience reaction read positive`,
      href: `${d.appUrl}/dashboard`,
      linkText: 'See where you stand',
    })
  }
  if (d.share) {
    const comp = d.share.competitor
    rows.push({
      label: 'Share of tracked videos',
      text: comp
        ? `You <strong>${d.share.client}%</strong> · ${escapeHtml(comp.name)} <strong>${comp.pct}%</strong> of ${fmtNum(d.share.totalVideos)} videos we track`
        : `You hold <strong>${d.share.client}%</strong> of the ${fmtNum(d.share.totalVideos)} videos we track`,
      href: `${d.appUrl}/dashboard/competitive`,
      linkText: 'See the competitive picture',
    })
  }
  if (d.summary?.total_comments != null) {
    rows.push({
      label: 'Coverage',
      text: `<strong>${fmtNum(Number(d.summary.total_comments))}</strong> comments read across your market`,
    })
  }
  return { title: 'Where you stand', rows }
}

function renderReportHtml(d: ReportData, subject: string): string {
  const lead = leadRows(d)
  const cadence = d.period === 'monthly' ? 'monthly' : 'weekly'
  const showNewBadges = Boolean(d.delta?.newThemes)

  const themeItems = d.themes.map((t) => {
    const href = t.slug
      ? `${d.appUrl}/dashboard/voice?themes=${encodeURIComponent(t.slug)}`
      : `${d.appUrl}/dashboard/voice`
    const badge = showNewBadges && t.firstSeen
      ? ` <span style="display:inline-block;background:#E1E8DA;color:${GREEN};font-size:10px;font-weight:700;padding:1px 7px;border-radius:9px;vertical-align:2px">NEW</span>`
      : ''
    return `
      <div style="padding:11px 0;border-bottom:1px solid ${BORDER}">
        <div style="font-size:14px;font-weight:600;color:${INK}">
          <a href="${href}" style="color:${INK};text-decoration:none">${escapeHtml(t.label)}</a>${badge}
        </div>
        ${t.description ? `<div style="font-size:13px;color:${MUTED};line-height:1.5;margin-top:2px">${escapeHtml(t.description)}</div>` : ''}
        <div style="margin-top:4px">
          <a href="${href}" style="color:${GREEN};font-size:12px;font-weight:600;text-decoration:none">${t.evidenceCount} voice${t.evidenceCount === 1 ? '' : 's'} →</a>
        </div>
      </div>`
  }).join('')

  // The one action, FIRST (T0-10). It used to render third, below the stat
  // rows and the owned block, which on a 390px phone put the only thing to do
  // below the fold. Order now: what to do, the voice it rests on, then state.
  const recHtml = d.rec ? `
    ${sectionTitle('The one thing to act on')}
    <div style="background:${GREEN};border-radius:12px;padding:16px 18px;margin-top:8px">
      <div style="font-size:15px;font-weight:700;color:#FFFFFF;line-height:1.4">${escapeHtml(d.rec.title)}</div>
      ${d.rec.reasoning ? `<div style="font-size:13px;color:#CBDCD1;line-height:1.55;margin-top:6px">${escapeHtml(firstSentence(d.rec.reasoning))}</div>` : ''}
      ${d.rec.heroQuote ? `<div style="font-size:14px;font-style:italic;color:#FFFFFF;line-height:1.55;margin-top:12px;border-left:3px solid #7FA98F;padding-left:12px">&ldquo;${escapeHtml(d.rec.heroQuote)}&rdquo;</div>` : ''}
      <div style="margin-top:12px">
        <a href="${d.appUrl}/dashboard/market" style="color:#FFFFFF;font-size:12px;font-weight:700;text-decoration:none">Why this, why now →</a>
      </div>
    </div>` : ''

  // "On your account" (Owned-Data-Plan): explained events only — the report
  // carries the explanation, not metric rows. If every event is unexplained,
  // one honest line for the strongest; silence would hide it, a guess would lie.
  const PLATFORM_LABEL: Record<string, string> = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram' }
  const platformLabel = (p: string) => PLATFORM_LABEL[p] ?? p.charAt(0).toUpperCase() + p.slice(1)
  const explainedEvents = d.ownedEvents.filter((e) => e.explained && e.explanation)
  const ownedItems = explainedEvents.length
    ? explainedEvents.map((e) => `
      <div style="padding:11px 0;border-bottom:1px solid ${BORDER}">
        ${e.heroQuote ? `<div style="font-size:14px;font-style:italic;color:${INK};line-height:1.5;border-left:3px solid #BCD3C6;padding-left:10px">&ldquo;${escapeHtml(e.heroQuote)}&rdquo;</div>` : ''}
        <div style="font-size:14px;font-weight:600;color:${INK};margin-top:${e.heroQuote ? '8px' : '0'}">${escapeHtml(e.magnitudeLabel)}</div>
        <div style="font-size:13px;color:${MUTED};line-height:1.5;margin-top:2px">${escapeHtml(e.explanation ?? '')}</div>
        <div style="margin-top:4px">
          <a href="${d.appUrl}/dashboard/trends" style="color:${GREEN};font-size:12px;font-weight:600;text-decoration:none">See what moved →</a>
        </div>
      </div>`).join('')
    : d.ownedEvents.length
      ? `
      <div style="padding:11px 0;border-bottom:1px solid ${BORDER}">
        <div style="font-size:14px;font-weight:600;color:${INK}">${escapeHtml(d.ownedEvents[0].magnitudeLabel)}</div>
        <div style="font-size:13px;color:${MUTED};line-height:1.5;margin-top:2px">The conversation we track doesn't account for this move, so we flag it rather than guess at a cause. (${escapeHtml(platformLabel(d.ownedEvents[0].platform))})</div>
      </div>`
      : ''
  const ownedHtml = ownedItems ? `${sectionTitle('On your account')}${ownedItems}` : ''

  // "Worth a reply": fresh questions/buying signals with a link to the spot —
  // the report's only outward-pointing section (off-platform on purpose).
  const engageHtml = d.engage.length ? `
    ${sectionTitle('Worth a reply')}
    ${d.engage.map((e) => rowBlock({
      label: e.categoryLabel,
      text: `&ldquo;${escapeHtml(e.text)}&rdquo; <span style="color:${MUTED}">· ${escapeHtml(platformLabel(e.platform))}</span>`,
      href: e.href ?? undefined,
      linkText: 'Join the conversation',
    })).join('')}` : ''

  const compHtml = d.competitive ? `
    ${sectionTitle('Competitive signal')}
    ${rowBlock({
      label: d.competitive.competitorName ? `vs ${d.competitive.competitorName}` : 'Competitors',
      text: `<strong>${escapeHtml(d.competitive.title)}</strong>${d.competitive.finding ? `. ${escapeHtml(d.competitive.finding)}` : ''}`,
      href: `${d.appUrl}/dashboard/competitive`,
      linkText: 'See the full picture',
    })}` : ''

  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:${CREAM};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK}">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(subject)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${CARD};border-radius:14px;overflow:hidden;border:1px solid ${BORDER}">
          <tr><td style="background:${GREEN};padding:24px 28px">
            <div style="color:${CREAM};font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;opacity:.9">Verbatim · Consumer Intelligence</div>
            <div style="color:#FFFFFF;font-size:20px;font-weight:700;margin-top:8px">${escapeHtml(d.companyName)}: ${escapeHtml(lead.rows.length ? lead.title.toLowerCase() : `your ${cadence} update`)}</div>
            <div style="color:#BCD3C6;font-size:13px;margin-top:4px">Data through ${escapeHtml(fmtDate(d.runDate))}</div>
          </td></tr>
          <tr><td style="padding:8px 24px 22px">
            ${recHtml}
            ${lead.rows.length ? `${sectionTitle(lead.title)}${lead.rows.map(rowBlock).join('')}` : ''}
            ${ownedHtml}
            ${engageHtml}
            ${d.themes.length ? `${sectionTitle(d.delta ? 'Themes worth a look' : 'What your market is talking about')}${themeItems}` : ''}
            ${compHtml}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 4px">
              <tr><td align="center">
                <a href="${d.appUrl}/dashboard" style="display:inline-block;background:${GREEN};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:10px">
                  Open your dashboard
                </a>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:16px 28px;border-top:1px solid ${BORDER}">
            <div style="font-size:12px;color:${MUTED};line-height:1.5">Verbatim. Consumer intelligence, in their own words. You're receiving this because your team gets ${cadence} updates.</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

function renderReportText(d: ReportData, subject: string): string {
  const lead = leadRows(d)
  const strip = (html: string) => html.replace(/<[^>]+>/g, '')
  const lines: string[] = [subject, `Data through ${fmtDate(d.runDate)}`, '']
  // Same order as the HTML: the action first, then state.
  if (d.rec) {
    lines.push('THE ONE THING TO ACT ON', `- ${d.rec.title}`)
    if (d.rec.reasoning) lines.push(`  ${firstSentence(d.rec.reasoning)}`)
    if (d.rec.heroQuote) lines.push(`  "${d.rec.heroQuote}"`)
    lines.push('')
  }
  if (lead.rows.length) {
    lines.push(lead.title.toUpperCase())
    for (const r of lead.rows) lines.push(`- ${r.label}: ${strip(r.text)}`)
    lines.push('')
  }
  const explained = d.ownedEvents.filter((e) => e.explained && e.explanation)
  if (explained.length || d.ownedEvents.length) {
    lines.push('ON YOUR ACCOUNT')
    if (explained.length) {
      for (const e of explained) {
        lines.push(`- ${e.magnitudeLabel}`)
        if (e.explanation) lines.push(`  ${e.explanation}`)
        if (e.heroQuote) lines.push(`  "${e.heroQuote}"`)
      }
    } else {
      lines.push(`- ${d.ownedEvents[0].magnitudeLabel}. The conversation we track doesn't account for this move, so we flag it rather than guess at a cause.`)
    }
    lines.push('')
  }
  if (d.engage.length) {
    lines.push('WORTH A REPLY')
    for (const e of d.engage) {
      // No handle: the thread link is the way back to the person (T0-9).
      lines.push(`- [${e.categoryLabel}] "${e.text}" (${e.platform})`)
      if (e.href) lines.push(`  ${e.href}`)
    }
    lines.push('')
  }
  if (d.themes.length) {
    lines.push(d.delta ? 'THEMES WORTH A LOOK' : 'WHAT YOUR MARKET IS TALKING ABOUT')
    for (const t of d.themes) lines.push(`- ${t.label} (${t.evidenceCount} voices)`)
    lines.push('')
  }
  if (d.competitive) {
    lines.push('COMPETITIVE SIGNAL', `- ${d.competitive.title}`)
    lines.push('')
  }
  lines.push(`Open your dashboard: ${d.appUrl}/dashboard`)
  return lines.join('\n')
}
