import type { MetadataRoute } from 'next'
import { playbooks, USE_CASES_PUBLIC } from './site/_data/playbooks'

// The marketing site's sitemap, served at the apex (verbatimintel.com/sitemap.xml).
// proxy.ts rewrites every apex path to /site/<path> EXCEPT a path with a file
// extension (its very first check: `/\.[^/]+$/.test(pathname)` short-circuits
// to NextResponse.next()), so /sitemap.xml skips that rewrite and is served
// directly by this root-level route — exactly where Next's sitemap convention
// expects it, no proxy change needed.
const BASE = 'https://verbatimintel.com'

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPaths = ['', '/how-it-works', ...(USE_CASES_PUBLIC ? ['/use-cases'] : []), '/privacy', '/terms']
  const playbookPaths = USE_CASES_PUBLIC ? playbooks.map((pb) => `/use-cases/${pb.slug}`) : []
  const lastModified = new Date()
  return [...staticPaths, ...playbookPaths].map((path) => ({
    url: `${BASE}${path}`,
    lastModified,
  }))
}
