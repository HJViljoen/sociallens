import type { ReactNode } from 'react'
import { PageFrame, PageBar } from '@/components/shell/page-grid'
import { PaneHeader, PaneBody, RailGroup, RailLink } from '@/components/shell/master-list'

// The settings rail (component-map §3): one frame shared by Settings, Billing
// and Team so the account pages read as one place. Workspace settings are
// owner/admin-editable and member-readable, as before; Team holds the
// member-level pages. Two panes, not resizable — settings don't need it.

export type SettingsSection = 'tracking' | 'connections' | 'billing' | 'team' | 'guide'

const RAIL: { key: SettingsSection; href: string; label: string; group: 'Workspace' | 'Help' }[] = [
  { key: 'tracking', href: '/dashboard/settings', label: 'Tracking & reports', group: 'Workspace' },
  { key: 'connections', href: '/dashboard/settings/connections', label: 'Connections', group: 'Workspace' },
  { key: 'billing', href: '/dashboard/billing', label: 'Plan & billing', group: 'Workspace' },
  { key: 'team', href: '/dashboard/team', label: 'Team', group: 'Workspace' },
  { key: 'guide', href: '/dashboard/guide', label: 'Guide', group: 'Help' },
]

export function SettingsFrame({
  active, title, context, contentTitle, contentMeta, children, controls,
}: {
  active: SettingsSection
  title: string
  context?: ReactNode
  contentTitle?: ReactNode
  contentMeta?: ReactNode
  controls?: ReactNode
  children: ReactNode
}) {
  return (
    <PageFrame className="min-h-0 flex-1">
      <PageBar title={title} context={context}>{controls}</PageBar>
      <div className="flex min-h-0 flex-col gap-3 md:h-[calc(100dvh_-_6.75rem)] md:flex-none md:flex-row">
        <section className="flex shrink-0 flex-col overflow-hidden rounded-lg bg-tile shadow-tile md:w-[220px]">
          <PaneHeader title="Account" />
          <PaneBody>
            {(['Workspace', 'Help'] as const).map((g) => (
              <RailGroup key={g} label={g}>
                {RAIL.filter((r) => r.group === g).map((r) => (
                  <RailLink key={r.key} href={r.href} active={active === r.key}>{r.label}</RailLink>
                ))}
              </RailGroup>
            ))}
          </PaneBody>
        </section>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-tile shadow-tile">
          {contentTitle && <PaneHeader title={contentTitle} meta={contentMeta} />}
          <PaneBody className="px-5 py-4">{children}</PaneBody>
        </section>
      </div>
    </PageFrame>
  )
}

/** A settings card: an inner block with a title, a one-line description and
 *  its fields — the nesting level under the content pane. */
export function SettingsCard({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-md bg-inner px-4 py-3.5 ${className ?? ''}`}>
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {description && <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** A read-only fact row inside a card: label · value. */
export function FactRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border/70 py-2 first:border-t-0 first:pt-0 last:pb-0">
      <span className="shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-[12.5px]">{children}</span>
    </div>
  )
}

/** A connection row: name · what it does · status. Status is a word, never a
 *  toggle that does nothing (honest empties). */
export function ConnectionRow({ name, what, status, action }: { name: ReactNode; what: ReactNode; status: 'connected' | 'not-connected' | 'coming-soon' | 'in-development' | 'paused'; action?: ReactNode }) {
  const label = status === 'connected' ? 'Connected' : status === 'not-connected' ? 'Not connected' : status === 'in-development' ? 'In development' : status === 'paused' ? 'Paused' : 'Coming soon'
  const cls = status === 'connected' ? 'bg-accent text-accent-foreground' : status === 'not-connected' ? 'bg-warning/15 text-warning' : status === 'paused' ? 'bg-inner text-muted-foreground' : 'bg-tile text-muted-foreground ring-1 ring-border'
  return (
    <div className="flex items-center gap-3 border-t border-border/70 py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{name}</p>
        <p className="text-[11.5px] text-muted-foreground">{what}</p>
      </div>
      {action}
      <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-px text-[10.5px] font-medium ${cls}`}>{label}</span>
    </div>
  )
}
