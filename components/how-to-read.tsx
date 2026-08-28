'use client'

import { useSearchParams } from 'next/navigation'
import { GLOSSARY, type GlossaryKey } from '@/lib/calibration'
import { DrawerLink } from '@/components/shell/drawer-link'
import { Card, CardContent } from '@/components/ui/card'

// "How to read this page" — a quiet top-right trigger that opens the calibrated-
// language legend as a floating card (?detail=legend). URL-driven, but opened
// and closed with history.pushState (2026-08-23): the legend is static text
// that is always in the payload, so flipping it must not cost a server
// round trip the way a <Link> to ?detail=legend did. `open` is accepted for
// the server's first paint and ignored once the router has hydrated — the
// URL is the truth either way. Drop into a page header row; pass the page's
// own path as basePath.
export function HowToRead({ items, basePath }: { items: GlossaryKey[]; open?: boolean; basePath: string }) {
  const sp = useSearchParams()
  const isOpen = sp.get('detail') === 'legend'
  return (
    <>
      <DrawerLink
        href={`${basePath}?detail=legend`}
        className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-border transition-colors hover:bg-muted"
      >
        How to read this page
      </DrawerLink>
      {isOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
          <DrawerLink href={basePath} aria-label="Close" className="absolute inset-0 bg-foreground/25">{''}</DrawerLink>
          <Card className="relative z-10 w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-xl">
            <DrawerLink
              href={basePath}
              aria-label="Close"
              className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-full text-sm text-muted-foreground hover:bg-muted"
            >
              ✕
            </DrawerLink>
            <CardContent className="pt-6">
              <div className="space-y-3 pr-6">
                <h2 className="text-base font-semibold">How to read this page</h2>
                <dl className="space-y-1.5 text-sm text-muted-foreground">
                  {items.map((key) => (
                    <div key={key} className="flex gap-2">
                      <dt className="shrink-0 font-semibold text-foreground">{GLOSSARY[key][0]}</dt>
                      <dd>— {GLOSSARY[key][1]}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs opacity-80">
                  Every label above is assigned by a fixed rule from counted data — never worded by the AI.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
