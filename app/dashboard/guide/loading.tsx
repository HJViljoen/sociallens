import { SettingsSkeleton } from '@/components/settings-skeleton'

// Loading skeleton for app/dashboard/guide/page.tsx — the settings rail + content pane.
export default function Loading() {
  return <SettingsSkeleton title="Guide" cards={3} />
}
