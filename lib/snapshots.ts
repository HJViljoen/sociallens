import type { SupabaseClient } from '@supabase/supabase-js'
import { collectQuoteRefs, freezeQuotes, resolveQuotes } from './renderables/quotes-freeze'
import type { PageKey, PrintVariant } from './renderables/types'
import { fetchQuoteTextsByRefs } from './quotes'

/**
 * report_snapshots — what an export froze (Reports & Exports T9, 2026-08-29).
 *
 * A snapshot is the loader's tile-ready data with every quote's text emptied
 * and the refs kept (lib/renderables/quotes-freeze.ts). Numbers, ordering and
 * the reader's selection are stored; a third party's words never are — they
 * resolve live at render through insight_evidence (or a hero row), so an
 * erased voice cannot survive inside a stored export.
 */

/** 'report' (Stage 2): several pages' data under one snapshot, the Studio's
 *  build — lib/reports/build.ts; data is ReportSnapshotData. */
export type SnapshotKind = 'page' | 'tile' | 'agent_thread' | 'report'

export interface SnapshotRef {
  page?: PageKey
  tileKey?: string
  /** kind 'report': the reports row this build came from. */
  reportId?: string
  params: Record<string, string | undefined>
  variant?: PrintVariant
}

export interface SnapshotRow {
  id: string
  client_id: string
  kind: SnapshotKind
  ref: SnapshotRef
  title: string
  run_id: string | null
  data: unknown
  evidence_ids: string[]
  created_by: string | null
  created_at: string
}

export async function createSnapshot(
  admin: SupabaseClient,
  args: { clientId: string; userId: string | null; kind: SnapshotKind; ref: SnapshotRef; title: string; runId: string | null; data: unknown; reportId?: string | null },
): Promise<{ id: string; evidenceIds: string[] }> {
  const { data: frozen, refs } = freezeQuotes(args.data)
  const { data, error } = await admin
    .from('report_snapshots')
    .insert({
      client_id: args.clientId,
      kind: args.kind,
      ref: args.ref,
      title: args.title,
      run_id: args.runId,
      data: frozen,
      evidence_ids: refs,
      created_by: args.userId,
      ...(args.reportId ? { report_id: args.reportId } : {}),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`snapshot: insert failed: ${error?.message ?? 'no row'}`)
  return { id: data.id as string, evidenceIds: refs }
}

export async function loadSnapshot(admin: SupabaseClient, id: string): Promise<SnapshotRow | null> {
  const { data, error } = await admin.from('report_snapshots').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`snapshot: read failed: ${error.message}`)
  return (data as SnapshotRow | null) ?? null
}

/** The snapshot's data with the words put back — what the renderers get. */
export async function hydrateSnapshot<T = unknown>(admin: SupabaseClient, row: SnapshotRow): Promise<T> {
  const refs = collectQuoteRefs(row.data)
  const texts = refs.length ? await fetchQuoteTextsByRefs(admin, refs) : new Map<string, string>()
  return resolveQuotes(row.data, texts) as T
}
