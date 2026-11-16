import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, ImageSource, MapMouseEvent, StyleSpecification } from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

// MapLibre 6 looks for its worker next to the page, which only works in dev. In a production build (Vercel) the file is missing, so every
// GeoJSON layer (the glowing ring, the region outlines, pins, districts) silently fails. Ship the worker as a hashed asset and point at it.
maplibregl.setWorkerUrl(workerUrl)
import { BASEMAP, LOD } from './config'
import { addBeacon, addSweep } from './AoiBeacon'
import { attachLens, contours } from './vfx'
import { reducedMotion, FLAT_ABOVE, GLOBE_BELOW, floorZoom, introFlight, orbitView, tetherZoom } from './camera'
import { CHEVRONS_HTML } from './Icons'
import { beachball } from './lib/beachball'
import { playhead } from './lib/playhead'
import { changeProgress, eventReached, overlayOpacity } from './lib/progress'
import { renderOverlay } from './lib/render'
import type { MixOpts } from './lib/render'
import { fmtDate } from './lib/data'
import type { CameraReq, Grid, LayerDef, Overlays, QuakeCollection, Story, UsgsContext, ViewMode } from './types'

/** Extra layers drawn over the study area. Ids in `visible` are the image ids, 'districts' and 'pins'. */
export interface MapExtras {
  districts?: FeatureCollection
  pins?: FeatureCollection
  /** Context pictures stretched over the study area. `above` draws over the radar picture, otherwise under it. */
  images: { id: string; url: string; opacity: number; resampling?: 'nearest' | 'linear'; above: boolean }[]
  visible: Record<string, boolean>
  onPin: (id: string) => void
  /** Hide the radar picture (a whole-map context picture such as optical is on and the view is not the water view). */
  hideData: boolean
}

interface Props {
  story: Story
  quakes: QuakeCollection
  context?: UsgsContext
  displacement: { layer: LayerDef; grid: Grid }
  coherence: { layer: LayerDef; grid: Grid }
  radarHH?: { layer: LayerDef; grid: Grid }
  radarHV?: { layer: LayerDef; grid: Grid }
  /** HH/HV colour mix of the period on screen, when the story has the two channels. */
  mix?: MixOpts
  /** The next measured period of a story that follows the timeline, cross-faded in between the two passes (from and to are times in ms). */
  next?: { displacement: { layer: LayerDef; grid: Grid }; coherence: { layer: LayerDef; grid: Grid }; radarHV?: { layer: LayerDef; grid: Grid }; radarHH?: { layer: LayerDef; grid: Grid }; from: number; to: number }
  /** Another measured period to show west of the swipe line instead of the plain imagery (a before/after between two dates). */
  compare?: { displacement: { layer: LayerDef; grid: Grid }; coherence: { layer: LayerDef; grid: Grid }; radarHH?: { layer: LayerDef; grid: Grid }; radarHV?: { layer: LayerDef; grid: Grid }; mix?: MixOpts; labels: [string, string] }
  /** Extra map layers a story brings (districts, reported damage, context pictures). Toggled by `visible`. */
  extras?: MapExtras
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
    projection: { type: 'globe' },
    sources: {
      // Two imagery sources so the far view stays cheap: a world layer capped at a low zoom, and the full-detail layer used up close.
      'sat-far': { type: 'raster', tiles: [BASEMAP.imageryTiles], tileSize: 256, maxzoom: LOD.far.maxzoom, attribution: BASEMAP.imageryAttribution },
      sat: { type: 'raster', tiles: [BASEMAP.imageryTiles], tileSize: 256, maxzoom: 18, attribution: BASEMAP.imageryAttribution },
      dem: { type: 'raster-dem', tiles: [BASEMAP.terrainTiles], tileSize: 256, maxzoom: 14, encoding: BASEMAP.terrainEncoding, attribution: BASEMAP.terrainAttribution },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#05080f' } },
      { id: 'sat-far', type: 'raster', source: 'sat-far', maxzoom: LOD.handoff + 0.5, paint: { 'raster-brightness-max': 0.78, 'raster-saturation': -0.35, 'raster-contrast': 0.1, 'raster-fade-duration': 0 } },
      { id: 'sat', type: 'raster', source: 'sat', minzoom: LOD.handoff, paint: { 'raster-brightness-max': 0.78, 'raster-saturation': -0.35, 'raster-contrast': 0.1 } },
      // No hillshade layer: it made panning and tilting crawl (about 1 frame per second against 30 without it). The 3D terrain still gives the relief.
    ],
    // terrain is switched on in code once the map is zoomed in far enough to be flat (see camera.ts)
    sky: {
      'sky-color': '#0a1424', 'horizon-color': '#2a4a7a', 'fog-color': '#16263f',
      'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.25, 'atmosphere-blend': 0.9,
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
  const cmpRef = useRef<HTMLCanvasElement | null>(null) // the compare period's overlay, drawn west of the swipe line
  const viewRef = useRef<HTMLCanvasElement | null>(null) // the overlay cut at the swipe line, encoded and sent to the map
  const swipeFrac = useRef(0.5) // swipe line position across the map box: 0 = west edge, 1 = east edge
  const swipeOn = useRef(false)

  const appliedSeq = useRef(0)
  const paintSeq = useRef(0) // numbers each update so an older, slower one can never overwrite a newer one
  const lastUrl = useRef<string | null>(null)
  const bbox = p.story.aoi.bbox

  // Two picture layers take turns. One shows the CURRENT period; the other holds the NEXT period and fades in as the timeline moves
  // toward the next pass. When the timeline passes that pass the two just swap jobs: the picture that was fading in is already loaded
  // and already on screen, so the map never has to replace a picture that is visible (doing that mid-playback is what flickered).
  type Held = { grid: Grid; sig: string }
  type LayerId = 'overlay' | 'overlay2'
  const otherOf = (l: LayerId): LayerId => (l === 'overlay' ? 'overlay2' : 'overlay')
  const curLayer = useRef<LayerId>('overlay') // the layer that shows the current period
  const held = useRef<Record<LayerId, Held | null>>({ overlay: null, overlay2: null }) // the picture each layer has been given
  const curPaint = useRef<Held | null>(null) // what the current layer is being asked to show
  const paintSeqB = useRef(0)
  const lastUrlB = useRef<string | null>(null)
  const applyRef = useRef<() => void>(() => {}) // sets both layers' opacity for the latest date
  const bState = useRef<{ next?: Props['next']; swipe: boolean; mode: ViewMode; replay: boolean; cursor: number; sig: string }>(
    { swipe: false, mode: 'los', replay: false, cursor: 0, sig: '' })
  // The next period's picture for the view on screen (the HV picture in HV mode), or nothing when it has none.
  const nextPicture = (n: NonNullable<Props['next']>, mode: ViewMode) =>
    mode === 'hh' ? n.radarHH : mode === 'hv' ? n.radarHV : mode === 'mix' ? undefined : n.displacement
  // true once the idle layer really holds the next period's picture, drawn with the settings now in use
  const nextReady = () => {
    const s = bState.current
    const h = held.current[otherOf(curLayer.current)]
    return !!s.next && !s.swipe && !s.replay && !!h && h.sig === s.sig && h.grid === nextPicture(s.next, s.mode)?.grid
  }
  const setOps = (map: maplibregl.Map, cur: number, next: number) => {
    map.setPaintProperty(curLayer.current, 'raster-opacity', cur)
    map.setPaintProperty(otherOf(curLayer.current), 'raster-opacity', next)
  }

  // The current period's own layer fades out over the last part of the cross-fade, so that where the next picture is
  // transparent (little change there) the old one does not show through at the end, which would pop when the period changes.
  const aFactor0 = useCallback((t: number) => {
    const n = bState.current.next
    if (!n || !nextReady() || t <= n.from) return 1
    const x = Math.min(1, (t - n.from) / (n.to - n.from))
    const y = Math.max(0, (x - 0.6) / 0.4)
    return 1 - y * y * (3 - 2 * y)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const bOpacity0 = useCallback((t: number) => {
    const n = bState.current.next
    if (!n || !nextReady() || t <= n.from) return 0
    if (t >= n.to) return 0.95
    const x = (t - n.from) / (n.to - n.from)
    return 0.95 * x * x * (3 - 2 * x)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // The picture is revealed by the radar-pass sweep after the flight: until then everything the layers show is multiplied by revealRef (0 to 1).
  const revealRef = useRef(0)
  const gateRef = useRef(1) // 0 while a whole-map context picture replaces the radar picture
  const aFactor = useCallback((t: number) => aFactor0(t) * revealRef.current * gateRef.current, [aFactor0])
  const bOpacity = useCallback((t: number) => bOpacity0(t) * revealRef.current * gateRef.current, [bOpacity0])

  // Send the overlay to the map as an image, cutting off the "before" side when swiping. Encoding happens off the main
  // thread (toBlob), and only the newest request is applied.
  const paintBusy = useRef(false) // one encode at a time: while one runs, newer swipe positions wait and only the latest is drawn
  const paintDirty = useRef(false)
  const dragging = useRef(false) // while the divider is being dragged the picture is drawn smaller, then sharp again on release
  const paintRef = useRef<() => void>(() => {})
  const rebuildFull = useRef<(() => void) | null>(null) // draws the full-size picture when it was skipped (see the period change below)
  const paintOverlay = useCallback(() => {
    const map = mapRef.current
    if (!fullRef.current && rebuildFull.current) rebuildFull.current()
    const full = fullRef.current
    if (!map || !full) return
    if (paintBusy.current) { paintDirty.current = true; return }
    // while dragging: a small picture in WebP (much quicker to encode than PNG); once let go: full size and lossless again
    const k = dragging.current ? Math.min(1, 640 / full.width) : 1
    const W = Math.max(1, Math.round(full.width * k))
    const H = Math.max(1, Math.round(full.height * k))
    const view = viewRef.current ?? (viewRef.current = document.createElement('canvas'))
    if (view.width !== W || view.height !== H) { view.width = W; view.height = H }
    const ctx = view.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    const sx = swipeOn.current ? Math.round(Math.min(1, Math.max(0, swipeFrac.current)) * full.width) : 0
    const dx = Math.round(sx * k)
    const cmp = cmpRef.current
    if (cmp && sx > 0 && swipeOn.current) ctx.drawImage(cmp, 0, 0, Math.min(sx, cmp.width), cmp.height, 0, 0, dx, H)
    if (sx < full.width) ctx.drawImage(full, sx, 0, full.width - sx, full.height, dx, 0, W - dx, H)
    const seq = ++paintSeq.current
    const target = curLayer.current
    const shown = curPaint.current
    const apply = (url: string) => {
      ;(map.getSource(target) as ImageSource | undefined)?.updateImage({ url, coordinates: corners(bbox) })
      held.current[target] = shown
      applyRef.current() // the layer's picture changed, which can change which layer has which job
    }
    if (view.width <= 400) {
      // the small replay frames encode instantly, so skip the asynchronous encoder, which can lag behind a fast replay
      appliedSeq.current = seq
      apply(view.toDataURL('image/png'))
      return
    }
    paintBusy.current = true
    view.toBlob((blob) => {
      paintBusy.current = false
      // (if the layers swapped jobs while this was encoding, this picture is no longer wanted)
      if (blob && seq > appliedSeq.current && mapRef.current === map && target === curLayer.current) {
        appliedSeq.current = seq
        const url = URL.createObjectURL(blob)
        const old = lastUrl.current
        lastUrl.current = url
        apply(url)
        if (old) setTimeout(() => URL.revokeObjectURL(old), 3000) // the map has long since loaded the previous image
      }
      if (paintDirty.current) { paintDirty.current = false; paintRef.current() }
    }, dragging.current ? 'image/webp' : 'image/png', dragging.current ? 0.75 : undefined)
  }, [bbox])
  useEffect(() => { paintRef.current = paintOverlay }, [paintOverlay])
  // the latest callbacks and mode, read by the one-time click handler
  const live = useRef({ onPick: p.onPick, onProfilePoint: p.onProfilePoint, profileMode: p.profileMode, onPin: p.extras?.onPin })
  const [ready, setReady] = useState(false)
  const [away, setAway] = useState(false) // the study area is off screen, or the view is pushed far out
  const [intro, setIntro] = useState<null | 'wait' | 'fly'>(null) // waiting for the first imagery, or the opening flight is running
  const beaconRef = useRef<ReturnType<typeof addBeacon> | null>(null)
  const introRef = useRef<(() => void) | null>(null)
  const returnRef = useRef<() => void>(() => {})
  const [fxOn, setFxOn] = useState(false) // the flight and the reveal are over: the extra effects may run
  const latest = useRef(p)
  useEffect(() => { latest.current = p })
  const fxBlocked = useRef(false) // true while something else owns the pointer or the picture (flight, cross-section tool)
  useEffect(() => { fxBlocked.current = !fxOn || p.profileMode }, [fxOn, p.profileMode])
  const lensRef = useRef<(() => void) | null>(null)

  // Everything on the map is a function of the timeline position, so scrubbing backward undoes it again.
  const scale = p.replayScale ?? p.progress
  const evReached = eventReached(p.story, p.cursor)
  const annotations = p.story.annotations
  const annotKey = (annotations ?? [])
    .map((a) => ((a.appears === 'event' ? evReached : a.appears === 'change' ? scale >= 0.8 : true) ? '1' : '0'))
    .join('')

  useEffect(() => { live.current = { onPick: p.onPick, onProfilePoint: p.onProfilePoint, profileMode: p.profileMode, onPin: p.extras?.onPin } })
  const imgUrl = useRef<Record<string, string>>({}) // the picture each context layer currently holds

  // create the map once per story
  useEffect(() => {
    const { aoi } = p.story
    const map = new maplibregl.Map({
      container: el.current!,
      style: styleFor(),
      // starts as the whole Earth; the opening flight (below) carries it to the story's area
      ...orbitView(aoi),
      // A global floor keeps tile counts bounded; the soft tether (below) pulls the view back toward the study area well before it.
      minZoom: floorZoom(),
      maxPitch: 75, attributionControl: { compact: true },
      // Lighter drawing: cap the pixel density on sharp screens (4x the work for little visible gain) and skip tile fade-ins.
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), fadeDuration: 0,
    })
    mapRef.current = map
    // fade the map in once the first picture is ready (a data attribute, so React's className updates never remove it)
    const reveal = () => { map.getContainer().dataset.ready = '1' }
    map.once('idle', reveal)
    const revealTimer = window.setTimeout(reveal, 2500)
    if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = map
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

      // (the study-area outline is the glowing ring added below; it replaces the old dashed rectangle)

      // outlines of the regions that moved the most: a thin light line with a soft glow, never recolouring the data
      map.addSource('contour', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'contour-glow', type: 'line', source: 'contour', paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-blur': 5, 'line-opacity': 0 } }, 'swipe-line')
      map.addLayer({ id: 'contour-line', type: 'line', source: 'contour', paint: { 'line-color': '#ffffff', 'line-width': 1.1, 'line-opacity': 0 } }, 'swipe-line')

      // extra layers a story brings: districts, reported damage and context pictures (hidden until switched on)
      const ex = latest.current.extras
      if (ex) {
        for (const im of ex.images) {
          map.addSource(`x-${im.id}`, { type: 'image', url: TRANSPARENT, coordinates: corners(aoi.bbox) })
          map.addLayer({ id: `x-${im.id}`, type: 'raster', source: `x-${im.id}`, layout: { visibility: 'none' },
            paint: { 'raster-opacity': im.opacity, 'raster-fade-duration': 0, 'raster-resampling': im.resampling ?? 'linear' } }, im.above ? 'swipe-line' : 'overlay')
        }
        if (ex.districts) {
          map.addSource('districts', { type: 'geojson', data: ex.districts })
          map.addLayer({ id: 'districts-casing', type: 'line', source: 'districts', layout: { visibility: 'none' }, paint: { 'line-color': '#000', 'line-width': 3.5, 'line-opacity': 0.5 } }, 'swipe-line')
          map.addLayer({ id: 'districts', type: 'line', source: 'districts', layout: { visibility: 'none' }, paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-dasharray': [4, 2] } }, 'swipe-line')
        }
        if (ex.pins) {
          map.addSource('pins', { type: 'geojson', data: ex.pins })
          map.addLayer({ id: 'pins-halo', type: 'circle', source: 'pins', filter: ['==', ['get', 'approximate'], true], layout: { visibility: 'none' },
            paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 11, 10, 14, 16], 'circle-color': '#e69f00', 'circle-opacity': 0.18, 'circle-stroke-color': '#e69f00', 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.6 } }, 'swipe-line')
          map.addLayer({ id: 'pins', type: 'circle', source: 'pins', layout: { visibility: 'none' },
            paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 11, 6, 14, 8], 'circle-color': ['case', ['get', 'approximate'], '#ffffff', '#e69f00'],
              'circle-stroke-color': ['case', ['get', 'approximate'], '#e69f00', '#ffffff'], 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 12, 3] } }, 'swipe-line')
        }
      }

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

      for (const id of ['quake', 'cities', ...(map.getLayer('pins') ? ['pins'] : [])]) {
        map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = '' })
      }
      map.on('click', (e: MapMouseEvent) => {
        if (live.current.profileMode) { live.current.onProfilePoint(e.lngLat.lng, e.lngLat.lat); return }
        const f = map.queryRenderedFeatures(e.point, { layers: ['quake', 'cities', ...(map.getLayer('pins') ? ['pins'] : [])] })[0]
        if (f && f.layer.id === 'pins') { live.current.onPin?.(String((f.properties as { id: string }).id)); return }
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

      // Glowing boundary around the study area, with the outside dimmed so the eye stays inside it.
      const beacon = addBeacon(map, aoi.bbox, { dimBefore: 'overlay' })
      beaconRef.current = beacon

      // Globe when far out, flat map with 3D terrain when close. Two thresholds so it does not flicker at the edge.
      let flat = false
      let flying = true
      const syncProjection = () => {
        // During the opening flight stay on the globe: switching mid-flight loads terrain tiles at every zoom the camera passes through.
        if (flying) return
        const z = map.getZoom()
        if (!flat && z >= FLAT_ABOVE) {
          flat = true
          map.setProjection({ type: 'mercator' })
          map.setTerrain({ source: 'dem', exaggeration: BASEMAP.terrainExaggeration })
        } else if (flat && z <= GLOBE_BELOW) {
          flat = false
          map.setTerrain(null)
          map.setProjection({ type: 'globe' })
        }
        beacon.scaleFor(z)
      }
      map.on('zoom', syncProjection)

      // Is the study area still in view? If not (or if the view is pushed far out), offer a way back and ease the view home.
      const tether = tetherZoom(aoi)
      const checkAway = () => {
        if (flying) return
        // only "away" when no part of the study area is on screen (zooming in on a detail is not getting lost)
        const bb = map.getBounds()
        const [w, so, e, n] = aoi.bbox
        const inView = bb.getWest() < e && bb.getEast() > w && bb.getSouth() < n && bb.getNorth() > so
        setAway(!inView || map.getZoom() < tether)
      }
      let awayT = 0
      map.on('move', () => { if (awayT) return; awayT = window.setTimeout(() => { awayT = 0; checkAway() }, 250) })
      returnRef.current = () => map.flyTo({ center: aoi.center, zoom: aoi.zoom, pitch: aoi.pitch, bearing: aoi.bearing, speed: 0.9, essential: true })

      // opening flight: the whole Earth turns and dives to the study area; Esc skips it
      syncProjection()
      // The radar-pass: a light line sweeps across the study area while the picture fades in behind it. Afterwards the other effects start.
      const applyOpacity = () => {
        const q = latest.current
        if (q.replayScale != null) return
        setOps(map, overlayOpacity(q.progress, q.mode) * aFactor(q.cursor), bOpacity(q.cursor))
      }
      const sweep = addSweep(map, aoi.bbox)
      // The sweep runs during the last stretch of the descent, while the whole ring is still in view, so the line is a chord of the ring
      // on the ground (at the camera's own angle) and not a stray line across a screen that the ring has already outgrown.
      let sweepDone = false
      let flightDone = false
      const maybeFx = () => { if (sweepDone && flightDone) setFxOn(true) }
      let swept = false
      const startReveal = () => {
        if (swept) return
        swept = true
        beacon.scaleFor(map.getZoom()); beacon.show()
        if (reducedMotion()) { revealRef.current = 1; applyOpacity(); sweepDone = true; maybeFx(); return }
        const t0 = performance.now()
        const D = 1700
        const step = (t: number) => {
          if (cancelled) return
          const k = Math.min(1, (t - t0) / D)
          const e = k * k * (3 - 2 * k)
          sweep.set(e)
          revealRef.current = Math.min(1, e * 1.25) // the picture is revealed just behind the line
          applyOpacity()
          if (k < 1) requestAnimationFrame(step)
          else { sweep.clear(); revealRef.current = 1; applyOpacity(); sweepDone = true; maybeFx() }
        }
        requestAnimationFrame(step)
      }
      map.on('zoom', () => { if (flying && !swept && map.getZoom() >= aoi.zoom - 2.0) startReveal() })
      // hover lens inside the study area (an outline only, so the data underneath is never tinted)
      const detachLens = attachLens(map, aoi.bbox, () => fxBlocked.current)
      lensRef.current = detachLens

      // wait for the first picture of the Earth so the flight does not start over a blank globe (never longer than 4 s)
      let started = false
      const begin = () => {
        if (started || cancelled) return
        started = true
        window.clearTimeout(to)
        setIntro('fly')
        introRef.current = introFlight(map, aoi, { onDone: () => {
          flying = false; syncProjection(); checkAway(); setIntro(null)
          flightDone = true
          startReveal() // (no-op when the sweep already ran during the descent)
          maybeFx()
        } })
      }
      const to = window.setTimeout(begin, 4000)
      map.once('idle', begin)
      setIntro('wait')
      setReady(true)
    })
    return () => { cancelled = true; window.clearTimeout(revealTimer); lensRef.current?.(); revealRef.current = 0; setFxOn(false); beaconRef.current?.destroy(); introRef.current?.(); map.remove(); mapRef.current = null; markerRef.current = null; beachRef.current = []; setReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.story.id])

  // redraw the change overlay when the view or data changes (and, at low quality, during the replay)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    // radar brightness views draw their own layer with the same diverging colors; the interferometric coherence mask does not apply to them
    const draw = (src: { displacement: { layer: LayerDef; grid: Grid }; coherence: { layer: LayerDef; grid: Grid }; radarHH?: { layer: LayerDef; grid: Grid }; radarHV?: { layer: LayerDef; grid: Grid }; mix?: MixOpts }) => {
      const radar = p.mode === 'hh' ? src.radarHH : p.mode === 'hv' ? src.radarHV : undefined
      return renderOverlay(p.mode === 'mix' && src.mix ? src.mix.hh : radar?.grid ?? src.displacement.grid, src.coherence.grid, {
        mix: src.mix,
        mode: radar ? 'los' : p.mode,
        range: radar ? radar.layer.range : p.mode === 'coherence' ? src.coherence.layer.range : src.displacement.layer.range,
        fadeLow: radar ? false : p.fadeLow, threshold: p.threshold,
        scale: p.replayScale ?? 1, low: p.replayScale != null, quiet: (radar ?? src.displacement).layer.quietBelow,
        colormap: (radar ?? src.displacement).layer.colormap,
      })
    }
    const build = () => {
      fullRef.current = draw(p)
      // the compare picture is only ever shown while swiping
      cmpRef.current = p.compare && p.replayScale == null && p.swipe ? draw(p.compare) : null
    }
    const curGrid = p.mode === 'mix' && p.mix ? p.mix.hh : (p.mode === 'hh' ? p.radarHH : p.mode === 'hv' ? p.radarHV : undefined)?.grid ?? p.displacement.grid
    const sig = `${p.mode}|${p.fadeLow}|${p.threshold}|${p.swipe ? 1 : 0}`
    curPaint.current = { grid: curGrid, sig }
    const idle = held.current[otherOf(curLayer.current)]
    // The timeline moved on to the period whose picture the other layer was already fading in: it simply becomes the current layer.
    // Nothing visible is replaced. (The full-size copy, needed only for swiping, is drawn a moment later, off the critical path.)
    if (!p.swipe && p.replayScale == null && !dragging.current && idle && idle.grid === curGrid && idle.sig === sig) {
      curLayer.current = otherOf(curLayer.current)
      fullRef.current = null
      cmpRef.current = null
      rebuildFull.current = () => { rebuildFull.current = null; build() }
      applyRef.current() // (the full-size copy is drawn only if it is asked for)
      return
    }
    rebuildFull.current = null
    build()
    paintOverlay()
    // The compare and mix objects are rebuilt on every render of the page (which happens many times a second while the timeline plays),
    // so this effect depends on the pictures inside them, not on the objects: otherwise the whole overlay is redrawn and re-sent each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, paintOverlay, p.displacement, p.coherence, p.radarHH, p.radarHV, p.mix?.kind, p.mix?.hh, p.mix?.hv, p.mix?.rHH, p.mix?.rHV,
    p.compare?.displacement.grid, p.compare?.coherence.grid, p.compare?.radarHH?.grid, p.compare?.radarHV?.grid, p.compare?.mix?.hh, p.compare?.mix?.hv,
    p.mode, p.fadeLow, p.threshold, p.story.aoi.bbox, p.replayScale, p.swipe])

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
    // the divider can slide from the picture's west edge to its east edge, like borders
    const within = (lng: number) => Math.min(e, Math.max(w, lng))
    const lng0 = within(w + (e - w) * swipeFrac.current)
    swipeFrac.current = (lng0 - w) / (e - w)
    src.setData(lineAt(lng0))
    const el = document.createElement('div')
    el.className = 'swipe-handle'
    el.title = 'Drag to compare before and after'
    el.innerHTML = `<span>${p.compare?.labels[0] ?? 'Before'}</span><b>${CHEVRONS_HTML}</b><span>${p.compare?.labels[1] ?? 'After'}</span>`
    const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([lng0, lat0]).addTo(map)
    marker.on('dragstart', () => { dragging.current = true })
    marker.on('dragend', () => { dragging.current = false; paintOverlay() }) // sharp again once let go
    marker.on('drag', () => {
      const lng = within(marker.getLngLat().lng)
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
  }, [ready, p.swipe, p.story.aoi.bbox, paintOverlay, p.compare?.labels[0], p.compare?.labels[1]])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (p.replayScale != null) { setOps(map, 0.95, 0); return }
    gateRef.current = p.extras?.hideData ? 0 : 1
    if (playhead.active) return // while playing, the per-frame subscriber below owns the fade
    // The overlay is drawn once at full strength; the build-up only fades it, so nothing is redrawn as time moves.
    setOps(map, overlayOpacity(p.progress, p.mode) * aFactor(p.cursor), bOpacity(p.cursor))
  }, [ready, p.progress, p.mode, p.replayScale, p.cursor, p.next, p.swipe, p.extras?.hideData, bOpacity, aFactor])

  // show or hide the extra layers, and load a context picture the first time it is switched on (or when its picture changes, like people by date)
  useEffect(() => {
    const map = mapRef.current
    const ex = p.extras
    if (!ready || !map || !ex) return
    for (const im of ex.images) {
      const id = `x-${im.id}`
      if (!map.getLayer(id)) continue
      const on = !!ex.visible[im.id]
      map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
      if (on && imgUrl.current[im.id] !== im.url) {
        imgUrl.current[im.id] = im.url
        ;(map.getSource(id) as ImageSource).updateImage({ url: im.url, coordinates: corners(bbox) })
      }
    }
    for (const [key, layers] of [['districts', ['districts-casing', 'districts']], ['pins', ['pins-halo', 'pins']]] as const) {
      for (const l of layers) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', ex.visible[key] ? 'visible' : 'none')
    }
  }, [ready, p.extras, bbox])

  // while playing, fade smoothly every animation frame instead of at the slower React update rate
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || p.replayScale != null) return
    return playhead.subscribe((t) => {
      setOps(map, overlayOpacity(changeProgress(p.story, t, p.secondaryIso), p.mode) * aFactor(t), bOpacity(t))
    })
  }, [ready, p.replayScale, p.story, p.mode, p.secondaryIso, bOpacity, aFactor])

  // The idle layer: draw the NEXT period's picture into it, ready to cross-fade in.
  const renderB = useCallback(() => {
    const map = mapRef.current
    const n = p.next
    const pic = n ? nextPicture(n, p.mode) : undefined
    if (!ready || !map || !n || !pic || p.swipe) return
    const target = otherOf(curLayer.current)
    const sig = `${p.mode}|${p.fadeLow}|${p.threshold}|0`
    const have = held.current[target]
    if (have && have.grid === pic.grid && have.sig === sig) return // already there
    const radar = p.mode === 'hv' || p.mode === 'hh'
    const canvas = renderOverlay(pic.grid, n.coherence.grid, {
      mode: radar ? 'los' : p.mode, range: p.mode === 'coherence' ? p.coherence.layer.range : pic.layer.range,
      fadeLow: radar ? false : p.fadeLow, threshold: p.threshold, quiet: pic.layer.quietBelow, colormap: pic.layer.colormap,
    })
    const seq = ++paintSeqB.current
    canvas.toBlob((blob) => {
      // dropped if a newer picture was asked for, or if the layers swapped jobs while this was encoding
      if (!blob || seq !== paintSeqB.current || mapRef.current !== map || target !== otherOf(curLayer.current)) return
      const url = URL.createObjectURL(blob)
      const old = lastUrlB.current
      lastUrlB.current = url
      ;(map.getSource(target) as ImageSource | undefined)?.updateImage({ url, coordinates: corners(bbox) })
      held.current[target] = { grid: pic.grid, sig }
      if (old) setTimeout(() => URL.revokeObjectURL(old), 3000)
      applyRef.current()
    }, 'image/png')
  }, [ready, p.next, p.swipe, p.mode, p.fadeLow, p.threshold, p.coherence.layer.range, bbox])
  useLayoutEffect(() => {
    bState.current = { next: p.next, swipe: p.swipe, mode: p.mode, replay: p.replayScale != null, cursor: p.cursor, sig: `${p.mode}|${p.fadeLow}|${p.threshold}|${p.swipe ? 1 : 0}` }
    applyRef.current = () => {
      const m = mapRef.current
      if (!m) return
      if (p.replayScale != null) { setOps(m, 0.95, 0); return }
      const c = bState.current.cursor
      setOps(m, overlayOpacity(changeProgress(p.story, c, p.secondaryIso), p.mode) * aFactor(c), bOpacity(c))
    }
  })
  useEffect(() => {
    if (!ready) return
    if (!p.next) { applyRef.current(); return }
    // drawn a moment after a period change, not in the same frame: the new picture only starts to fade in slowly
    const h = window.setTimeout(renderB, 100)
    return () => window.clearTimeout(h)
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

  // labels pinned on the map (vent, strongest motion). A story that follows the timeline hands over a new but identical list at every
  // satellite pass, so the markers are rebuilt only when what they say or where they sit actually changes (rebuilding made them blink).
  const annotSig = (annotations ?? []).map((a) => `${a.lon},${a.lat},${a.kind ?? ''},${a.label}`).join('|')
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, annotSig])

  // show or hide each label as the timeline moves (classes on the label, because the map manages the marker's own opacity)
  useEffect(() => {
    annotRef.current.forEach((m, i) => m.getElement().classList.toggle('off', annotKey[i] === '0'))
  }, [ready, annotSig, annotKey])

  // ---- extra effects. They start only after the flight and the reveal, and each one stands down for the views it would clash with ----
  const losView = p.mode === 'los' && !p.swipe && p.replayScale == null && !p.profileMode

  // outlines of the strongest-moving regions
  useEffect(() => {
    const map = mapRef.current
    // (the outlines are only drawn in the motion view, so nothing is worked out for the other views)
    if (!ready || !map || !fxOn || !losView || !map.getSource('contour')) return
    const lay = p.displacement.layer
    const level = Math.max(lay.quietBelow ?? 0, 0.3 * Math.max(Math.abs(lay.range[0]), Math.abs(lay.range[1])))
    ;(map.getSource('contour') as GeoJSONSource).setData(contours(p.displacement.grid, p.coherence.grid, p.fadeLow ? p.threshold : 0, level) as FeatureCollection)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fxOn, losView, p.displacement, p.coherence, p.fadeLow, p.threshold])
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !map.getLayer('contour-line')) return
    const k = fxOn && losView ? Math.min(1, overlayOpacity(p.progress, p.mode) * aFactor(p.cursor)) : 0
    map.setPaintProperty('contour-line', 'line-opacity', 0.7 * k)
    map.setPaintProperty('contour-glow', 'line-opacity', 0.22 * k)
  }, [ready, fxOn, losView, p.progress, p.mode, p.cursor, p.next, aFactor])

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

  return (
    <>
      <div ref={el} className={`map ${p.profileMode ? 'picking' : ''}`} />
      {intro === 'wait' && <div className="intro-hint" role="status">Loading imagery…</div>}
      {intro === 'fly' && (
        // the same skip as the Esc key, for screens without a keyboard
        <button type="button" className="intro-hint skip" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))}>
          {window.matchMedia('(pointer: coarse)').matches ? 'Tap to skip' : 'Press Esc to skip'}
        </button>
      )}
      {away && !intro && (
        <button className="return-chip" onClick={() => returnRef.current()}>
          Return to the study area
        </button>
      )}
    </>
  )
}

const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
