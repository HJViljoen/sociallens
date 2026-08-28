"use client"

import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { LayoutDashboard, Target, MessageCircle, Swords, Play, FileText, Users, UserRound, Sparkles, CreditCard, Settings, LogOut } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "@/app/login/actions"

// Two groups (component-map §1, MASTER rule 1): the intelligence pages a client
// reads, then the account pages. Trends was dissolved into the pages it served
// (2026-08-22): share over time lives on Competitive, theme movers on Voice,
// movement since the first update on the Dashboard, your accounts on Content.
const INTELLIGENCE = [
  { href: "/dashboard",             label: "Dashboard",           icon: LayoutDashboard },
  { href: "/dashboard/market",      label: "Market Intelligence", icon: Target },
  { href: "/dashboard/voice",       label: "Voice of Customer",   icon: MessageCircle },
  { href: "/dashboard/profile",     label: "Consumer Profile",    icon: UserRound },
  { href: "/dashboard/competitive", label: "Competitive Intel",   icon: Swords },
  { href: "/dashboard/videos",      label: "Content",             icon: Play },
]
const ACCOUNT = [
  { href: "/dashboard/reports",  label: "Reports",  icon: FileText },
  { href: "/dashboard/team",     label: "Team",     icon: Users },
  { href: "/dashboard/billing",  label: "Billing",  icon: CreditCard },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
]

// The agent rides its OWN flag, not the Ask one: lighting up the agent must
// not light up Pass E and the weekly re-evaluation inside a pipeline run.
const AGENT_ITEM = { href: "/dashboard/agent", label: "Verbatim Agent", icon: Sparkles }

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard }

// Active = weight + a 2px green bar on the left (rule 1: green marks the active
// page). No pill fill — the shadcn default paints bg-sidebar-accent on
// data-active, which is overridden here.
const ITEM_CLASS =
  "relative h-9 gap-2.5 rounded-md px-2.5 text-[13px] font-normal text-sidebar-foreground " +
  "hover:bg-sidebar-accent hover:text-foreground " +
  "data-active:bg-transparent data-active:font-semibold data-active:text-foreground " +
  "data-active:before:absolute data-active:before:-left-2 data-active:before:top-2 data-active:before:bottom-2 " +
  "data-active:before:w-0.5 data-active:before:rounded-full data-active:before:bg-primary data-active:before:content-['']"

export function AppSidebar({ showAgent = false }: { showAgent?: boolean }) {
  const pathname = usePathname()
  // The agent sits directly under the profile it reads from.
  const intelligence: NavItem[] = showAgent
    ? INTELLIGENCE.flatMap((item) => (item.href === "/dashboard/profile" ? [item, AGENT_ITEM] : [item]))
    : INTELLIGENCE
  // Close the mobile drawer when a nav item is tapped — otherwise it stays
  // open over the new page until the backdrop is tapped.
  const { setOpenMobile } = useSidebar()

  async function handleLogout() {
    await signOut()
  }

  const renderGroup = (label: string, items: NavItem[]) => (
    <SidebarGroup className="px-2">
      <SidebarGroupLabel className="h-7 px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/80">
        {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton asChild isActive={pathname === item.href} className={ITEM_CLASS}>
                <Link href={item.href} onClick={() => setOpenMobile(false)}>
                  <item.icon className="size-4 text-muted-foreground group-data-active/menu-button:text-foreground" aria-hidden />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )

  return (
    <Sidebar variant="sidebar" collapsible="offcanvas">
      <SidebarHeader>
        <div className="flex items-baseline gap-2 px-4 pt-5 pb-1">
          <span className="text-[16px] font-bold tracking-[-0.02em] text-foreground">Verbatim</span>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-1 pt-1">
        {renderGroup("Intelligence", intelligence)}
        {renderGroup("Account", ACCOUNT)}
      </SidebarContent>

      <SidebarFooter className="px-2 pb-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} className={ITEM_CLASS}>
              <LogOut className="size-4 text-muted-foreground" aria-hidden />
              <span>Logout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
