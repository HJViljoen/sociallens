'use client'

import type { ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { closeDrawer } from '@/components/shell/drawer-link'

// The universal "one click deeper" surface of the one-screen pages: a right-hand
// drawer. URL-driven (?detail=<id> opens it), so every deep view stays linkable
// and the page itself stays a server component — only this thin wrapper is
// client code. Children are rendered on the server by the page and passed
// through.
//
// Two modes (2026-08-23):
// - `value` given → CLIENT-driven: open = (?detail === value), read from the
//   router's search params, and closing is a history.pushState. Opening via
//   DrawerLink and closing here cost no server round trip — the content was
//   already in the payload. Use this when the drawer's children do not depend
//   on ?detail (almost all of them).
// - no `value` → SERVER-driven (the original behaviour): `open` comes from the
//   page, closing navigates to closeHref. For drawers whose content is fetched
//   only when open (Voice's theme evidence, the language pool).
export function DetailDrawer({
  open, value, param = 'detail', closeHref, title, description, children,
}: {
  open?: boolean
  value?: string
  param?: string
  closeHref: string
  title: string
  description?: string
  children: ReactNode
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const clientDriven = value !== undefined
  const isOpen = clientDriven ? sp.get(param) === value : !!open
  return (
    <Sheet
      open={isOpen}
      onOpenChange={(next) => {
        if (next) return
        if (clientDriven) closeDrawer(closeHref)
        else router.push(closeHref, { scroll: false })
      }}
    >
      <SheetContent side="right" className="w-full gap-0 bg-tile p-0 data-[side=right]:sm:max-w-[30rem]">
        <SheetHeader className="border-b border-border/70 px-5 py-4 pr-12">
          <SheetTitle className="text-[15px] font-semibold">{title}</SheetTitle>
          {description ? (
            <SheetDescription className="text-[12px]">{description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">{title}</SheetDescription>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[12.5px] leading-[1.45]">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
