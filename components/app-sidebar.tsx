"use client"

import {
  Sidebar, SidebarContent, SidebarFooter,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { LayoutDashboard, Target, MessageCircle, Swords, Play, FileText, Users, UserRound, MessageSquareQuote, Sparkles, CreditCard, Settings, LogOut } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "@/app/login/actions"

// Trends was dissolved into the pages it served (2026-08-22 redesign): share
// over time lives on Competitive, theme movers on Voice, movement since the
// first update on the Dashboard, your accounts on Content.
const baseNav = [
  { href: "/dashboard",           label: "Dashboard",          icon: LayoutDashboard },
  { href: "/dashboard/market",    label: "Market Intelligence",icon: Target },
  { href: "/dashboard/voice",     label: "Voice of Customer",  icon: MessageCircle },
  { href: "/dashboard/profile",   label: "Consumer Profile",   icon: UserRound },
  { href: "/dashboard/competitive",label: "Competitive Intel", icon: Swords },
  { href: "/dashboard/videos",    label: "Content",            icon: Play },
  { href: "/dashboard/reports",   label: "Reports",            icon: FileText },
  { href: "/dashboard/team",      label: "Team",               icon: Users },
  { href: "/dashboard/billing",   label: "Billing",            icon: CreditCard },
  { href: "/dashboard/settings",  label: "Settings",           icon: Settings },
]

// Ask is gated on the same flag as its route (/api/ask 404s without it) — an
// entry point to an endpoint that refuses is worse than no entry point.
const ASK_ITEM = { href: "/dashboard/ask", label: "Ask", icon: MessageSquareQuote }
// The agent rides its OWN flag, not the Ask one: lighting up the agent must
// not light up Pass E and the weekly re-evaluation inside a pipeline run.
const AGENT_ITEM = { href: "/dashboard/agent", label: "Verbatim Agent", icon: Sparkles }

export function AppSidebar({ showAsk = false, showAgent = false }: { showAsk?: boolean; showAgent?: boolean }) {
  const pathname = usePathname()
  // Ask sits just after the profile it reads from.
  const withAsk = showAsk
    ? baseNav.flatMap((item) => (item.href === "/dashboard/profile" ? [item, ASK_ITEM] : [item]))
    : baseNav
  // The agent sits directly under the profile it reads from, above Ask.
  const navItems = showAgent
    ? withAsk.flatMap((item) => (item.href === "/dashboard/profile" ? [item, AGENT_ITEM] : [item]))
    : withAsk
  // Close the mobile drawer when a nav item is tapped — otherwise it stays
  // open over the new page until the backdrop is tapped.
  const { setOpenMobile } = useSidebar()

  async function handleLogout() {
    await signOut()
  }

  return (
    <Sidebar variant="floating">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-3 pt-4 pb-2">
          <span className="h-7 w-7 rounded-lg bg-primary" aria-hidden />
          <span className="text-lg font-bold tracking-tight text-[#14291F]">Verbatim</span>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarMenu className="gap-1.5">
          {navItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={pathname === item.href}
                className="h-11 gap-3 rounded-xl px-3 font-medium"
              >
                <Link href={item.href} onClick={() => setOpenMobile(false)}>
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} className="h-11 gap-3 rounded-xl px-3 font-medium">
              <LogOut className="h-4 w-4" />
              <span>Logout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}