/**
 * App-level configuration. Data (grids, dates, text) lives in public/stories/<id>/story.json.
 * Only things that are NOT story data live here: map base layers and tuning.
 *
 * To swap a base layer, change the URL. To use Cesium instead of MapLibre later, only
 * MapView.tsx needs to be replaced; everything else works from the story manifest.
 */
export const BASEMAP = {
  // Satellite imagery. Esri World Imagery is free for development; check terms before launch.
  imageryTiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  imageryAttribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
  // Elevation tiles (Terrarium encoding), free, no key. Swap for Cesium World Terrain / your own tiles.
  terrainTiles: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  terrainEncoding: 'terrarium' as const,
  terrainAttribution: 'Terrain: Mapzen / AWS Terrain Tiles',
  terrainExaggeration: 1.6,
  // Place names drawn over the imagery (used by the flood map), also free for development.
  labelTiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
}

/**
 * Level of detail for the base imagery. The far layer is capped at a low zoom so a whole-Earth view loads only a few tiles;
 * the full-detail layer takes over from `handoff` upward.
 */
export const LOD = { far: { maxzoom: 5 }, handoff: 4.5 }

/** Coherence below this is treated as unreliable by default. Users can change it in the UI. */
export const DEFAULT_COHERENCE_THRESHOLD = 0.5

/** Seconds for the timeline "play" animation to cross the whole date range. */
export const PLAY_SECONDS = 14

/** Playback slows down so the change takes at least this many seconds to build up. */
export const BUILD_SECONDS = 3.5

/** The team and the event, shown in the credits and on the loading screen. */
export const TEAM = ['Rui Sun', 'Aaryaman Chopra', 'Palash Desarda', 'Andrew Chen', 'Ethan de Guzman', 'Kaiyaan Faisal']
export const EVENT = '2026 NASA Space Apps Challenge · Dancing with the SARs'
