import { printPdf, shootTile, withBrowser } from './chromium'
import { renderTokenSecret, signRenderToken, RENDER_TOKEN_TTL_SECONDS } from '../render-token'
import type { ArtifactFormat } from '../artifacts'

/**
 * Render one snapshot to a file: mint a token, point a headless browser at
 * /render/<snapshot>, print or screenshot. The browser fetches OUR OWN
 * deployment, so the origin must be this deployment — on a Vercel preview
 * that is VERCEL_URL, not the production host NEXT_PUBLIC_APP_URL names.
 */

export function renderBaseUrl(requestBase: string): string {
  if (process.env.RENDER_BASE_URL) return process.env.RENDER_BASE_URL.replace(/\/$/, '')
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return requestBase.replace(/\/$/, '')
}

export function renderUrl(base: string, snapshotId: string, opts: { tileKey?: string | null; style?: string | null } = {}): string {
  const exp = Math.floor(Date.now() / 1000) + RENDER_TOKEN_TTL_SECONDS
  const token = signRenderToken({ snapshotId, exp, ...(opts.tileKey ? { tileKey: opts.tileKey } : {}) }, renderTokenSecret())
  const q = new URLSearchParams({ t: token })
  if (opts.tileKey) q.set('tile', opts.tileKey)
  if (opts.style) q.set('style', opts.style)
  return `${base}/render/${snapshotId}?${q.toString()}`
}

export async function renderArtifact(args: {
  baseUrl: string
  snapshotId: string
  format: ArtifactFormat
  tileKey?: string | null
  style?: string | null
}): Promise<{ buffer: Buffer; ms: number }> {
  const url = renderUrl(args.baseUrl, args.snapshotId, { tileKey: args.tileKey, style: args.style })
  const t0 = Date.now()
  const buffer = await withBrowser((page) => (args.format === 'png' ? shootTile(page, url) : printPdf(page, url)))
  return { buffer, ms: Date.now() - t0 }
}
