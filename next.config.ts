import type { NextConfig } from "next";

// The apex used to 307 here to the app. It now serves the marketing site,
// routed by host in proxy.ts. Config-level redirects run BEFORE the proxy, so
// this file must stay out of the way of that routing.
const nextConfig: NextConfig = {
  // Reports & Exports (2026-08-29): the export route prints pages with
  // puppeteer-core + @sparticuz/chromium. Next 16 already leaves both packages
  // unbundled (they are on its built-in serverExternalPackages list); listed
  // here anyway so that stays true if the default list changes. The brotli
  // Chromium pack is read at runtime, which the file tracer cannot see, so it
  // is included by hand — for the two routes that launch a browser only.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  outputFileTracingIncludes: {
    '/api/export': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    // Route globs are picomatch: the brackets of a dynamic segment must be escaped.
    '/api/artifacts/\\[id\\]': ['./node_modules/@sparticuz/chromium/bin/**/*'],
    // Stage 2: building a report prints it too.
    '/api/reports/\\[id\\]/build': ['./node_modules/@sparticuz/chromium/bin/**/*'],
  },
  // Share links (Stage 2): a public, read-only page nobody should index. The
  // page sets metadata.robots as well; this is the header form for crawlers
  // that read headers before HTML.
  async headers() {
    return [{ source: '/r/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }] }]
  },
  experimental: {
    // Client router cache. Every dashboard route is dynamic (cookies), and the
    // default for dynamic segments is 0s — so going Dashboard → Voice → back
    // to Dashboard re-rendered the whole page on the server each time, ~25
    // DB requests and all. The data behind these pages changes once per
    // update (weekly), not per click; a minute of staleness on a revisit is
    // invisible, and the revisit becomes instant. Loading boundaries are
    // cached for the `static` window, so the prefetched skeleton paints the
    // moment a link is clicked.
    staleTimes: { dynamic: 60, static: 300 },
  },
};

export default nextConfig;
