import type { SupabaseClient } from '@supabase/supabase-js'
import { DOCUMENT_BUILD_STALE_MS } from '../../config'
import { BUILD_ACTIVE, type ReportBuildRow, type ReportBuildStatus } from '../types'

/**
 * The build row of a document report (T7, 2026-08-31). One build at a time
 * per report: the route refuses a second while one is young and unfinished,
 * and takes over one that died. The rules are pure so they can be tested;
 * the I/O below is the one door to `report_builds` for the app.
 */

export const BUILD_COLS = 'id, client_id, report_id, schedule_id, send_id, run_id, status, needs_review, error, snapshot_id, artifact_id, cost_usd, requested_by, started_at, finished_at'

export type InFlightDecision = 'busy' | 'takeover' | 'free'

/** What the latest build row means for a new request: finished → free;
 *  active and younger than the stale window → busy (someone is on it);
 *  active and older → takeover (mark it failed, start afresh). */
export function inFlightDecision(row: Pick<ReportBuildRow, 'status' | 'started_at'> | null, now = Date.now()): InFlightDecision {
  if (!row || !BUILD_ACTIVE.includes(row.status)) return 'free'
  const age = now - new Date(row.started_at).getTime()
  return age < DOCUMENT_BUILD_STALE_MS ? 'busy' : 'takeover'
}

/** The words the Studio shows for a status. No em dashes. */
export const BUILD_PHASE_WORDS: Record<ReportBuildStatus, string> = {
  queued: 'Queued',
  researching: 'Reading the update and asking the data',
  writing: 'Writing',
  checking: 'Checking the claims',
  rendering: 'Printing',
  delivering: 'Sending',
  done: 'Built',
  failed: 'Failed',
}

export async function latestBuild(admin: SupabaseClient, reportId: string): Promise<ReportBuildRow | null> {
  const { data, error } = await admin
    .from('report_builds')
    .select(BUILD_COLS)
    .eq('report_id', reportId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`report_builds: read failed: ${error.message}`)
  return (data as ReportBuildRow | null) ?? null
}

export async function loadBuild(admin: SupabaseClient, buildId: string): Promise<ReportBuildRow | null> {
  const { data, error } = await admin.from('report_builds').select(BUILD_COLS).eq('id', buildId).maybeSingle()
  if (error) throw new Error(`report_builds: read failed: ${error.message}`)
  return (data as ReportBuildRow | null) ?? null
}

export async function insertBuild(
  admin: SupabaseClient,
  args: { clientId: string; reportId: string; runId: string | null; requestedBy: string | null; scheduleId?: string | null; sendId?: string | null },
): Promise<ReportBuildRow> {
  const { data, error } = await admin
    .from('report_builds')
    .insert({
      client_id: args.clientId,
      report_id: args.reportId,
      run_id: args.runId,
      requested_by: args.requestedBy,
      schedule_id: args.scheduleId ?? null,
      send_id: args.sendId ?? null,
      status: 'queued',
    })
    .select(BUILD_COLS)
    .single()
  if (error || !data) throw new Error(`report_builds: insert failed: ${error?.message ?? 'no row'}`)
  return data as ReportBuildRow
}

export async function setBuildStatus(admin: SupabaseClient, buildId: string, status: ReportBuildStatus, patch: Partial<Pick<ReportBuildRow, 'snapshot_id' | 'artifact_id' | 'cost_usd' | 'needs_review'>> = {}): Promise<void> {
  const { error } = await admin.from('report_builds').update({ status, ...patch }).eq('id', buildId)
  if (error) throw new Error(`report_builds: update failed: ${error.message}`)
}

/** The build's spend so far, absolute (a retried step writes the same
 *  number again instead of adding to it). */
export async function setBuildCost(admin: SupabaseClient, buildId: string, totalUsd: number): Promise<void> {
  if (!(totalUsd > 0)) return
  const { error } = await admin.from('report_builds').update({ cost_usd: totalUsd }).eq('id', buildId)
  if (error) throw new Error(`report_builds: cost update failed: ${error.message}`)
}

export async function failBuild(admin: SupabaseClient, buildId: string, message: string): Promise<void> {
  const { error } = await admin
    .from('report_builds')
    .update({ status: 'failed', error: message.slice(0, 1000), finished_at: new Date().toISOString() })
    .eq('id', buildId)
    .not('status', 'in', '("done","failed")')
  if (error) throw new Error(`report_builds: fail failed: ${error.message}`)
}

export async function completeBuild(admin: SupabaseClient, buildId: string, patch: Partial<Pick<ReportBuildRow, 'artifact_id' | 'snapshot_id'>> = {}): Promise<void> {
  const { error } = await admin
    .from('report_builds')
    .update({ status: 'done', finished_at: new Date().toISOString(), ...patch })
    .eq('id', buildId)
    .neq('status', 'failed')
  if (error) throw new Error(`report_builds: complete failed: ${error.message}`)
}

/** The run a build is pinned to: the tenant's latest finished run. Null when
 *  the workspace has none yet (the route says so instead of enqueueing). */
export async function latestRunId(admin: SupabaseClient, clientId: string): Promise<string | null> {
  const { data } = await admin
    .from('pipeline_runs')
    .select('id')
    .eq('client_id', clientId)
    .in('status', ['completed', 'partial'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}
