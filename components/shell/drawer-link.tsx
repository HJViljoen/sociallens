'use client'

import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'

// A link that opens a drawer WITHOUT a server round trip. The drawers' content
// is rendered by the server on every visit anyway (it rides along in the page
// payload); only the open/closed state came from ?detail=, and a <Link> to
// ?detail=x re-rendered the whole dynamic page on the server just to flip it.
// history.pushState keeps the URL as the source of truth — Next syncs its
// router with native pushState, so useSearchParams() in DetailDrawer updates
// and the drawer opens on the next frame; the link stays a real <a>, so a
// middle-click, a copied URL or a page without JS still reach the same view.
export function DrawerLink({
  href, children, onClick, ...rest
}: { href: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <a
      href={href}
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e)
        if (e.defaultPrevented) return
        // Modified clicks (new tab, etc.) keep the browser's own behaviour.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        window.history.pushState(null, '', href)
      }}
    >
      {children}
    </a>
  )
}

/** Close a drawer the same way it was opened — URL first, no navigation. */
export function closeDrawer(closeHref: string) {
  window.history.pushState(null, '', closeHref)
}
