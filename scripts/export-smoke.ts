// End-to-end export smoke: sign in as the demo tenant, POST /api/export for
// the pages the spine knows, download the files, report sizes and timings.
//   node --env-file=.env.local --import tsx scripts/export-smoke.ts --out scratch/exports [--pages dashboard,voice] [--tile dashboard.strip] [--variant full] [--style a|b]
// Needs a dev server (RENDER_BASE_URL or http://localhost:3000) and the
// report_snapshots/artifacts tables applied.

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { withBrowser } from '../lib/render/chromium'

const args = process.argv.slice(2)
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const out = flag('out', 'scratch/exports')
const base = flag('base', process.env.RENDER_BASE_URL ?? 'http://localhost:3000')
const pages = flag('pages', 'dashboard,voice').split(',').filter(Boolean)
const tile = flag('tile', '')
const variant = flag('variant', 'default')
const style = flag('style', '')
const email = process.env.SHOT_EMAIL ?? 'demo@verbatimintel.com'
const password = process.env.SHOT_PASSWORD ?? process.env.DEMO_PASSWORD ?? ''

type ExportResult = { artifactId?: string; snapshotId?: string; url?: string; ms?: number; bytes?: number; error?: string; status: number }

async function main() {
  if (!password) throw new Error('SHOT_PASSWORD / DEMO_PASSWORD not set')
  mkdirSync(out, { recursive: true })
  await withBrowser(async (page) => {
    await page.goto(`${base}/login`, { waitUntil: 'networkidle0' })
    await page.type('input[name="email"]', email)
    await page.type('input[name="password"]', password)
    await page.click('button[type="submit"]')
    await page.waitForFunction(() => location.pathname.startsWith('/dashboard'), { timeout: 60000 })

    const post = (body: Record<string, unknown>) =>
      page.evaluate(async (b) => {
        const r = await fetch('/api/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
        const j = await r.json().catch(() => ({}))
        return { ...j, status: r.status } as ExportResult
      }, body)

    const jobs: { name: string; body: Record<string, unknown> }[] = pages.map((p) => ({
      name: `${p}${variant === 'full' ? '-full' : ''}`,
      body: { kind: 'page', page: p, format: 'pdf', variant, ...(style ? { style } : {}) },
    }))
    if (tile) jobs.push({ name: tile.replace(/[^a-z0-9.]/gi, '_'), body: { kind: 'tile', page: tile.split('.')[0], tileKey: tile, format: 'png', ...(style ? { style } : {}) } })

    for (const job of jobs) {
      const t0 = Date.now()
      const res = await post(job.body)
      const wall = Date.now() - t0
      if (res.status !== 200 || !res.url) {
        console.log(`${job.name}: HTTP ${res.status} ${res.error ?? ''} (${wall} ms)`)
        continue
      }
      const file = await fetch(res.url)
      const buf = Buffer.from(await file.arrayBuffer())
      const ext = (job.body.format as string) === 'png' ? 'png' : 'pdf'
      writeFileSync(join(out, `${job.name}.${ext}`), buf)
      console.log(`${job.name}: ok · render ${res.ms} ms · wall ${wall} ms · ${buf.length} bytes · artifact ${res.artifactId}`)
    }
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
