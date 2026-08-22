import Link from 'next/link'
import { getSessionContext } from '@/lib/auth'
import { Card, CardContent } from '@/components/ui/card'
import { AskForm } from '@/components/ask-form'

// Ask — check an idea or a whole plan against the conversation already mined.
//
// The unit here is the CHECK, not the page: each one gets its own URL so it can
// be shared with someone who was not in the room, and so it can be re-tested
// against next week's conversation and show what moved.

interface CheckRow {
  id: string
  kind: string
  title: string | null
  summary: { supported?: number; contradicted?: number; untested?: number } | null
  created_at: string
  source_filename: string | null
}

export default async function AskPage() {
  const { supabase, clientId } = await getSessionContext()

  const { data: rows } = await supabase
    .from('plan_checks')
    .select('id, kind, title, summary, created_at, source_filename')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(20)
  const checks = (rows ?? []) as CheckRow[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Ask</h1>
      </div>

      <Card>
        <CardContent className="py-5">
          <AskForm />
        </CardContent>
      </Card>

      {checks.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Earlier checks</h2>
          <div className="space-y-2">
            {checks.map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/ask/${c.id}`}
                className="block rounded-lg border border-border px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {c.title || (c.kind === 'plan' ? 'Plan check' : 'Idea check')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {c.summary?.supported ?? 0} supported · {c.summary?.contradicted ?? 0} contradicted ·{' '}
                  {c.summary?.untested ?? 0} untested
                  {c.source_filename ? ` · ${c.source_filename}` : ''}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing checked yet. Start with something you believe about your buyers — the more specific,
            the more useful the answer.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
