// Compare two directories of screenshots (scripts/shot.ts) pixel for pixel.
//   node --import tsx scripts/shot-diff.ts <beforeDir> <afterDir> [--out diffDir]
// Prints one line per image: identical / N pixels differ (with a diff image
// written when --out is given) / missing. Exit 1 if anything differs.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const [before, after, ...rest] = process.argv.slice(2)
const outIdx = rest.indexOf('--out')
const out = outIdx >= 0 ? rest[outIdx + 1] : null
if (!before || !after) {
  console.error('usage: shot-diff <beforeDir> <afterDir> [--out diffDir]')
  process.exit(2)
}
if (out) mkdirSync(out, { recursive: true })

let failures = 0
for (const file of readdirSync(before).filter((f) => f.endsWith('.png')).sort()) {
  const a = join(before, file)
  const b = join(after, file)
  if (!existsSync(b)) { console.log(`${file}: missing in after`); failures++; continue }
  const A = PNG.sync.read(readFileSync(a))
  const B = PNG.sync.read(readFileSync(b))
  if (A.width !== B.width || A.height !== B.height) {
    console.log(`${file}: size ${A.width}×${A.height} → ${B.width}×${B.height}`)
    failures++
    continue
  }
  const diff = new PNG({ width: A.width, height: A.height })
  const n = pixelmatch(A.data, B.data, diff.data, A.width, A.height, { threshold: 0 })
  if (n === 0) console.log(`${file}: identical`)
  else {
    console.log(`${file}: ${n} pixels differ`)
    failures++
    if (out) writeFileSync(join(out, file), PNG.sync.write(diff))
  }
}
process.exit(failures ? 1 : 0)
