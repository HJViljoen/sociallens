/**
 * Report recipients (Tier 0 T0-10, 2026-08-18).
 *
 * `tracking_configs.report_emails` is seeded with the signup email and never
 * touched again: Össur has five users and one address on the list, so four
 * people who were invited into the workspace never received the thing the
 * workspace produces. Accepting an invite now adds you to the list.
 *
 * Pure so the rule is testable and the same everywhere.
 */

/** Case-insensitive, whitespace-tolerant append. Returns the same array
 *  (by value) when the address is already there, so callers can skip the write. */
export function addRecipient(current: string[] | null | undefined, email: string): string[] {
  const clean = email.trim()
  const list = (current ?? []).map((e) => e.trim()).filter(Boolean)
  if (!clean) return list
  const has = list.some((e) => e.toLowerCase() === clean.toLowerCase())
  return has ? list : [...list, clean]
}
