import { DigestEmail } from '../../components/email/document'
import { renderStaticHtml } from './render-html'
import type { ReportSnapshotData } from '../reports/types'
import type { EmailContext } from '../renderables/types'
import { EMAIL } from './theme'
import { htmlToText } from './text'
import { digestSubject } from './subject'

/**
 * Rendering the digest (Stage 3): a hydrated report snapshot → the subject,
 * the HTML and its plain-text mirror. Runs in a route handler or a script
 * (react-dom/server is not for server components), never in a page.
 */

/** Tiles whose email says it with a picture: the runner renders these as PNGs
 *  in the PDF's browser session and attaches them inline. */
export const EMAIL_IMAGE_TILES = ['dashboard.movement', 'dashboard.accounts'] as const

export { digestSubject }

export interface RenderDigestArgs {
  data: ReportSnapshotData
  shareUrl: string | null
  appUrl: string
  attached: boolean
  /** tileKey → `cid:` URL of an inline image the runner attached. */
  images?: Record<string, string>
  cadenceWord?: string
}

export function renderDigestEmail(a: RenderDigestArgs): { subject: string; html: string; text: string } {
  const subject = digestSubject(a.data.company, a.data.delta, a.cadenceWord)
  const ctx: EmailContext = {
    appUrl: a.appUrl,
    image: (key) => a.images?.[key] ?? null,
    theme: EMAIL,
  }
  const html = `<!doctype html>\n${renderStaticHtml(<DigestEmail data={a.data} shareUrl={a.shareUrl} appUrl={a.appUrl} attached={a.attached} ctx={ctx} preheader={subject} />)}`
  return { subject, html, text: htmlToText(html) }
}
