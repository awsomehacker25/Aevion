import type { Epoch, Grid, Story } from '../types'
import { areaMean } from './analysis'

/** Mean motion near the vent per period, in mm (null where there is no data). */
export type VentMotion = Record<string, number | null>

const RADIUS_CELLS = 15 // about 2 km

export const sortEpochs = (epochs: Epoch[]) => [...epochs].sort((a, b) => a.pair.reference.localeCompare(b.pair.reference))

/** Looks up the vent on the story and averages each period's grid around it. */
export function computeVentMotion(story: Story, grids?: Record<string, { deformation: Grid }>): VentMotion | null {
  const vent = story.annotations?.find((a) => a.kind === 'vent')
  if (!vent || !story.epochs || !grids) return null
  const out: VentMotion = {}
  for (const e of story.epochs) {
    const g = grids[e.id]?.deformation
    const v = g ? areaMean(g, vent.lon, vent.lat, RADIUS_CELLS) : null
    out[e.id] = v == null ? null : v * 1000
  }
  return out
}

/** "Episode 54", "New vents", or "Quiet" (no eruption episode in that period). */
export const periodTitle = (e: Epoch) =>
  e.event ? (e.event.name.startsWith('Episode') ? e.event.name : e.event.shortLabel) : 'Quiet'

/** The processed period whose two NISAR passes surround a moment, if there is one. */
export function epochFor(story: Story, t: number): Epoch | undefined {
  return story.epochs?.find((e) => t >= Date.parse(`${e.pair.reference}T00:00:00Z`) && t <= Date.parse(`${e.pair.secondary}T00:00:00Z`))
}

/** "Aug 18 – Aug 30" */
export const periodDates = (e: Epoch) => e.label.replace(' to ', ' \u2013 ')

/** When the event happened, in Hawaii time (the time zone of the HVO timeline). */
export function eventTime(e: Epoch) {
  if (!e.event) return null
  const s = new Date(e.event.datetime).toLocaleString('en-US', {
    timeZone: 'Pacific/Honolulu', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  return `${s} HST`
}
