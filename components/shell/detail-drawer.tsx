'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'

// The universal "one click deeper" surface of the one-screen pages: a right-hand
// drawer. URL-driven like DetailOverlay (?detail=<id> opens it; closing
// navigates to closeHref), so every deep view stays linkable and the page
// itself stays a server component — only this thin wrapper is client code.
// Children are rendered on the server by the page and passed through.

export function DetailDrawer({
  open, closeHref, title, description, children,
}: {
  open: boolean
  closeHref: string
  title: string
  description?: string
  children: ReactNode
}) {
  const router = useRouter()
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) router.push(closeHref, { scroll: false }) }}>
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
