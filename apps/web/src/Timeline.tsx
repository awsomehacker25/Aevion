import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PLAY_SECONDS } from './config'
import { fmtDate, ms } from './lib/data'
import type { AcquisitionPair, LoadedStory } from './types'

interface Props {
  data: LoadedStory
  cursor: number
  setCursor: (t: number) => void
}

interface Pass { t: number; track: number; dir: string; flagship: boolean }

/** While playing, React state (date text, map filter) refreshes this often. The cursor line itself moves every frame. */
const COMMIT_MS = 120
const DAY_MS = 86400000
const HOUR_MS = 3600000
/** Candidate spacings for the axis labels, in days. The smallest one that keeps the axis readable is used. */
const TICK_STEPS_DAYS = [1, 2, 4, 7, 14]
const MAX_TICKS = 12

/** Quake marker diameter in px, scaled by magnitude. */
const quakeSize = (mag: number) => 4 + (mag - 3.5) * 2.6

export default function Timeline({ data, cursor, setCursor }: Props) {
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

  useEffect(() => { cursorRef.current = cursor }, [cursor])

  // The cursor line is positioned imperatively. When not playing it follows React state;
  // while playing the animation loop owns it, so React commits can never make it snap back.
  useLayoutEffect(() => {
    if (!playing && lineRef.current) lineRef.current.style.left = pct(cursor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, playing, start, span])

  // Time comes from the clock (start value + elapsed), never from accumulated React state,
  // so slow frames cannot stall or reverse the cursor.
  useEffect(() => {
    if (!playing) return
    const from = cursorRef.current
    latestRef.current = from
    const t0 = performance.now()
    let id = 0
    let lastCommit = t0
    const step = (now: number) => {
      const t = Math.min(end, from + ((now - t0) / 1000) * (span / PLAY_SECONDS))
      latestRef.current = t
      if (lineRef.current) lineRef.current.style.left = `${((t - start) / span) * 100}%`
      if (t >= end) { setCursor(end); setPlaying(false); return }
      if (now - lastCommit >= COMMIT_MS) { lastCommit = now; setCursor(t) }
      id = requestAnimationFrame(step)
    }
    id = requestAnimationFrame(step)
    return () => cancelAnimationFrame(id)
  }, [playing, span, start, end, setCursor])

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
  const marks = useMemo(() => (
    <>
      {passes.length > 0 && <div className="tl-row tl-passes">
        <span className="tl-label">{sensor} passes</span>
        {passes.map((p, i) => (
          <button key={i} className={`pass ${p.flagship ? 'flag' : ''}`} style={{ left: pct(p.t) }}
            title={`${fmtDate(p.t, true)} · track ${p.track} ${p.dir === 'A' ? 'ascending' : 'descending'}${p.flagship ? ' · used in this story' : ''}`}
            onClick={() => { setPlaying(false); setCursor(p.t) }} aria-label={`${sensor} pass ${fmtDate(p.t)}`} />
        ))}
      </div>}
      {quakes.features.length > 0 && <div className="tl-row tl-quakes">
        <span className="tl-label">{story.eventsLabel ?? 'Earthquakes (USGS)'}</span>
        {quakes.features.map((q) => (
          <i key={q.id} className="qdot" style={{ left: pct(q.properties.time), width: quakeSize(q.properties.mag), height: quakeSize(q.properties.mag) }}
            title={`M${q.properties.mag} · ${q.properties.place}`} />
        ))}
      </div>}
      <div className="tl-axis">
        {ticks.times.map((t) => (
          <span key={t} style={{ left: pct(t) }}>{new Date(t).toLocaleDateString('en-US', ticks.monthly ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
        ))}
      </div>
      {story.event && <div className="tl-event" style={{ left: pct(ms(story.event.datetime)) }}><span>{story.event.shortLabel}</span></div>}
    </>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [passes, quakes, ticks, story.event, start, span, setCursor])

  const sec = ms(story.flagshipPair.secondary + 'T00:00:00Z')
  const ref = ms(story.flagshipPair.reference + 'T00:00:00Z')
  const status =
    cursor < ref ? `Before the first ${sensor} pass of the pair. Nothing to compare yet.`
    : cursor < sec ? 'Reference pass collected. Waiting for the second pass.'
    : `Showing ${sensor} change between ${fmtDate(ref)} and ${fmtDate(sec)}.`

  return (
    <div className="timeline" role="group" aria-label="Timeline">
      <div className="tl-head">
        <button className="btn" onClick={() => {
          if (playing) { setCursor(latestRef.current); setPlaying(false); return } // keep the exact paused time
          if (cursorRef.current >= end) setCursor(start)
          setPlaying(true)
        }} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <div className="tl-date">{fmtDate(cursor, true)}</div>
        <div className="tl-status">{status}</div>
      </div>

      <div className="tl-track">
        {marks}
        <div className="tl-cursor" ref={lineRef} />
        <input className="tl-range" type="range" min={start} max={end} step={HOUR_MS} value={cursor}
          onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)) }} aria-label="Date" />
      </div>
    </div>
  )
}
