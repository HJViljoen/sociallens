// Render any page module for any tenant to a PDF (or a tile to PNG) with the
// local Chrome, WITHOUT a session: loader on the admin client → snapshot →
// /render/<snapshot> → file. The snapshot row is deleted afterwards unless
// --keep, so a verification run leaves no trace in the tenant's Exports list.
//   node --env-file=.env.local --import tsx scripts/render-page.ts --client <uuid> --page agent --param thread=<uuid> [--tile agent.answer:0] [--variant full] [--style a|b] [--out dir] [--keep]
// Verification only (Reports & Exports T11/T13). Needs a dev server on :3000.

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createAdminClient } from '../lib/supabase-admin'
import { pageModule } from '../components/pages/registry'
import { createSnapshot } from '../lib/snapshots'
import { renderArtifact } from '../lib/render/render'
import type { PageKey, PrintVariant } from '../lib/renderables/types'

const args = process.argv.slice(2)
const flag = (name: string, dflt = '') => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt
}
const has = (name: string) => args.includes(`--${name}`)
const clientId = flag('client')
const page = flag('page') as PageKey
const tileKey = flag('tile') || null
const variant = (flag('variant', 'default') as PrintVariant)
const style = flag('style') || null
const out = flag('out', 'scratch/render')
const base = process.env.RENDER_BASE_URL ?? 'http://localhost:3000'
const params: Record<string, string> = {}
for (let i = 0; i < args.length; i++) if (args[i] === '--param' && args[i + 1]) { const [k, v] = args[i + 1].split('='); params[k] = v }

async function main() {
  if (!clientId || !page) throw new Error('--client and --page are required')
  const mod = pageModule(page)
  if (!mod) throw new Error(`no page module: ${page}`)
  const admin = createAdminClient()
  mkdirSync(out, { recursive: true })
  const t0 = Date.now()
  const data = await mod.load({ supabase: admin, clientId, params, variant })
  if (!data) throw new Error('loader returned null (empty state)')
  const title = tileKey ? `${tileKey} · ${mod.snapshotTitle(data)}` : mod.snapshotTitle(data)
  const snap = await createSnapshot(admin, { clientId, userId: null, kind: tileKey ? 'tile' : page === 'agent' ? 'agent_thread' : 'page', ref: { page, ...(tileKey ? { tileKey } : {}), params, variant }, title, runId: null, data })
  const t1 = Date.now()
  try {
    const format = tileKey ? 'png' : 'pdf'
    const { buffer, ms } = await renderArtifact({ baseUrl: base, snapshotId: snap.id, format, tileKey, style })
    const name = `${page}${tileKey ? `-${tileKey.replace(/[^a-z0-9]/gi, '_')}` : ''}${variant === 'full' ? '-full' : ''}.${format}`
    writeFileSync(join(out, name), buffer)
    console.log(`${name}: load ${t1 - t0} ms · render ${ms} ms · ${buffer.length} bytes · refs ${snap.evidenceIds.length} · snapshot ${snap.id}${has('keep') ? ' (kept)' : ''}`)
  } finally {
    if (!has('keep')) await admin.from('report_snapshots').delete().eq('id', snap.id)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
