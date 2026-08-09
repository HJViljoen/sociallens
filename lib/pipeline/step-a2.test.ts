import { describe, expect, it } from 'vitest'
import { isMegaCluster, megaClusterThreshold } from './step-a2'
import { MEGA_CLUSTER_MIN } from '../config'

// Scale-aware mega-cluster tripwire (recalibrated 2026-08-09). The two
// historical cases are the calibration contract: the Sealand run-1 chaining
// blob must warn, Ossur run 2's legitimate largest theme must not. Real
// numbers from prod (audience_insights distinct source videos per run).

describe('isMegaCluster', () => {
  it('flags the Sealand run-1 chaining blob (119 videos)', () => {
    // Even at run 2's larger 385-video denominator the blob would still warn;
    // the run-1-era denominator was smaller, so this is the conservative case.
    expect(isMegaCluster(119, 385)).toBe(true)
    expect(isMegaCluster(119, 300)).toBe(true)
  })

  it('passes Ossur run 2’s legitimate 64-video theme at its real denominator', () => {
    // 64 of 385 distinct insight videos = 17% — coherent theme, not chaining.
    expect(isMegaCluster(64, 385)).toBe(false)
  })

  it('keeps the absolute floor for small corpora', () => {
    // Below MIN never warns regardless of share; just over MIN warns when the
    // corpus is small enough that share cannot raise the line.
    expect(isMegaCluster(MEGA_CLUSTER_MIN, 50)).toBe(false)
    expect(isMegaCluster(MEGA_CLUSTER_MIN + 1, 50)).toBe(true)
  })

  it('scales the line with corpus size', () => {
    // At 400 distinct videos the line is share-driven (100), not MIN.
    expect(megaClusterThreshold(400)).toBe(100)
    expect(isMegaCluster(100, 400)).toBe(false)
    expect(isMegaCluster(101, 400)).toBe(true)
  })

  it('falls back to MIN when the denominator is degenerate', () => {
    expect(megaClusterThreshold(0)).toBe(MEGA_CLUSTER_MIN)
    expect(isMegaCluster(MEGA_CLUSTER_MIN + 1, 0)).toBe(true)
  })
})
