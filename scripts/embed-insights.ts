import { createAdminClient, selectAll } from '../lib/supabase-admin'
import { embedTexts, embedInput } from '../lib/pipeline/cluster'
import { EMBEDDING_MODEL } from '../lib/config'

// Populate audience_insights.embedding for the Verbatim Agent's insight-level
// retrieval. DRY BY DEFAULT — pass --apply to write.
//
//   node --env-file=.env.local --import tsx scripts/embed-insights.ts --client <uuid>
//   node --env-file=.env.local --import tsx scripts/embed-insights.ts --client <uuid> --apply
//
// Why a script and not a pipeline step: the 2026-08-23 Össur run must stay a
// single-variable proof, so this build touches inngest/functions/pipeline.ts
// not at all. The consequence is that insights created by a later run land with
// embedding IS NULL until this is re-run. Folding the embed into Pass A is the
// follow-up once that run has landed.
//
// Idempotent: rows that already carry an embedding are skipped, so re-running
// after a pipeline run only embeds what is new. Re-embedding everything after a
// model change needs --force.
//
// The embed text comes from embedInput() in lib/pipeline/cluster.ts — the SAME
// formula the theme clusterer uses. Do not inline a second copy: vectors built
// from different text are not comparable, and the failure is silent.

const BATCH = 256

interface Args { clientId: string | null; apply: boolean; force: boolean; limit: number }

function parseArgs(argv: string[]): Args {
  const args: Args = { clientId: null, apply: false, force: false, limit: 0 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--client') args.clientId = argv[++i]
    else if (argv[i] === '--apply') args.apply = true
    else if (argv[i] === '--force') args.force = true
    else if (argv[i] === '--limit') args.limit = Number(argv[++i])
    else throw new Error(`unknown flag: ${argv[i]}`)
  }
  if (!args.clientId) throw new Error('--client <uuid> is required')
  if (!Number.isFinite(args.limit) || args.limit < 0) throw new Error('--limit must be a non-negative integer')
  return args
}

/** Rows of the LIVE population only. audience_insights_current is the view
 *  AGENTS.md mandates for population reads — the base table still holds rows
 *  a later run superseded but prune-stale-analysis has not yet removed, and
 *  embedding those would spend money on evidence that is about to vanish. */
interface Row { id: string; category: string; theme: string; description: string; embedding: unknown }

async function main() {
  const { clientId, apply, force, limit } = parseArgs(process.argv.slice(2))
  const admin = createAdminClient()

  const rows = await selectAll<Row>(() =>
    admin
      .from('audience_insights_current')
      .select('id, category, theme, description, embedding')
      .eq('client_id', clientId)
      .order('id', { ascending: true }),
  )

  const todo = (force ? rows : rows.filter((r) => r.embedding === null)).filter(
    (r) => (r.description ?? '').trim().length > 0,
  )
  const capped = limit > 0 ? todo.slice(0, limit) : todo

  const already = rows.length - todo.length
  console.log(`insights in live population: ${rows.length}`)
  console.log(`already embedded (skipped):  ${already}${force ? ' — IGNORED, --force' : ''}`)
  console.log(`to embed:                    ${capped.length}${limit > 0 && todo.length > limit ? ` (capped from ${todo.length} by --limit)` : ''}`)

  if (capped.length === 0) {
    console.log('\nnothing to do.')
    return
  }

  // ~60 tokens per insight measured on Össur; text-embedding-3-small is
  // $0.02/1M. The estimate is printed BEFORE any spend so a dry run is a real
  // decision point and not a formality.
  const chars = capped.reduce((n, r) => n + embedInput(r).length, 0)
  const estTokens = Math.ceil(chars / 4)
  console.log(`\nestimated tokens: ~${estTokens.toLocaleString()} → ~$${((estTokens / 1_000_000) * 0.02).toFixed(4)} on ${EMBEDDING_MODEL}`)

  if (!apply) {
    console.log('\n(dry run — nothing written. Re-run with --apply.)')
    return
  }

  let written = 0
  for (let i = 0; i < capped.length; i += BATCH) {
    const chunk = capped.slice(i, i + BATCH)
    // Batched because embedTexts issues ONE request per call and the pipeline's
    // own callers hand it a bucket at a time; a whole tenant's population in a
    // single request is a different order of magnitude.
    const vectors = await embedTexts(chunk.map((r) => embedInput(r)))
    if (vectors.length !== chunk.length) {
      throw new Error(`embedTexts returned ${vectors.length} vectors for ${chunk.length} inputs`)
    }
    for (let j = 0; j < chunk.length; j++) {
      // Written one row at a time, and to the BASE table: the view is not
      // updatable, and an upsert would need every not-null column of a row we
      // only partially selected.
      const { error } = await admin
        .from('audience_insights')
        .update({ embedding: vectors[j] as unknown as string })
        .eq('id', chunk[j].id)
      if (error) throw new Error(`update ${chunk[j].id}: ${error.message}`)
      written++
    }
    console.log(`  embedded ${Math.min(i + BATCH, capped.length)}/${capped.length}`)
  }

  console.log(`\nwrote ${written} embeddings.`)
  console.log('verify: select count(*) from audience_insights where embedding is not null;')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
