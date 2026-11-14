export type Badge = 'OBSERVED' | 'DERIVED' | 'CONTEXT' | 'WHAT-IF'
export type DataStatus = 'placeholder' | 'beta' | 'provisional' | 'validated'
export type ViewMode = 'los' | 'fringes' | 'coherence' | 'hh' | 'hv'

/** What kind of event a story is about. Used for the story picker and for data-source hints. */
export type StoryType = 'earthquake' | 'volcano' | 'landslide' | 'subsidence'

/** One row of stories/index.json. */
export interface StoryIndexEntry {
  id: string
  title: string
  manifest: string
  /** Short name for the story picker. */
  label?: string
  type?: StoryType
}

/** What a layer means to the app. A story needs one 'displacement' and one 'coherence' layer. */
export type LayerRole = 'displacement' | 'coherence' | 'backscatterHH' | 'backscatterHV'

export interface LayerDef {
  id: string
  role: LayerRole
  name: string
  badge: Badge
  grid: string
  units: string
  displayUnits: string
  displayScale: number
  range: [number, number]
  appearsAfter?: 'secondary'
  synthetic: boolean
  provenance: Record<string, string>
  /** Optional wording overrides, so a layer that is not interferometric coherence can say what it is. */
  label?: string
  /** Changes smaller than this (in the layer's units) are drawn fully transparent, so noise does not compete with the real signal. */
  quietBelow?: number
  /** What positive and negative values mean physically (used in the inspector sentence). */
  positiveMeans?: string
  negativeMeans?: string
  titleStory?: string
  titleScientist?: string
  hintStory?: string
  hintScientist?: string
}

export interface Resource {
  group: 'learn' | 'data' | 'partner'
  audience: 'story' | 'scientist' | 'both'
  title: string
  url: string
  description: string
}

/** An eruption episode or similar event, drawn as a dot on the timeline. */
export interface EventMark {
  name: string
  shortLabel: string
  datetime: string
  /** How long it lasted, in hours. */
  hours?: number
  source: string
}

/** One measured 12-day period of a story (a pair of NISAR passes), with its own displacement grids. */
export interface Epoch {
  id: string
  /** Short label for the chart, for example "Aug 18 to Aug 30". */
  label: string
  pair: { reference: string; secondary: string }
  /** An eruption or other event inside the period, if any. */
  event?: { name: string; shortLabel: string; datetime: string; source: string }
  deformation: string
  coherence: string
}

export interface Story {
  id: string
  type?: StoryType
  title: string
  subtitle: string
  /** Name of the radar mission that measured it. Defaults to NISAR. */
  sensor?: string
  /** Label for the second timeline row (the event catalog). Defaults to "Earthquakes (USGS)". */
  eventsLabel?: string
  /** Footer line crediting data sources. */
  credits?: string
  /** Starting coherence threshold for fading unreliable cells. Defaults to 0.5. */
  defaultThreshold?: number
  /** Labels pinned on the map, for example the vent or the strongest motion. */
  annotations?: { lon: number; lat: number; label: string; kind?: 'vent' | 'note'; appears?: 'event' | 'change' }[]
  dataStatus: DataStatus
  dataStatusNote: string
  /** Short text next to the status pill, per mode. */
  statusDetail?: { story: string; scientist: string }
  storyText: string
  /** Optional text shown in Scientist mode instead of the plain-language story. */
  technical?: { title: string; subtitle?: string; summary: string; caveats?: string[] }
  aoi: { bbox: [number, number, number, number]; center: [number, number]; zoom: number; pitch: number; bearing: number }
  timeline: { start: string; end: string; initial: string }
  /** The moment the timeline marks. Leave out for slow processes with no single event. */
  event?: { name: string; shortLabel: string; datetime: string; source: string }
  resources?: Resource[]
  /** File with USGS context (mechanisms, PAGER, shaking, fault model). Optional. */
  context?: string
  /** Approximate satellite geometry, used to project the USGS model onto the line of sight. */
  geometry?: { incidenceDeg: number; lookAzimuthDeg: number; source?: string }
  why?: { title: string; body: string }[]
  tour?: TourStep[]
  flagshipPair: { track: number; orbitDirection: string; reference: string; secondary: string }
  acquisitions: string
  events: string
  layers: LayerDef[]
  /** Other measured periods the viewer can switch to. The top-level pair is the featured one. */
  epochs?: Epoch[]
  /** Every known event (for example all eruption episodes), shown as a row of dots on the timeline. */
  episodes?: EventMark[]
}

/** "aevion-grid-v1": see docs/data-contract.md */
export interface Grid {
  format: 'aevion-grid-v1'
  name: string
  units: string
  width: number
  height: number
  bbox: [number, number, number, number]
  rowOrder: 'north-up'
  nodata: number | null
  /** null (or the nodata value) marks cells with no valid measurement. */
  values: (number | null)[]
  /** If present, `values` are whole numbers in steps of this size (value = stored number times scale). Keeps files small. */
  scale?: number
}

export interface AcquisitionPair {
  track: number
  orbitDirection: string
  reference: string
  secondary: string
  granuleId: string
}

export interface QuakeCollection {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    id: string
    geometry: { type: 'Point'; coordinates: [number, number, number] }
    properties: { mag: number; time: number; place: string; url: string }
  }[]
}

export interface Camera {
  center: [number, number]
  zoom: number
  pitch: number
  bearing: number
}

/** A request to fly the camera. A new nonce triggers a new flight. */
export interface CameraReq {
  nonce: number
  camera: Camera
}

export interface Overlays {
  fault: boolean
  shaking: boolean
  cities: boolean
  mechanisms: boolean
}

export interface TourStep {
  title: string
  text: string
  camera?: Camera
  view?: ViewMode
  /** ISO date the timeline jumps to. */
  date?: string
  overlays?: Partial<Overlays>
}

export interface Mechanism {
  planes: { strike: number; dip: number; rake: number; kind: string }[]
  depthKm: number
}

export interface UsgsEvent {
  id: string
  mag: number
  title: string
  time: number
  lon: number
  lat: number
  url: string
  mechanism: Mechanism | null
}

export interface City {
  name: string
  lon: number
  lat: number
  pop: number
  mmi: number
}

export interface UsgsModel {
  lons: number[]
  lats: number[]
  ue: (number | null)[][]
  un: (number | null)[][]
  uz: (number | null)[][]
  note: string
}

export interface UsgsContext {
  mainEventId: string
  events: UsgsEvent[]
  pager: {
    fatalityLevel?: string
    economicLevel?: string
    exposureByMmi?: Record<string, number>
    exposedMmi7plus?: number
    felt?: number
  }
  cities: City[]
  shakingContours: GeoJSON.FeatureCollection | null
  fault: GeoJSON.FeatureCollection | null
  model: UsgsModel | null
}

export interface LoadedStory {
  story: Story
  grids: Record<string, Grid>
  pairs: AcquisitionPair[]
  flagship?: AcquisitionPair
  quakes: QuakeCollection
  context?: UsgsContext
  epochGrids?: Record<string, { deformation: Grid; coherence: Grid }>
}
