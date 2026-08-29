import type { Metadata } from 'next'

// Share links: fonts and tokens from the root layout; none of the dashboard
// chrome. What a reader with no account sees.
export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
}

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-inner text-foreground">{children}</div>
}
