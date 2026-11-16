import type { FloodSeries } from '../types'

/** HH and HV backscatter (dB) at a map position, one value per date, or null when the spot is outside the data. */
export function pointValues(s: FloodSeries, lng: number, lat: number): { HH: (number | null)[]; HV: (number | null)[] } | null {
  const [x0, y0, x1, y1] = s.bbox
  if (lng < x0 || lng > x1 || lat < y0 || lat > y1) return null
  const c = Math.min(s.cols - 1, Math.floor(((lng - x0) / (x1 - x0)) * s.cols))
  const r = Math.min(s.rows - 1, Math.floor(((y1 - lat) / (y1 - y0)) * s.rows))
  const get = (pol: 'HH' | 'HV') => s.values[pol].map((g) => (g && g[r] && g[r][c] != null ? g[r][c] * (s.scale || 1) : null))
  return { HH: get('HH'), HV: get('HV') }
}

export const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

/** Distance in km between two points, for "near a reported damage site". */
export function kmBetween(a: [number, number], b: [number, number]): number {
  const R = 6371
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}
