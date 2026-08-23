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
  return (
    <SidebarProvider>
      <AppSidebar showAgent={agentEnabled()} />
      {/* min-w-0: without it this flex item refuses to shrink below the
          intrinsic width of wide children (the Content page's 9-column table),
          so the whole page overflows the phone viewport instead of the table
          scrolling inside its own overflow-x-auto container.
          h-dvh + inner-scrolling <main>: the app scrolls inside its own pane
          instead of the document. On mobile the browser toolbar therefore
          never collapses — which was the only way to stop the toolbar
          animation visibly shifting the (previously window-fixed) crowd
          backdrop; the browser moves everything glued to the window edge
          while the bar animates, and no CSS on the layer can prevent that. */}
      <div className="relative flex flex-col flex-1 min-w-0 h-dvh overflow-hidden">
        <div className="crowd-bg" aria-hidden />
        <header className="relative z-10 flex shrink-0 items-center h-12 px-4 border-b border-border/60">
          <SidebarTrigger />
        </header>
        <main className="relative z-10 flex-1 min-h-0 overflow-y-auto p-6">
          <Suspense fallback={null}>
            <AccessBannerLoader />
          </Suspense>
          {children}
        </main>
      </div>
    </SidebarProvider>
  )
}