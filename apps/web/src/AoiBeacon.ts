import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import type { Story } from './types'

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const GLOW = '#86a9ff' // the UI accent ink, never a data colour

/**
 * The outline is an ellipse that passes just outside the four corners of the data picture, so every pixel of data is inside it
 * and it reads as a clean ring (a cylinder from above) rather than a box.
 */
export function ringPolygon(bbox: Story['aoi']['bbox'], steps = 120): Feature<Polygon> {
  const [w, s, e, n] = bbox
  const cx = (w + e) / 2
  const cy = (s + n) / 2
  const k = Math.SQRT2 * 1.04 // an axis-aligned ellipse through a rectangle's corners is the half-size times sqrt(2)
  const rx = ((e - w) / 2) * k
  const ry = ((n - s) / 2) * k
  const ring: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    ring.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
}

/** How far out (in times the ring size) the fade reaches full strength, and how strong it gets there. */
const FADE_SPAN = 7
const FADE_MAX = 0.6

const scaledBox = (bbox: Story['aoi']['bbox'], k: number): [number, number, number, number] => {
  const [w, s, e, n] = bbox
  const cx = (w + e) / 2
  const cy = (s + n) / 2
  const hw = ((e - w) / 2) * k
  const hh = ((n - s) / 2) * k
  return [Math.max(-179.9, cx - hw), Math.max(-84, cy - hh), Math.min(179.9, cx + hw), Math.min(84, cy + hh)]
}

/** A smooth dark vignette: clear around the ring, then darker with distance, reaching FADE_MAX at the edge of the picture. */
function vignetteUrl(): string {
  const N = 256
  const c = document.createElement('canvas')
  c.width = c.height = N
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(N, N)
  const r0 = (Math.SQRT2 * 1.04 * 1.12) / FADE_SPAN // just outside the ring
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const r = Math.min(1, Math.hypot((x + 0.5) / N * 2 - 1, (y + 0.5) / N * 2 - 1))
      const t = Math.min(1, Math.max(0, (r - r0) / (1 - r0)))
      const a = t * t * (3 - 2 * t)
      const i = (y * N + x) * 4
      img.data[i] = 5; img.data[i + 1] = 8; img.data[i + 2] = 15; img.data[i + 3] = Math.round(255 * a)
    }
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}

/**
 * Adds the glowing boundary (a dark edge, a soft glow and a crisp line, all on the ground) and the fade that darkens everything outside it.
 * Returns controls to show or hide it and to run the slow shimmer.
 */
export function addBeacon(map: MlMap, bbox: Story['aoi']['bbox'], opts: { dimBefore?: string; topBefore?: string } = {}) {
  map.addSource('beacon', { type: 'geojson', data: ringPolygon(bbox) })

  // Everything outside the study area fades smoothly darker with distance, so the eye stays inside the ring and no tile seams show in the
  // far imagery (the open ocean especially). A smooth vignette picture covers the surroundings; beyond it, one flat fill continues it.
  const [w, s, e, n] = scaledBox(bbox, FADE_SPAN)
  map.addSource('outside-img', { type: 'image', url: vignetteUrl(), coordinates: [[w, n], [e, n], [e, s], [w, s]] })
  map.addSource('outside', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [
    [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], [[w, s], [w, n], [e, n], [e, s], [w, s]]] } } })
  map.addLayer({ id: 'outside-dim-img', type: 'raster', source: 'outside-img', paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, opts.dimBefore)
  map.addLayer({ id: 'outside-dim', type: 'fill', source: 'outside', paint: { 'fill-color': '#05080f', 'fill-opacity': 0, 'fill-antialias': false } }, opts.dimBefore)

  map.addLayer({ id: 'beacon-casing', type: 'line', source: 'beacon', paint: { 'line-color': '#000', 'line-width': 4.5, 'line-opacity': 0 } }, opts.topBefore)
  map.addLayer({ id: 'beacon-glow', type: 'line', source: 'beacon', paint: { 'line-color': GLOW, 'line-width': 14, 'line-blur': 12, 'line-opacity': 0 } }, opts.topBefore)
  map.addLayer({ id: 'beacon-line', type: 'line', source: 'beacon', paint: { 'line-color': '#dbe6ff', 'line-width': 1.6, 'line-opacity': 0 } }, opts.topBefore)

  // Static, not animated: an animated glow forces a full repaint of the terrain every frame, even when nothing moves.
  const apply = (k: number) => {
    map.setPaintProperty('beacon-casing', 'line-opacity', 0.4 * k)
    map.setPaintProperty('beacon-glow', 'line-opacity', 0.5 * k)
    map.setPaintProperty('beacon-line', 'line-opacity', 0.9 * k)
    map.setPaintProperty('outside-dim', 'fill-opacity', FADE_MAX * k)
    map.setPaintProperty('outside-dim-img', 'raster-opacity', k)
  }
  let bucket = -1
  return {
    show() { apply(1) },
    hide() { apply(0) },
    /** The ring thickens when far away so it stays visible from orbit; only touches the style when the size actually changes. */
    scaleFor(zoom: number) {
      const b = Math.round(zoom * 2)
      if (b === bucket) return
      bucket = b
      const w = Math.max(1.2, Math.min(3.4, 7 - zoom * 0.5))
      map.setPaintProperty('beacon-line', 'line-width', w)
      map.setPaintProperty('beacon-casing', 'line-width', w + 2.4)
      map.setPaintProperty('beacon-glow', 'line-width', w * 8)
    },
    destroy() {},
    source: () => map.getSource('beacon') as GeoJSONSource | undefined,
  }
}

export { EMPTY as EMPTY_BEACON }

/**
 * The radar-pass sweep, drawn on the ground inside the ring (so it sits at the camera's own viewing angle and follows terrain):
 * a chord of the ring that travels west to east, with the same light line and glow as the ring itself.
 */
export function addSweep(map: MlMap, bbox: Story['aoi']['bbox'], opts: { topBefore?: string } = {}) {
  const [w, s, e, n] = bbox
  const cx = (w + e) / 2
  const cy = (s + n) / 2
  const k = Math.SQRT2 * 1.04
  const rx = ((e - w) / 2) * k
  const ry = ((n - s) / 2) * k
  map.addSource('sweep', { type: 'geojson', data: EMPTY })
  map.addLayer({ id: 'sweep-glow', type: 'line', source: 'sweep', paint: { 'line-color': GLOW, 'line-width': 16, 'line-blur': 12, 'line-opacity': 0.7 } }, opts.topBefore)
  map.addLayer({ id: 'sweep-line', type: 'line', source: 'sweep', paint: { 'line-color': '#dbe6ff', 'line-width': 2, 'line-opacity': 0.95 } }, opts.topBefore)
  const src = map.getSource('sweep') as GeoJSONSource
  return {
    /** t from 0 (west edge of the ring) to 1 (east edge). The chord's ends sit exactly on the ring. */
    set(t: number) {
      const u = 2 * t - 1
      const h = ry * Math.sqrt(Math.max(0, 1 - u * u))
      const x = cx + rx * u
      const pts: [number, number][] = []
      for (let i = 0; i <= 24; i++) pts.push([x, cy - h + (2 * h * i) / 24])
      src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } })
    },
    clear() { src.setData(EMPTY) },
  }
}
