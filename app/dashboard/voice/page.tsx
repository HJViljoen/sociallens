import { getSessionContext } from '@/lib/auth'
import { loadVoice, type VoiceParams } from '@/lib/pages/voice'
import { VoicePage } from '@/components/pages/voice'

// Voice of Customer — "what are they saying?" Loader in lib/pages/voice.ts,
// renderers in components/pages/voice (Reports & Exports, 2026-08-29).

export default async function Page({ searchParams }: { searchParams?: Promise<VoiceParams> }) {
  const { supabase, clientId } = await getSessionContext()
  const sp = (await searchParams) ?? {}
  const data = await loadVoice({ supabase, clientId, params: sp })
  return <VoicePage data={data} detail={sp.detail} params={sp} />
}
