import { Suspense } from "react"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { AccessBannerLoader } from "@/components/access-banner-loader"
import { agentEnabled } from "@/lib/config"

// Deliberately synchronous: no session, no DB. This layout wraps every
// dashboard route, and an async layout sits ABOVE each route's loading.tsx
// boundary — while it awaited the session + the clients row, no skeleton
// could paint and every navigation showed the old page frozen for the
// duration. The proxy already gates anonymous users; the page resolves the
// session (request-cached) and the billing banner streams in behind Suspense.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Sidebar 14rem, not shadcn's 16rem: labels sit closer to the edge and the
  // page gets the width back (Heinrich, 2026-08-28 walk-through).
  return (
    <SidebarProvider style={{ '--sidebar-width': '14rem' } as React.CSSProperties}>
      <AppSidebar showAgent={agentEnabled()} />
      {/* min-w-0: without it this flex item refuses to shrink below the
          intrinsic width of wide children (the Content page's 9-column table),
          so the whole page overflows the phone viewport instead of the table
          scrolling inside its own overflow-x-auto container.
          h-dvh + inner-scrolling <main>: the app scrolls inside its own pane
          instead of the document, so the sidebar stays put while content
          scrolls (this also stopped the mobile browser toolbar from animating,
          which used to shift the old window-fixed crowd backdrop).
          2026-08-28 (MASTER.md rules 6 + 8): the crowd art left the shell and
          the 48px header — which only ever held the mobile sidebar trigger —
          is gone; on phones the trigger floats in the top-left corner. */}
      <div className="relative flex flex-col flex-1 min-w-0 h-dvh overflow-hidden">
        <SidebarTrigger
          aria-label="Open navigation"
          className="absolute left-3 top-3 z-20 size-9 rounded-full bg-tile text-foreground shadow-tile md:hidden"
        />
        <main className="relative z-10 flex-1 min-h-0 overflow-y-auto p-6 pt-14 md:pt-6">
          <Suspense fallback={null}>
            <AccessBannerLoader />
          </Suspense>
          {children}
        </main>
      </div>
    </SidebarProvider>
  )
}