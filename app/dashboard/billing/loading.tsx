import { SettingsSkeleton } from '@/components/settings-skeleton'

// Loading skeleton for app/dashboard/billing/page.tsx — the settings rail + content pane.
export default function Loading() {
  return <SettingsSkeleton title="Settings" cards={3} />
}
