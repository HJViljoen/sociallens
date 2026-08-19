import { extractText, getDocumentProxy } from 'unpdf'
import { ASK_PDF_MAX_BYTES, ASK_PDF_MAX_PAGES, ASK_PDF_MIN_CHARS_PER_PAGE } from '../config'

// Reading a submitted plan out of a PDF.
//
// unpdf rather than pdf-parse or raw pdfjs-dist: zero native dependencies, no
// next.config change (a static import specifier is traced by the bundler,
// which is exactly where raw pdfjs-dist fails), and pdf-parse v2 hard-depends
// on an 80 MB canvas package for something we never do — render a page.
//
// The file itself is never stored. Only the text comes out, and only the text
// is kept, so a plan does not become a document store with a retention policy
// nobody wrote.

export interface PdfExtraction {
  text: string
  pages: number
  /** True when the document has pages but almost no extractable text — a
   *  scanned or image-only deck. There is no OCR here, so this is reported
   *  rather than silently treated as an empty plan. */
  imageOnly: boolean
}

export class PdfTooLargeError extends Error {}
export class PdfUnreadableError extends Error {}

/**
 * Extract text from a PDF buffer.
 *
 * Size is checked BEFORE parsing (the transcript path's habit: check the
 * declared length, then the real one — a lying or absent header is normal).
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtraction> {
  if (bytes.byteLength > ASK_PDF_MAX_BYTES) {
    throw new PdfTooLargeError(`PDF is ${Math.round(bytes.byteLength / 1e6)}MB, over the ${Math.round(ASK_PDF_MAX_BYTES / 1e6)}MB limit`)
  }

  let pages = 0
  let text = ''
  try {
    // pdf.js DETACHES the buffer it is handed, so a caller that also wants to
    // hash or re-read the bytes would find them emptied. Copy defensively.
    const doc = await getDocumentProxy(new Uint8Array(bytes))
    pages = doc.numPages
    const result = await extractText(doc, { mergePages: true })
    text = typeof result.text === 'string' ? result.text : String(result.text ?? '')
  } catch (e) {
    throw new PdfUnreadableError(`Could not read this PDF: ${e instanceof Error ? e.message : String(e)}`)
  }

  const cleaned = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const perPage = pages > 0 ? cleaned.length / pages : 0
  return {
    text: cleaned,
    pages,
    imageOnly: pages > 0 && perPage < ASK_PDF_MIN_CHARS_PER_PAGE,
  }
}

/** Pages beyond this are still extracted (unpdf reads the whole document in one
 *  pass) but the caller is told, because a 200-page appendix dump is not a plan
 *  and the claim extractor will read only the clipped head of it. */
export function pageWarning(pages: number): string | null {
  return pages > ASK_PDF_MAX_PAGES ? `${pages} pages — only the first part will be read` : null
}
