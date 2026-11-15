import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, ImageSource, MapMouseEvent, StyleSpecification } from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAP } from './config'
import { beachball } from './lib/beachball'
import { playhead } from './lib/playhead'
import { changeProgress, eventReached, overlayOpacity } from './lib/progress'
import { renderOverlay } from './lib/render'
import { fmtDate } from './lib/data'
import type { CameraReq, Grid, LayerDef, Overlays, QuakeCollection, Story, UsgsContext, ViewMode } from './types'

interface Props {
  story: Story
  quakes: QuakeCollection
  context?: UsgsContext
  displacement: { layer: LayerDef; grid: Grid }
  coherence: { layer: LayerDef; grid: Grid }
  radarHH?: { layer: LayerDef; grid: Grid }
  radarHV?: { layer: LayerDef; grid: Grid }
  /** The next measured period of a story that follows the timeline, cross-faded in between the two passes (from and to are times in ms). */
  next?: { displacement: { layer: LayerDef; grid: Grid }; coherence: { layer: LayerDef; grid: Grid }; radarHV?: { layer: LayerDef; grid: Grid }; radarHH?: { layer: LayerDef; grid: Grid }; from: number; to: number }
  mode: ViewMode
  fadeLow: boolean
  threshold: number
  /** How much of the change to show at the current date, 0 to 1 (see lib/progress.ts). */
  progress: number
  /** Exact time of the second pass, for the per-frame fade while playing. */
  secondaryIso?: string
  /** Before/after swipe: west of the line shows the plain imagery, east of it the measured change. */
  swipe: boolean
  cursor: number
  overlays: Overlays
  camera: CameraReq | null
  picked: [number, number] | null
  onPick: (lon: number, lat: number) => void
  /** Cross-section tool: while picking, map clicks go to onProfilePoint instead of the inspector. */
  profile: { a: [number, number] | null; b: [number, number] | null }
  profileMode: boolean
  onProfilePoint: (lon: number, lat: number) => void
  /** 0..1 while the illustrative quake replay runs, otherwise null. */
  replayScale: number | null
}

function styleFor(): StyleSpecification {
  return {
    version: 8,
    sources: {
      sat: { type: 'raster', tiles: [BASEMAP.imageryTiles], tileSize: 256, maxzoom: 18, attribution: BASEMAP.imageryAttribution },
      dem: { type: 'raster-dem', tiles: [BASEMAP.terrainTiles], tileSize: 256, maxzoom: 14, encoding: BASEMAP.terrainEncoding, attribution: BASEMAP.terrainAttribution },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#05080f' } },
      { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-brightness-max': 0.78, 'raster-saturation': -0.35, 'raster-contrast': 0.1 } },
      // No hillshade layer: it made panning and tilting crawl (about 1 frame per second against 30 without it). The 3D terrain still gives the relief.
    ],
    terrain: { source: 'dem', exaggeration: BASEMAP.terrainExaggeration },
    sky: {
      'sky-color': '#0a1424', 'horizon-color': '#2a4a7a', 'fog-color': '#16263f',
      'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.25,
    },
  } as StyleSpecification
}

const corners = (b: Story['aoi']['bbox']): [[number, number], [number, number], [number, number], [number, number]] =>
  [[b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]]

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const MMI_ROMAN: Record<number, string> = { 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X' }

export default function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const beachRef = useRef<maplibregl.Marker[]>([])
  const annotRef = useRef<maplibregl.Marker[]>([])
  const fullRef = useRef<HTMLCanvasElement | null>(null) // the overlay, drawn once at full strength
  const viewRef = useRef<HTMLCanvasElement | null>(null) // the overlay cut at the swipe line, encoded and sent to the map
  const swipeFrac = useRef(0.5) // swipe line position across the map box: 0 = west edge, 1 = east edge
  const swipeOn = useRef(false)

  const appliedSeq = useRef(0)
  const paintSeq = useRef(0) // numbers each update so an older, slower one can never overwrite a newer one
  const lastUrl = useRef<string | null>(null)
  const bbox = p.story.aoi.bbox

  // Second image layer for the cross-fade: it holds the NEXT period and fades in as the timeline moves toward the next pass.
  const bShows = useRef<Grid | null>(null) // the grid the second layer currently shows
  const holdB = useRef(false) // after the period changes, the second layer stays at full strength until the main layer shows the same picture
  const paintSeqB = useRef(0)
  const lastUrlB = useRef<string | null>(null)
  const renderBRef = useRef<() => void>(() => {})
  const releaseRef = useRef<() => void>(() => {})
  const bState = useRef<{ next?: Props['next']; swipe: boolean; mode: ViewMode; replay: boolean; cursor: number }>(
    { swipe: false, mode: 'los', replay: false, cursor: 0 })
  // The next period's picture for the view on screen (the HV picture in HV mode), or nothing when it has none.
  const nextPicture = (n: NonNullable<Props['next']>, mode: ViewMode) =>
    mode === 'hh' ? n.radarHH : mode === 'hv' ? n.radarHV : n.displacement

  // The current period's own layer fades out over the last part of the cross-fade, so that where the next picture is
  // transparent (little change there) the old one does not show through at the end, which would pop when the period changes.
  const aFactor = useCallback((t: number) => {
    const s = bState.current
    const n = s.next
    if (holdB.current) return 0
    if (!n || s.swipe || s.replay || bShows.current !== nextPicture(n, s.mode)?.grid || t <= n.from) return 1
    const x = Math.min(1, (t - n.from) / (n.to - n.from))
    const y = Math.max(0, (x - 0.6) / 0.4)
    return 1 - y * y * (3 - 2 * y)
  }, [])
  const bOpacity = useCallback((t: number) => {
    const s = bState.current
    const n = s.next
    if (holdB.current) return 0.95
    if (!n || s.swipe || s.replay || bShows.current !== nextPicture(n, s.mode)?.grid) return 0
    if (t <= n.from) return 0
    if (t >= n.to) return 0.95
    const x = (t - n.from) / (n.to - n.from)
    return 0.95 * x * x * (3 - 2 * x)
  }, [])

  // Send the overlay to the map as an image, cutting off the "before" side when swiping. Encoding happens off the main
  // thread (toBlob), and only the newest request is applied.
  const paintOverlay = useCallback(() => {
    const map = mapRef.current
    const full = fullRef.current
    if (!map || !full) return
    const view = viewRef.current ?? (viewRef.current = document.createElement('canvas'))
    if (view.width !== full.width || view.height !== full.height) { view.width = full.width; view.height = full.height }
    const ctx = view.getContext('2d')!
    ctx.clearRect(0, 0, view.width, view.height)
    const sx = swipeOn.current ? Math.round(Math.min(1, Math.max(0, swipeFrac.current)) * full.width) : 0
    if (sx < full.width) ctx.drawImage(full, sx, 0, full.width - sx, full.height, sx, 0, full.width - sx, full.height)
    const seq = ++paintSeq.current
    if (view.width <= 400) {
      // the small replay frames encode instantly, so skip the asynchronous encoder, which can lag behind a fast replay
      appliedSeq.current = seq
      ;(map.getSource('overlay') as ImageSource | undefined)?.updateImage({ url: view.toDataURL('image/png'), coordinates: corners(bbox) })
      if (holdB.current) setTimeout(() => releaseRef.current(), 150)
      return
    }
    view.toBlob((blob) => {
      if (!blob || seq <= appliedSeq.current || mapRef.current !== map) return
      appliedSeq.current = seq
      const url = URL.createObjectURL(blob)
      const old = lastUrl.current
      lastUrl.current = url
      ;(map.getSource('overlay') as ImageSource | undefined)?.updateImage({ url, coordinates: corners(bbox) })
      if (old) setTimeout(() => URL.revokeObjectURL(old), 3000) // the map has long since loaded the previous image
      if (holdB.current) {
        // the main layer now shows what the second layer was showing: give the map a moment to draw it, then let the second layer move on
        setTimeout(() => releaseRef.current(), 150)
      }
    }, 'image/png')
  }, [bbox])
  // the latest callbacks and mode, read by the one-time click handler
  const live = useRef({ onPick: p.onPick, onProfilePoint: p.onProfilePoint, profileMode: p.profileMode })
  const [ready, setReady] = useState(false)

  // Everything on the map is a function of the timeline position, so scrubbing backward undoes it again.
  const scale = p.replayScale ?? p.progress
  const evReached = eventReached(p.story, p.cursor)
  const annotations = p.story.annotations
  const annotKey = (annotations ?? [])
    .map((a) => ((a.appears === 'event' ? evReached : a.appears === 'change' ? scale >= 0.8 : true) ? '1' : '0'))
    .join('')

  useEffect(() => { live.current = { onPick: p.onPick, onProfilePoint: p.onProfilePoint, profileMode: p.profileMode } })

  // create the map once per story
  useEffect(() => {
    const { aoi } = p.story
    const map = new maplibregl.Map({
      container: el.current!,
      style: styleFor(),
      center: aoi.center, zoom: aoi.zoom, pitch: aoi.pitch, bearing: aoi.bearing,
      // Can't zoom out far from the story area, which also keeps the number of tiles to load and draw down.
      minZoom: Math.max(2, aoi.zoom - 1.5),
      maxPitch: 75, attributionControl: { compact: true },
      // Lighter drawing: cap the pixel density on sharp screens (4x the work for little visible gain) and skip tile fade-ins.
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), fadeDuration: 0,
    })
    mapRef.current = map
    let cancelled = false // this map was replaced or removed before it finished starting
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')

    // The compass button resets bearing and tilt, which on its own can't be undone.
    // Make it a toggle: the first click goes to north-up and flat, the next restores the previous view.
    let before: { bearing: number; pitch: number } | null = null
    const compass = map.getContainer().querySelector<HTMLButtonElement>('.maplibregl-ctrl-compass')
    const onCompass = (e: Event) => {
      e.stopImmediatePropagation()
      const flat = Math.abs(map.getBearing()) < 1 && map.getPitch() < 1
      if (!flat) { before = { bearing: map.getBearing(), pitch: map.getPitch() }; map.easeTo({ bearing: 0, pitch: 0 }) }
      else if (before) { map.easeTo(before); before = null }
    }
    compass?.addEventListener('click', onCompass, true)
    if (compass) compass.title = 'Reset to north and flat. Click again to go back.'

    // Add our layers as soon as the style is ready. The map's own 'load' event also waits for every satellite and
    // terrain tile, which can take a long time (or never finish) over rough terrain, and the overlay must not wait for that.
    map.once('style.load', () => {
      if (cancelled) return
      // keep the focus area clear of the side panel and timeline
      if (window.innerWidth > 760) map.setPadding({ left: 360, bottom: 120, top: 0, right: 0 })
      for (const id of ['overlay', 'overlay2']) {
        map.addSource(id, { type: 'image', url: TRANSPARENT, coordinates: corners(aoi.bbox) })
        map.addLayer({ id, type: 'raster', source: id, paint: {
          'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-resampling': 'linear',
          // we fade this layer ourselves, every frame; the map's own 300 ms opacity animation would fight with that and can leave a stale frame
          'raster-opacity-transition': { duration: 0, delay: 0 },
        } })
      }

      // the before/after swipe line (empty until swipe is switched on)
      map.addSource('swipe', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'swipe-line', type: 'line', source: 'swipe', paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-opacity': 0.95 } })

      // AOI outline
      map.addSource('aoi', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...corners(aoi.bbox), corners(aoi.bbox)[0]]] } } })
      map.addLayer({ id: 'aoi-line', type: 'line', source: 'aoi', paint: { 'line-color': '#9fb4d9', 'line-width': 1, 'line-opacity': 0.5, 'line-dasharray': [3, 3] } })

      // USGS context layers (hidden until switched on)
      map.addSource('fault', { type: 'geojson', data: (p.context?.fault ?? EMPTY) as FeatureCollection })
      map.addLayer({ id: 'fault-fill', type: 'fill', source: 'fault', layout: { visibility: 'none' },
        paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'slip'], 0, '#e4d4ff', 0.8, '#a05bd6', 1.8, '#3d0b66'], 'fill-opacity': 0.6 } })
      map.addLayer({ id: 'fault-line', type: 'line', source: 'fault', layout: { visibility: 'none' },
        paint: { 'line-color': '#f1e6ff', 'line-width': 0.6, 'line-opacity': 0.5 } })
      map.addSource('shaking', { type: 'geojson', data: (p.context?.shakingContours ?? EMPTY) as FeatureCollection })
      map.addLayer({ id: 'shaking', type: 'line', source: 'shaking', layout: { visibility: 'none' },
        paint: { 'line-color': ['interpolate', ['linear'], ['get', 'value'], 5, '#ffe29a', 7, '#ff9a3d', 9, '#c4002f'], 'line-width': ['interpolate', ['linear'], ['get', 'value'], 5, 1.5, 9, 3.5], 'line-opacity': 0.9 } })
      map.addSource('cities', { type: 'geojson', data: {
        type: 'FeatureCollection',
        features: (p.context?.cities ?? []).map((c) => ({ type: 'Feature', properties: { name: c.name, pop: c.pop, mmi: c.mmi }, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } })),
      } as FeatureCollection })
      map.addLayer({ id: 'cities', type: 'circle', source: 'cities', layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'pop']], 100, 4, 400, 7, 800, 12],
          'circle-color': ['interpolate', ['linear'], ['get', 'mmi'], 5, '#ffe29a', 7, '#ff9a3d', 9, '#c4002f'],
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-opacity': 0.95,
        } })

      // cross-section line
      map.addSource('profile', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'profile-line', type: 'line', source: 'profile', filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } })
      map.addLayer({ id: 'profile-pts', type: 'circle', source: 'profile', filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 6, 'circle-color': '#6aa5ff', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } })

      map.addSource('quakes', { type: 'geojson', data: p.quakes as unknown as FeatureCollection })
      const rad = ['interpolate', ['linear'], ['get', 'mag'], 3.5, 4, 5, 9, 7.5, 26] as maplibregl.ExpressionSpecification
      map.addLayer({ id: 'quake-halo', type: 'circle', source: 'quakes', filter: ['>=', ['get', 'mag'], 7],
        paint: { 'circle-radius': ['*', rad, 2.2], 'circle-color': '#ff4d3d', 'circle-opacity': 0.16, 'circle-blur': 0.8 } })
      map.addLayer({ id: 'quake', type: 'circle', source: 'quakes',
        paint: { 'circle-radius': rad, 'circle-color': ['interpolate', ['linear'], ['get', 'mag'], 3.5, '#ffd479', 5, '#ff8a3d', 7.5, '#ff3b30'],
          'circle-opacity': 0.9, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } })

      for (const id of ['quake', 'cities']) {
        map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = '' })
      }
      map.on('click', (e: MapMouseEvent) => {
        if (live.current.profileMode) { live.current.onProfilePoint(e.lngLat.lng, e.lngLat.lat); return }
        const f = map.queryRenderedFeatures(e.point, { layers: ['quake', 'cities'] })[0]
        if (f && f.layer.id === 'quake') {
          const pr = f.properties as { mag: number; time: number; place: string; url: string }
          new maplibregl.Popup({ closeButton: false, className: 'quake-pop' })
            .setLngLat((f.geometry as Point).coordinates as [number, number])
            .setHTML(`<b>M${pr.mag}</b> &middot; ${pr.place}<br>${fmtDate(pr.time, true)}<br><a href="${pr.url}" target="_blank" rel="noreferrer">USGS event page</a>`)
            .addTo(map)
          return
        }
        if (f && f.layer.id === 'cities') {
          const pr = f.properties as { name: string; pop: number; mmi: number }
          new maplibregl.Popup({ closeButton: false, className: 'quake-pop' })
            .setLngLat((f.geometry as Point).coordinates as [number, number])
            .setHTML(`<b>${pr.name}</b><br>${Math.round(pr.pop).toLocaleString('en-US')} people<br>Shaking intensity ${pr.mmi.toFixed(1)} (${MMI_ROMAN[Math.round(pr.mmi)] ?? ''})`)
            .addTo(map)
          return
        }
        live.current.onPick(e.lngLat.lng, e.lngLat.lat)
      })
      setReady(true)
    })
    return () => { cancelled = true; map.remove(); mapRef.current = null; markerRef.current = null; beachRef.current = []; setReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.story.id])

  // redraw the change overlay when the view or data changes (and, at low quality, during the replay)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    // if the period just moved on to the picture the second layer already shows, keep that layer in place until the main one has it
    holdB.current = bShows.current === ((p.mode === 'hh' ? p.radarHH : p.mode === 'hv' ? p.radarHV : undefined)?.grid ?? p.displacement.grid)
    // radar brightness views draw their own layer with the same diverging colors; the interferometric coherence mask does not apply to them
    const radar = p.mode === 'hh' ? p.radarHH : p.mode === 'hv' ? p.radarHV : undefined
    fullRef.current = renderOverlay(radar?.grid ?? p.displacement.grid, p.coherence.grid, {
      mode: radar ? 'los' : p.mode,
      range: radar ? radar.layer.range : p.mode === 'coherence' ? p.coherence.layer.range : p.displacement.layer.range,
      fadeLow: radar ? false : p.fadeLow, threshold: p.threshold,
      scale: p.replayScale ?? 1, low: p.replayScale != null, quiet: (radar ?? p.displacement).layer.quietBelow,
      colormap: (radar ?? p.displacement).layer.colormap,
    })
    paintOverlay()
  }, [ready, paintOverlay, p.displacement, p.coherence, p.radarHH, p.radarHV, p.mode, p.fadeLow, p.threshold, p.story.aoi.bbox, p.replayScale])

  // before/after swipe: a draggable handle on a line; the overlay is shown only east of the line
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const [w, s, e, n] = p.story.aoi.bbox
    const lat0 = (s + n) / 2
    const lineAt = (lng: number): FeatureCollection => ({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lng, s], [lng, lat0], [lng, n]] } }],
    })
    const src = map.getSource('swipe') as GeoJSONSource
    swipeOn.current = p.swipe
    if (!p.swipe) { src.setData(EMPTY); paintOverlay(); return }
    const lng0 = w + (e - w) * swipeFrac.current
    src.setData(lineAt(lng0))
    const el = document.createElement('div')
    el.className = 'swipe-handle'
    el.title = 'Drag to compare before and after'
    el.innerHTML = '<span>Before</span><b>&lsaquo; &rsaquo;</b><span>After</span>'
    const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([lng0, lat0]).addTo(map)
    marker.on('drag', () => {
      const lng = Math.min(e, Math.max(w, marker.getLngLat().lng))
      swipeFrac.current = (lng - w) / (e - w)
      marker.setLngLat([lng, lat0]) // stay on the line, only slide east and west
      src.setData(lineAt(lng))
      paintOverlay()
    })
    paintOverlay()
    return () => {
      marker.remove()
      if (mapRef.current !== map) return // the map itself was already removed
      swipeOn.current = false
      src.setData(EMPTY)
      paintOverlay()
    }
  }, [ready, p.swipe, p.story.aoi.bbox, paintOverlay])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (p.replayScale != null) { map.setPaintProperty('overlay', 'raster-opacity', 0.95); map.setPaintProperty('overlay2', 'raster-opacity', 0); return }
    if (playhead.active) return // while playing, the per-frame subscriber below owns the fade
    // The overlay is drawn once at full strength; the build-up only fades it, so nothing is redrawn as time moves.
    map.setPaintProperty('overlay', 'raster-opacity', overlayOpacity(p.progress, p.mode) * aFactor(p.cursor))
    map.setPaintProperty('overlay2', 'raster-opacity', bOpacity(p.cursor))
  }, [ready, p.progress, p.mode, p.replayScale, p.cursor, p.next, p.swipe, bOpacity, aFactor])

  // while playing, fade smoothly every animation frame instead of at the slower React update rate
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || p.replayScale != null) return
    return playhead.subscribe((t) => {
      map.setPaintProperty('overlay', 'raster-opacity', overlayOpacity(changeProgress(p.story, t, p.secondaryIso), p.mode) * aFactor(t))
      map.setPaintProperty('overlay2', 'raster-opacity', bOpacity(t))
    })
  }, [ready, p.replayScale, p.story, p.mode, p.secondaryIso, bOpacity, aFactor])

  // The second layer: draw the NEXT period's picture, ready to cross-fade in.
  const renderB = useCallback(() => {
    const map = mapRef.current
    const n = p.next
    const pic = n ? nextPicture(n, p.mode) : undefined
    if (!ready || !map || !n || !pic || p.swipe) return
    const radar = p.mode === 'hv' || p.mode === 'hh'
    const canvas = renderOverlay(pic.grid, n.coherence.grid, {
      mode: radar ? 'los' : p.mode, range: p.mode === 'coherence' ? p.coherence.layer.range : pic.layer.range,
      fadeLow: radar ? false : p.fadeLow, threshold: p.threshold, quiet: pic.layer.quietBelow, colormap: pic.layer.colormap,
    })
    const seq = ++paintSeqB.current
    canvas.toBlob((blob) => {
      if (!blob || seq !== paintSeqB.current || mapRef.current !== map) return
      const url = URL.createObjectURL(blob)
      const old = lastUrlB.current
      lastUrlB.current = url
      ;(map.getSource('overlay2') as ImageSource | undefined)?.updateImage({ url, coordinates: corners(bbox) })
      bShows.current = pic.grid
      if (old) setTimeout(() => URL.revokeObjectURL(old), 3000)
      map.setPaintProperty('overlay2', 'raster-opacity', bOpacity(bState.current.cursor))
    }, 'image/png')
  }, [ready, p.next, p.swipe, p.mode, p.fadeLow, p.threshold, p.coherence.layer.range, bbox, bOpacity])
  useLayoutEffect(() => {
    bState.current = { next: p.next, swipe: p.swipe, mode: p.mode, replay: p.replayScale != null, cursor: p.cursor }
    renderBRef.current = renderB
    releaseRef.current = () => {
      holdB.current = false
      renderBRef.current()
      const m = mapRef.current
      if (!m) return
      m.setPaintProperty('overlay', 'raster-opacity', overlayOpacity(changeProgress(p.story, bState.current.cursor, p.secondaryIso), bState.current.mode) * aFactor(bState.current.cursor))
      m.setPaintProperty('overlay2', 'raster-opacity', bOpacity(bState.current.cursor))
    }
  })
  useEffect(() => {
    if (!ready) return
    if (holdB.current) return // the main layer is catching up; it starts this again when it has
    if (p.next) renderB()
    else mapRef.current?.setPaintProperty('overlay2', 'raster-opacity', 0)
  }, [ready, renderB, p.next])

  // quakes appear as the date cursor passes them (these are real, so time-filtering is fine)
  // Only touch the map when the set of visible quakes actually changes, not on every
  // animation frame, which would force constant re-processing while playing.
  const visibleQuakes = p.quakes.features.filter((q) => q.properties.time <= p.cursor).length
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const f = ['<=', ['get', 'time'], p.cursor] as maplibregl.FilterSpecification
    map.setFilter('quake', f)
    map.setFilter('quake-halo', ['all', f, ['>=', ['get', 'mag'], 7]] as maplibregl.FilterSpecification)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, visibleQuakes])

  // USGS overlays on or off
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const vis = (on: boolean) => (on ? 'visible' : 'none')
    map.setLayoutProperty('fault-fill', 'visibility', vis(p.overlays.fault && evReached))
    map.setLayoutProperty('fault-line', 'visibility', vis(p.overlays.fault && evReached))
    map.setLayoutProperty('shaking', 'visibility', vis(p.overlays.shaking && evReached))
    map.setLayoutProperty('cities', 'visibility', vis(p.overlays.cities && evReached))
  }, [ready, evReached, p.overlays.fault, p.overlays.shaking, p.overlays.cities])

  // focal mechanism beach balls at the epicenters
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    beachRef.current.forEach((m) => m.remove())
    beachRef.current = []
    if (!p.overlays.mechanisms || !evReached || !p.context) return
    for (const ev of p.context.events) {
      const pl = ev.mechanism?.planes[0]
      if (!pl) continue
      const img = document.createElement('img')
      img.src = beachball(pl.strike, pl.dip, pl.rake, 72)
      img.className = 'beach'
      img.alt = `Fault mechanism of the M${ev.mag}`
      img.title = `M${ev.mag}: ${ev.mechanism!.planes[1]?.kind ?? ''}`
      beachRef.current.push(new maplibregl.Marker({ element: img }).setLngLat([ev.lon, ev.lat]).addTo(map))
    }
  }, [ready, evReached, p.overlays.mechanisms, p.context])

  // labels pinned on the map (vent, strongest motion)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    annotRef.current.forEach((m) => m.remove())
    annotRef.current = []
    for (const a of annotations ?? []) {
      const el = document.createElement('div')
      el.className = `annot ${a.kind ?? 'note'}`
      el.innerHTML = '<i></i><span></span>'
      el.querySelector('span')!.textContent = a.label
      annotRef.current.push(new maplibregl.Marker({ element: el, anchor: 'left', offset: [-6, 0] }).setLngLat([a.lon, a.lat]).addTo(map))
    }
    return () => { annotRef.current.forEach((m) => m.remove()); annotRef.current = [] }
  }, [ready, annotations])

  // show or hide each label as the timeline moves (classes on the label, because the map manages the marker's own opacity)
  useEffect(() => {
    annotRef.current.forEach((m, i) => m.getElement().classList.toggle('off', annotKey[i] === '0'))
  }, [ready, annotations, annotKey])

  // cross-section line
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const features: FeatureCollection['features'] = []
    const { a, b } = p.profile
    if (a && b) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [a, b] } })
    if (a) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: a } })
    if (b) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: b } })
    ;(map.getSource('profile') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features })
  }, [ready, p.profile])

  // camera flights (guided tour, clicking a city)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !p.camera) return
    const c = p.camera.camera
    map.flyTo({ center: c.center, zoom: c.zoom, pitch: c.pitch, bearing: c.bearing, duration: 2400, essential: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, p.camera?.nonce])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    markerRef.current?.remove()
    markerRef.current = null
    if (p.picked) {
      const d = document.createElement('div')
      d.className = 'pick-ring'
      markerRef.current = new maplibregl.Marker({ element: d }).setLngLat(p.picked).addTo(map)
    }
  }, [ready, p.picked])

  return <div ref={el} className={`map ${p.profileMode ? 'picking' : ''}`} />
}

const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
