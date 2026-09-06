import Link from 'next/link'

const APP_URL = 'https://app.verbatimintel.com'

// Two variants of the same bar. `dark` is absolutely positioned inside the home
// hero (the voices start beneath its hairline); `light` is sticky on inner
// pages. Links are apex-relative, as everywhere on the marketing site.
export function SiteNav({ variant, current }: { variant: 'dark' | 'light'; current?: 'how-it-works' | 'playbooks' }) {
  return (
    <nav className={`nav ${variant}`} aria-label="Main">
      <div className="wrap">
        <Link href="/" className="wordmark">
          <b>Verbatim</b>
          <span>consumer intelligence</span>
        </Link>
        <div className="nav-links">
          <Link href="/how-it-works" className={current === 'how-it-works' ? 'here' : undefined}>
            How it works
          </Link>
          <Link href="/playbooks" className={current === 'playbooks' ? 'here' : undefined}>
            Playbooks
          </Link>
          <a href={`${APP_URL}/login`}>Sign in</a>
          <a className="btn btn-green" href="#early-access">
            Get early access
          </a>
        </div>
      </div>
    </nav>
  )
}
