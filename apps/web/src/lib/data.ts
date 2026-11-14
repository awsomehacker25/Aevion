import type { AcquisitionPair, Grid, LoadedStory, QuakeCollection, Story, StoryIndexEntry, UsgsContext } from '../types'

const BASE = `${import.meta.env.BASE_URL}stories/`

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return r.json() as Promise<T>
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
  const [acq, quakes, context] = await Promise.all([
    getJson<{ pairs: AcquisitionPair[] }>(dir + story.acquisitions),
    getJson<QuakeCollection>(dir + story.events),
    story.context ? getJson<UsgsContext>(dir + story.context).catch(() => undefined) : undefined,
    ...story.layers.map(async (l) => { grids[l.id] = await getJson<Grid>(dir + l.grid) }),
  ])

  const f = story.flagshipPair
  const flagship = acq.pairs.find(
    (p) => p.track === f.track && p.orbitDirection === f.orbitDirection &&
      p.reference.startsWith(f.reference) && p.secondary.startsWith(f.secondary),
  )
  return { story, grids, pairs: acq.pairs, flagship, quakes, context }
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

export function fmtDate(t: number, withTime = false): string {
  const d = new Date(t)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  if (!withTime) return date
  return `${date}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC`
}
