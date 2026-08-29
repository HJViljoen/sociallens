import { getSessionContext } from '@/lib/auth'
import { loadProfile, type ProfileParams } from '@/lib/pages/profile'
import { ProfilePage } from '@/components/pages/profile'

// Consumer Profile — "who is actually talking?" Loader in lib/pages/profile.ts,
// renderers in components/pages/profile (Reports & Exports, 2026-08-29).

export default async function Page({ searchParams }: { searchParams: Promise<ProfileParams> }) {
  const { supabase, clientId } = await getSessionContext()
  const sp = await searchParams
  const data = await loadProfile({ supabase, clientId, params: sp })
  return <ProfilePage data={data} params={sp} />
}
