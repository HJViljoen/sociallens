import type { Metadata } from 'next'

// Share links: fonts and tokens from the root layout; none of the dashboard
// chrome. What a reader with no account sees.
export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
  // The token is the URL; it must never ride a Referer to a platform link.
  referrer: 'no-referrer',
}

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-inner text-foreground">{children}</div>
}
