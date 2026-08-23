import { redirect } from 'next/navigation'

// Retired 2026-08-23 with the Ask page. Old check links land on the agent's
// history rather than a dead page.
export default function AskCheckPage() {
  redirect('/dashboard/agent')
}
