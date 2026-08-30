import { redirect } from 'next/navigation'

// Old deep links (the weekly email, bookmarks) land here; a sent update now
// opens in the Reports page's Sent group.
export default async function ReportViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/dashboard/reports?group=sent&item=${encodeURIComponent(id)}`)
}
