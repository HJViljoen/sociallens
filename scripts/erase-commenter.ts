import { createHash } from 'node:crypto'
import { createAdminClient, selectAll } from '../lib/supabase-admin'
import { authorKey, handleVariants } from '../lib/gather/suppression'
import { deleteCommentsProperly } from '../lib/retention/youtube-refresh-io'
import { AI_LOG_BODY_RETENTION_DAYS, DEMO_CLIENT_ID } from '../lib/config'

// Erase one commenter on request (Tier 1.5, 2026-08-22). The privacy notice
// says: write with the handle and platform and we will remove the comments tied
// to it, within 7 days. This is the runbook, as code. Dry-run by default; the
// SLA is met by running it, not by promising it.
//
//   node --env-file=.env.local --import tsx scripts/erase-commenter.ts \
//     --platform youtube --handle "@someone" [--apply] [--note "ticket/email ref"]
//
// What it touches, in order:
//   1. comments rows on that platform whose author matches the handle
//      (case-insensitive, with or without a leading '@'), across EVERY tenant.
//   2. the demo tenant's clone of those rows. The clone keeps platform +
//      comment_id unchanged, so it is found by THAT (verified on prod: 156/156
//      YouTube clones match by comment_id, 0 by pseudonym — source author
//      strings changed shape when YouTube moved from Apify to the API). The
//      pseudonym is only a secondary net: the Tier 0 migration hashed with md5
//      (20260820130000_demo_pseudonymise.sql), a re-seed hashes with sha256
//      (scripts/seed-demo.ts) — both shapes are tried.
//   3. what the delete cascades: insight_evidence and language_samples (FKs),
//      counted so the reply can say how many insights lost a quote.
//   4. hero_quote copies in recommendations / market_insights /
//      competitive_insights / account_events (no FK — verbatim text that would
//      otherwise survive), nulled where they quote one of the erased comments.
//   5. ai_call_log prompt bodies inside the 30-day window that carry the text
//      (older bodies are already stripped by the retention sweep), nulled.
//   6. a suppressed_commenters row per key variant, so a re-scrape never brings
//      the handle back (lib/gather/suppression.ts filters at ingest).
//   7. weekly_reports.html_content — the stored copy of every report we sent —
//      scrubbed of the erased text (raw and HTML-escaped forms), best-effort.
//   7b. plan_checks / plan_check_evaluations — an Ask answer's `theySay` is
//      model prose written after the model was shown real comments, so it can
//      carry the commenter's words even though no quote field is stored.
//      Scrubbed the same way. (The insight ids those rows store resolve through
//      evidence rows already deleted in step 3, so the live quote panel goes
//      empty on its own.)
// video_raw is not touched: it never carries comment items (only video-search
// and transcribe payloads).
// What it cannot undo, and the reply must say so: reports already emailed;
// OpenAI's copy of API inputs for its retention period (until zero-data-retention).

interface Args { platform: string; handle: string; apply: boolean; note: string }
function parseArgs(argv: string[]): Args {
  const a: Args = { platform: '', handle: '', apply: false, note: '' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--platform') a.platform = argv[++i]
    else if (argv[i] === '--handle') a.handle = argv[++i]
    else if (argv[i] === '--apply') a.apply = true
    else if (argv[i] === '--note') a.note = argv[++i]
    else throw new Error(`unknown flag: ${argv[i]}`)
  }
  if (!['youtube', 'tiktok', 'instagram', 'reddit'].includes(a.platform)) throw new Error('--platform must be youtube | tiktok | instagram | reddit')
  if (!a.handle?.trim()) throw new Error('--handle is required')
  return a
}

/** Both pseudonym shapes the demo has carried: md5 (Tier 0 migration) and
 *  sha256 (scripts/seed-demo.ts pseudonymise). Secondary net only — the primary
 *  match is by comment_id. */
function demoPseudonyms(author: string): string[] {
  return ['md5', 'sha256'].map((alg) => `user_${createHash(alg).update(author).digest('hex').slice(0, 8)}`)
}

// PostgREST turns '*' into '%' inside ilike patterns, so a display name like
// "**Sarah**" would otherwise match every author containing "sarah" — escape it
// too, and post-filter in JS for exact (case-insensitive) equality anyway.
const escapeLike = (s: string) => s.replace(/[\\%_*]/g, (m) => `\\${m}`)

interface CommentRow { id: string; client_id: string; author: string | null; text: string | null; platform: string; video_id: string; comment_id: string }

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const admin = createAdminClient()
  const bare = args.handle.trim().replace(/^@/, '').replace(/^\/?u\//i, '')
  const patterns = [...new Set([bare, `@${bare}`, ...(args.platform === 'reddit' ? [`u/${bare}`, `/u/${bare}`] : [])])]
  const patternSet = new Set(patterns.map((p) => p.toLowerCase()))

  console.log(`erase-commenter · platform=${args.platform} · handle="${args.handle}" · ${args.apply ? 'APPLY' : 'DRY RUN (add --apply to execute)'}\n`)

  // 1. Real rows across every tenant (ilike without wildcards = case-insensitive equality).
  const found = new Map<string, CommentRow>()
  for (const p of patterns) {
    const rows = await selectAll<CommentRow>(() =>
      admin.from('comments').select('id, client_id, author, text, platform, video_id, comment_id').eq('platform', args.platform).ilike('author', escapeLike(p)).order('id', { ascending: true }),
    )
    for (const r of rows) if (r.author && patternSet.has(r.author.trim().toLowerCase())) found.set(r.id, r)
  }
  const exactAuthors = [...new Set([...found.values()].map((r) => r.author).filter((a): a is string => !!a))]

  // 2. Demo clones — by comment_id first (the clone keeps it), pseudonyms second.
  const realCommentIds = [...new Set([...found.values()].filter((r) => r.client_id !== DEMO_CLIENT_ID).map((r) => r.comment_id))]
  const demoRows: CommentRow[] = []
  for (let i = 0; i < realCommentIds.length; i += 200) {
    demoRows.push(...await selectAll<CommentRow>(() =>
      admin.from('comments').select('id, client_id, author, text, platform, video_id, comment_id').eq('client_id', DEMO_CLIENT_ID).eq('platform', args.platform).in('comment_id', realCommentIds.slice(i, i + 200)).order('id', { ascending: true }),
    ))
  }
  const pseudonyms = [...new Set([...exactAuthors, ...handleVariants(args.handle)].flatMap(demoPseudonyms))]
  demoRows.push(...await selectAll<CommentRow>(() =>
    admin.from('comments').select('id, client_id, author, text, platform, video_id, comment_id').eq('client_id', DEMO_CLIENT_ID).eq('platform', args.platform).in('author', pseudonyms).order('id', { ascending: true }),
  ))
  for (const r of demoRows) found.set(r.id, r)

  const rows = [...found.values()]
  const byClient = new Map<string, number>()
  for (const r of rows) byClient.set(r.client_id, (byClient.get(r.client_id) ?? 0) + 1)
  console.log(`comments matched: ${rows.length} (${rows.filter((r) => r.client_id === DEMO_CLIENT_ID).length} of them demo-tenant clones)`)
  for (const [c, n] of byClient) console.log(`   ${c === DEMO_CLIENT_ID ? 'DEMO' : c}: ${n}`)
  console.log(`author strings seen: ${exactAuthors.map((a) => JSON.stringify(a)).join(', ') || '(none)'}`)
  if (!rows.length) {
    console.log('\nnothing to erase. Suppression will still be recorded with --apply so a future scrape never adds this handle.')
  }

  // 3–4. Dependents + hero quotes, counted; deleted with --apply (cascade).
  const ids = rows.map((r) => r.id)
  let evidenceRows = 0
  let sampleRows = 0
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const [ev, ls] = await Promise.all([
      admin.from('insight_evidence').select('id', { count: 'exact', head: true }).in('comment_id', chunk),
      admin.from('language_samples').select('id', { count: 'exact', head: true }).in('comment_id', chunk),
    ])
    evidenceRows += ev.count ?? 0
    sampleRows += ls.count ?? 0
  }
  const del = await deleteCommentsProperly(admin, rows, { dryRun: !args.apply })
  console.log(`\nwill ${args.apply ? '' : '(would) '}delete ${del.deleted} comment row(s) → cascades ${evidenceRows} evidence row(s) + ${sampleRows} language sample(s), touching ${del.insightsAffected} insight(s); hero quotes nulled: ${del.heroQuotesNulled}`)

  // 5. ai_call_log bodies inside the window that carry the text.
  const clientIds = [...byClient.keys()]
  const texts = rows.map((r) => (r.text ?? '').replace(/\s+/g, ' ').trim()).filter((t) => t.length >= 8)
  let bodiesMatched: string[] = []
  if (clientIds.length && texts.length) {
    const since = new Date(Date.now() - AI_LOG_BODY_RETENTION_DAYS * 86_400_000).toISOString()
    const logs = await selectAll<{ id: string; request: { user?: string } | null }>(() =>
      admin.from('ai_call_log').select('id, request').in('client_id', clientIds).gte('created_at', since).not('request', 'is', null).order('id', { ascending: true }),
    )
    bodiesMatched = logs.filter((l) => { const u = String(l.request?.user ?? ''); return texts.some((t) => u.includes(t)) }).map((l) => l.id)
    console.log(`ai_call_log bodies in the last ${AI_LOG_BODY_RETENTION_DAYS}d carrying the text: ${bodiesMatched.length} of ${logs.length} scanned → ${args.apply ? 'nulled' : 'would be nulled'}`)
    if (args.apply) {
      for (let i = 0; i < bodiesMatched.length; i += 200) {
        const { error } = await admin.from('ai_call_log').update({ request: null, response: null }).in('id', bodiesMatched.slice(i, i + 200))
        if (error) throw new Error(`null ai_call_log bodies: ${error.message}`)
      }
    }
  }

  // 7. Stored report copies. Best-effort: the renderer HTML-escapes text, so
  //    both the raw and the escaped forms are replaced. Reports already emailed
  //    cannot be recalled — the reply says so.
  let reportsScrubbed = 0
  if (clientIds.length && texts.length) {
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    const needles = [...new Set(texts.flatMap((t) => [t, esc(t)]))]
    const reports = await selectAll<{ id: string; html_content: string }>(() =>
      admin.from('weekly_reports').select('id, html_content').in('client_id', clientIds).order('id', { ascending: true }),
    )
    for (const r of reports) {
      let html = r.html_content
      for (const n of needles) html = html.split(n).join('[removed at the commenter\'s request]')
      if (html !== r.html_content) {
        reportsScrubbed++
        if (args.apply) {
          const { error } = await admin.from('weekly_reports').update({ html_content: html }).eq('id', r.id)
          if (error) throw new Error(`scrub weekly_reports ${r.id}: ${error.message}`)
        }
      }
    }
    console.log(`stored report copies carrying the text: ${reportsScrubbed} of ${reports.length} → ${args.apply ? 'scrubbed' : 'would be scrubbed'}`)
  }

  // 7b. Stored Ask answers. `plan_checks.claims[].theySay` and its
  //     re-evaluations are model prose written AFTER the model was shown real
  //     comments, so they can carry a commenter's words even though no quote
  //     field is stored. Nothing else reaches them: there is no FK, and the
  //     insight ids they store resolve through evidence rows that this script
  //     has already deleted. Same treatment as the report copies — replace the
  //     text in place, best effort.
  let askAnswersScrubbed = 0
  if (clientIds.length && texts.length) {
    for (const table of ['plan_checks', 'plan_check_evaluations'] as const) {
      const stored = await selectAll<{ id: string; claims: { theySay?: string | null }[] | null }>(() =>
        admin.from(table).select('id, claims').in('client_id', clientIds).order('id', { ascending: true }),
      )
      for (const row of stored) {
        const claims = Array.isArray(row.claims) ? row.claims : []
        let touched = false
        const next = claims.map((c) => {
          const said = typeof c?.theySay === 'string' ? c.theySay : null
          if (!said) return c
          let cleaned = said
          for (const t of texts) cleaned = cleaned.split(t).join('[removed at the commenter\'s request]')
          if (cleaned === said) return c
          touched = true
          return { ...c, theySay: cleaned }
        })
        if (!touched) continue
        askAnswersScrubbed++
        if (args.apply) {
          const { error } = await admin.from(table).update({ claims: next }).eq('id', row.id)
          if (error) throw new Error(`scrub ${table} ${row.id}: ${error.message}`)
        }
      }
    }
    console.log(`stored Ask answers carrying the text: ${askAnswersScrubbed} → ${args.apply ? 'scrubbed' : 'would be scrubbed'}`)
  }

  // 6. Suppression — every key variant we know of.
  const keys = [...new Set([authorKey(args.platform, args.handle), ...exactAuthors.map((a) => authorKey(args.platform, a))].filter((k): k is string => !!k))]
  console.log(`suppression keys (${args.platform}): ${keys.join(', ')} → ${args.apply ? 'recorded' : 'would be recorded'}`)
  if (args.apply && keys.length) {
    const { error } = await admin.from('suppressed_commenters').upsert(
      keys.map((k) => ({ platform: args.platform, author_key: k, note: args.note || null })),
      { onConflict: 'platform,author_key' },
    )
    if (error) throw new Error(`suppress: ${error.message}`)
  }

  console.log(`\n--- reply template ---
We have removed the ${rows.length} comment(s) tied to ${args.handle} on ${args.platform} from Verbatim, together with every quote of them in our analysis${del.heroQuotesNulled ? ' and in report headlines' : ''}, and we have recorded the handle so it is not collected again.
What we cannot undo: report emails already sent to our customers before your request, and our AI provider's copy of any analysis input for its own retention period (up to 30 days).
${args.apply ? '' : '(DRY RUN — nothing has been changed yet.)'}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
