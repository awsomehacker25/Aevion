import type { AcquisitionPair, FloodManifest, FloodRain, FloodSeries, FloodStory, Grid, LoadedFlood, LoadedStory, QuakeCollection, Story, StoryIndexEntry, UsgsContext } from '../types'

const BASE = `${import.meta.env.BASE_URL}stories/`

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return r.json() as Promise<T>
}

/** Loads a grid file. Grids stored as scaled whole numbers are turned back into real values. */
async function getGrid(url: string): Promise<Grid> {
  const g = await getJson<Grid>(url)
  const k = g.scale
  if (k) {
    g.values = g.values.map((v) => (v == null ? null : Math.round(v * 1e6 * k) / 1e6))
    delete g.scale
  }
  return g
}

/** The list of available stories, for the story picker. */
export async function loadIndex(): Promise<StoryIndexEntry[]> {
  return (await getJson<{ stories: StoryIndexEntry[] }>(`${BASE}index.json`)).stories
}

/**
 * Loads a story by id. Everything the app shows comes from files under
 * public/stories/<id>/. To use real data, replace the grid files and edit story.json.
 */
export async function loadStory(id?: string): Promise<LoadedStory> {
  const stories = await loadIndex()
  const entry = stories.find((s) => s.id === id) ?? stories[0]
  const dir = `${BASE}${entry.manifest.split('/')[0]}/`
  const story = await getJson<Story>(`${BASE}${entry.manifest}`)

  // Everything below is independent, so fetch it all at once. The context file is optional.
  const grids: Record<string, Grid> = {}
  const epochGrids: Record<string, { deformation: Grid; coherence: Grid; hv?: Grid; hh?: Grid }> = {}
  const [acq, quakes, context] = await Promise.all([
    getJson<{ pairs: AcquisitionPair[] }>(dir + story.acquisitions),
    getJson<QuakeCollection>(dir + story.events),
    story.context ? getJson<UsgsContext>(dir + story.context).catch(() => undefined) : undefined,
    ...story.layers.map(async (l) => { grids[l.id] = await getGrid(dir + l.grid) }),
    ...(story.epochs ?? []).map(async (e) => {
      const [deformation, coherence, hv, hh] = await Promise.all([
        getGrid(dir + e.deformation), e.coherence ? getGrid(dir + e.coherence) : undefined,
        e.hv ? getGrid(dir + e.hv) : undefined, e.hh ? getGrid(dir + e.hh) : undefined,
      ])
      epochGrids[e.id] = { deformation, coherence: coherence as Grid, hv, hh }
    }),
  ])
  // A period without its own coherence file uses the story's coherence layer.
  const mainCoherence = story.layers.find((l) => l.role === 'coherence')
  for (const e of story.epochs ?? []) {
    const g = epochGrids[e.id]
    if (g && !g.coherence && mainCoherence) g.coherence = grids[mainCoherence.id]
  }

  const f = story.flagshipPair
  const flagship = acq.pairs.find(
    (p) => p.track === f.track && p.orbitDirection === f.orbitDirection &&
      p.reference.startsWith(f.reference) && p.secondary.startsWith(f.secondary),
  )
  return { story, grids, pairs: acq.pairs, flagship, quakes, context, epochGrids }
}

/** Loads a flood story: its manifest, time series, rainfall, damage pins and outlines, all in parallel. */
export async function loadFlood(id: string): Promise<LoadedFlood> {
  const stories = await loadIndex()
  const entry = stories.find((s) => s.id === id)
  if (!entry) throw new Error(`Unknown story "${id}"`)
  const dir = `${BASE}${entry.manifest.split('/')[0]}/`
  const story = await getJson<FloodStory>(`${BASE}${entry.manifest}`)
  const opt = <T,>(p: string | undefined) => (p ? getJson<T>(dir + p).catch(() => null) : Promise.resolve(null))
  const [flood, series] = await Promise.all([getJson<FloodManifest>(dir + story.flood), getJson<FloodSeries>(dir + story.series)])
  const [rain, pins, districts, validation] = await Promise.all([
    opt<FloodRain>(flood.rainfall), opt<GeoJSON.FeatureCollection>(flood.pins), opt<GeoJSON.FeatureCollection>(flood.districts), opt<Record<string, unknown>>(story.validation),
  ])
  // image paths in the manifest are relative to the story folder
  const abs = (p: string) => (p.startsWith('http') ? p : dir + p)
  for (const d of flood.dates) {
    d.layers.HH = abs(d.layers.HH); d.layers.HV = abs(d.layers.HV); d.layers.water = abs(d.layers.water)
    if (d.layers.RGB) d.layers.RGB = abs(d.layers.RGB)
  }
  const c = flood.context
  if (c.permanent_water) c.permanent_water.url = abs(c.permanent_water.url)
  if (c.aftermath) c.aftermath.url = abs(c.aftermath.url)
  if (c.sentinel1) c.sentinel1.url = abs(c.sentinel1.url)
  if (c.sentinel2) c.sentinel2.url = abs(c.sentinel2.url)
  if (c.population) {
    c.population.url = abs(c.population.url)
    for (const k of Object.keys(c.population.by_date)) c.population.by_date[k].url = abs(c.population.by_date[k].url)
  }
  return { story, flood, series, rain, pins, districts, validation }
}

/** Text overrides for one language of a story (stories/<id>/i18n/<lang>.json), or null when there are none. */
export async function loadStoryText<T>(id: string, lang: string): Promise<T | null> {
  if (lang === 'en') return null
  try {
    const r = await fetch(`${BASE}${id}/i18n/${lang}.json`)
    return r.ok ? ((await r.json()) as T) : null
  } catch { return null }
}

/** Nearest-cell lookup. Returns null outside the grid or on nodata. */
export function sampleGrid(g: Grid, lon: number, lat: number): number | null {
  const [w, s, e, n] = g.bbox
  if (lon < w || lon > e || lat < s || lat > n) return null
  const x = Math.min(g.width - 1, Math.floor(((lon - w) / (e - w)) * g.width))
  const y = Math.min(g.height - 1, Math.floor(((n - lat) / (n - s)) * g.height))
  const v = g.values[y * g.width + x]
  return v == null || v === g.nodata || Number.isNaN(v) ? null : v
}

export const ms = (iso: string) => Date.parse(iso)

import { formatCustomDate } from './months'

let dateLocale = 'en-US'
let dateLang = 'en'
/** Called by the language provider so dates everywhere follow the chosen language. */
export function setDateLocale(l: string, lang = 'en') { dateLocale = l; dateLang = lang }
export const getDateLocale = () => dateLocale

/** A timeline axis label: "Jul 22" (or month and two-digit year on long axes), in the current language's month names. */
export function fmtTick(t: number, monthly: boolean): string {
  return formatCustomDate(t, dateLang, monthly ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' })
    ?? new Date(t).toLocaleDateString(dateLocale, monthly ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function fmtDate(t: number, withTime = false): string {
  const d = new Date(t)
  const date = formatCustomDate(t, dateLang) ?? d.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  if (!withTime) return date
  return `${date}, ${d.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC`
}
