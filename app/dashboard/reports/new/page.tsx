import { redirect } from 'next/navigation'

// The template picker moved into the Studio (Stage 3); old links land there.
export default function NewReportPage() {
  redirect('/dashboard/studio?group=templates')
}
