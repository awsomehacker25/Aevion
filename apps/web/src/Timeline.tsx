import { useEffect, useMemo, useRef, useState } from 'react'
import { PLAY_SECONDS } from './config'
import { fmtDate, ms } from './lib/data'
import type { AcquisitionPair, LoadedStory } from './types'

interface Props {
  data: LoadedStory
  cursor: number
  setCursor: (t: number) => void
}

interface Pass { t: number; track: number; dir: string; flagship: boolean }

export default function Timeline({ data, cursor, setCursor }: Props) {
  const { story, pairs, quakes } = data
  const start = ms(story.timeline.start)
  const end = ms(story.timeline.end)
  const span = end - start
  const pct = (t: number) => `${((t - start) / span) * 100}%`
  const [playing, setPlaying] = useState(false)
  const raf = useRef(0)
  const cursorRef = useRef(cursor)
  useEffect(() => { cursorRef.current = cursor }, [cursor])

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

  const ticks = useMemo(() => {
    const out: number[] = []
    const day = 86400000
    for (let t = Math.ceil(start / day) * day; t <= end; t += 4 * day) out.push(t)
    return out
  }, [start, end])

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const step = (now: number) => {
      const dt = now - last
      last = now
      const next = cursorRef.current + (dt / 1000) * (span / PLAY_SECONDS)
      if (next >= end) { setCursor(end); setPlaying(false); return }
      setCursor(next)
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, span, end, setCursor])

  const sec = ms(story.flagshipPair.secondary + 'T00:00:00Z')
  const ref = ms(story.flagshipPair.reference + 'T00:00:00Z')
  const quakeT = ms(story.event.datetime)
  const status =
    cursor < ref ? 'Before the first NISAR pass of the pair. Nothing to compare yet.'
    : cursor < sec ? 'Reference pass collected. Waiting for the post-event pass.'
    : `Showing NISAR change between ${fmtDate(ref)} and ${fmtDate(sec)}.`

  return (
    <div className="timeline" role="group" aria-label="Timeline">
      <div className="tl-head">
        <button className="btn" onClick={() => { if (cursor >= end) setCursor(start); setPlaying((v) => !v) }} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
        <div className="tl-date">{fmtDate(cursor, true)}</div>
        <div className="tl-status">{status}</div>
      </div>

      <div className="tl-track">
        <div className="tl-row tl-passes">
          <span className="tl-label">NISAR passes</span>
          {passes.map((p, i) => (
            <button key={i} className={`pass ${p.flagship ? 'flag' : ''}`} style={{ left: pct(p.t) }}
              title={`${fmtDate(p.t, true)} · track ${p.track} ${p.dir === 'A' ? 'ascending' : 'descending'}${p.flagship ? ' · used in this story' : ''}`}
              onClick={() => { setPlaying(false); setCursor(p.t) }} aria-label={`NISAR pass ${fmtDate(p.t)}`} />
          ))}
        </div>
        <div className="tl-row tl-quakes">
          <span className="tl-label">Earthquakes (USGS)</span>
          {quakes.features.map((q) => (
            <i key={q.id} className="qdot" style={{ left: pct(q.properties.time), width: 4 + (q.properties.mag - 3.5) * 2.6, height: 4 + (q.properties.mag - 3.5) * 2.6 }}
              title={`M${q.properties.mag} · ${q.properties.place}`} />
          ))}
        </div>
        <div className="tl-axis">
          {ticks.map((t) => (
            <span key={t} style={{ left: pct(t) }}>{new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
          ))}
        </div>
        <div className="tl-event" style={{ left: pct(quakeT) }}><span>{story.event.shortLabel}</span></div>
        <div className="tl-cursor" style={{ left: pct(cursor) }} />
        <input className="tl-range" type="range" min={start} max={end} step={3600000} value={cursor}
          onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)) }} aria-label="Date" />
      </div>
    </div>
  )
}
