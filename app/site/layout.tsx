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
      <header className="sticky top-0 z-40 border-b border-border bg-background/95">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-baseline gap-2.5">
            <span className="h-5 w-5 self-center rounded-md bg-primary" aria-hidden />
            <span className="text-lg font-bold tracking-tight">Verbatim</span>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              Consumer intelligence
            </span>
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <a href="#scope" className="hidden text-muted-foreground transition-colors duration-200 hover:text-foreground md:inline">
              What it reads
            </a>
            <a href="#how" className="hidden text-muted-foreground transition-colors duration-200 hover:text-foreground md:inline">
              How it works
            </a>
            <a href="#what" className="hidden text-muted-foreground transition-colors duration-200 hover:text-foreground md:inline">
              What you get
            </a>
            <a href={`${APP_URL}/login`} className="font-medium text-foreground/80 transition-colors duration-200 hover:text-foreground">
              Sign in
            </a>
            <a
              href="#early-access"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition duration-200 hover:brightness-110 active:scale-[0.97]"
            >
              Get early access
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

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
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <a href={`${APP_URL}/login`} className="transition-colors duration-200 hover:text-foreground">
              Sign in
            </a>
            <a href="#early-access" className="transition-colors duration-200 hover:text-foreground">
              Early access
            </a>
            <span>© 2026 Verbatim</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
