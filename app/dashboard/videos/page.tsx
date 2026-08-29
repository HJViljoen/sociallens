import { getSessionContext } from '@/lib/auth'
import { loadContent, type ContentParams } from '@/lib/pages/content'
import { ContentPage } from '@/components/pages/content'

// Content — "what content works, and who to answer?" Loader in
// lib/pages/content.ts, renderers in components/pages/content (Reports &
// Exports, 2026-08-29).

export default async function Page({ searchParams }: { searchParams?: Promise<ContentParams> }) {
  const { supabase, clientId } = await getSessionContext()
  const sp = (await searchParams) ?? {}
  const data = await loadContent({ supabase, clientId, params: sp })
  return <ContentPage data={data} params={sp} />
}
