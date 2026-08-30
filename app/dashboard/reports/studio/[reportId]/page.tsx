import { redirect } from 'next/navigation'

// The editor moved under the Studio (Stage 3); old links land there.
export default async function OldStudioPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params
  redirect(`/dashboard/studio/edit/${encodeURIComponent(reportId)}`)
}
