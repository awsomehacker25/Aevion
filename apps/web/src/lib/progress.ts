import type { Story } from '../types'
import { ms } from './data'

/**
 * How far the measured change has built up at a timeline position, from 0 to 1.
 *
 * The satellite only measured the start (reference pass) and the end (second pass), so the change in
 * between is an illustration. For a story with an event it builds from the event to the second pass;
 * for a slow process it builds from the reference pass to the second pass. It is always a pure function of
 * the cursor, so scrubbing backward takes it away again.
 */
export function changeProgress(story: Story, cursor: number, secondaryIso?: string): number {
  const sec = ms(secondaryIso ?? `${story.flagshipPair.secondary}T00:00:00Z`)
  const ref = ms(`${story.flagshipPair.reference}T00:00:00Z`)
  const start = story.event ? Math.min(Math.max(ms(story.event.datetime), ref), sec) : ref
  if (cursor >= sec) return 1
  if (cursor <= start || sec <= start) return 0
  const t = (cursor - start) / (sec - start)
  return t * t * (3 - 2 * t) // ease in and out
}

/** Things that belong to the event (fault model, shaking, cities, mechanisms) exist only once it has happened. */
export const eventReached = (story: Story, cursor: number) => !story.event || cursor >= ms(story.event.datetime)
