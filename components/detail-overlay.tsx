import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'

// URL-driven detail overlay — a card over the page, no client JS. Opening is a
// Link that adds ?detail=… (scroll={false} keeps the reader's place); the
// backdrop and ✕ are Links back to closeHref. Server-rendered like every other
// surface, so overlay content is shareable and works without hydration.

export function DetailOverlay({ closeHref, children }: { closeHref: string; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
      <Link href={closeHref} scroll={false} aria-label="Close" className="absolute inset-0 bg-foreground/25" />
      <Card className="relative z-10 w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-tile-hover">
        <Link
          href={closeHref}
          scroll={false}
          aria-label="Close"
          className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-full text-sm text-muted-foreground hover:bg-muted"
        >
          ✕
        </Link>
        <CardContent className="pt-6">{children}</CardContent>
      </Card>
    </div>
  )
}
