import type { ClaimResult } from './types'

// Finding each claim in the document it came from, so the annotated view can
// mark it in place.
//
// THE RULE, and it is the same one Pass A applies to comment quotes: a span is
// used ONLY if it is genuinely present in the document. A model asked for a
// verbatim will occasionally tidy or join sentences, and an unverified "quote"
// of the client's own brief is worse than no highlight at all — they would be
// looking at words they never wrote, attributed to themselves.
//
// A claim that does not anchor is NOT dropped. It stays in the list marked as
// unstated, because "your plan rests on this and never says it" is a genuinely
// useful thing to tell someone about to spend money on a campaign. The failure
// mode of the feature is another feature.

export interface Segment {
  text: string
  /** Claim ref this span belongs to, or null for ordinary document text. */
  ref: string | null
}

/** Collapse whitespace for COMPARISON only. PDF extraction breaks lines mid
 *  sentence, so an exact `indexOf` fails on text that is plainly there. The
 *  document is always rendered from the original characters — this normalising
 *  is used to locate, never to display. */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Locate a span in the document, tolerant of whitespace but nothing else.
 *
 * Returns the [start, end) range in the ORIGINAL string, or null. Walks the
 * original while matching against the normalised form, so the range maps back
 * to real characters including whatever line breaks sit inside it.
 */
export function findSpan(document: string, span: string): [number, number] | null {
  const needle = norm(span)
  if (needle.length < 12) return null // too short to be a safe anchor

  // Map every non-space character of the original to its index, and build the
  // normalised haystack alongside, so a hit can be translated back.
  const idx: number[] = []
  let hay = ''
  let lastWasSpace = true
  for (let i = 0; i < document.length; i++) {
    const ch = document[i]
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        hay += ' '
        idx.push(i)
        lastWasSpace = true
      }
      continue
    }
    hay += ch
    idx.push(i)
    lastWasSpace = false
  }

  const at = hay.indexOf(needle)
  if (at === -1) return null
  const start = idx[at]
  const end = (idx[at + needle.length - 1] ?? idx[idx.length - 1]) + 1
  return [start, end]
}

/**
 * Cut the document into segments, each either plain text or the span of one
 * claim, in document order.
 *
 * Overlaps are resolved first-come: two claims drawn from the same sentence
 * would otherwise produce interleaved ranges that cannot be rendered as a flat
 * list, and the second one simply goes unanchored.
 */
export function anchorClaims(document: string, claims: ClaimResult[]): {
  segments: Segment[]
  anchored: Set<string>
} {
  const ranges: { start: number; end: number; ref: string }[] = []
  const anchored = new Set<string>()

  for (const c of claims) {
    if (!c.source) continue
    const hit = findSpan(document, c.source)
    if (!hit) continue
    const [start, end] = hit
    if (ranges.some((r) => start < r.end && end > r.start)) continue
    ranges.push({ start, end, ref: c.ref })
    anchored.add(c.ref)
  }

  ranges.sort((a, b) => a.start - b.start)

  const segments: Segment[] = []
  let cursor = 0
  for (const r of ranges) {
    if (r.start > cursor) segments.push({ text: document.slice(cursor, r.start), ref: null })
    segments.push({ text: document.slice(r.start, r.end), ref: r.ref })
    cursor = r.end
  }
  if (cursor < document.length) segments.push({ text: document.slice(cursor), ref: null })

  return { segments, anchored }
}
