import { SettingsSkeleton } from '@/components/settings-skeleton'

// Loading skeleton for app/dashboard/settings/page.tsx — the settings rail + content pane.
export default function Loading() {
  return <SettingsSkeleton title="Settings" cards={2} />
}
