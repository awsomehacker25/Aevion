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

// The coarse time series (about 660 m cells) smooths small ponds away, so "is it flooded here?" is read from the water-mask picture itself,
// which is the 40 m result drawn on the map. The last picture is kept so repeated clicks on one date are instant.
let maskCache: { url: string; ctx: CanvasRenderingContext2D; w: number; h: number } | null = null

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

/** True when the water mask shows new flood water at this spot, false when it does not, null when the spot is outside the picture or it cannot be read. */
export async function floodedAt(url: string, bbox: [number, number, number, number], lng: number, lat: number): Promise<boolean | null> {
  const [w, s, e, n] = bbox
  if (lng < w || lng > e || lat < s || lat > n) return null
  try {
    if (!maskCache || maskCache.url !== url) {
      const img = new Image()
      img.src = url
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = img.naturalWidth
      cv.height = img.naturalHeight
      const ctx = cv.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(img, 0, 0)
      maskCache = { url, ctx, w: cv.width, h: cv.height }
    }
    // the map stretches the picture evenly in map (Mercator) coordinates between its corners
    const x = Math.min(maskCache.w - 1, Math.floor(((lng - w) / (e - w)) * maskCache.w))
    const y = Math.min(maskCache.h - 1, Math.floor(((mercY(n) - mercY(lat)) / (mercY(n) - mercY(s))) * maskCache.h))
    // look at a small neighbourhood so a click right beside a thin patch still counts
    const r = 3
    const d = maskCache.ctx.getImageData(Math.max(0, x - r), Math.max(0, y - r), 2 * r + 1, 2 * r + 1).data
    let wet = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 40) wet++
    return wet >= 3
  } catch {
    return null
  }
}

const historyCache = new Map<string, { date: string; wet: boolean | null }[]>()

/** Was this spot under new flood water on each date? Reads each date's water-mask picture one after the other, so only one is in memory at a time. */
export async function floodHistory(
  dates: { date: string; url: string }[], bbox: [number, number, number, number], lng: number, lat: number,
): Promise<{ date: string; wet: boolean | null }[]> {
  const key = `${dates.map((d) => d.date).join(',')}|${lng.toFixed(5)}|${lat.toFixed(5)}`
  const hit = historyCache.get(key)
  if (hit) return hit
  const [w, s, e, n] = bbox
  const out: { date: string; wet: boolean | null }[] = []
  for (const d of dates) {
    let wet: boolean | null = null
    if (lng >= w && lng <= e && lat >= s && lat <= n) {
      try {
        const img = new Image()
        img.src = d.url
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.naturalWidth
        cv.height = img.naturalHeight
        const ctx = cv.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0)
        const x = Math.min(cv.width - 1, Math.floor(((lng - w) / (e - w)) * cv.width))
        const y = Math.min(cv.height - 1, Math.floor(((mercY(n) - mercY(lat)) / (mercY(n) - mercY(s))) * cv.height))
        const r = 3
        const px = ctx.getImageData(Math.max(0, x - r), Math.max(0, y - r), 2 * r + 1, 2 * r + 1).data
        let count = 0
        for (let i = 3; i < px.length; i += 4) if (px[i] > 40) count++
        wet = count >= 3
      } catch { wet = null }
    }
    out.push({ date: d.date, wet })
  }
  historyCache.set(key, out)
  return out
}

/** Distance in km between two points, for "near a reported damage site". */
export function kmBetween(a: [number, number], b: [number, number]): number {
  const R = 6371
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
