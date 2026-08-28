import { PRIVACY_URL, TERMS_URL } from '@/lib/legal'

/**
 * Consent line on the two account-creation surfaces (T0-9, 2026-08-18).
 * Neither /signup nor invite acceptance said anything at all about terms or
 * privacy, on a product that reads other people's public conversation for a
 * living. A checkbox rather than a passive notice: creating the account is the
 * moment the agreement is made.
 */
export function LegalConsent({ disabled }: { disabled?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        name="accept_terms"
        required
        disabled={disabled}
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-input accent-primary"
      />
      <span>
        I agree to the{' '}
        <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="cursor-pointer text-foreground underline underline-offset-2">terms</a>{' '}
        and the{' '}
        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="cursor-pointer text-foreground underline underline-offset-2">privacy notice</a>.
      </span>
    </label>
  )
}
