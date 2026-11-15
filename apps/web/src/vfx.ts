import type { Map as MlMap } from 'maplibre-gl'
import type { Feature, FeatureCollection, LineString } from 'geojson'
import { sampleGrid } from './lib/data'
import type { Grid, Story } from './types'

type BBox = Story['aoi']['bbox']

/** True when the point is inside the study-area ring (the same ellipse that AoiBeacon draws). */
export function insideRing(lng: number, lat: number, bbox: BBox): boolean {
  const [w, s, e, n] = bbox
  const k = Math.SQRT2 * 1.04
  const x = (lng - (w + e) / 2) / (((e - w) / 2) * k)
  const y = (lat - (s + n) / 2) / (((n - s) / 2) * k)
  return x * x + y * y <= 1
}

/** Box-blurred copy of a grid's values: no-data and low-coherence cells count as zero, so speckle cannot win a peak search or draw a contour. */
function smooth(g: Grid, coh: Grid | undefined, threshold: number, radius: number): Float32Array {
  const { width: W, height: H } = g
  const [w, s, e, n] = g.bbox
  const base = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = g.values[y * W + x]
      if (v == null || v === g.nodata || Number.isNaN(v)) continue
      if (coh) {
        const c = sampleGrid(coh, w + ((x + 0.5) / W) * (e - w), n - ((y + 0.5) / H) * (n - s))
        if (c != null && c < threshold) continue
      }
      base[y * W + x] = v
    }
  }
  // separable box blur
  const tmp = new Float32Array(W * H)
  const out = new Float32Array(W * H)
  const r = Math.max(1, radius)
  for (let y = 0; y < H; y++) {
    let acc = 0
    for (let x = -r; x <= r; x++) acc += base[y * W + Math.min(W - 1, Math.max(0, x))]
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = acc / (2 * r + 1)
      acc += base[y * W + Math.min(W - 1, x + r + 1)] - base[y * W + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x]
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / (2 * r + 1)
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]
    }
  }
  return out
}

/** Outlines of the regions that moved more than `level` in either direction, as line segments (marching squares on the smoothed grid). */
export function contours(g: Grid, coh: Grid | undefined, threshold: number, level: number): FeatureCollection<LineString> {
  const { width: W, height: H } = g
  const [w, s, e, n] = g.bbox
  const sm = smooth(g, coh, threshold, Math.max(2, Math.round(Math.min(W, H) / 80)))
  const lon = (x: number) => w + ((x + 0.5) / W) * (e - w)
  const lat = (y: number) => n - ((y + 0.5) / H) * (n - s)
  const feats: Feature<LineString>[] = []
  const lerp = (a: number, b: number, L: number) => (b === a ? 0.5 : (L - a) / (b - a))
  for (const L of [level, -level]) {
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W - 1; x++) {
        const a = sm[y * W + x] - L
        const b = sm[y * W + x + 1] - L
        const c = sm[(y + 1) * W + x + 1] - L
        const d = sm[(y + 1) * W + x] - L
        const sg = (v: number) => (L > 0 ? v > 0 : v < 0)
        const code = (sg(a) ? 8 : 0) | (sg(b) ? 4 : 0) | (sg(c) ? 2 : 0) | (sg(d) ? 1 : 0)
        if (code === 0 || code === 15) continue
        const lv = (v: number) => v + L
        const top: [number, number] = [lon(x + lerp(lv(a), lv(b), L)), lat(y)]
        const right: [number, number] = [lon(x + 1), lat(y + lerp(lv(b), lv(c), L))]
        const bottom: [number, number] = [lon(x + lerp(lv(d), lv(c), L)), lat(y + 1)]
        const left: [number, number] = [lon(x), lat(y + lerp(lv(a), lv(d), L))]
        const segs: [[number, number], [number, number]][] = []
        switch (code) {
          case 1: case 14: segs.push([left, bottom]); break
          case 2: case 13: segs.push([bottom, right]); break
          case 3: case 12: segs.push([left, right]); break
          case 4: case 11: segs.push([top, right]); break
          case 5: segs.push([top, left], [bottom, right]); break
          case 6: case 9: segs.push([top, bottom]); break
          case 7: case 8: segs.push([top, left]); break
          case 10: segs.push([top, right], [left, bottom]); break
        }
        for (const sgm of segs) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: sgm } })
      }
    }
  }
  return { type: 'FeatureCollection', features: feats }
}

/**
 * A small lens ring that follows the pointer inside the study area. It is drawn as an outline only: it never tints or dims the data
 * underneath (science colours stay exactly as measured). Returns a cleanup function.
 */
export function attachLens(map: MlMap, bbox: BBox, blocked: () => boolean): () => void {
  const host = map.getContainer()
  const el = document.createElement('div')
  el.className = 'lens'
  el.setAttribute('aria-hidden', 'true')
  host.appendChild(el)
  let raf = 0
  let last: { x: number; y: number; lng: number; lat: number } | null = null
  const paint = () => {
    raf = 0
    if (!last) return
    const off = blocked() || map.getCanvas().style.cursor === 'pointer' || !insideRing(last.lng, last.lat, bbox)
    el.classList.toggle('on', !off)
    el.style.transform = `translate(${last.x}px, ${last.y}px)`
  }
  const move = (e: { point: { x: number; y: number }; lngLat: { lng: number; lat: number } }) => {
    last = { x: e.point.x, y: e.point.y, lng: e.lngLat.lng, lat: e.lngLat.lat }
    if (!raf) raf = requestAnimationFrame(paint)
  }
  const hide = () => { last = null; el.classList.remove('on') }
  const down = () => el.classList.add('press')
  const up = () => el.classList.remove('press')
  map.on('mousemove', move)
  map.on('mouseout', hide)
  map.on('movestart', hide) // dragging or flying: no lens until the pointer moves again
  map.on('mousedown', down)
  map.on('mouseup', up)
  return () => {
    cancelAnimationFrame(raf)
    map.off('mousemove', move); map.off('mouseout', hide); map.off('movestart', hide); map.off('mousedown', down); map.off('mouseup', up)
    el.remove()
  }
}
