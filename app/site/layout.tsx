import type { Metadata } from 'next'
import { Bricolage_Grotesque } from 'next/font/google'
import './site.css'
import { SiteFooter } from './_components/site-footer'

// Marketing chrome. Served on the apex domain (see proxy.ts) under the
// marketing identity (DESIGN.md, "The murmur"): Bricolage Grotesque for
// everything a person did not say, IBM Plex Serif italic for everything a
// person did. Bricolage loads here, not in the root layout, so the app bundle
// never carries it. Pages render their own nav (dark inside the home hero,
// light and sticky on inner pages); the layout owns the footer.

const bricolage = Bricolage_Grotesque({
  variable: '--font-bricolage',
  subsets: ['latin'],
  weight: 'variable',
  axes: ['opsz'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Verbatim · They hear your name. We hear the market.',
  description:
    'Your name is 0.02% of the conversation. Verbatim reads the comment threads on TikTok, Instagram, YouTube and Reddit around your category and builds a working model of your market.',
}

export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`site-theme ${bricolage.variable}`}>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  )
}
