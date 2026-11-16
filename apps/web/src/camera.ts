import type { Map as MlMap } from 'maplibre-gl'
import type { Story } from './types'

type Aoi = Story['aoi']

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Above this zoom the map is flat (mercator) with 3D terrain; below it, a globe with no terrain. Two values so it does not flicker at the edge. */
export const GLOBE_BELOW = 5.6
export const FLAT_ABOVE = 6.2

/** The whole-Earth view the intro starts from: facing the story's longitude, a little north of the equator. */
export const orbitView = (aoi: Aoi, zoom = 1.3) => ({ center: [aoi.center[0], Math.min(35, Math.max(-5, aoi.center[1] * 0.5))] as [number, number], zoom, pitch: 0, bearing: 0 })

/** How far out the view may be pushed before it springs back toward the study area. */
export const tetherZoom = (aoi: Aoi) => Math.max(3.2, aoi.zoom - 3.4)
/** The closest-in the global floor ever lets the view go out to (keeps tile counts bounded). */
export const floorZoom = () => 1.1

/**
 * Fly from a whole-Earth view to the story's area. Resolves when the flight ends or is skipped.
 * With reduced motion the camera simply appears at the destination.
 */
export function introFlight(map: MlMap, aoi: Aoi, opts: { onDone?: () => void; skipOn?: HTMLElement | Window } = {}): () => void {
  const dest = { center: aoi.center, zoom: aoi.zoom, pitch: aoi.pitch, bearing: aoi.bearing }
  if (reducedMotion()) { map.jumpTo(dest); opts.onDone?.(); return () => {} }
  const from = orbitView(aoi)
  map.jumpTo(from)
  let done = false
  const finish = () => {
    if (done) return
    done = true
    window.removeEventListener('keydown', onKey)
    map.off('moveend', onEnd)
    opts.onDone?.()
  }
  const onEnd = () => finish()
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || done) return
    map.stop()
    map.jumpTo(dest)
    finish()
  }
  window.addEventListener('keydown', onKey)
  map.once('moveend', onEnd)
  // a slow swivel of the globe first, then the dive: flyTo's curve gives the zoom-out-then-in arc for free
  map.flyTo({ ...dest, bearing: aoi.bearing, speed: 0.55, curve: 1.5, essential: true })
  return () => { map.stop(); finish() }
}

/** Fly out to orbit, swivel to a new area, and fly in (used when the story changes while the map is open). */
export function travelTo(map: MlMap, aoi: Aoi, onDone?: () => void) {
  introFlight(map, aoi, { onDone })
}
