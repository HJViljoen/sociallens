import Link from 'next/link'
import { PageFrame, PageBar, BarPill } from '@/components/shell/page-grid'
import { PaneHeader, PaneBody } from '@/components/shell/master-list'
import { STARTER_TEMPLATES } from '@/lib/reports/templates'
import { AUDIENCES } from '@/lib/reports/types'
import { catalogueTitle } from '@/lib/reports/catalogue'
import { createReport } from '@/app/dashboard/studio/actions'

// New report (Heinrich, 2026-08-30): pick a template to start from, or go
// custom and arrange it yourself. A template only arranges existing pages
// and suggests who it is written for; both are yours to change in the editor.

export const dynamic = 'force-dynamic'

const audienceLabel = (k: string) => AUDIENCES.find((a) => a.key === k)?.label ?? k

export default function NewReportPage() {
  return (
    <PageFrame className="min-h-0 flex-1">
      <PageBar title="New report" context="pick a starting point">
        <Link href="/dashboard/studio"><BarPill>Back to the Studio</BarPill></Link>
      </PageBar>
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-tile shadow-tile">
        <PaneHeader title="Templates" meta="arrange existing pages, never new analysis" />
        <PaneBody className="px-5 py-4">
          <form action={createReport} className="flex flex-col gap-6">
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
                    Use this template
                  </button>
                </li>
              ))}
              <li className="flex flex-col gap-2 rounded-[4px] bg-inner p-4">
                <div>
                  <p className="text-[14px] font-semibold">Custom</p>
                  <p className="font-mono text-[10.5px] text-muted-foreground">start empty</p>
                </div>
                <p className="text-[12.5px] leading-relaxed text-secondary-foreground">Choose the pages and tiles yourself, name the reader, and add a line of framing per section.</p>
                <button type="submit" className="mt-1 inline-flex h-[26px] w-fit items-center rounded-full bg-tile px-3 text-[12px] font-medium text-secondary-foreground ring-1 ring-border hover:bg-inner">
                  Start custom
                </button>
              </li>
            </ul>
          </form>
        </PaneBody>
      </section>
    </PageFrame>
  )
}
