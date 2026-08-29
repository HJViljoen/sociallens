import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { existsSync } from 'fs'

/**
 * One browser for one render. On Vercel this is @sparticuz/chromium's bundled
 * build (extracted to /tmp on a cold start, reused while the instance is
 * warm); locally it is whatever CHROME_PATH points at, or the Mac's Google
 * Chrome. The sparticuz package is imported lazily: it cannot launch on macOS
 * and it is 67 MB the dev server need not load.
 *
 * Motion is emulated off (prefers-reduced-motion: reduce) — every draw-in in
 * app/globals.css is gated on it — and the print root switches the rest off
 * again in CSS. Renders are deterministic by construction, not by waiting.
 */

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function launch(): Promise<Browser> {
  const local = process.env.CHROME_PATH || (process.platform === 'darwin' && existsSync(MAC_CHROME) ? MAC_CHROME : null)
  if (local) {
    return puppeteer.launch({
      executablePath: local,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
    })
  }
  const chromium = (await import('@sparticuz/chromium')).default
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  })
}

export async function withBrowser<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await launch()
  try {
    const page = await browser.newPage()
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    // Preview deployments sit behind Vercel Authentication; the browser is
    // fetching our own deployment, so it carries the automation bypass when
    // the project has one (Settings → Deployment Protection).
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    if (bypass) await page.setExtraHTTPHeaders({ 'x-vercel-protection-bypass': bypass })
    return await fn(page)
  } finally {
    await browser.close()
  }
}

/** Print the page at `url` to a PDF. The page's own @page rule sets the size. */
export async function printPdf(page: Page, url: string): Promise<Buffer> {
  await page.setViewport({ width: 1123, height: 631, deviceScaleFactor: 1 })
  await page.goto(url, { waitUntil: 'networkidle0' })
  const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true })
  return Buffer.from(pdf)
}

/** Screenshot the first [data-tile] on the page at 2× as a PNG. */
export async function shootTile(page: Page, url: string): Promise<Buffer> {
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 })
  await page.emulateMediaType('screen')
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  const el = await page.$('[data-tile]')
  if (!el) throw new Error('render: no [data-tile] on the page')
  const png = await el.screenshot({ type: 'png' })
  return Buffer.from(png)
}
