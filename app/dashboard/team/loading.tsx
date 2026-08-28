import { SettingsSkeleton } from '@/components/settings-skeleton'

// Loading skeleton for app/dashboard/team/page.tsx — the settings rail + content pane.
export default function Loading() {
  return <SettingsSkeleton title="Settings" cards={3} />
}
