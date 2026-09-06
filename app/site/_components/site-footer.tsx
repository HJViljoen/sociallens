import Link from 'next/link'

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <span className="wordmark">
          <b>Verbatim</b>
          <span>consumer intelligence</span>
        </span>
        <span className="links">
          <Link href="/how-it-works">How it works</Link>
          <Link href="/use-cases">Use cases</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="mailto:hello@verbatimintel.com">hello@verbatimintel.com</a>
        </span>
        <span>Cape Town. Runs weekly.</span>
      </div>
    </footer>
  )
}
