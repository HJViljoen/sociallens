import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  // Static assets (crowd.svg, favicon.ico, …) are never auth-gated or
  // rewritten, on any host. Without this, an unauthenticated request for a
  // public/ file 307s to /login — which silently broke the crowd artwork on
  // the login page itself.
  if (/\.[^/]+$/.test(request.nextUrl.pathname)) {
    return NextResponse.next()
  }

  // ── Marketing site (apex domain) ─────────────────────────────────────────
  // verbatimintel.com serves the public marketing pages (app/site/*) and never
  // touches Supabase; the product lives on app.verbatimintel.com. Host-based
  // rewrite keeps both in one project sharing one design system.
  const host = (request.headers.get('host') ?? '').toLowerCase()
  const isMarketingHost = host === 'verbatimintel.com' || host === 'www.verbatimintel.com'
  if (isMarketingHost) {
    const url = request.nextUrl.clone()
    url.port = ''
    // Canonical host: www → apex.
    if (host === 'www.verbatimintel.com') {
      url.host = 'verbatimintel.com'
      return NextResponse.redirect(url, 308)
    }
    // Old apex links to app paths (the apex used to 307 to the app) keep working.
    const appPaths = ['/login', '/signup', '/invite', '/dashboard', '/onboarding', '/reset', '/auth', '/r/']
    if (appPaths.some((p) => url.pathname.startsWith(p))) {
      url.host = 'app.verbatimintel.com'
      return NextResponse.redirect(url, 308)
    }
    if (!url.pathname.startsWith('/site')) {
      url.pathname = url.pathname === '/' ? '/site' : `/site${url.pathname}`
      return NextResponse.rewrite(url)
    }
    return NextResponse.next()
  }
  // The app host never serves the marketing pages under their internal path.
  if (host === 'app.verbatimintel.com' && request.nextUrl.pathname.startsWith('/site')) {
    const url = request.nextUrl.clone()
    url.host = 'verbatimintel.com'
    url.port = ''
    url.pathname = request.nextUrl.pathname.replace(/^\/site/, '') || '/'
    return NextResponse.redirect(url, 308)
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getClaims() verifies the access token locally (ES256 + cached JWKS) and
  // still refreshes an expiring session through setAll above. getUser() was a
  // round-trip to the Auth server on every request — including every sidebar
  // prefetch, which fans out a dozen at once.
  const { data: claims } = await supabase.auth.getClaims()
  const user = claims?.claims?.sub ? claims.claims : null

  // Pages reachable without a session: sign in, sign up, password reset, and
  // invite acceptance (the invitee usually has no account yet).
  const { pathname } = request.nextUrl
  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/invite') ||
    // Password reset: the request page has no session by definition, the
    // callback is where the emailed link redeems its code for one, and the
    // confirm page runs on the session the callback just established (T0-3).
    pathname.startsWith('/reset') ||
    pathname.startsWith('/auth/callback') ||
    // Keep-warm target — pinged unauthenticated every 5 min (inngest keep-warm).
    pathname === '/health' ||
    // Print-mode HTML for the export renderer: fetched by headless Chrome
    // server-side, with no session. Gated by a signed, short-lived token that
    // the page itself verifies (lib/render-token.ts) — never by a session.
    pathname.startsWith('/render/') ||
    // Share links (Stage 2): read-only, no account, by unguessable token; the
    // page checks the token, expiry, revocation and any password itself.
    pathname.startsWith('/r/') ||
    // Marketing pages need no session — reachable directly in local dev, where
    // the host isn't the apex and the rewrite above doesn't apply.
    pathname.startsWith('/site')

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  // Exclude /api/inngest, /api/stripe and /api/admin: all are called without a
  // Supabase session and carry their own auth (Inngest/Stripe signing keys, the
  // service-role key for the admin trigger), so they must skip the redirect.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/inngest|api/stripe|api/admin).*)'],
}