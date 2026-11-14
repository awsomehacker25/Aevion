export type Badge = 'OBSERVED' | 'DERIVED' | 'CONTEXT' | 'WHAT-IF'
export type DataStatus = 'placeholder' | 'beta' | 'provisional' | 'validated'
export type ViewMode = 'los' | 'fringes' | 'coherence'

/** What a layer means to the app. A story needs one 'displacement' and one 'coherence' layer. */
export type LayerRole = 'displacement' | 'coherence'

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
}

export interface Story {
  id: string
  title: string
  subtitle: string
  dataStatus: DataStatus
  dataStatusNote: string
  storyText: string
  /** Optional text shown in Scientist mode instead of the plain-language story. */
  technical?: { title: string; subtitle?: string; summary: string; caveats?: string[] }
  aoi: { bbox: [number, number, number, number]; center: [number, number]; zoom: number; pitch: number; bearing: number }
  timeline: { start: string; end: string; initial: string }
  event: { name: string; shortLabel: string; datetime: string; source: string }
  flagshipPair: { track: number; orbitDirection: string; reference: string; secondary: string }
  acquisitions: string
  events: string
  layers: LayerDef[]
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
  values: number[]
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

export interface LoadedStory {
  story: Story
  grids: Record<string, Grid>
  pairs: AcquisitionPair[]
  flagship?: AcquisitionPair
  quakes: QuakeCollection
}
