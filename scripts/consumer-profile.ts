import { createAdminClient } from '../lib/supabase-admin'
import { runPassE } from '../lib/pipeline/pass-e'
import { PERSONA_MIN_INSIGHTS, PERSONA_MIN_VIDEOS, PERSONA_MAX } from '../lib/config'

// Consumer-profile operator lever (Pass E, 2026-08-19).
//
// Two jobs. It produces a profile for an already-COMPLETED run without touching
// the pipeline — which is how the first profiles get made while CONSUMER_PROFILE
// stays off, so a brand-new GPT call never rides along on a run that a clean-run
// gate depends on. And it prints what the floors kept and dropped, which is how
// the floors get tuned against real output instead of a guess.
//
// Dry by default: --dry-run costs one model call (~$0.05) and writes nothing.
//
//   node --env-file=.env.local --import tsx scripts/consumer-profile.ts --client <uuid> --dry-run
//   … --run <uuid>        (default: the client's newest completed/partial run)
//   … --write             (persist the profile row)

interface Args {
  clientId: string | null
  runId: string | null
  write: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { clientId: null, runId: null, write: false }
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]
    if (argv[i] === '--client') args.clientId = next()
    else if (argv[i] === '--run') args.runId = next()
    else if (argv[i] === '--write') args.write = true
    else if (argv[i] === '--dry-run') args.write = false
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.clientId) {
    console.error('usage: --client <uuid> [--run <uuid>] [--write]')
    process.exit(1)
  }
  const admin = createAdminClient()

  const { data: client } = await admin
    .from('clients')
    .select('company_name')
    .eq('id', args.clientId)
    .maybeSingle()
  if (!client) {
    console.error(`no client ${args.clientId}`)
    process.exit(1)
  }

  let runId = args.runId
  let runDate = new Date().toISOString().slice(0, 10)
  if (!runId) {
    // Newest run that actually finished — an in-flight run's themes are half
    // written and would profile a partial corpus.
    const { data: run } = await admin
      .from('pipeline_runs')
      .select('id, completed_at, started_at')
      .eq('client_id', args.clientId)
      .in('status', ['completed', 'partial'])
      .order('completed_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (!run) {
      console.error('no completed run for this client')
      process.exit(1)
    }
    runId = (run as { id: string }).id
    const stamp = (run as { completed_at: string | null; started_at: string | null }).completed_at
      ?? (run as { started_at: string | null }).started_at
    if (stamp) runDate = new Date(stamp).toISOString().slice(0, 10)
  }

  const companyName = (client as { company_name: string }).company_name
  console.log(`\n${companyName} · run ${runId} · ${runDate}`)
  console.log(`floors: >=${PERSONA_MIN_INSIGHTS} insights, >=${PERSONA_MIN_VIDEOS} videos, max ${PERSONA_MAX} per scope`)
  console.log(args.write ? 'MODE: write\n' : 'MODE: dry run (nothing will be written)\n')

  const r = await runPassE(admin, {
    clientId: args.clientId,
    runId: runId!,
    runDate,
    companyName,
    persist: args.write,
  })

  console.log(`headline: ${r.headline || '(none)'}`)
  console.log(`cost: $${r.costUsd.toFixed(4)} · kept ${r.personas.length} · dropped ${r.dropped.length}\n`)

  for (const p of r.personas) {
    console.log(`— ${p.name} [${p.scope}] · ${p.prevalence}`)
    console.log(`  ${p.oneLiner}`)
    console.log(`  grounded in ${p.evidenceCount} insights across ${p.sourceVideoCount} videos · ${p.themeIds.length} themes`)
    console.log(`  buckets: ${Object.entries(p.bucketMix).map(([k, v]) => `${k}=${v}`).join(' ') || '—'}`)
    if (p.wants) console.log(`  drives:   ${p.wants}`)
    if (p.blockers) console.log(`  stops:    ${p.blockers}`)
    if (p.triggers) console.log(`  works on: ${p.triggers}`)
    if (p.who.length) console.log(`  who: ${p.who.map((w) => `${w.signal} (${w.count})`).join(' · ')}`)
    if (p.howTheyTalk.length) console.log(`  talks like: ${p.howTheyTalk.map((s) => `"${s}"`).join(' ')}`)
    for (const q of p.quotes) console.log(`  > ${q}`)
    if (p.unknownRefs.length) console.log(`  (unresolved refs: ${p.unknownRefs.join(', ')})`)
    console.log('')
  }

  if (r.dropped.length) {
    // The tuning signal: a good persona rejected by a hair means the floor is
    // wrong; a thin one rejected means it is working.
    console.log('dropped by the floors:')
    for (const d of r.dropped) {
      console.log(`  ${d.name} — ${d.reason} (${d.evidenceCount} insights, ${d.sourceVideoCount} videos)`)
    }
    console.log('')
  }
  if (r.profileId) console.log(`written: consumer_profiles ${r.profileId}\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
