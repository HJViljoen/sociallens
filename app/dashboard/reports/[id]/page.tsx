import { redirect } from 'next/navigation'

// Old deep links (the weekly email, bookmarks) land here; the report itself
// now opens in the Reports page's detail pane.
export default async function ReportViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/dashboard/reports?group=weekly&item=${encodeURIComponent(id)}`)
}
