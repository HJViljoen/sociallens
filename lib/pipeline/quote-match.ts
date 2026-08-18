/** The one definition of "this quote appears in that text". Exported so the
 *  eval harness, the retention refresh (a YouTube comment edited upstream) and
 *  the erasure script measure exactly what the pipeline enforces — a second
 *  copy would drift, and this repo has already been burned by a diagnostic that
 *  carried its own copy of production logic and produced confident, wrong
 *  evidence (scripts/diagnose-owned, 2026-08-16). Lives outside pass-a.ts so
 *  callers that never touch OpenAI don't import it. */
export function normForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when `quote` still appears verbatim (normalised) inside `text`. */
export function quoteAppearsIn(quote: string, text: string): boolean {
  const needle = normForMatch(quote)
  return needle.length > 0 && normForMatch(text).includes(needle)
}
