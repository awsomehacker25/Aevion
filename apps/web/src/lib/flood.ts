import type { FloodLayers } from '../FloodMap'
import type { FloodManifest, FloodSeries, FloodView } from '../types'
import { readLink, shortDate, writeLink } from './link'

export type FloodTab = 'overview' | 'layers' | 'charts' | 'impact' | 'learn'
export const FLOOD_TABS: FloodTab[] = ['overview', 'layers', 'charts', 'impact', 'learn']

/** Everything the viewer shows that can go into a shared link. */
export interface FloodState {
  a: number
  b: number
  view: FloodView
  water: boolean
  swipeOn: boolean
  tab: FloodTab
  expert: boolean
  layers: FloodLayers
  cam: { lng: number; lat: number; zoom: number } | null
}

/** Layers that cover the whole map: only one of these shows at a time. */
export const EXCLUSIVE = ['optical', 'sentinel1', 'population'] as const

export const DEFAULT_LAYERS: FloodLayers = { districts: true, permwater: true, aftermath: false, population: false, optical: false, pins: true, sentinel1: false }

/** Default view: the dry-season reference on the left, the flood peak on the right. */
export function initialFloodState(f: FloodManifest): FloodState {
  const ref = Math.max(0, f.dates.findIndex((d) => d.date === f.reference))
  const peak = f.dates.reduce((best, d, i) => ((d.new_water_km2 ?? 0) > (f.dates[best].new_water_km2 ?? 0) ? i : best), 0)
  return { a: ref, b: peak, view: 'HH', water: true, swipeOn: true, tab: 'overview', expert: false, layers: { ...DEFAULT_LAYERS }, cam: null }
}

/** The link keeps v = radar view, d = right date, c = compare date and t = tab (see lib/link.ts). */
export function readHash(f: FloodManifest, s: FloodState): { state: FloodState; fromHash: boolean } {
  const h = readLink()
  const idx = (iso: string | null) => f.dates.findIndex((d) => d.date === iso)
  const next = { ...s }
  if (idx(h.d) >= 0) next.b = idx(h.d)
  if (idx(h.c) >= 0) next.a = idx(h.c)
  const v = h.v?.toUpperCase()
  if (v === 'HH' || v === 'HV' || (v === 'RGB' && f.dates.every((d) => d.layers.RGB))) next.view = v
  const tab = h.t === 'story' ? 'overview' : h.t === 'evidence' ? 'impact' : h.t
  if (FLOOD_TABS.includes(tab as FloodTab)) next.tab = tab as FloodTab
  return { state: next, fromHash: !!(h.v || h.d || h.c || h.t) }
}

export function writeHash(f: FloodManifest, s: FloodState) {
  writeLink({ v: s.view.toLowerCase(), d: shortDate(f.dates[s.b].date), c: shortDate(f.dates[s.a].date), t: s.tab })
}

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
