import type { FloodLayers } from '../FloodMap'
import type { FloodManifest, FloodSeries, FloodView } from '../types'

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

/** d = right date, c = compare date, v = radar view, tab, mode, swipe, at = lng,lat,zoom */
export function readHash(f: FloodManifest, s: FloodState): { state: FloodState; fromHash: boolean } {
  const h: Record<string, string> = {}
  location.hash.replace(/^#/, '').split('&').forEach((kv) => { const [k, v] = kv.split('='); if (k) h[k] = decodeURIComponent(v || '') })
  const idx = (iso: string) => f.dates.findIndex((d) => d.date === iso)
  const next = { ...s }
  if (idx(h.d) >= 0) next.b = idx(h.d)
  if (idx(h.c) >= 0) next.a = idx(h.c)
  if (h.v === 'HH' || h.v === 'HV' || (h.v === 'RGB' && f.dates.every((d) => d.layers.RGB))) next.view = h.v
  if (h.mode === 'plain' || h.mode === 'expert') next.expert = h.mode === 'expert'
  const tab = h.tab === 'story' ? 'overview' : h.tab === 'evidence' ? 'impact' : h.tab
  if (FLOOD_TABS.includes(tab as FloodTab)) next.tab = tab as FloodTab
  if (h.swipe === '0' || h.swipe === '1') next.swipeOn = h.swipe === '1'
  const at = (h.at || '').split(',').map(Number)
  next.cam = at.length === 3 && at.every(Number.isFinite) ? { lng: at[0], lat: at[1], zoom: at[2] } : null
  return { state: next, fromHash: Object.keys(h).length > 0 }
}

export function writeHash(f: FloodManifest, s: FloodState) {
  const parts = [`d=${f.dates[s.b].date}`, `c=${f.dates[s.a].date}`, `v=${s.view}`, `tab=${s.tab}`, `mode=${s.expert ? 'expert' : 'plain'}`, `swipe=${s.swipeOn ? 1 : 0}`]
  if (s.cam) parts.push(`at=${s.cam.lng.toFixed(4)},${s.cam.lat.toFixed(4)},${s.cam.zoom.toFixed(2)}`)
  const url = new URL(location.href)
  url.hash = parts.join('&')
  history.replaceState(null, '', url)
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
