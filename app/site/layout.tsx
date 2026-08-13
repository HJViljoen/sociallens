import type { Metadata } from 'next'
import Link from 'next/link'
import { Newsreader } from 'next/font/google'

// Marketing chrome. Served on the apex domain (see proxy.ts) under the
// "Annotated transcript" theme (DESIGN.md) — sage paper, Newsreader display,
// marker highlight. Newsreader loads here, not in the root layout, so the app
// bundle never carries it.

const newsreader = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
  style: ['normal', 'italic'],
})

export const metadata: Metadata = {
  title: 'Verbatim · Consumer Intelligence',
  description:
    'Know what your market is saying, without reading ten thousand comments. Verbatim reads the public conversation across your brand, your competitors and your category, and sends you one weekly report.',
}

const APP_URL = 'https://app.verbatimintel.com'

export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      className={`site-theme ${newsreader.variable} flex min-h-screen flex-col bg-background text-foreground`}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {/* Opaque, not 95%: page content was ghosting through the bar. The
          section links appear at lg, not md — at 768 (iPad portrait) they force
          every label in the bar onto two lines. */}
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5">
          <Link href="/" className="flex shrink-0 items-baseline gap-2.5 whitespace-nowrap">
            <span className="h-5 w-5 self-center rounded-md bg-primary" aria-hidden />
            <span className="text-lg font-bold tracking-tight">Verbatim</span>
            <span className="hidden text-sm text-muted-foreground lg:inline">
              Consumer intelligence
            </span>
          </Link>
          <nav className="flex items-center gap-5 whitespace-nowrap text-sm">
            <a href="#scope" className="hidden text-muted-foreground transition-colors duration-200 ease-site hover:text-foreground lg:inline">
              What it reads
            </a>
            <a href="#how" className="hidden text-muted-foreground transition-colors duration-200 ease-site hover:text-foreground lg:inline">
              How it works
            </a>
            <a href="#what" className="hidden text-muted-foreground transition-colors duration-200 ease-site hover:text-foreground lg:inline">
              What you get
            </a>
            <a
              href={`${APP_URL}/login`}
              className="flex h-11 items-center font-medium text-foreground/80 transition-colors duration-200 ease-site hover:text-foreground"
            >
              Sign in
            </a>
            <a
              href="#early-access"
              className="flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition duration-200 ease-site hover:brightness-110 active:scale-[0.97]"
            >
              Get early access
            </a>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 rounded-sm bg-primary" aria-hidden />
              <span className="font-bold tracking-tight">Verbatim</span>
            </div>
            <p className="mt-1 font-heading italic text-muted-foreground">
              Consumer intelligence, in their own words.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 text-sm text-muted-foreground">
            <a
              href={`${APP_URL}/login`}
              className="flex h-11 items-center transition-colors duration-200 ease-site hover:text-foreground"
            >
              Sign in
            </a>
            <a
              href="#early-access"
              className="flex h-11 items-center transition-colors duration-200 ease-site hover:text-foreground"
            >
              Early access
            </a>
            <span className="flex h-11 items-center">© 2026 Verbatim</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
