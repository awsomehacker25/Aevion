import type { Grid } from '../types'

/** Area of one grid cell in km², from its bounding box and size (cells shrink toward the poles). */
export function cellKm2(g: Grid): number {
  const [w, s, e, n] = g.bbox
  const lat = ((s + n) / 2) * (Math.PI / 180)
  const dx = ((e - w) / g.width) * 111.32 * Math.cos(lat)
  const dy = ((n - s) / g.height) * 110.57
  return dx * dy
}

const valid = (v: number | null | undefined, nodata: number | null): v is number => v != null && v !== nodata && Number.isFinite(v)

/** Values of a grid that pass an optional mask (for example coherence above a threshold). */
export function values(g: Grid, mask?: { grid: Grid; min: number }): number[] {
  const out: number[] = []
  for (let i = 0; i < g.values.length; i++) {
    const v = g.values[i]
    if (!valid(v, g.nodata)) continue
    if (mask) { const c = mask.grid.values[i]; if (c == null || c < mask.min) continue }
    out.push(v)
  }
  return out
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))]
}

/** Counts per bin between lo and hi (values outside are clamped into the end bins). */
export function histogram(vals: number[], lo: number, hi: number, bins: number): { x: number; from: number; to: number; share: number }[] {
  const counts = new Array<number>(bins).fill(0)
  for (const v of vals) counts[Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)))]++
  const total = vals.length || 1
  const w = (hi - lo) / bins
  return counts.map((c, i) => ({ x: lo + (i + 0.5) * w, from: lo + i * w, to: lo + (i + 1) * w, share: (100 * c) / total }))
}

/** Area (km²) of valid cells that satisfy a test. */
export function areaWhere(g: Grid, test: (v: number) => boolean, mask?: { grid: Grid; min: number }): number {
  let n = 0
  for (let i = 0; i < g.values.length; i++) {
    const v = g.values[i]
    if (!valid(v, g.nodata)) continue
    if (mask) { const c = mask.grid.values[i]; if (c == null || c < mask.min) continue }
    if (test(v)) n++
  }
  return n * cellKm2(g)
}

export function mean(vals: number[]): number | null {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}
