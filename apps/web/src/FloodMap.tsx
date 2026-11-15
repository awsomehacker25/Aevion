import { useEffect, useImperativeHandle, useRef } from 'react'
import type { Ref } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, ImageSource, MapMouseEvent, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FloodView, LoadedFlood } from './types'

export interface FloodLayers {
  districts: boolean
  permwater: boolean
  aftermath: boolean
  population: boolean
  optical: boolean
  pins: boolean
  sentinel1: boolean
}

export interface FloodMapHandle {
  zoomIn: () => void
  zoomOut: () => void
  /** Back to the whole study area. */
  reset: () => void
  flyTo: (lng: number, lat: number, zoom?: number) => void
  /** Current camera, for the shareable link. */
  camera: () => { lng: number; lat: number; zoom: number } | null
}

interface Props {
  data: LoadedFlood
  /** Index of the date on the left and on the right. */
  a: number
  b: number
  view: FloodView
  water: boolean
  swipeOn: boolean
  /** Divider position across the map, 0 to 1. */
  swipe: number
  layers: FloodLayers
  point: [number, number] | null
  startCamera?: { lng: number; lat: number; zoom: number } | null
  onPick: (lng: number, lat: number) => void
  onPin: (id: string) => void
  onLoading: (busy: boolean) => void
  onMissing: (what: string) => void
  onMoveEnd: () => void
  ref?: Ref<FloodMapHandle>
}

type Img = [[number, number], [number, number], [number, number], [number, number]]

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const OPACITY = { sar: 0.92, water: 0.9 }
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA='

const preloads = new Map<string, Promise<boolean>>()
const preload = (url: string) => {
  let p = preloads.get(url)
  if (!p) {
    p = new Promise<boolean>((res) => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = url })
    preloads.set(url, p)
  }
  return p
}

/** Waits until MapLibre has decoded a new image for this source, with a time limit. */
const imageReady = (map: maplibregl.Map, id: string) => new Promise<void>((res) => {
  let to = 0
  const h = (e: maplibregl.MapSourceDataEvent) => { if (e.sourceId === id && e.sourceDataType === 'metadata') fin() }
  const fin = () => { map.off('sourcedata', h); window.clearTimeout(to); requestAnimationFrame(() => res()) }
  map.on('sourcedata', h)
  to = window.setTimeout(fin, 3000)
})

interface Slot { front: string; back: string; url: Record<string, string>; want: string }

export default function FloodMap(p: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const elA = useRef<HTMLDivElement>(null)
  const elB = useRef<HTMLDivElement>(null)
  const maps = useRef<{ a: maplibregl.Map; b: maplibregl.Map } | null>(null)
  const slots = useRef(new WeakMap<maplibregl.Map, Record<string, Slot>>())
  const shown = useRef(new WeakMap<maplibregl.Map, Record<string, string>>())
  const pending = useRef(0)
  const live = useRef(p)
  useEffect(() => { live.current = p })

  const { flood, story } = p.data
  const [x0, y0, x1, y1] = flood.bbox
  const corners: Img = [[x0, y1], [x1, y1], [x1, y0], [x0, y0]]

  const coverCam = () => {
    const el = wrap.current!
    const mx = (lng: number) => (lng + 180) / 360
    const my = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2
    const bw = (mx(x1) - mx(x0)) * 512
    const bh = (my(y0) - my(y1)) * 512
    const zoom = Math.log2(Math.max(el.clientWidth / bw, el.clientHeight / bh))
    const cy = (my(y0) + my(y1)) / 2
    return { center: [(x0 + x1) / 2, (Math.atan(Math.sinh(Math.PI * (1 - 2 * cy))) * 180) / Math.PI] as [number, number], zoom }
  }

  useImperativeHandle(p.ref, () => ({
    zoomIn: () => maps.current?.b.zoomIn(),
    zoomOut: () => maps.current?.b.zoomOut(),
    reset: () => maps.current?.b.easeTo({ ...coverCam(), bearing: 0, pitch: 0, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500, essential: true }),
    flyTo: (lng, lat, zoom) => maps.current?.b.easeTo({ center: [lng, lat], zoom: zoom ?? Math.max(maps.current.b.getZoom(), 11.5), duration: 600, essential: true }),
    camera: () => {
      const m = maps.current?.b
      if (!m) return null
      const c = m.getCenter()
      return { lng: c.lng, lat: c.lat, zoom: m.getZoom() }
    },
  }))

  // ---- create both maps once per story ----
  useEffect(() => {
    const d = live.current
    const f = d.data.flood
    const ctx = f.context
    const url = (i: number, k: 'HH' | 'HV' | 'water' | 'RGB') => f.dates[i].layers[k] ?? f.dates[i].layers.HH
    const style = (idx: number): StyleSpecification => ({
      version: 8,
      sources: {
        imagery: { type: 'raster', tileSize: 256, maxzoom: 15, tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'],
          attribution: '<a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless 2024</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0' },
        labels: { type: 'raster', tileSize: 256, maxzoom: 15, tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/overlay_bright_3857/default/g/{z}/{y}/{x}.png'],
          attribution: 'Labels &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>, rendering &copy; EOX' },
        sar: { type: 'image', url: url(idx, d.view), coordinates: corners },
        'sar-b': { type: 'image', url: url(idx, d.view), coordinates: corners },
        water: { type: 'image', url: url(idx, 'water'), coordinates: corners },
        'water-b': { type: 'image', url: url(idx, 'water'), coordinates: corners },
        pt: { type: 'geojson', data: EMPTY },
        ...(ctx.sentinel1 ? { sentinel1: { type: 'image', url: BLANK, coordinates: corners } } : {}),
        ...(ctx.sentinel2 ? { optical: { type: 'image', url: BLANK, coordinates: corners } } : {}),
        ...(ctx.population ? { population: { type: 'image', url: BLANK, coordinates: corners } } : {}),
        ...(ctx.aftermath ? { aftermath: { type: 'image', url: BLANK, coordinates: corners } } : {}),
        ...(ctx.permanent_water ? { permwater: { type: 'image', url: BLANK, coordinates: corners } } : {}),
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0c1118' } },
        { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-saturation': -0.35, 'raster-brightness-max': 0.8 } },
        { id: 'sar', type: 'raster', source: 'sar', paint: { 'raster-opacity': OPACITY.sar, 'raster-fade-duration': 0, 'raster-opacity-transition': { duration: 200, delay: 0 } } },
        { id: 'sar-b', type: 'raster', source: 'sar-b', paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-opacity-transition': { duration: 200, delay: 0 } } },
        ...(['sentinel1', 'optical', 'population', 'aftermath'] as const).filter((id) => (id === 'optical' ? ctx.sentinel2 : ctx[id])).map((id) =>
          ({ id, type: 'raster' as const, source: id, layout: { visibility: 'none' as const }, paint: { 'raster-opacity': id === 'population' || id === 'aftermath' ? 0.9 : 1, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' as const } })),
        { id: 'water', type: 'raster', source: 'water', paint: { 'raster-opacity': OPACITY.water, 'raster-fade-duration': 0, 'raster-resampling': 'nearest', 'raster-opacity-transition': { duration: 200, delay: 0 } } },
        { id: 'water-b', type: 'raster', source: 'water-b', paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-resampling': 'nearest', 'raster-opacity-transition': { duration: 200, delay: 0 } } },
        ...(ctx.permanent_water ? [{ id: 'permwater', type: 'raster' as const, source: 'permwater', paint: { 'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' as const } }] : []),
        { id: 'labels', type: 'raster', source: 'labels' },
        { id: 'pt', type: 'circle', source: 'pt', paint: { 'circle-radius': 6, 'circle-color': '#ff5252', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } },
      ],
    })
    const cam = d.startCamera ? { center: [d.startCamera.lng, d.startCamera.lat] as [number, number], zoom: d.startCamera.zoom } : coverCam()
    const startOpts = { center: cam.center, zoom: cam.zoom, attributionControl: false as const, dragRotate: false, pitchWithRotate: false, maxPitch: 0 }
    const A = new maplibregl.Map({ container: elA.current!, style: style(d.a), ...startOpts })
    const B = new maplibregl.Map({ container: elB.current!, style: style(d.b), ...startOpts })
    B.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    maps.current = { a: A, b: B }

    let syncing = false
    const sync = (src: maplibregl.Map, dst: maplibregl.Map) => src.on('move', () => {
      if (syncing) return
      syncing = true
      dst.jumpTo({ center: src.getCenter(), zoom: src.getZoom() })
      syncing = false
    })
    sync(A, B); sync(B, A)
    B.on('moveend', () => live.current.onMoveEnd())

    const whenStyle = (m: maplibregl.Map, fn: () => void) => {
      if (m.getLayer('sar')) { fn(); return }
      const h = () => { if (m.getLayer('sar')) { m.off('styledata', h); fn() } }
      m.on('styledata', h)
    }
    const addVector = (m: maplibregl.Map) => {
      const L = live.current.layers
      if (live.current.data.districts && !m.getSource('districts')) {
        m.addSource('districts', { type: 'geojson', data: live.current.data.districts })
        m.addLayer({ id: 'districts-casing', type: 'line', source: 'districts', paint: { 'line-color': '#000', 'line-width': 3.5, 'line-opacity': 0.5 }, layout: { visibility: L.districts ? 'visible' : 'none' } }, 'pt')
        m.addLayer({ id: 'districts', type: 'line', source: 'districts', paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-dasharray': [4, 2] }, layout: { visibility: L.districts ? 'visible' : 'none' } }, 'pt')
      }
      if (live.current.data.pins && !m.getSource('pins')) {
        const vis = { visibility: L.pins ? 'visible' : 'none' } as const
        m.addSource('pins', { type: 'geojson', data: live.current.data.pins })
        m.addLayer({ id: 'pins-halo', type: 'circle', source: 'pins', filter: ['==', ['get', 'approximate'], true], layout: vis,
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 11, 10, 14, 16], 'circle-color': '#e69f00', 'circle-opacity': 0.18, 'circle-stroke-color': '#e69f00', 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.6 } }, 'pt')
        m.addLayer({ id: 'pins', type: 'circle', source: 'pins', layout: vis,
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 11, 6, 14, 8], 'circle-color': ['case', ['get', 'approximate'], '#ffffff', '#e69f00'],
            'circle-stroke-color': ['case', ['get', 'approximate'], '#e69f00', '#ffffff'], 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 12, 3] } }, 'pt')
        m.on('mouseenter', 'pins', () => { m.getCanvas().style.cursor = 'pointer' })
        m.on('mouseleave', 'pins', () => { m.getCanvas().style.cursor = '' })
      }
    }
    for (const m of [A, B]) {
      whenStyle(m, () => addVector(m))
      m.on('click', (e: MapMouseEvent) => {
        const pin = m.getLayer('pins') ? m.queryRenderedFeatures(e.point, { layers: ['pins'] })[0] : undefined
        if (pin) { live.current.onPin(String((pin.properties as { id: string }).id)); return }
        live.current.onPick(e.lngLat.lng, e.lngLat.lat)
      })
    }
    // the maps start unsized when the container is still laying out
    const ro = new ResizeObserver(() => { A.resize(); B.resize() })
    ro.observe(wrap.current!)
    return () => { ro.disconnect(); A.remove(); B.remove(); maps.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.data.story.id])

  // ---- keep images, layer visibility and the picked point in step with the controls ----
  useEffect(() => {
    const m = maps.current
    if (!m) return
    const { flood: f } = p.data
    const ctx = f.context
    const busy = (dlt: number) => { pending.current = Math.max(0, pending.current + dlt); live.current.onLoading(pending.current > 0) }
    const slot = (map: maplibregl.Map, kind: 'sar' | 'water', initial: string): Slot => {
      let s = slots.current.get(map)
      if (!s) { s = {}; slots.current.set(map, s) }
      return (s[kind] ??= { front: kind, back: `${kind}-b`, url: { [kind]: initial, [`${kind}-b`]: initial }, want: initial })
    }
    const swapImage = (map: maplibregl.Map, kind: 'sar' | 'water', url: string, name: string) => {
      const S = slot(map, kind, url)
      if (S.want === url) return
      S.want = url
      if (S.url[S.front] === url) { map.setPaintProperty(S.front, 'raster-opacity', OPACITY[kind]); map.setPaintProperty(S.back, 'raster-opacity', 0); return }
      busy(1)
      preload(url).then((ok) => {
        if (!ok) live.current.onMissing(name)
        if (S.want !== url) { busy(-1); return undefined }
        const back = S.back
        if (S.url[back] !== url) {
          try { (map.getSource(back) as ImageSource).updateImage({ url, coordinates: corners }) } catch { /* ignore */ }
          S.url[back] = url
          return imageReady(map, back).then(() => back)
        }
        return back
      }).then((back) => {
        if (!back) return
        busy(-1)
        if (S.want !== url) return
        map.setPaintProperty(back, 'raster-opacity', OPACITY[kind])
        map.setPaintProperty(S.front, 'raster-opacity', 0)
        ;[S.front, S.back] = [back, S.front]
      })
    }
    const setImage = (map: maplibregl.Map, id: string, url: string | undefined) => {
      if (!url) return
      let cur = shown.current.get(map)
      if (!cur) { cur = {}; shown.current.set(map, cur) }
      if (cur[id] === url) return
      const src = map.getSource(id) as ImageSource | undefined
      if (!src) return
      try { const r = src.updateImage({ url, coordinates: corners }) as unknown; if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {}); cur[id] = url } catch { /* ignore */ }
    }

    const apply = (map: maplibregl.Map, idx: number, left: boolean) => {
      const go = () => {
        const d = f.dates[idx]
        swapImage(map, 'sar', d.layers[p.view] ?? d.layers.HH, `${p.view} ${d.date}`)
        swapImage(map, 'water', d.layers.water, `water ${d.date}`)
        // large context pictures are fetched only once their layer is switched on
        if (ctx.population && p.layers.population) setImage(map, 'population', ctx.population.by_date[d.date]?.url ?? ctx.population.url)
        if (ctx.sentinel1 && p.layers.sentinel1 && left) setImage(map, 'sentinel1', ctx.sentinel1.url)
        if (ctx.sentinel2 && p.layers.optical) setImage(map, 'optical', ctx.sentinel2.url)
        if (ctx.aftermath && p.layers.aftermath) setImage(map, 'aftermath', ctx.aftermath.url)
        if (ctx.permanent_water && p.layers.permwater) setImage(map, 'permwater', ctx.permanent_water.url)
        const s1 = left && p.layers.sentinel1 && !!ctx.sentinel1
        for (const w of ['water', 'water-b']) if (map.getLayer(w)) map.setLayoutProperty(w, 'visibility', p.water && !s1 ? 'visible' : 'none')
        const vis: Record<string, boolean> = {
          sentinel1: p.layers.sentinel1 && left, optical: p.layers.optical, population: p.layers.population, aftermath: p.layers.aftermath,
          permwater: p.layers.permwater, districts: p.layers.districts, 'districts-casing': p.layers.districts, pins: p.layers.pins, 'pins-halo': p.layers.pins,
        }
        for (const [id, on] of Object.entries(vis)) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
        const pt = map.getSource('pt') as GeoJSONSource | undefined
        pt?.setData(p.point ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p.point } } : EMPTY)
      }
      if (map.getLayer('sar')) go()
      else { const h = () => { if (map.getLayer('sar')) { map.off('styledata', h); go() } }; map.on('styledata', h) }
    }
    apply(m.a, p.a, true)
    apply(m.b, p.b, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.a, p.b, p.view, p.water, p.layers, p.point, p.data])

  // the left map is only needed while the swipe is on
  const px = p.swipeOn ? p.swipe * 100 : 0
  return (
    <div className="fmap" ref={wrap}>
      <div className="fmap-a" ref={elA} style={{ visibility: p.swipeOn ? 'visible' : 'hidden' }} aria-label={story.title} />
      <div className="fmap-b" ref={elB} style={{ clipPath: p.swipeOn ? `inset(0 0 0 ${px}%)` : 'none' }} />
    </div>
  )
}
