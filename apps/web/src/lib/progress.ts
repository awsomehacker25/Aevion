import type { Story } from '../types'
import { ms } from './data'

/**
 * The stretch of time over which the measured change builds up: from the event (or, with no event, the
 * reference pass) to the second pass. The satellite only measured the two ends, so the build-up in between
 * is an illustration.
 */
export function buildWindow(story: Story, secondaryIso?: string): { from: number; to: number } {
  const to = ms(secondaryIso ?? `${story.flagshipPair.secondary}T00:00:00Z`)
  const ref = ms(`${story.flagshipPair.reference}T00:00:00Z`)
  const from = story.event ? Math.min(Math.max(ms(story.event.datetime), ref), to) : ref
  return { from, to }
}

/**
 * How far the change has built up at a timeline position, from 0 to 1. Always a pure function of the
 * cursor, so scrubbing backward takes it away again.
 */
export function changeProgress(story: Story, cursor: number, secondaryIso?: string): number {
  const { from, to } = buildWindow(story, secondaryIso)
  if (cursor >= to) return 1
  if (cursor <= from || to <= from) return 0
  const t = (cursor - from) / (to - from)
  return t * t * (3 - 2 * t) // ease in and out
}

/** Opacity of the map overlay for a build-up progress. The overlay is drawn once at full strength and only faded. */
export const overlayOpacity = (progress: number, mode: 'los' | 'fringes' | 'coherence') =>
  progress <= 0 ? 0 : mode === 'coherence' ? 0.95 * Math.min(1, progress * 1.5) : 0.95 * Math.min(1, progress)

/** Things that belong to the event (fault model, shaking, cities, mechanisms) exist only once it has happened. */
export const eventReached = (story: Story, cursor: number) => !story.event || cursor >= ms(story.event.datetime)

/**
 * Playback clock. Plain playback moves through the timeline at a constant rate, which can make a short
 * build-up (a quake to the next satellite pass, a few hours) flash by. This slows playback inside the build-up
 * window so that it lasts `buildSeconds`.
 *
 * To avoid a sudden jolt, the speed eases down over the last `brakeSeconds` of playback before the window (a short
 * brake that finishes exactly when the build-up starts, so playback is at full speed until just before it), holds the
 * slow speed through the build-up, and eases back up to the normal rate over `releaseSeconds` after it ends.
 * `toPlay` maps a timeline position to seconds of playback, `toTime` maps back.
 */
export function playClock(
  start: number, end: number, rate: number, win: { from: number; to: number } | null, buildSeconds: number,
  brakeSeconds = 0.5, releaseSeconds = 0.9,
) {
  const linear = { toPlay: (t: number) => (t - start) / rate, toTime: (s: number) => Math.min(end, start + s * rate) }
  if (!win) return linear
  const a = Math.min(Math.max(win.from, start), end)
  const b = Math.min(Math.max(win.to, a), end)
  const L = b - a
  if (L <= 0 || L / rate >= buildSeconds) return linear // already slow enough

  const vSlow = L / buildSeconds // timeline ms per second of playback during the build-up
  const ease = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c) }
  const DT = 0.01 // seconds of playback per table step
  const brakeSteps = Math.round(brakeSeconds / DT)
  const speedAt = (u: number) => rate - (rate - vSlow) * ease(u) // u: 0 = normal speed, 1 = slow
  let brakeDistance = 0
  for (let i = 0; i < brakeSteps; i++) brakeDistance += speedAt((i + 0.5) / brakeSteps) * DT
  const brakeFrom = Math.max(start, a - brakeDistance) // where the brake begins

  // Table of timeline position against playback time, marched forward in small steps.
  const pos: number[] = [start]
  let x = start
  let phase = 0 // 0 normal, 1 braking, 2 building up, 3 releasing
  let into = 0
  for (let k = 0; x < end && k < 20000; k++) {
    let v = rate
    if (phase === 0 && x >= brakeFrom) { phase = 1; into = 0 }
    if (phase === 1) {
      v = speedAt((into + DT / 2) / brakeSeconds)
      if (into + DT >= brakeSeconds) { phase = 2; into = -DT }
    } else if (phase === 2) {
      v = vSlow
      if (x + v * DT >= b) { phase = 3; into = -DT }
    } else if (phase === 3) {
      v = vSlow + (rate - vSlow) * ease((into + DT / 2) / releaseSeconds)
    }
    x = Math.min(end, x + v * DT)
    into += DT
    pos.push(x)
  }

  const last = pos.length - 1
  return {
    toPlay: (t: number) => {
      if (t <= start) return 0
      if (t >= pos[last]) return last * DT
      let lo = 0
      let hi = last
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pos[mid] <= t) lo = mid; else hi = mid }
      return (lo + (t - pos[lo]) / (pos[hi] - pos[lo])) * DT
    },
    toTime: (s: number) => {
      const i = s / DT
      if (i >= last) return end
      const lo = Math.max(0, Math.floor(i))
      return pos[lo] + (pos[lo + 1] - pos[lo]) * (i - lo)
    },
  }
}
