import type { Grid } from '../types'
import { sampleGrid } from './data'

const R_KM = 6371

export function haversineKm(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180
  const dLat = (b[1] - a[1]) * rad
  const dLon = (b[0] - a[0]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export interface ProfilePoint {
  km: number
  lon: number
  lat: number
  /** displacement in the grid's units (meters), null where there is no data */
  d: number | null
  c: number | null
}

/** Samples both grids along the straight line a -> b. */
export function sampleProfile(defo: Grid, cov: Grid, a: [number, number], b: [number, number], n = 240) {
  const totalKm = haversineKm(a, b)
  const points: ProfilePoint[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const lon = a[0] + (b[0] - a[0]) * t
    const lat = a[1] + (b[1] - a[1]) * t
    points.push({ km: totalKm * t, lon, lat, d: areaMean(defo, lon, lat, 1), c: sampleGrid(cov, lon, lat) })
  }
  return { points, totalKm }
}

/** Mean of the valid cells within `radius` cells of a point. Needs at least a third of them valid. */
export function areaMean(g: Grid, lon: number, lat: number, radius = 2): number | null {
  const [w, s, e, n] = g.bbox
  if (lon < w || lon > e || lat < s || lat > n) return null
  const cx = Math.min(g.width - 1, Math.floor(((lon - w) / (e - w)) * g.width))
  const cy = Math.min(g.height - 1, Math.floor(((n - lat) / (n - s)) * g.height))
  let sum = 0
  let count = 0
  let total = 0
  for (let y = Math.max(0, cy - radius); y <= Math.min(g.height - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(g.width - 1, cx + radius); x++) {
      total++
      const v = g.values[y * g.width + x]
      if (v != null && Number.isFinite(v)) { sum += v; count++ }
    }
  }
  return count >= Math.max(2, total / 3) ? sum / count : null
}

export interface OffsetEstimate {
  /** largest step between the average on either side of a point, same units as the profile */
  step: number
  atKm: number
  /** max minus min of the smoothed profile */
  peakToPeak: number
}

/** Finds the sharpest step in a profile: the likely fault offset. */
export function estimateOffset(points: ProfilePoint[], totalKm: number, windowKm = 6): OffsetEstimate | null {
  const n = points.length
  if (n < 12 || totalKm <= 0) return null
  const spacing = totalKm / (n - 1)
  const w = Math.max(3, Math.round(windowKm / spacing))
  const mean = (from: number, to: number) => {
    let s = 0
    let c = 0
    for (let i = from; i <= to; i++) {
      const v = points[i].d
      if (v != null) { s += v; c++ }
    }
    return c >= (to - from + 1) / 2 ? s / c : null
  }
  let best: OffsetEstimate | null = null
  for (let i = w; i < n - w; i++) {
    const left = mean(i - w, i - 1)
    const right = mean(i + 1, i + w)
    if (left == null || right == null) continue
    const step = right - left
    if (!best || Math.abs(step) > Math.abs(best.step)) best = { step, atKm: points[i].km, peakToPeak: 0 }
  }
  if (!best) return null
  const smooth: number[] = []
  for (let i = 1; i < n - 1; i++) {
    const m = mean(i - 1, i + 1)
    if (m != null) smooth.push(m)
  }
  if (smooth.length) best.peakToPeak = Math.max(...smooth) - Math.min(...smooth)
  return best
}
