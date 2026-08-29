// Screenshot dashboard pages as a signed-in user, for before/after parity
// checks while pages are split into loaders + renderers (Reports & Exports T3–T8).
//
//   node --env-file=.env.local --import tsx scripts/shot.ts --out scratch/before [--base http://localhost:3000] [--only voice]
//
// Signs in through the real /login form with SHOT_EMAIL / SHOT_PASSWORD (defaults:
// the demo tenant, DEMO_PASSWORD). Motion is emulated off so draw-ins are at
// their final state; Voice's ribbon seed is pinned. `follow` shoots the first
// link matching a selector on the base page too (an id-bearing deep link).

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { withBrowser } from '../lib/render/chromium'

const args = process.argv.slice(2)
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const out = flag('out', 'scratch/shots')
const base = flag('base', process.env.RENDER_BASE_URL ?? 'http://localhost:3000')
const only = flag('only', '')
const email = process.env.SHOT_EMAIL ?? 'demo@verbatimintel.com'
const password = process.env.SHOT_PASSWORD ?? process.env.DEMO_PASSWORD ?? ''

interface Shot { name: string; path: string; follow?: string }
const SHOTS: Shot[] = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'dashboard-brief', path: '/dashboard?detail=brief' },
  { name: 'market', path: '/dashboard/market', follow: 'a[href*="item="]' },
  { name: 'market-insights', path: '/dashboard/market?group=insights' },
  { name: 'market-claims', path: '/dashboard/market?group=claims' },
  { name: 'voice', path: '/dashboard/voice?seed=1', follow: 'a[href*="theme="]' },
  { name: 'voice-filtered', path: '/dashboard/voice?seed=1&entity=client&type=pain_point&stage=consideration' },
  { name: 'voice-list', path: '/dashboard/voice?seed=1&detail=list' },
  { name: 'competitive', path: '/dashboard/competitive', follow: 'a[href*="item="]' },
  { name: 'competitive-kind', path: '/dashboard/competitive', follow: 'a[href*="kind="]' },
  { name: 'content', path: '/dashboard/videos', follow: 'a[href*="detail=engage-"]' },
  { name: 'content-intent', path: '/dashboard/videos?intent=objection' },
  { name: 'content-playbooks', path: '/dashboard/videos?detail=playbooks' },
  { name: 'profile', path: '/dashboard/profile', follow: 'a[href*="persona="]' },
]

async function main() {
  if (!password) throw new Error('SHOT_PASSWORD / DEMO_PASSWORD not set')
  mkdirSync(out, { recursive: true })
  await withBrowser(async (page) => {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await page.goto(`${base}/login`, { waitUntil: 'networkidle0' })
    await page.type('input[type="email"], input[name="email"]', email)
    await page.type('input[type="password"], input[name="password"]', password)
    // The login form is a server action: a redirect() is a client-side
    // navigation, so wait on the location rather than a document load.
    await page.click('button[type="submit"]')
    await page.waitForFunction(() => location.pathname.startsWith('/dashboard'), { timeout: 60000 })

    const shoot = async (name: string, url: string) => {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 })
      await page.evaluate(() => document.fonts.ready)
      const png = await page.screenshot({ type: 'png', fullPage: true })
      writeFileSync(join(out, `${name}.png`), png)
      console.log(`${name}  ${url}`)
    }
    for (const s of SHOTS) {
      if (only && !s.name.startsWith(only)) continue
      await shoot(s.name, `${base}${s.path}`)
      if (s.follow) {
        const href = await page.evaluate((sel) => (document.querySelector(sel) as HTMLAnchorElement | null)?.getAttribute('href') ?? null, s.follow)
        if (href) await shoot(`${s.name}-follow`, href.startsWith('http') ? href : `${base}${href}`)
        else console.log(`${s.name}-follow  (no link matched ${s.follow})`)
      }
    }
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
