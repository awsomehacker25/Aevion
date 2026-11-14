import type { AcquisitionPair, Epoch, LayerDef, Story } from '../types'
import { ms } from './data'

const DAY = 86400000
const iso = (t: number) => new Date(t).toISOString().replace('.000', '')
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const longDate = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`

/** True when this period is the story's featured pair (which keeps the tour, radar views and annotations). */
export const isFeatured = (story: Story, e: Epoch) =>
  e.pair.reference === story.flagshipPair.reference && e.pair.secondary === story.flagshipPair.secondary

/**
 * The story as it should look while a different period is selected: that period's dates, its event, and a
 * timeline window around it. The tour and the radar brightness layers belong to the featured pair only.
 */
export function epochStory(story: Story, e: Epoch): Story {
  const ref = ms(`${e.pair.reference}T00:00:00Z`)
  const sec = ms(`${e.pair.secondary}T00:00:00Z`)
  const between = e.event ? `with ${e.event.name} in between` : 'with no eruption episode listed in between'
  const c = story.copy
  const fill = (s: string) => s.replace('{from}', longDate(e.pair.reference)).replace('{to}', longDate(e.pair.secondary)).replace('{between}', between)
  const t = story.technical
  const follow = !!c?.followTimeline
  return {
    ...story,
    subtitle: `${story.subtitle} · ${e.label}`,
    storyText: follow
      ? story.storyText // a story that follows the timeline keeps one text for every period, so nothing changes as the cursor passes a pass
      : c?.epochText
      ? fill(c.epochText)
      : `NISAR flew over on ${longDate(e.pair.reference)} and again on ${longDate(e.pair.secondary)}, ${between}. Comparing the two radar passes shows how the ground around the summit moved in that 12-day period.`,
    flagshipPair: { ...story.flagshipPair, reference: e.pair.reference, secondary: e.pair.secondary },
    event: e.event,
    timeline: follow ? story.timeline : { start: iso(ref - 8 * DAY), end: iso(sec + 14 * DAY), initial: iso(sec + 3 * DAY) },
    tour: follow ? story.tour : undefined,
    annotations: story.annotations
      ?.filter((a) => follow || a.appears !== 'change')
      .map((a) => (a.kind === 'vent' ? { ...a, label: `${c?.ventLabel ?? 'Halemaʻumaʻu vent'}${e.event ? ` (${e.event.shortLabel})` : ''}` } : a)),
    layers: story.layers.filter((l) => l.role === 'displacement' || l.role === 'coherence'),
    technical: t && {
      ...t,
      title: c?.epochTechTitle ? c.epochTechTitle.replace('{from}', e.pair.reference).replace('{to}', e.pair.secondary) : `LOS displacement at Kīlauea summit, NISAR pair ${e.pair.reference} to ${e.pair.secondary}`,
      summary: t.summary.replace('Episode 54 (USGS HVO)', `${e.event?.name ?? 'no listed eruption episode'} (USGS HVO)`),
      caveats: t.caveats?.filter((c) => !c.includes('Aug 18')),
    },
  }
}

/**
 * For a story that follows the timeline: the featured period shows the same text as the others, with only the period's
 * label added, so the panel does not change when the cursor reaches the featured pass.
 */
export function labelledStory(story: Story, e?: Epoch): Story {
  if (!story.copy?.followTimeline || !e) return story
  const t = story.technical
  const title = story.copy.epochTechTitle
  return {
    ...story,
    subtitle: `${story.subtitle} · ${e.label}`,
    technical: t && title ? { ...t, title: title.replace('{from}', e.pair.reference).replace('{to}', e.pair.secondary) } : t,
  }
}

/** The displacement layer's description with this period's dates and granule filled in. */
export function epochLayer(layer: LayerDef, e: Epoch, pair?: AcquisitionPair): LayerDef {
  return {
    ...layer,
    provenance: {
      ...layer.provenance,
      referenceDate: e.pair.reference,
      secondaryDate: e.pair.secondary,
      granuleId: pair?.granuleId ?? 'see the NASA CMR catalog',
    },
  }
}
