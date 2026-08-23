import { redirect } from 'next/navigation'

// Retired 2026-08-23: the Verbatim Agent superseded the Ask page (same
// question + plan/document check, and more). The engine (lib/ask, plan_checks,
// /api/ask) stays — the agent's document mode runs on it.
export default function AskPage() {
  redirect('/dashboard/agent')
}
