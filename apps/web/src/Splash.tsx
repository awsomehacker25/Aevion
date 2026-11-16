import { useEffect, useState } from 'react'
import { EVENT, TEAM } from './config'
import en from './i18n/en'
import { Logo } from './Logo'

/** The brand moment is held at least this long so the pixel half can finish filling in, then fades. */
const HOLD_MS = 1000
const FADE_MS = 350
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * The opening splash: the stacked logo with its pixel half filling in column by column from the split outward, then a
 * cross-fade into the app. It mounts once with the app and goes away for good once the first story is ready, so it never
 * replays when the person switches stories. Reduced motion shows the finished logo with no build and no fade.
 */
export function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setHeld(true), reduced() ? 300 : HOLD_MS)
    return () => window.clearTimeout(id)
  }, [])

  const go = ready && held
  useEffect(() => {
    if (!go) return
    const id = window.setTimeout(onDone, reduced() ? 0 : FADE_MS)
    return () => window.clearTimeout(id)
  }, [go, onDone])
  const leaving = go && !reduced()

  const names = en['s.team'].replace('{names}', TEAM.slice(0, -1).join(', ')).replace('{last}', TEAM[TEAM.length - 1])
  return (
    <div className={`boot ${leaving ? 'leaving' : ''}`} role="status" aria-label={en.loading}>
      <div className="boot-logo">
        <Logo variant="stacked" height={150} className="boot-solid" />
        <Logo variant="stacked" height={150} className="boot-pixels" />
      </div>
      <small className="boot-team">{EVENT}</small>
      <small className="boot-names">{en['s.builtBy']} {names}</small>
    </div>
  )
}
