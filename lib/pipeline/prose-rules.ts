// Shared prompt rule (Calibrated-Language doc 2026-07-04): magnitude words are
// assigned by code from measured data (lib/calibration.ts) — the model's prose
// must not free-style them. One string imported by Passes B/C/D so the wording
// never drifts between prompts.

export const CALIBRATED_PROSE_RULE =
  '- Your prose explains WHAT people express and WHY it matters — never HOW MUCH. ' +
  'Do not use intensity or frequency words: "very", "extremely", "significant", "overwhelming", ' +
  '"huge", "strong", "most", "many", "widespread", "frequent", "consistently", "growing", "increasingly", ' +
  'or their synonyms. The product renders measured counts next to your text, so a magnitude claim in ' +
  'prose is a defect. Comparisons ("X more than Y") are allowed only where the input data directly shows them.\n' +
  '- Prose is client-facing. NEVER cite internal handles like [T4] or T12 inside titles, findings, or ' +
  'descriptions — name the topic in plain words instead. T# belongs ONLY in the structured supporting_themes field.'

/** Defensive strip for internal handles that leak into client-facing prose
 *  despite the prompt rule (seen live: Pass C findings citing "[T18]",
 *  2026-07-09). Covers T# (themes), C# (competitive insights), and S# (client
 *  claims, Step 2b) — the same leak class for every bracket-labelled input.
 *  Removes bracketed refs and tidies the whitespace/punctuation left behind. */
export function stripThemeRefs(text: string): string {
  return text
    .replace(/\s*\[[TSC]\d+\](\[[TSC]\d+\])*/g, '')
    .replace(/\s*\([TSC]\d+(,\s*[TSC]\d+)*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim()
}
