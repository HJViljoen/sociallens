import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReportRow } from '../types'
import type { DocumentSnapshotData, DocumentWorkings } from './types'
import type { ResearchQuestion } from './questions'
import type { ResearchAnswer } from './research'
import { checkStep, contextFor, freezeStep, researchStep, writeStep } from './steps'
import { loadSnapshotWorkings } from '../../snapshots'
import { isDocumentData } from './types'

/**
 * A document build, in process, without a build row: read the update, ask,
 * write, check, freeze. No rendering here. The steps themselves live in
 * ./steps.ts (the Inngest function and the script run the same ones).
 */

export { DocumentBuildError, periodOf, previousBrief } from './steps'

export type DocumentPhase = 'researching' | 'writing' | 'checking' | 'freezing'

export interface DocumentBuildResult {
  snapshotId: string
  title: string
  data: DocumentSnapshotData
  workings: DocumentWorkings
  questions: ResearchQuestion[]
  answers: ResearchAnswer[]
  costUsd: number
  timings: Record<string, number>
  evidenceIds: string[]
}

export async function buildDocumentSnapshot(
  admin: SupabaseClient,
  args: { clientId: string; userId: string | null; report: ReportRow; company: string; runId?: string | null; check?: boolean; onPhase?: (phase: DocumentPhase) => void | Promise<void> },
): Promise<DocumentBuildResult> {
  const ctx = contextFor(args)
  await args.onPhase?.('researching')
  const research = await researchStep(admin, ctx)
  await args.onPhase?.('writing')
  const write = await writeStep(admin, ctx, research)
  let check = null
  if (args.check !== false) {
    await args.onPhase?.('checking')
    check = await checkStep(admin, ctx, write)
  }
  await args.onPhase?.('freezing')
  const costUsd = research.costUsd + write.costUsd + (check?.costUsd ?? 0)
  const timings = { ...research.timings, ...write.timings, ...(check?.timings ?? {}) }
  const freeze = await freezeStep(admin, ctx, { answers: research.answers, written: check?.written ?? write.written, check, costUsd, timings })
  const { data: row } = await admin.from('report_snapshots').select('data').eq('id', freeze.snapshotId).single()
  const data = (row as { data?: unknown } | null)?.data
  if (!isDocumentData(data)) throw new Error('The frozen snapshot is not a document.')
  const workings = (await loadSnapshotWorkings<DocumentWorkings>(admin, freeze.snapshotId, ctx.clientId)) as DocumentWorkings
  return { snapshotId: freeze.snapshotId, title: freeze.title, data, workings, questions: research.questions, answers: research.answers, costUsd, timings, evidenceIds: freeze.evidenceIds }
}
