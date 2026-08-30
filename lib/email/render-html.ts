import { createRequire } from 'node:module'
import type { ReactNode } from 'react'

/**
 * React elements → static HTML, for an email body.
 *
 * Next refuses a static import of react-dom/server inside an app route
 * (the route module is compiled in the server-component layer, where that
 * import means "you meant a Server Component"), and react-dom/static would
 * resolve to the RSC stub in the same layer. An email is neither: it is HTML
 * for a mail client to read. So the Node build is loaded at runtime, past the
 * bundler, from the project's own node_modules — the copy Next itself ships.
 */
type Render = (el: ReactNode) => string
let cached: Render | null = null

export function renderStaticHtml(el: ReactNode): string {
  if (!cached) {
    const req = createRequire(`${process.cwd()}/`)
    cached = (req('react-dom/server') as { renderToStaticMarkup: Render }).renderToStaticMarkup
  }
  return cached(el)
}
