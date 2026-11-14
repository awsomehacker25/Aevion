import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { ImageSource, MapMouseEvent, StyleSpecification } from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAP } from './config'
import { beachball } from './lib/beachball'
import { renderOverlay } from './lib/render'
import { fmtDate } from './lib/data'
import type { CameraReq, Grid, LayerDef, Overlays, QuakeCollection, Story, UsgsContext, ViewMode } from './types'

interface Props {
  story: Story
  quakes: QuakeCollection
  context?: UsgsContext
  displacement: { layer: LayerDef; grid: Grid }
  coherence: { layer: LayerDef; grid: Grid }
  mode: ViewMode
  fadeLow: boolean
  threshold: number
  /** Whether the NISAR change layer should be visible at the current date. */
  showChange: boolean
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
      // separate source for hillshade, as MapLibre recommends when 3D terrain uses the same tiles
      demShade: { type: 'raster-dem', tiles: [BASEMAP.terrainTiles], tileSize: 256, maxzoom: 14, encoding: BASEMAP.terrainEncoding },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#05080f' } },
      { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-brightness-max': 0.78, 'raster-saturation': -0.35, 'raster-contrast': 0.1 } },
      { id: 'hillshade', type: 'hillshade', source: 'demShade', paint: { 'hillshade-exaggeration': 0.4, 'hillshade-shadow-color': '#000000', 'hillshade-highlight-color': '#ffffff' } },
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
  // the latest callbacks and mode, read by the one-time click handler
  const live = useRef({ onPick: p.onPick, onProfilePoint: p.onProfilePoint, profileMode: p.profileMode })
  const [ready, setReady] = useState(false)

  useEffect(() => { live.current = { onPick: p.onPick, onProfilePoint: p.onProfilePoint, profileMode: p.profileMode } })

  // create the map once per story
  useEffect(() => {
    const { aoi } = p.story
    const map = new maplibregl.Map({
      container: el.current!,
      style: styleFor(),
      center: aoi.center, zoom: aoi.zoom, pitch: aoi.pitch, bearing: aoi.bearing,
      maxPitch: 82, attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')

    map.on('load', () => {
      // keep the focus area clear of the side panel and timeline
      if (window.innerWidth > 760) map.setPadding({ left: 360, bottom: 150, top: 0, right: 0 })
      map.addSource('overlay', { type: 'image', url: TRANSPARENT, coordinates: corners(aoi.bbox) })
      map.addLayer({ id: 'overlay', type: 'raster', source: 'overlay', paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } })

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
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; beachRef.current = []; setReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.story.id])

  // redraw the change overlay when the view or data changes (and, at low quality, during the replay)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const url = renderOverlay(p.displacement.grid, p.coherence.grid, {
      mode: p.mode,
      range: p.mode === 'coherence' ? p.coherence.layer.range : p.displacement.layer.range,
      fadeLow: p.fadeLow, threshold: p.threshold,
      scale: p.replayScale ?? 1, low: p.replayScale != null,
    })
    ;(map.getSource('overlay') as ImageSource).updateImage({ url, coordinates: corners(p.story.aoi.bbox) })
  }, [ready, p.displacement, p.coherence, p.mode, p.fadeLow, p.threshold, p.story.aoi.bbox, p.replayScale])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    // the replay is illustrative and always visible, so it can play before the post-event date
    map.setPaintProperty('overlay', 'raster-opacity', p.showChange || p.replayScale != null ? 0.95 : 0)
  }, [ready, p.showChange, p.replayScale])

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
    map.setLayoutProperty('fault-fill', 'visibility', vis(p.overlays.fault))
    map.setLayoutProperty('fault-line', 'visibility', vis(p.overlays.fault))
    map.setLayoutProperty('shaking', 'visibility', vis(p.overlays.shaking))
    map.setLayoutProperty('cities', 'visibility', vis(p.overlays.cities))
  }, [ready, p.overlays.fault, p.overlays.shaking, p.overlays.cities])

  // focal mechanism beach balls at the epicenters
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    beachRef.current.forEach((m) => m.remove())
    beachRef.current = []
    if (!p.overlays.mechanisms || !p.context) return
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
  }, [ready, p.overlays.mechanisms, p.context])

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
