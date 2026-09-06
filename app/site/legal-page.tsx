import { SiteNav } from './_components/site-nav'

// Shared chrome for the two legal pages. Plain and readable on purpose: the
// marketing identity's motion and scale are for persuasion surfaces, and this
// is not one. Bricolage for headings, body at 17px, one column, no cards.
export function LegalPage({
  title, updated, children,
}: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <SiteNav variant="light" />
      <section className="legal" id="content" tabIndex={-1}>
        <div className="wrap">
          <h1>{title}</h1>
          <p className="updated">Last updated {updated}</p>
          <div className="prose">{children}</div>
        </div>
      </section>
    </>
  )
}
