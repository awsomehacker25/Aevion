/**
 * The timeline position while it is playing, published every animation frame.
 *
 * React state only updates a few times a second while playing (so the page stays light), which is too coarse for
 * smooth fades on the map. Anything that must move smoothly subscribes here and updates itself directly each frame.
 * While `active` is true the frame subscribers own those visuals, and ordinary React-driven updates skip them.
 */
type Listener = (t: number) => void

const listeners = new Set<Listener>()

export const playhead = {
  active: false,
  subscribe(fn: Listener) {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  },
  emit(t: number) {
    listeners.forEach((fn) => fn(t))
  },
}
