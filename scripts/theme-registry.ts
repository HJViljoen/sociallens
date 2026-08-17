import { createAdminClient, selectAll } from '../lib/supabase-admin'

// Theme-registry operator lever (shape B-lite, 2026-08-17). Read-only by
// default; every mutating action needs --apply. There is no admin UI yet, so
// this is the repair path when matching gets identity wrong — and matching WILL
// get it wrong occasionally: the weak band (Jaccard 0.25-0.5 + label cosine)
// exists precisely because a cluster genuinely reshaped and the call is a
// judgment. A wrong match corrupts a time series that Trends draws as fact, so
// the lever matters more than the elegance of the matcher.
//
//   node --env-file=.env.local --import tsx scripts/theme-registry.ts --client <uuid>
//   … --merge <keep-id> <retire-id> --apply
//   … --dormant <id> --apply          (retire an entry; next run opens a fresh one)
//   … --revive <id> --apply

const SEALAND = 'ac16988e-c4f3-4baf-b388-73895852a554'

interface Args {
  clientId: string
  merge?: [string, string]
  dormant?: string
  revive?: string
  apply: boolean
  limit: number
}

function parseArgs(argv: string[]): Args {
  const args: Args = { clientId: SEALAND, apply: false, limit: 25 }
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]
    if (argv[i] === '--client') args.clientId = next()
    else if (argv[i] === '--merge') args.merge = [next(), next()]
    else if (argv[i] === '--dormant') args.dormant = next()
    else if (argv[i] === '--revive') args.revive = next()
    else if (argv[i] === '--limit') args.limit = Number(next())
    else if (argv[i] === '--apply') args.apply = true
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const admin = createAdminClient()

  const entries = await selectAll<{
    id: string; bucket: string; canonical_label: string; status: string
    observation_count: number | null; first_seen_at: string; last_seen_at: string
    member_insight_ids: string[]; parent_theme_id: string | null
  }>(() =>
    admin.from('theme_registry')
      .select('id, bucket, canonical_label, status, observation_count, first_seen_at, last_seen_at, member_insight_ids, parent_theme_id')
      .eq('client_id', args.clientId).order('observation_count', { ascending: false }).order('id', { ascending: true }),
  )
  const obs = await selectAll<{ theme_id: string; run_id: string | null; match_kind: string; label: string; evidence_count: number; created_at: string }>(() =>
    admin.from('theme_observations')
      .select('theme_id, run_id, match_kind, label, evidence_count, created_at')
      .eq('client_id', args.clientId).order('created_at', { ascending: true }).order('id', { ascending: true }),
  )

  // ---- mutations (each requires --apply) ----
  // Every mutation is scoped to --client as well as the id: a mistyped uuid must
  // not be able to touch another tenant's registry.
  const owned = (id: string) => entries.some((e) => e.id === id)

  if (args.merge) {
    const [keep, retire] = args.merge
    if (!owned(keep) || !owned(retire)) throw new Error(`both ids must belong to client ${args.clientId}`)
    if (keep === retire) throw new Error('keep and retire are the same entry')
    // The two entries were almost certainly observed in the SAME runs — that is
    // usually why they are duplicates — and (theme_id, run_id) is unique, so a
    // blind repoint hits a constraint violation. Drop the loser's colliding
    // observations first; the winner's series is the one being kept.
    const keepRuns = new Set(obs.filter((o) => o.theme_id === keep).map((o) => o.run_id))
    const colliding = obs.filter((o) => o.theme_id === retire && keepRuns.has(o.run_id))
    const moving = obs.filter((o) => o.theme_id === retire && !keepRuns.has(o.run_id))
    console.log(`merge: ${moving.length} observation(s) move ${retire} → ${keep}, ${colliding.length} dropped as duplicates of ${keep}'s own runs; ${retire} → dormant, parent=${keep}`)
    if (!args.apply) { console.log('(dry run — pass --apply to write)'); return }
    if (colliding.length) {
      const { error } = await admin.from('theme_observations').delete()
        .eq('client_id', args.clientId).eq('theme_id', retire)
        .in('run_id', colliding.map((o) => o.run_id).filter((r): r is string => !!r))
      if (error) throw new Error(`drop colliding observations: ${error.message}`)
    }
    const { error: e1 } = await admin.from('theme_observations').update({ theme_id: keep })
      .eq('client_id', args.clientId).eq('theme_id', retire)
    if (e1) throw new Error(`repoint observations: ${e1.message}`)
    const { error: e2 } = await admin.from('theme_registry').update({ status: 'dormant', parent_theme_id: keep })
      .eq('client_id', args.clientId).eq('id', retire)
    if (e2) throw new Error(`retire entry: ${e2.message}`)
    const { error: e3 } = await admin.from('themes').update({ registry_id: keep })
      .eq('client_id', args.clientId).eq('registry_id', retire)
    if (e3) throw new Error(`repoint theme rows: ${e3.message}`)
    // The winner absorbed rows, so its bookkeeping is now stale.
    const { error: e4 } = await admin.from('theme_registry')
      .update({ observation_count: obs.filter((o) => o.theme_id === keep).length + moving.length })
      .eq('client_id', args.clientId).eq('id', keep)
    if (e4) throw new Error(`refresh observation_count: ${e4.message}`)
    console.log('applied.')
    return
  }
  for (const [flag, id, status] of [['--dormant', args.dormant, 'dormant'], ['--revive', args.revive, 'active']] as const) {
    if (!id) continue
    if (!owned(id)) throw new Error(`${id} does not belong to client ${args.clientId}`)
    console.log(`${flag}: ${id} → status=${status}`)
    if (!args.apply) { console.log('(dry run — pass --apply to write)'); return }
    const { error } = await admin.from('theme_registry').update({ status })
      .eq('client_id', args.clientId).eq('id', id)
    if (error) throw new Error(`set status: ${error.message}`)
    console.log('applied.')
    return
  }

  // ---- default: inspect ----
  const byTheme = new Map<string, typeof obs>()
  for (const o of obs) {
    const arr = byTheme.get(o.theme_id) ?? []
    arr.push(o)
    byTheme.set(o.theme_id, arr)
  }
  const runs = [...new Set(obs.map((o) => o.run_id).filter(Boolean))]
  const kinds = obs.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.match_kind]: (acc[o.match_kind] ?? 0) + 1 }), {})

  console.log(`\nclient ${args.clientId}`)
  console.log(`registry: ${entries.length} entries (${entries.filter((e) => e.status === 'active').length} active, ${entries.filter((e) => e.status === 'dormant').length} dormant)`)
  console.log(`observations: ${obs.length} across ${runs.length} run(s) · match kinds: ${JSON.stringify(kinds)}`)

  const latestRun = runs[runs.length - 1]
  if (latestRun) {
    const latest = obs.filter((o) => o.run_id === latestRun)
    const k = latest.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.match_kind]: (acc[o.match_kind] ?? 0) + 1 }), {})
    const pctNew = latest.length ? ((k.new ?? 0) / latest.length) * 100 : 0
    console.log(`latest run ${latestRun}: ${latest.length} themes · ${JSON.stringify(k)} · ${pctNew.toFixed(1)}% new`)
  }

  console.log(`\nmost-observed themes (top ${args.limit}):`)
  for (const e of entries.slice(0, args.limit)) {
    const hist = byTheme.get(e.id) ?? []
    const labels = [...new Set(hist.map((h) => h.label))]
    console.log(
      `  ${e.id.slice(0, 8)} [${e.status}] ${e.bucket} · seen ${e.observation_count ?? hist.length}× · ${e.member_insight_ids.length} insights\n` +
      `    now: "${e.canonical_label}"` +
      (labels.length > 1 ? `\n    was: ${labels.slice(0, -1).map((l) => `"${l}"`).join(' · ')}` : '') +
      (hist.length ? `\n    evidence: ${hist.map((h) => h.evidence_count).join(' → ')}` : ''),
    )
  }

  // A theme that keeps being relabelled is fine; one whose MEMBERSHIP churns is
  // the thing to eyeball — that is a matcher judgment call, not labeller noise.
  const churny = entries
    .map((e) => ({ e, kinds: (byTheme.get(e.id) ?? []).map((h) => h.match_kind) }))
    .filter((x) => x.kinds.some((k) => k === 'weak'))
  if (churny.length) {
    console.log(`\n${churny.length} theme(s) matched in the WEAK band at least once — worth an eyeball:`)
    for (const c of churny.slice(0, 10)) console.log(`  ${c.e.id.slice(0, 8)} "${c.e.canonical_label}" · ${c.kinds.join(',')}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
