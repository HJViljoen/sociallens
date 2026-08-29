import Link from 'next/link'
import { getSessionContext } from '@/lib/auth'
import { PageFrame, PageBar, BarPill } from '@/components/shell/page-grid'
import { PaneHeader, PaneBody } from '@/components/shell/master-list'
import { STARTER_TEMPLATES } from '@/lib/reports/templates'
import { AUDIENCES } from '@/lib/reports/types'
import { catalogueTitle } from '@/lib/reports/catalogue'
import { createReport } from '@/app/dashboard/reports/studio/actions'

// New report: a starter, one of the workspace's own templates, or blank.
// A template only arranges existing pages and sets the cover register.

export const dynamic = 'force-dynamic'

const audienceLabel = (k: string) => AUDIENCES.find((a) => a.key === k)?.label ?? k

export default async function NewReportPage() {
  const { supabase, clientId } = await getSessionContext()
  const { data } = await supabase.from('report_templates').select('id, name, audience, sections, created_at').eq('client_id', clientId).order('created_at', { ascending: false })
  const own = (data ?? []) as { id: string; name: string; audience: string; sections: { page: string }[] }[]

  return (
    <PageFrame className="min-h-0 flex-1">
      <PageBar title="New report" context="pick a starting point">
        <Link href="/dashboard/reports?group=reports"><BarPill>Back to reports</BarPill></Link>
      </PageBar>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-tile shadow-tile">
        <PaneHeader title="Templates" meta="arrange existing pages — never new analysis" />
        <PaneBody className="px-5 py-4">
          <form action={createReport} className="flex flex-col gap-6">
            <div>
              <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Starters</p>
              <ul className="grid gap-3 md:grid-cols-2">
                {STARTER_TEMPLATES.map((t) => (
                  <li key={t.key} className="flex flex-col gap-2 rounded-[4px] bg-inner p-4">
                    <div>
                      <p className="text-[14px] font-semibold">{t.name}</p>
                      <p className="font-mono text-[10.5px] text-muted-foreground">for {audienceLabel(t.audience)} · {t.sections.length} section{t.sections.length === 1 ? '' : 's'} · {[...new Set(t.sections.map((s) => catalogueTitle(s.page)))].join(' · ')}</p>
                    </div>
                    <p className="text-[12.5px] leading-relaxed text-secondary-foreground">{t.description}</p>
                    <button type="submit" name="template" value={t.key}
                      className="mt-1 inline-flex h-[26px] w-fit items-center rounded-full bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Start from this
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">Your templates</p>
              {own.length ? (
                <ul className="grid gap-3 md:grid-cols-2">
                  {own.map((t) => (
                    <li key={t.id} className="flex flex-col gap-2 rounded-[4px] bg-inner p-4">
                      <p className="text-[14px] font-semibold">{t.name}</p>
                      <p className="font-mono text-[10.5px] text-muted-foreground">for {audienceLabel(t.audience)} · {t.sections?.length ?? 0} section{t.sections?.length === 1 ? '' : 's'}</p>
                      <button type="submit" name="tenant_template" value={t.id}
                        className="mt-1 inline-flex h-[26px] w-fit items-center rounded-full bg-tile px-3 text-[12px] font-medium text-secondary-foreground ring-1 ring-border hover:bg-inner">
                        Start from this
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-muted-foreground">None yet. Any arrangement in the Studio can be saved as one.</p>
              )}
            </div>
            <div>
              <button type="submit" className="inline-flex h-[26px] items-center rounded-full bg-tile px-3 text-[12px] font-medium text-secondary-foreground ring-1 ring-border hover:bg-inner">
                Start blank
              </button>
            </div>
          </form>
        </PaneBody>
      </section>
    </PageFrame>
  )
}
