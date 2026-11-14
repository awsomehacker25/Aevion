import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { ImageSource, MapMouseEvent, StyleSpecification } from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAP } from './config'
import { renderOverlay } from './lib/render'
import { fmtDate } from './lib/data'
import type { Grid, LayerDef, QuakeCollection, Story, ViewMode } from './types'

interface Props {
  story: Story
  quakes: QuakeCollection
  displacement: { layer: LayerDef; grid: Grid }
  coherence: { layer: LayerDef; grid: Grid }
  mode: ViewMode
  fadeLow: boolean
  threshold: number
  /** Whether the NISAR change layer should be visible at the current date. */
  showChange: boolean
  cursor: number
  picked: [number, number] | null
  onPick: (lon: number, lat: number) => void
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

export default function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const onPickRef = useRef(p.onPick)
  const [ready, setReady] = useState(false)

  useEffect(() => { onPickRef.current = p.onPick }, [p.onPick])

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

      map.addSource('quakes', { type: 'geojson', data: p.quakes as unknown as FeatureCollection })
      const rad = ['interpolate', ['linear'], ['get', 'mag'], 3.5, 4, 5, 9, 7.5, 26] as maplibregl.ExpressionSpecification
      map.addLayer({ id: 'quake-halo', type: 'circle', source: 'quakes', filter: ['>=', ['get', 'mag'], 7],
        paint: { 'circle-radius': ['*', rad, 2.2], 'circle-color': '#ff4d3d', 'circle-opacity': 0.16, 'circle-blur': 0.8 } })
      map.addLayer({ id: 'quake', type: 'circle', source: 'quakes',
        paint: { 'circle-radius': rad, 'circle-color': ['interpolate', ['linear'], ['get', 'mag'], 3.5, '#ffd479', 5, '#ff8a3d', 7.5, '#ff3b30'],
          'circle-opacity': 0.9, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } })

      map.on('mouseenter', 'quake', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'quake', () => { map.getCanvas().style.cursor = '' })
      map.on('click', (e: MapMouseEvent) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ['quake'] })[0]
        if (f) {
          const pr = f.properties as { mag: number; time: number; place: string; url: string }
          new maplibregl.Popup({ closeButton: false, className: 'quake-pop' })
            .setLngLat((f.geometry as Point).coordinates as [number, number])
            .setHTML(`<b>M${pr.mag}</b> &middot; ${pr.place}<br>${fmtDate(pr.time, true)}<br><a href="${pr.url}" target="_blank" rel="noreferrer">USGS event page</a>`)
            .addTo(map)
          return
        }
        onPickRef.current(e.lngLat.lng, e.lngLat.lat)
      })
      setReady(true)
    })
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; setReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.story.id])

  // redraw the change overlay when the view or data changes
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const url = renderOverlay(p.displacement.grid, p.coherence.grid, {
      mode: p.mode,
      range: p.mode === 'coherence' ? p.coherence.layer.range : p.displacement.layer.range,
      fadeLow: p.fadeLow, threshold: p.threshold,
    })
    ;(map.getSource('overlay') as ImageSource).updateImage({ url, coordinates: corners(p.story.aoi.bbox) })
  }, [ready, p.displacement, p.coherence, p.mode, p.fadeLow, p.threshold, p.story.aoi.bbox])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.setPaintProperty('overlay', 'raster-opacity', p.showChange ? 0.95 : 0)
  }, [ready, p.showChange])

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

  return <div ref={el} className="map" />
}

const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
