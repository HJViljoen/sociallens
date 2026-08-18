// Shared chrome for the two legal pages (T0-9, 2026-08-18). Plain and readable
// on purpose: DESIGN.md's marker and anti-list rules are about persuasion
// surfaces, and this is not one. Newsreader for headings, body at 17px, one
// column, no cards.

export function LegalPage({
  title, updated, children,
}: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border">
      <div className="mx-auto w-full max-w-3xl px-5 py-16">
        <h1 className="font-heading text-4xl font-medium tracking-tight">{title}</h1>
        <p className="mt-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Last updated {updated}
        </p>
        <div className="mt-10 space-y-8 text-[17px] leading-relaxed text-foreground/90 [&_a]:cursor-pointer [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_h2]:font-heading [&_h2]:text-2xl [&_h2]:font-medium [&_h2]:tracking-tight [&_li]:mt-2 [&_ul]:list-disc [&_ul]:pl-6">
          {children}
        </div>
      </div>
    </section>
  )
}
