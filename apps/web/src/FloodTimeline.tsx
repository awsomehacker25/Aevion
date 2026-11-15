import { useLayoutEffect, useRef } from 'react'
import Chart from './charts/Chart'
import { useI18n } from './i18n'
import { PauseIcon, PlayIcon } from './Icons'
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
export default function FloodTimeline({ data, story, a, b, setA, setB, playing, onPlay }: Props) {
  const { t, num, date } = useI18n()
  const { flood, rain } = data
  const dates = flood.dates
  const times = dates.map((d) => t0(d.date))
  const rainTimes = rain ? rain.dates.map(t0) : []
  const lo = Math.min(times[0], rainTimes[0] ?? Infinity) - 2 * DAY
  const hi = times[times.length - 1] + 3 * DAY
  const short = (ms: number) => date(ms, { month: 'short', day: 'numeric', year: undefined })

  const narrow = typeof window !== 'undefined' && window.innerWidth < 700
  const summaryText = t('timeline.value', { date: `${short(times[b])}, ${story.dateLabels[dates[b].date] ?? ''}`, km2: `${num(dates[b].new_water_km2)} ${t('unit.km2')}` })
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

  // rain and flooded area share one small chart: rain is drawn faintly behind the bars, scaled to sit in the lower part
  const maxWater = Math.max(1, ...dates.map((d) => d.new_water_km2))
  const maxRain = rain ? Math.max(1, ...rain.mean_mm) : 1
  const rainScale = (maxWater * 0.4) / maxRain
  const rainSeries = rain ? [{
    id: 'rain', kind: 'bar' as const, color: 'rgba(86, 180, 233, .55)', barUnit: 0.8 * DAY,
    points: rain.dates.map((d, i) => ({ x: t0(d), y: rain.mean_mm[i] * rainScale, color: 'rgba(86, 180, 233, .55)', tip: `${short(t0(d))}: ${num(rain.mean_mm[i], 1)} mm` })),
  }] : []

  return (
    <section ref={box} className="timeline ftl" aria-label={t('timeline.region')}>
      <div className="tl-head">
        <button className="btn" onClick={onPlay} aria-pressed={playing} aria-label={playing ? t('controls.pause') : t('controls.animate')}>
          {playing ? <><PauseIcon /> {t('controls.pause')}</> : <><PlayIcon /> {t('s.tl.play')}</>}
        </button>
        <div className="tl-date" title={t('timeline.label')}>{date(dates[b].date)}</div>
        <div className="ftl-keys">
          <span className="ftl-key"><i className="k-water" />{t('timeline.water')}</span>
          <span className="ftl-key"><i className="k-rain" />{t('timeline.rain')}</span>
        </div>
      </div>
      <div className="ftl-charts" tabIndex={0} role="group" aria-label={`${t('timeline.region')}: ${summaryText}`} aria-describedby="ftl-keys" onKeyDown={onKey}>
        <Chart label={t('timeline.water')} height={narrow ? 70 : 82} hideY left={6} xDomain={[lo, hi]} xPad={14}
          xTicks={times.map((x) => ({ x, label: short(x) }))}
          series={[...rainSeries, {
            id: 'water', kind: 'bar', color: 'var(--d-water)', barUnit: 6 * DAY,
            points: dates.map((d, i) => ({ x: times[i], y: d.new_water_km2, tip: `${short(times[i])}: ${num(d.new_water_km2)} ${t('unit.km2')}` })),
          }]}
          selectedX={times[b]} secondX={a !== b ? times[a] : undefined}
          barLabels={(p) => (p.y == null || p.color ? null : num(p.y))}
          onSelect={(x) => { const i = times.indexOf(x); if (i >= 0) setB(i) }} />
      </div>
      <p className="sr-only" id="ftl-keys">{t('timeline.keys')}</p>
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
