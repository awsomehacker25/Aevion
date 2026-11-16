import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BUILD_SECONDS, PLAY_SECONDS } from './config'
import { fmtDate, fmtTick, ms } from './lib/data'
import { playhead } from './lib/playhead'
import { epochFor, periodDates } from './lib/periods'
import { buildWindow, playClock } from './lib/progress'
import type { AcquisitionPair, EventMark, LoadedStory } from './types'
import { useI18n } from './i18n'
import { PauseIcon, PlayIcon } from './Icons'

interface Props {
  data: LoadedStory
  cursor: number
  setCursor: (t: number) => void
  /** Extra controls shown in the header, next to the play button (the period switcher). */
  headExtra?: ReactNode
  /** A row under the passes (the flood story's rain and new-water chart), on the same date axis. */
  extraRow?: ReactNode
  /** Called when an eruption dot is clicked, with the moment it refers to. */
  onEpisode?: (e: EventMark, t: number) => void
}

/** One satellite pass on the timeline. Memoised, so when the highlighted pass changes only the dots whose look changed are redrawn. */
const PassDot = memo(function PassDot({ t, left, flagship, title, label, onPick }: { t: number; left: string; flagship: boolean; title: string; label: string; onPick: (t: number) => void }) {
  return <button className={`pass ${flagship ? 'flag' : ''}`} style={{ left }} title={title} aria-label={label} onClick={() => onPick(t)} />
})

interface Pass { t: number; track: number; dir: string; flagship: boolean }

/** While playing, React state (date text, map filter) refreshes this often. The cursor line itself moves every frame. */
const COMMIT_MS = 120
const DAY_MS = 86400000
const HOUR_MS = 3600000
/** Candidate spacings for the axis labels, in days. The smallest one that keeps the axis readable is used. */
const TICK_STEPS_DAYS = [1, 2, 4, 7, 14]
const MAX_TICKS = 6

/** Quake marker diameter in px, scaled by magnitude. */
const quakeSize = (mag: number) => 4 + (mag - 3.5) * 2.6

export default function Timeline({ data, cursor, setCursor, headExtra, extraRow, onEpisode }: Props) {
  const { t: tr } = useI18n()
  const { story, pairs, quakes } = data
  const sensor = story.sensor ?? 'NISAR'
  const start = ms(story.timeline.start)
  const end = ms(story.timeline.end)
  const span = end - start
  const pctNum = (t: number) => ((t - start) / span) * 100
  const pct = (t: number) => `${pctNum(t)}%`
  const [playing, setPlaying] = useState(false)
  const cursorRef = useRef(cursor)
  const lineRef = useRef<HTMLDivElement>(null)
  const latestRef = useRef(cursor) // where the animation currently is
  const boxRef = useRef<HTMLDivElement>(null)

  // Tell the rest of the page how tall the timeline is, so the side panel and cards sit right above it.
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--tl-h', `${Math.round(el.getBoundingClientRect().height)}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A story that follows the timeline plays at one steady speed. (Its build-up window changes with every period, and a clock that
  // changed under the animation would restart it at each pass.)
  const follow = !!story.copy?.followTimeline
  const win = follow ? null : buildWindow(story, data.flagship?.secondary)
  const winFrom = win?.from
  const winTo = win?.to
  const clock = useMemo(
    () => playClock(start, end, span / PLAY_SECONDS, winFrom != null && winTo != null ? { from: winFrom, to: winTo } : null, BUILD_SECONDS),
    [start, end, span, winFrom, winTo],
  )

  useEffect(() => { cursorRef.current = cursor }, [cursor])

  // Playing owns the date. If something else moves it (a period picked from the menu, a pass or an eruption tapped), playback
  // stops there; otherwise the next tick would put the date straight back.
  // (Dates the player itself committed are remembered, because a slow render can show an older one after a newer one was sent.)
  const own = useRef(new Set<number>())
  const ownCommit = { set current(v: number) { own.current.add(v); if (own.current.size > 60) own.current.delete(own.current.values().next().value as number) } }
  useEffect(() => { if (playing && !own.current.has(cursor)) setPlaying(false) }, [cursor, playing])


  // The cursor line sits in a lane as wide as the track and is moved with a transform (a percentage of the lane).
  // When not playing it follows React state; while playing a compositor animation owns it (see below), so neither
  // React commits nor a busy main thread (a new pass being drawn) can make it hitch or snap back.
  useLayoutEffect(() => {
    if (!playing && lineRef.current) lineRef.current.style.transform = `translateX(${pctNum(cursor)}%)`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, playing, start, span])

  // Time comes from the clock (start value + elapsed), never from accumulated React state,
  // so slow frames cannot stall or reverse the cursor.
  useEffect(() => {
    if (!playing) return
    const from = cursorRef.current
    const s0 = clock.toPlay(from) // seconds of playback at the starting position
    latestRef.current = from
    playhead.active = true
    // The line itself is animated by the browser's compositor, from here to the end, sampled from the same clock.
    // It keeps gliding at an even pace even while the page is busy, and its own clock is what the loop below reads.
    const sEnd = clock.toPlay(end)
    const N = 240
    const frames = Array.from({ length: N + 1 }, (_, i) => ({ transform: `translateX(${((clock.toTime(s0 + ((sEnd - s0) * i) / N) - start) / span) * 100}%)` }))
    const anim = lineRef.current && sEnd > s0 ? lineRef.current.animate(frames, { duration: (sEnd - s0) * 1000, easing: 'linear', fill: 'forwards' }) : null
    const t0 = performance.now()
    let id = 0
    let lastCommit = t0
    const step = (now: number) => {
      const el = anim?.currentTime != null ? Number(anim.currentTime) / 1000 : (now - t0) / 1000
      const t = Math.min(end, clock.toTime(s0 + el))
      latestRef.current = t
      playhead.emit(t) // smooth visuals on the map follow this every frame
      if (t >= end) { ownCommit.current = end; setCursor(end); setPlaying(false); return }
      if (now - lastCommit >= COMMIT_MS) { lastCommit = now; ownCommit.current = t; startTransition(() => setCursor(t)) } // a transition: a heavy redraw (a new pass) never holds up the animation
      id = requestAnimationFrame(step)
    }
    id = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(id)
      playhead.active = false
      // hand the line back to React at exactly where the animation had got to
      if (anim && lineRef.current) { lineRef.current.style.transform = `translateX(${((latestRef.current - start) / span) * 100}%)`; anim.cancel() }
    }
  }, [playing, span, start, end, setCursor, clock])

  // Real NISAR acquisition times from the catalog: every pair contributes its two passes.
  const passes = useMemo<Pass[]>(() => {
    const f = story.flagshipPair
    const isFlag = (p: AcquisitionPair, iso: string) =>
      p.track === f.track && p.orbitDirection === f.orbitDirection &&
      (iso.startsWith(f.reference) || iso.startsWith(f.secondary))
    const seen = new Set<string>()
    const out: Pass[] = []
    for (const p of pairs) {
      for (const iso of [p.reference, p.secondary]) {
        const t = ms(iso)
        const key = `${p.track}-${p.orbitDirection}-${iso.slice(0, 10)}`
        if (t < start || t > end || seen.has(key)) continue
        seen.add(key)
        out.push({ t, track: p.track, dir: p.orbitDirection, flagship: isFlag(p, iso) })
      }
    }
    return out.sort((a, b) => a.t - b.t)
  }, [pairs, story.flagshipPair, start, end])

  // Ticks: every few days for short windows, month starts for long ones (so labels never overlap).
  const ticks = useMemo(() => {
    const out: number[] = []
    const days = (end - start) / DAY_MS
    const step = TICK_STEPS_DAYS.find((s) => days / s <= MAX_TICKS)
    if (step) {
      for (let t = Math.ceil(start / DAY_MS) * DAY_MS; t <= end; t += step * DAY_MS) out.push(t)
      return { times: out, monthly: false }
    }
    const everyMonths = Math.ceil(days / 30 / MAX_TICKS)
    const s = new Date(start)
    for (let m = 0; ; m += everyMonths) {
      const t = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + m + (s.getUTCDate() > 1 ? 1 : 0), 1)
      if (t > end) break
      out.push(t)
    }
    return { times: out, monthly: true }
  }, [start, end])

  // Static marks are built once, so the frequent re-renders while playing stay cheap.
  // Eruption episodes (or similar events) that fall inside the visible window.
  const episodes = useMemo(
    () => (story.episodes ?? []).map((e) => ({ e, t: ms(e.datetime) })).filter((x) => x.t >= start && x.t <= end),
    [story.episodes, start, end],
  )
  const hasEpisodes = (story.episodes?.length ?? 0) > 0
  const extraRows = (quakes.features.length > 0 ? 1 : 0) + (hasEpisodes ? 1 : 0)

  const pickPass = useCallback((t: number) => { setPlaying(false); setCursor(t) }, [setCursor])
  const marks = useMemo(() => (
    <>
      {passes.length > 0 && <div className="tl-row tl-passes">
        <span className="tl-label">{tr('s.tl.passes')}</span>
        {passes.map((p, i) => (
          <PassDot key={i} t={p.t} left={pct(p.t)} flagship={p.flagship}
            title={`${fmtDate(p.t, true)} · track ${p.track} ${p.dir === 'A' ? 'ascending' : 'descending'}${p.flagship ? ' · used in this story' : ''}`}
            label={`${sensor} pass ${fmtDate(p.t)}`} onPick={pickPass} />
        ))}
      </div>}
      {quakes.features.length > 0 && <div className="tl-row tl-quakes">
        <span className="tl-label">{story.eventsLabel ?? tr('s.tl.quakes')}</span>
        {quakes.features.filter((q) => q.properties.time >= start && q.properties.time <= end).map((q) => (
          <i key={q.id} className="qdot" style={{ left: pct(q.properties.time), width: quakeSize(q.properties.mag), height: quakeSize(q.properties.mag) }}
            title={`M${q.properties.mag} · ${q.properties.place}`} />
        ))}
      </div>}
      {hasEpisodes && <div className="tl-row tl-eps">
        <span className="tl-label">{tr('s.tl.eruptions')}</span>
        {episodes.map(({ e, t }) => {
          const ep = epochFor(story, t) // the processed NISAR period this event falls in, if any
          return (
            <button key={e.datetime} className={`edot ${e.name.startsWith('Episode') ? '' : 'alt'} ${ep ? '' : 'none'}`} style={{ left: pct(t) }}
              title={`${e.name} · ${new Date(t).toLocaleString('en-US', { timeZone: 'Pacific/Honolulu', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} HST${e.hours ? ` · about ${e.hours} hours` : ''} · ${e.source}${ep ? ` · NISAR period ${periodDates(ep)} (click to view)` : ' · no NISAR period processed for this one'}`}
              onClick={() => { setPlaying(false); if (onEpisode) onEpisode(e, t); else setCursor(t) }}
              aria-label={`${e.name}, ${fmtDate(t)}${ep ? '' : ', no NISAR period processed'}`} />
          )
        })}
      </div>}
      <div className="tl-axis">
        {ticks.times.map((t) => (
          <span key={t} style={{ left: pct(t), ...(pctNum(t) > 94 ? { transform: 'translateX(-100%)' } : pctNum(t) < 3 ? { transform: 'none' } : null) }}>{fmtTick(t, ticks.monthly)}</span>
        ))}
      </div>
      {story.event && <div className="tl-event" style={{ left: pct(ms(story.event.datetime)) }}><span>{story.event.shortLabel}</span></div>}
    </>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [passes, quakes, episodes, hasEpisodes, story, ticks, start, span, setCursor, onEpisode, pickPass])

  const sec = ms(story.flagshipPair.secondary + 'T00:00:00Z')
  const ref = ms(story.flagshipPair.reference + 'T00:00:00Z')
  const status =
    story.kind === 'backscatter'
      ? (cursor < sec ? tr('s.tl.noPicture') : tr('s.tl.pictureFrom', { d: fmtDate(sec) }))
    : cursor < ref ? tr('s.tl.forward')
    : cursor < sec ? tr('s.tl.waiting')
    : tr('s.tl.shows', { a: fmtDate(ref), b: fmtDate(sec) })

  return (
    <div className="timeline" role="group" aria-label={tr('s.tl.aria')} ref={boxRef}>
      <div className="tl-head">
        <button className="btn" onClick={() => {
          if (playing) { setCursor(latestRef.current); setPlaying(false); return } // keep the exact paused time
          if (cursorRef.current >= end) { ownCommit.current = start; setCursor(start) } else ownCommit.current = cursorRef.current
          setPlaying(true)
        }} aria-label={playing ? tr('controls.pause') : tr('s.tl.play')}>
          {playing ? <><PauseIcon /> {tr('controls.pause')}</> : <><PlayIcon /> {tr('s.tl.play')}</>}
        </button>
        {headExtra}
        <div className="tl-date" title={tr('s.tl.now')}>{fmtDate(cursor, true)}</div>
        <div className="tl-status">{status}</div>
      </div>

      <div className={`tl-track rows-${extraRows}`}>
        {marks}
        <div className="tl-cursor-lane" ref={lineRef}><div className="tl-cursor" /></div>
        <input className="tl-range" type="range" min={start} max={end} step={HOUR_MS} value={cursor}
          onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)) }} aria-label={tr('s.tl.date')} />
      </div>
      {extraRow && <div className="tl-extra">{extraRow}</div>}
    </div>
  )
}
