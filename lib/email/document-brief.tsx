import { DocumentBriefEmail } from '../../components/email/document-brief'
import { renderStaticHtml } from './render-html'
import { applyEdits, type BlockEdit } from '../reports/documents/edits'
import type { DocumentSnapshotData } from '../reports/documents/types'
import { htmlToText } from './text'

/**
 * Rendering a written report's email (T10, 2026-08-31): a hydrated document
 * snapshot plus the operator's edits → the subject, the HTML and its
 * plain-text mirror. Runs in a route handler or a script, never in a page
 * (react-dom/server is loaded at runtime by render-html).
 */

export interface RenderDocumentEmailArgs {
  data: DocumentSnapshotData
  /** The overlay; applied here so every caller emails what the Studio shows. */
  edits?: BlockEdit[]
  shareUrl: string | null
  appUrl: string
  attached: boolean
}

/** "{company}: sales brief, 31 August 2026" — the report's own name, and the
 *  day it was written. No delta words: a brief is the same report each time. */
export function documentSubject(data: DocumentSnapshotData): string {
  const d = new Date(data.generatedAt)
  const day = Number.isNaN(d.getTime()) ? data.period : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return `${data.company}: ${data.title.toLowerCase()}, ${day}`
}

export function renderDocumentEmail(a: RenderDocumentEmailArgs): { subject: string; html: string; text: string } {
  const data = a.edits?.length ? applyEdits(a.data, a.edits) : a.data
  const subject = documentSubject(data)
  const html = `<!doctype html>\n${renderStaticHtml(<DocumentBriefEmail data={data} shareUrl={a.shareUrl} appUrl={a.appUrl} attached={a.attached} preheader={subject} />)}`
  return { subject, html, text: htmlToText(html) }
}
