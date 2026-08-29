import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * artifacts — rendered files in the private `artifacts` Storage bucket, one
 * row per file (Reports & Exports T9, 2026-08-29). Reads are signed URLs
 * minted here after the tenant check in the route; writes are the service
 * role. The erasure sweep deletes a file whose snapshot carried an erased
 * voice and flags the row stale; the next download re-renders it.
 */

export const ARTIFACTS_BUCKET = 'artifacts'
export const SIGNED_URL_SECONDS = 60 * 60

export type ArtifactFormat = 'pdf' | 'png'

export interface ArtifactRow {
  id: string
  client_id: string
  snapshot_id: string
  format: ArtifactFormat
  tile_key: string | null
  storage_path: string
  bytes: number
  version: number
  render_ms: number | null
  stale: boolean
  rendered_at: string
}

/** artifacts/<client>/<snapshot>/<tile|page>-v<n>.<format> — unguessable
 *  already (uuids), and readable at a glance in the bucket browser. */
export function artifactPath(clientId: string, snapshotId: string, tileKey: string | null, version: number, format: ArtifactFormat): string {
  const name = tileKey ? tileKey.replace(/[^a-z0-9.:_-]/gi, '_') : 'page'
  return `${clientId}/${snapshotId}/${name}-v${version}.${format}`
}

const CONTENT_TYPE: Record<ArtifactFormat, string> = { pdf: 'application/pdf', png: 'image/png' }

export async function storeArtifact(
  admin: SupabaseClient,
  args: { clientId: string; snapshotId: string; format: ArtifactFormat; tileKey: string | null; buffer: Buffer; renderMs: number },
): Promise<ArtifactRow> {
  // Version = one past the latest for this snapshot/format/tile. Two renders
  // racing would both read the same count; the second upload's `upsert:
  // false` then fails loudly rather than overwriting the first.
  const { data: prev } = await admin
    .from('artifacts')
    .select('version')
    .eq('snapshot_id', args.snapshotId)
    .eq('format', args.format)
    .is('tile_key', args.tileKey ?? null)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const version = ((prev?.version as number | undefined) ?? 0) + 1
  const path = artifactPath(args.clientId, args.snapshotId, args.tileKey, version, args.format)
  const up = await admin.storage.from(ARTIFACTS_BUCKET).upload(path, args.buffer, { contentType: CONTENT_TYPE[args.format], upsert: false })
  if (up.error) throw new Error(`artifact: upload failed: ${up.error.message}`)
  const { data, error } = await admin
    .from('artifacts')
    .insert({
      client_id: args.clientId,
      snapshot_id: args.snapshotId,
      format: args.format,
      tile_key: args.tileKey,
      storage_path: path,
      bytes: args.buffer.length,
      version,
      render_ms: args.renderMs,
    })
    .select('*')
    .single()
  if (error || !data) {
    await admin.storage.from(ARTIFACTS_BUCKET).remove([path])
    throw new Error(`artifact: insert failed: ${error?.message ?? 'no row'}`)
  }
  return data as ArtifactRow
}

/** Re-render a STALE artifact in place: a new file at the next version, the
 *  same row updated and un-flagged — not a second row beside the first, which
 *  would list twice in Reports and render again on every click. */
export async function replaceArtifactFile(
  admin: SupabaseClient,
  artifact: ArtifactRow,
  args: { buffer: Buffer; renderMs: number },
): Promise<ArtifactRow> {
  const version = artifact.version + 1
  const path = artifactPath(artifact.client_id, artifact.snapshot_id, artifact.tile_key, version, artifact.format)
  const up = await admin.storage.from(ARTIFACTS_BUCKET).upload(path, args.buffer, { contentType: CONTENT_TYPE[artifact.format], upsert: false })
  if (up.error) throw new Error(`artifact: upload failed: ${up.error.message}`)
  const { data, error } = await admin
    .from('artifacts')
    .update({ storage_path: path, bytes: args.buffer.length, version, render_ms: args.renderMs, stale: false, rendered_at: new Date().toISOString() })
    .eq('id', artifact.id)
    .select('*')
    .single()
  if (error || !data) {
    await admin.storage.from(ARTIFACTS_BUCKET).remove([path])
    throw new Error(`artifact: replace failed: ${error?.message ?? 'no row'}`)
  }
  return data as ArtifactRow
}

/** A one-hour signed URL that downloads as a sensible filename. */
export async function signedArtifactUrl(admin: SupabaseClient, artifact: ArtifactRow, filename: string): Promise<string> {
  const { data, error } = await admin.storage
    .from(ARTIFACTS_BUCKET)
    .createSignedUrl(artifact.storage_path, SIGNED_URL_SECONDS, { download: filename })
  if (error || !data?.signedUrl) throw new Error(`artifact: signed url failed: ${error?.message ?? 'no url'}`)
  return data.signedUrl
}

/** Storage-safe download name: "<title> · v2.pdf" → "title-v2.pdf". */
export function artifactFilename(title: string, artifact: ArtifactRow): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'export'
  return `${base}${artifact.version > 1 ? `-v${artifact.version}` : ''}.${artifact.format}`
}

/** Erasure (plan D6): the files of every artifact under these snapshots are
 *  deleted now — a PDF with the words baked in cannot wait — and the rows are
 *  flagged so the next download re-renders from the snapshot, where the
 *  erased voice no longer resolves. Returns what was touched. */
export async function markSnapshotsStale(
  admin: SupabaseClient,
  snapshotIds: string[],
  opts: { apply: boolean },
): Promise<{ artifacts: number; files: number }> {
  if (snapshotIds.length === 0) return { artifacts: 0, files: 0 }
  const { data, error } = await admin.from('artifacts').select('id, storage_path, stale').in('snapshot_id', snapshotIds)
  if (error) throw new Error(`artifact: read failed: ${error.message}`)
  const rows = (data ?? []) as { id: string; storage_path: string; stale: boolean }[]
  const live = rows.filter((r) => !r.stale)
  if (opts.apply && live.length) {
    // Flag FIRST: a flagged row with a file still present re-renders on the
    // next download; a deleted file with an unflagged row 302s to nothing.
    const upd = await admin.from('artifacts').update({ stale: true }).in('id', live.map((r) => r.id))
    if (upd.error) throw new Error(`artifact: stale flag failed: ${upd.error.message}`)
    const rm = await admin.storage.from(ARTIFACTS_BUCKET).remove(live.map((r) => r.storage_path))
    if (rm.error) throw new Error(`artifact: remove failed: ${rm.error.message}`)
  }
  return { artifacts: live.length, files: live.length }
}

export type ExportAction = 'export' | 'download' | 'rerender'

/** export_events — the Stage-1 gate: does anything travel? Non-fatal. */
export async function logExport(
  admin: SupabaseClient,
  ev: { clientId: string; userId: string | null; snapshotId: string | null; artifactId: string | null; action: ExportAction; kind: string; format: string; page?: string | null; tileKey?: string | null },
): Promise<void> {
  const { error } = await admin.from('export_events').insert({
    client_id: ev.clientId,
    user_id: ev.userId,
    snapshot_id: ev.snapshotId,
    artifact_id: ev.artifactId,
    action: ev.action,
    kind: ev.kind,
    format: ev.format,
    page: ev.page ?? null,
    tile_key: ev.tileKey ?? null,
  })
  if (error) console.error('[export] event log failed:', error.message)
}
