import { describe, expect, it } from 'vitest'
import { artifactFilename, artifactPath, type ArtifactRow } from './artifacts'

const row = (over: Partial<ArtifactRow>): ArtifactRow => ({
  id: 'a', client_id: 'c', snapshot_id: 's', format: 'pdf', tile_key: null, storage_path: 'p', bytes: 1, version: 1, render_ms: 1, stale: false, rendered_at: 'now', ...over,
})

describe('artifact paths and names', () => {
  it('keys the object by client, snapshot, tile and version', () => {
    expect(artifactPath('c1', 's1', null, 1, 'pdf')).toBe('c1/s1/page-v1.pdf')
    expect(artifactPath('c1', 's1', 'dashboard.strip', 2, 'png')).toBe('c1/s1/dashboard.strip-v2.png')
    expect(artifactPath('c1', 's1', 'voice.theme:3', 1, 'png')).toBe('c1/s1/voice.theme:3-v1.png')
    expect(artifactPath('c1', 's1', 'we ird/key', 1, 'png')).toBe('c1/s1/we_ird_key-v1.png')
  })

  it('names the download from the snapshot title', () => {
    expect(artifactFilename('Dashboard · Sealand · Sun 23 Aug', row({}))).toBe('dashboard-sealand-sun-23-aug.pdf')
    expect(artifactFilename('Dashboard · Sealand', row({ version: 3, format: 'png' }))).toBe('dashboard-sealand-v3.png')
    expect(artifactFilename('···', row({}))).toBe('export.pdf')
  })
})
