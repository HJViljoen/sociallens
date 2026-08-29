// Print the dev-only /render/smoke fixture to PDF and PNG with a local Chrome.
//   npm run dev   (in another shell)
//   node --env-file=.env.local --import tsx scripts/render-smoke.ts [--style a|b] [--out dir]
// Exercises the print frame end to end without a snapshot: fonts, tokens,
// grid spans in print media, no shadow, no motion, page size.

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { printPdf, shootTile, withBrowser } from '../lib/render/chromium'

const args = process.argv.slice(2)
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const style = flag('style', 'a')
const out = flag('out', 'scratch')
const base = process.env.RENDER_BASE_URL ?? 'http://localhost:3000'

async function main() {
  mkdirSync(out, { recursive: true })
  const t0 = Date.now()
  const pdf = await withBrowser((page) => printPdf(page, `${base}/render/smoke?style=${style}`))
  const t1 = Date.now()
  writeFileSync(join(out, `smoke-${style}.pdf`), pdf)
  const png = await withBrowser((page) => shootTile(page, `${base}/render/smoke?style=${style}&tile=1`))
  const t2 = Date.now()
  writeFileSync(join(out, `smoke-${style}-tile.png`), png)
  console.log(`pdf ${pdf.length} bytes in ${t1 - t0} ms · png ${png.length} bytes in ${t2 - t1} ms → ${out}/`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
