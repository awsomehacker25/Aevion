import { useMemo } from 'react'
import Chart from './charts/Chart'
import type { ChartMarker, ChartSeries } from './charts/Chart'
import { useI18n } from './i18n'
import { ms, sampleGrid } from './lib/data'
import { sortEpochs } from './lib/periods'
import { areaWhere, histogram, mean, percentile, values } from './lib/stats'
import type { Epoch, Grid, LoadedStory } from './types'

const DAY = 86400000
const ORANGE = 'var(--away)'
const BLUE = 'var(--toward)'

interface Props {
  data: LoadedStory
  /** The grids on screen now (the chosen period). */
  displacement: Grid
  coherence: Grid
  scale: number
  unit: string
  threshold: number
  picked: [number, number] | null
  sci: boolean
}

/** Charts for the interferometry and radar-picture stories. Each story gets the ones its data supports. */
export default function StoryCharts({ data, displacement, coherence, scale, unit, threshold, picked, sci }: Props) {
  const { t, num, date } = useI18n()
  const { story } = data
  const bs = story.kind === 'backscatter'
  const short = (ms_: number) => date(ms_, { month: 'short', day: 'numeric', year: undefined })
  const epochs = useMemo(() => (story.epochs ? sortEpochs(story.epochs) : []), [story.epochs])
  const grids = data.epochGrids
  const mask = useMemo(() => ({ grid: coherence, min: threshold }), [coherence, threshold])

  // ---- distribution of the measured values on screen ----
  const dist = useMemo(() => {
    if (bs) return null
    const v = values(displacement, mask).map((x) => x * scale)
    if (v.length < 50) return null
    v.sort((a, b) => a - b)
    const lim = Math.max(1, Math.ceil(Math.max(Math.abs(percentile(v, 0.01)), Math.abs(percentile(v, 0.99))) / 5) * 5)
    return { lim, bins: histogram(v, -lim, lim, 24), n: v.length }
  }, [displacement, mask, scale, bs])

  // ---- one number per measured period ----
  const secondary = (e: Epoch) => ms(`${e.pair.secondary}T00:00:00Z`)
  const perPeriod = useMemo(() => {
    if (!epochs.length || !grids) return []
    return epochs.map((e) => {
      const g = grids[e.id]
      if (!g) return null
      const x = secondary(e)
      const defo = g.deformation
      if (bs) {
        // radar-picture story: how much of the area is bright (strong echo) and how it changed
        const hh = values(defo)
        const chg = g.hh
        return {
          x, id: e.id,
          bright: areaWhere(defo, (v) => v > -5),
          up: chg ? areaWhere(chg, (v) => v > 3) : null,
          down: chg ? areaWhere(chg, (v) => v < -3) : null,
          meanHH: mean(hh),
          meanHV: g.hv ? mean(values(g.hv)) : null,
        }
      }
      const v = values(defo, { grid: g.coherence, min: threshold }).map((q) => q * scale).sort((a, b) => a - b)
      const spot = picked ? sampleGrid(defo, picked[0], picked[1]) : null
      return {
        x, id: e.id,
        lo: percentile(v, 0.01), hi: percentile(v, 0.99),
        sink: areaWhere(defo, (q) => q * scale > 2, { grid: g.coherence, min: threshold }),
        spot: spot == null ? null : spot * scale,
      }
    })
  }, [epochs, grids, bs, threshold, scale, picked])

  const rows = perPeriod.filter((r): r is NonNullable<typeof r> => !!r)
  const xs = rows.map((r) => r.x)
  const xDomain: [number, number] = xs.length ? [Math.min(...xs) - 6 * DAY, Math.max(...xs) + 6 * DAY] : [0, 1]
  const xTicks = xs.map((x) => ({ x, label: short(x) }))
  const barUnit = xs.length > 1 ? Math.min(8, (Math.min(...xs.slice(1).map((x, i) => x - xs[i])) / DAY) * 0.6) * DAY : 6 * DAY

  const sections: { id: string; title: string; hint?: string; node: React.ReactNode }[] = []

  // 1. distribution
  if (dist) {
    const pts = dist.bins.map((b) => ({ x: b.x, y: b.share, color: b.x < 0 ? BLUE : ORANGE, tip: `${num(b.from, 0)} to ${num(b.to, 0)} ${unit}: ${num(b.share, 1)}%` }))
    const step = dist.bins[1].x - dist.bins[0].x
    sections.push({
      id: 'dist', title: t('c.dist.title'), hint: t('c.dist.hint', { n: num(dist.n), unit }),
      node: <Chart label={t('c.dist.title')} height={140} left={30} yFormat={(v) => `${v}%`}
        xDomain={[-dist.lim - step, dist.lim + step]} xPad={4}
        xTicks={[-dist.lim, -dist.lim / 2, 0, dist.lim / 2, dist.lim].map((x) => ({ x, label: `${x > 0 ? '+' : ''}${num(x, 0)}` }))}
        series={[{ id: 'd', kind: 'bar', color: ORANGE, barUnit: step * 0.9, points: pts }]}
        markers={[{ x: 0, dashed: false }]} />,
    })
  }

  // 2. earthquakes through time (stories that have a catalogue)
  const quakes = data.quakes.features
  if (quakes.length > 3) {
    const start = ms(story.timeline.start), end = ms(story.timeline.end)
    const inRange = quakes.filter((q) => q.properties.time >= start && q.properties.time <= end)
    const f = story.flagshipPair
    const markers: ChartMarker[] = [ms(`${f.reference}T00:00:00Z`), ms(`${f.secondary}T00:00:00Z`)].map((x) => ({ x, dashed: true }))
    const ticks = Array.from({ length: 5 }, (_, i) => start + ((end - start) * i) / 4)
    sections.push({
      id: 'quakes', title: t('c.quakes.title'), hint: t('c.quakes.hint', { n: inRange.length }),
      node: <Chart label={t('c.quakes.title')} height={140} left={26} yDomain={[3, 8]} yTicks={5} xDomain={[start, end]} xPad={8}
        xTicks={ticks.map((x) => ({ x, label: short(x) }))} markers={markers}
        series={[{ id: 'q', kind: 'dot', color: ORANGE, size: 4.5, points: inRange.map((q) => ({ x: q.properties.time, y: q.properties.mag, color: q.properties.mag >= 7 ? '#ff4d3d' : ORANGE, tip: `M${q.properties.mag} · ${q.properties.place}` })) }]}
        yFormat={(v) => `M${v}`} />,
    })
  }

  // 3. who felt it: people exposed to each shaking level
  const exposure = data.context?.pager.exposureByMmi
  if (exposure) {
    const keys = ['3', '4', '5', '6', '7', '8', '9']
    const roman: Record<string, string> = { 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX' }
    sections.push({
      id: 'exposure', title: t('c.exposure.title'), hint: t('c.exposure.hint'),
      node: <Chart label={t('c.exposure.title')} height={140} left={34} yFormat={(v) => `${v}M`}
        xDomain={[2.4, 9.6]} xPad={4} xTicks={keys.map((k) => ({ x: Number(k), label: roman[k] }))}
        series={[{ id: 'e', kind: 'bar', color: 'var(--accent-ink)', size: 22, points: keys.map((k) => ({ x: Number(k), y: (exposure[k] ?? 0) / 1e6, tip: `${roman[k]}: ${num((exposure[k] ?? 0) / 1e6, 1)} M` })) }]} />,
    })
  }

  // 4. period-by-period charts
  if (rows.length > 1 && !bs) {
    const r = rows as { x: number; lo: number; hi: number; sink: number; spot: number | null }[]
    const series: ChartSeries[] = [
      { id: 'hi', kind: 'bar', color: ORANGE, barUnit, points: r.map((q) => ({ x: q.x, y: q.hi, tip: `${short(q.x)}: ${num(q.hi, 1)} ${unit}` })) },
      { id: 'lo', kind: 'bar', color: BLUE, barUnit, points: r.map((q) => ({ x: q.x, y: q.lo, tip: `${short(q.x)}: ${num(q.lo, 1)} ${unit}` })) },
    ]
    sections.push({
      id: 'peak', title: t('c.peak.title'), hint: t('c.peak.hint', { unit }),
      node: <Chart label={t('c.peak.title')} height={150} left={34} xDomain={xDomain} xTicks={xTicks} series={series} yFormat={(v) => `${v}`} markers={[]} refs={[{ y: 0, dashed: false }]} />,
    })
    sections.push({
      id: 'area', title: t('c.area.title'), hint: t('c.area.hint'),
      node: <Chart label={t('c.area.title')} height={130} left={34} xDomain={xDomain} xTicks={xTicks} yFormat={(v) => `${v}`}
        series={[{ id: 'a', kind: 'bar', color: ORANGE, barUnit, points: r.map((q) => ({ x: q.x, y: q.sink, tip: `${short(q.x)}: ${num(q.sink)} ${t('unit.km2')}` })) }]}
        barLabels={(p) => (p.y == null ? null : num(p.y))} />,
    })
    if (r.some((q) => q.spot != null)) {
      sections.push({
        id: 'spot', title: t('c.spot.title'), hint: t('c.spot.hint', { unit, lat: num(picked![1], 3), lng: num(picked![0], 3) }),
        node: <Chart label={t('c.spot.title')} height={130} left={34} xDomain={xDomain} xTicks={xTicks} yFormat={(v) => `${v}`}
          series={[{ id: 's', kind: 'line', color: 'var(--accent-ink)', vertices: true, points: r.map((q) => ({ x: q.x, y: q.spot, tip: `${short(q.x)}: ${q.spot == null ? '–' : num(q.spot, 1)} ${unit}` })) }]}
          refs={[{ y: 0, dashed: false }]} />,
      })
    }
  }

  if (rows.length > 1 && bs) {
    const r = rows as { x: number; bright: number; up: number | null; down: number | null; meanHH: number | null; meanHV: number | null }[]
    sections.push({
      id: 'bright', title: t('c.bright.title'), hint: t('c.bright.hint'),
      node: <Chart label={t('c.bright.title')} height={140} left={34} xDomain={xDomain} xTicks={xTicks} yFormat={(v) => `${v}`}
        series={[{ id: 'b', kind: 'bar', color: ORANGE, barUnit, points: r.map((q) => ({ x: q.x, y: q.bright, tip: `${short(q.x)}: ${num(q.bright, 1)} ${t('unit.km2')}` })) }]}
        barLabels={(p) => (p.y == null ? null : num(p.y, 1))} />,
    })
    if (r.some((q) => q.up != null)) {
      sections.push({
        id: 'change', title: t('c.change.title'), hint: t('c.change.hint'),
        node: <>
          <Chart label={t('c.change.title')} height={140} left={34} xDomain={xDomain} xTicks={xTicks} yFormat={(v) => `${v}`}
            series={[
              { id: 'up', kind: 'line', color: ORANGE, vertices: true, points: r.map((q) => ({ x: q.x, y: q.up, tip: `${short(q.x)}: ${q.up == null ? '–' : num(q.up, 1)} ${t('unit.km2')}` })) },
              { id: 'down', kind: 'line', color: BLUE, vertices: true, points: r.map((q) => ({ x: q.x, y: q.down, tip: `${short(q.x)}: ${q.down == null ? '–' : num(q.down, 1)} ${t('unit.km2')}` })) },
            ]} />
          <p className="fleg"><span><i style={{ background: ORANGE }} />{t('c.change.up')}</span><span><i style={{ background: BLUE }} />{t('c.change.down')}</span></p>
        </>,
      })
    }
    if (sci) {
      sections.push({
        id: 'echo', title: t('c.echo.title'), hint: t('c.echo.hint'),
        node: <>
          <Chart label={t('c.echo.title')} height={140} left={38} xDomain={xDomain} xTicks={xTicks} yFormat={(v) => `${v}`}
            series={[
              { id: 'hh', kind: 'line', color: 'var(--accent-ink)', vertices: true, points: r.map((q) => ({ x: q.x, y: q.meanHH, tip: `HH ${short(q.x)}: ${q.meanHH == null ? '–' : num(q.meanHH, 1)} dB` })) },
              { id: 'hv', kind: 'line', color: 'var(--d-hv)', vertices: true, points: r.map((q) => ({ x: q.x, y: q.meanHV, tip: `HV ${short(q.x)}: ${q.meanHV == null ? '–' : num(q.meanHV, 1)} dB` })) },
            ]} />
          <p className="fleg"><span><i style={{ background: 'var(--accent-ink)' }} />HH</span><span><i style={{ background: 'var(--d-hv)' }} />HV</span></p>
        </>,
      })
    }
  }

  if (!sections.length) return <p className="hint">{t('c.none')}</p>
  return (
    <div className="fcharts scharts">
      {sections.map((s) => (
        <section key={s.id}>
          <h3>{s.title}</h3>
          {s.node}
          {s.hint && <p className="hint">{s.hint}</p>}
        </section>
      ))}
    </div>
  )
}
