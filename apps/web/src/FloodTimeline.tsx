import { useLayoutEffect, useRef } from 'react'
import Chart from './charts/Chart'
import type { ChartMarker } from './charts/Chart'
import { useI18n } from './i18n'
import type { FloodRain, FloodStory, LoadedFlood } from './types'

const DAY = 86400000
const t0 = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

interface Props {
  data: LoadedFlood
  story: FloodStory
  a: number
  b: number
  setA: (i: number) => void
  setB: (i: number) => void
  playing: boolean
  onPlay: () => void
  expert: boolean
}

/** Flood timeline: daily rain on top, new water per NISAR pass below, both on one true-date axis. */
export default function FloodTimeline({ data, story, a, b, setA, setB, playing, onPlay, expert }: Props) {
  const { t, num, date } = useI18n()
  const { flood, rain } = data
  const dates = flood.dates
  const times = dates.map((d) => t0(d.date))
  const rainTimes = rain ? rain.dates.map(t0) : []
  const lo = Math.min(times[0], rainTimes[0] ?? Infinity) - 2 * DAY
  const hi = times[times.length - 1] + 3 * DAY
  const short = (ms: number) => date(ms, { month: 'short', day: 'numeric', year: undefined })

  const rainPts = rain?.dates.map((d, i) => ({ x: t0(d), y: rain.mean_mm[i], tip: `${short(t0(d))}: ${num(rain.mean_mm[i], 1)} mm` })) ?? []
  const peakRain = rain ? rainPeaks(rain) : []
  const passMarkers: ChartMarker[] = times.map((x) => ({ x, dashed: true }))
  const box = useRef<HTMLElement>(null)
  // Tell the page how tall the timeline is, so the side panel and map credit sit right above it.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--tl-h', `${Math.round(el.getBoundingClientRect().height)}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (!d) return
    e.preventDefault()
    if (e.shiftKey) setA(Math.min(dates.length - 1, Math.max(0, a + d)))
    else setB(Math.min(dates.length - 1, Math.max(0, b + d)))
  }

  const summary = t('timeline.value', { date: `${short(times[b])}, ${story.dateLabels[dates[b].date] ?? ''}`, km2: `${num(dates[b].new_water_km2)} ${t('unit.km2')}` })

  return (
    <section ref={box} className="timeline ftl" aria-label={t('timeline.region')}>
      <div className="ftl-head">
        <b>{expert ? t('area.title.expert') : t('area.title.plain')}</b>
        <span className="ftl-key"><i className="k-rain" />{t('timeline.rain')}</span>
        <span className="ftl-key"><i className="k-water" />{t('timeline.water')}</span>
        <span className="ftl-key"><i className="k-cmp" />{t('timeline.compare')}</span>
      </div>
      <div className="ftl-body">
        <button className="btn ftl-play" onClick={onPlay} aria-pressed={playing} aria-label={playing ? t('controls.pause') : t('controls.animate')}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="ftl-charts" tabIndex={0} role="group" aria-label={t('timeline.label')} aria-describedby="ftl-keys" onKeyDown={onKey}>
          {rain && (
            <Chart label={t('timeline.rain')} height={58} hideY left={6} xDomain={[lo, hi]} xTicks={[]} xPad={14}
              series={[{ id: 'rain', kind: 'bar', color: 'var(--d-rain)', points: rainPts, barUnit: 0.8 * DAY }]}
              markers={passMarkers}
              barLabels={(p) => {
                const pk = peakRain.find((q) => q.x === p.x)
                return pk ? `${short(p.x)}: ${num(p.y ?? 0)} mm` : null
              }} />
          )}
          <Chart label={t('timeline.water')} height={104} hideY left={6} xDomain={[lo, hi]} xPad={14}
            xTicks={times.map((x, i) => ({ x, label: i === b || i === a || window.innerWidth > 700 ? short(x) : '' }))}
            series={[{
              id: 'water', kind: 'bar', color: 'var(--d-water)', barUnit: 6 * DAY,
              points: dates.map((d, i) => ({ x: times[i], y: d.new_water_km2, tip: `${short(times[i])}: ${num(d.new_water_km2)} ${t('unit.km2')}` })),
            }]}
            selectedX={times[b]} secondX={a !== b ? times[a] : undefined}
            barLabels={(p) => (p.y == null || (p.y === 0) ? (p.y === 0 ? '0' : null) : num(p.y))}
            onSelect={(x) => { const i = times.indexOf(x); if (i >= 0) setB(i) }} />
        </div>
      </div>
      <p className="ftl-note" id="ftl-keys" role="status" aria-live="polite">{summary}. {t('timeline.keys')}</p>
    </section>
  )
}

/** The wettest day before the first NISAR pulse and the wettest day overall, to label on the rain bars. */
export function rainPeaks(rain: FloodRain) {
  const ts = rain.dates.map(t0)
  const out: { x: number; mm: number }[] = []
  let top = -1
  rain.mean_mm.forEach((v, i) => { if (v > (rain.mean_mm[top] ?? -1)) top = i })
  if (top >= 0) out.push({ x: ts[top], mm: rain.mean_mm[top] })
  const cut = ts.findIndex((x) => x >= Date.parse('2026-06-28T00:00:00Z'))
  let first = -1
  rain.mean_mm.forEach((v, i) => { if (i < cut && v > (rain.mean_mm[first] ?? -1)) first = i })
  if (first >= 0 && first !== top) out.push({ x: ts[first], mm: rain.mean_mm[first] })
  return out
}
