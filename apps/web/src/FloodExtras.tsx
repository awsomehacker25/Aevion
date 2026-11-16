import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import Chart from './charts/Chart'
import { useI18n } from './i18n'
import { dayMs, kmBetween, pointValues } from './lib/flood'
import type { FloodData, Story } from './types'

/**
 * The flood analysis for a story (Upper Assam): map layers, point charts, people and damage, how it was made, the point card and the
 * rain and new-water timeline. They sit in the shared panels and timeline, with the same look as every other story.
 */

/** Which extra map layers are on. */
export interface FloodLayers {
  districts: boolean
  permwater: boolean
  aftermath: boolean
  population: boolean
  optical: boolean
  pins: boolean
  sentinel1: boolean
}
type Layer = keyof FloodLayers

/** Layers that cover the whole map: only one of these shows at a time. */
export const EXCLUSIVE = ['optical', 'sentinel1', 'population'] as const
export const DEFAULT_LAYERS: FloodLayers = { districts: true, permwater: true, aftermath: false, population: false, optical: false, pins: true, sentinel1: false }

/** Under this change in HH (dB) a cell is not counted as new flood water: the same cut-off the map uses to leave a cell clear. */
export const WET_BELOW = -3

interface Common {
  data: FloodData
  story: Story
  /** Scientist mode. */
  expert: boolean
  /** Index of the pass on screen in `data.flood.dates`. */
  b: number
}

/** "Jul 22: about 729 km² more water than in the dry season", with the date being compared on the left. */
export function FloodSummary({ data, story, expert: _e, a, b, swipeOn }: Common & { a: number; swipeOn: boolean }) {
  const { t, num, date } = useI18n()
  const dates = data.flood.dates
  const labels = story.dateLabels ?? {}
  const lab = (i: number) => `${date(dates[i].date, { year: undefined })}${labels[dates[i].date] ? `, ${labels[dates[i].date]}` : ''}`
  const ref = dates.findIndex((d) => d.date === data.flood.reference)
  const left = a === ref ? '' : t('view.leftSuffix', { left: lab(a) })
  const tail = swipeOn ? '' : t('view.noswipe')
  const text = b === ref
    ? t('view.ref', { right: lab(b), left: swipeOn ? left : '' }) + tail
    : t('view.flood', { date: date(dates[b].date, { year: undefined }), km2: num(dates[b].new_water_km2), left: swipeOn ? left : '' }) + tail
  return <p className="fsummary" role="status">{text}</p>
}

const GROUPS: { id: string; layers: { id: Layer; expertOnly?: boolean }[] }[] = [
  { id: 'water', layers: [{ id: 'permwater' }, { id: 'aftermath' }] },
  { id: 'people', layers: [{ id: 'districts' }, { id: 'pins' }, { id: 'population' }] },
  { id: 'sat', layers: [{ id: 'optical' }, { id: 'sentinel1', expertOnly: true }] },
]

/** Which context layers the data has, and the sentence that goes with each one that is on. */
export function FloodLayersPanel({ data, expert, b, layers, setLayer }: Common & { layers: FloodLayers; setLayer: (l: Layer, on: boolean) => void }) {
  const { t, num, date } = useI18n()
  const { flood } = data
  const ctx = flood.context
  const has: Record<Layer, boolean> = {
    districts: !!data.districts, permwater: !!ctx.permanent_water, aftermath: !!ctx.aftermath, population: !!ctx.population,
    optical: !!ctx.sentinel2, pins: !!data.pins, sentinel1: !!ctx.sentinel1,
  }
  const L = layers
  const people = (n: number) => (n >= 1e6 ? t('num.million', { n: num(n / 1e6, 1) }) : num(Math.round(n / 1000) * 1000))
  const popDate = flood.dates[b].date
  const pd = ctx.population?.by_date[popDate]

  const summaries: string[] = []
  if (L.aftermath && ctx.aftermath) {
    const a = ctx.aftermath
    const ch = (k: string) => num(a.by_river[k]?.channel_brighter_km2 ?? 0, 1)
    summaries.push(expert
      ? t('ctx.aftermath.expert', { from: date(a.from), to: date(a.to), up: num(a.brighter_km2), pct: num(a.brighter_pct), down: num(a.darker_km2), dikhow: ch('Dikhow'), jhanji: ch('Jhanji'), disang: ch('Disang') })
      : t('ctx.aftermath.plain', { from: date(a.from), to: date(a.to), up: num(a.brighter_km2), down: num(a.darker_km2) }))
    if (expert) summaries.push(t('ctx.aftermath.offset', { to: date(a.to), db: num(Math.abs(a.offset_db), 1) }))
  }
  if (L.population && ctx.population) summaries.push(t('ctx.population', { people: people(pd ? pd.in_flood : ctx.population.in_flood), date: date(pd ? popDate : ctx.population.date), total: people(ctx.population.total) }))
  if (L.sentinel1 && ctx.sentinel1) summaries.push(t('ctx.sentinel1', { date: date(ctx.sentinel1.date) }))
  if (L.optical && ctx.sentinel2) summaries.push(t('ctx.optical', { date: date(ctx.sentinel2.date) }))
  if (L.permwater && ctx.permanent_water) summaries.push(t('ctx.permwater', { pct: num(ctx.permanent_water.pct) }))

  return (
    <div className="flayers">
      {GROUPS.map((g) => (
        <section key={g.id}>
          <h3>{t(`layers.group.${g.id}`)}</h3>
          {g.layers.filter((l) => has[l.id] && (!l.expertOnly || expert)).map((l) => (
            <label key={l.id} className="chk">
              <input type="checkbox" checked={L[l.id]} onChange={(e) => setLayer(l.id, e.target.checked)} />
              {t(`layers.${l.id}`)}
            </label>
          ))}
        </section>
      ))}
      <p className="hint">{t('layers.exclusive')}</p>
      {summaries.length > 0 && <p className="fsum">{summaries.join(' ')}</p>}
    </div>
  )
}

/** What each colour on the map means for the extra layers that are switched on. */
export function FloodLegendKey({ data, layers }: { data: FloodData; layers: FloodLayers }) {
  const { t } = useI18n()
  const ctx = data.flood.context
  return (
    <>
      {layers.permwater && ctx.permanent_water && <li><i className="stripes" />{t('legend.permwater')}</li>}
      {layers.districts && data.districts && <li><i className="dash" />{t('legend.districts')}</li>}
      {layers.pins && data.pins && <li><i className="ring" />{t('legend.pins')}</li>}
      {layers.aftermath && ctx.aftermath && <><li><i style={{ background: '#e8a33d' }} />{t('legend.aftermath.up')}</li><li><i style={{ background: '#4aa3d8' }} />{t('legend.aftermath.down')}</li></>}
      {layers.population && ctx.population && <li><i style={{ background: 'linear-gradient(90deg,#fde8c8,#c2410c)' }} />{t('legend.population')}</li>}
    </>
  )
}

/** The radar signal at the clicked spot over the season, the check on known flooded and non-flooded patches, and the rain. */
export function FloodCharts({ data, story, expert, b, point, onPreset, activePreset }: Common & {
  point: [number, number] | null
  onPreset: (id: string) => void
  activePreset: string | null
}) {
  const { t, num, date } = useI18n()
  const { flood, series, rain } = data
  const dates = series.dates
  const xs = dates.map(dayMs)
  const vals = point ? pointValues(series, point[0], point[1]) : null
  const refIdx = dates.indexOf(flood.reference)
  const thr = flood.threshold_db
  const sel = xs[dates.indexOf(flood.dates[b].date)]
  const short = (ms: number) => date(ms, { month: 'short', day: 'numeric', year: undefined })

  let text = t('point.empty')
  if (point && !vals) text = t('point.nodata', { lat: num(point[1], 3), lng: num(point[0], 3) })
  else if (point && vals) {
    const valid = vals.HH.map((v, i) => [v, i] as const).filter((x): x is readonly [number, number] => x[0] != null)
    if (!valid.length) text = t('point.nodata', { lat: num(point[1], 3), lng: num(point[0], 3) })
    else {
      const [minV, minI] = valid.reduce((m, x) => (x[0] < m[0] ? x : m))
      const wet = minV < thr
      const ref = vals.HH[refIdx]
      if (expert) {
        const swing = Math.max(...valid.map((x) => x[0])) - minV
        text = t('point.expert', { lat: num(point[1], 4), lng: num(point[0], 4), date: date(dates[minI]), min: num(minV, 1),
          drop: ref != null ? t('point.expert.drop', { drop: num(ref - minV, 1) }) : '', swing: num(swing, 1),
          verdict: wet ? t('point.expert.wet', { db: num(thr) }) : t('point.expert.dry') })
      } else text = t(wet ? 'point.plain.wet' : 'point.plain.dry', { lat: num(point[1], 3), lng: num(point[0], 3), date: date(dates[minI]) })
    }
  }

  const presets = flood.presets
  const pr = presets.find((p) => p.id === activePreset)
  const patch = (p: (typeof presets)[number]) => `${t(`presets.${p.id}.text`, { hh: num(p.hh_db, 1), hv: num(p.hv_db, 1), hhRef: num(p.hh_ref_db, 1), hvRef: num(p.hv_ref_db, 1) })} ${t('presets.patch', { pct: num(Math.round(p.patch_fraction * 100)) })}`

  const rainTs = rain ? rain.dates.map(dayMs) : []
  const peakI = rain ? rain.mean_mm.reduce((best, v, i) => (v > rain.mean_mm[best] ? i : best), 0) : 0

  return (
    <div className="fcharts">
      <section>
        <h3>{expert ? t('point.title.expert') : t('point.title.plain')}</h3>
        {vals && (
          <Chart label={t('point.title.plain')} height={150} left={expert ? 40 : 8} hideY={!expert} xPad={14}
            xDomain={[xs[0], xs[xs.length - 1]]} xTicks={xs.map((x, i) => ({ x, label: i % 2 === 0 || window.innerWidth > 700 ? short(x) : '' }))}
            yTicks={3} yFormat={(v) => `${v}`}
            series={[
              { id: 'hh', kind: 'line', color: 'var(--d-water)', vertices: true, points: xs.map((x, i) => ({ x, y: vals.HH[i], tip: `HH ${short(x)}: ${vals.HH[i] == null ? '–' : num(vals.HH[i]!, 1)} dB` })) },
              ...(expert ? [{ id: 'hv', kind: 'line' as const, color: 'var(--d-hv)', vertices: true, points: xs.map((x, i) => ({ x, y: vals.HV[i], tip: `HV ${short(x)}: ${vals.HV[i] == null ? '–' : num(vals.HV[i]!, 1)} dB` })) }] : []),
            ]}
            refs={expert ? [{ y: thr, label: `${thr} dB`, color: 'var(--muted)' }] : []}
            selectedX={sel} />
        )}
        <p className="hint" role="status">{text}</p>
        {vals && <p className="fleg"><span><i style={{ background: 'var(--d-water)' }} />HH{expert ? '' : ` (${t('pol.HH.plain')})`}</span>{expert && <span><i style={{ background: 'var(--d-hv)' }} />HV</span>}</p>}
      </section>

      {expert && presets.length > 0 && (
        <section>
          <h3>{t('presets.title.expert', { date: date(presets[0].date) })}</h3>
          <p className="hint">{t('presets.intro', { date: date(presets[0].date) })}</p>
          <div className="fpresets">
            {presets.map((p) => <button key={p.id} className={activePreset === p.id ? 'on' : ''} aria-pressed={activePreset === p.id} onClick={() => onPreset(p.id)}>{t(`presets.${p.id}.label`)}</button>)}
          </div>
          {pr && <p className="hint">{patch(pr)}</p>}
        </section>
      )}

      {rain && (
        <section>
          <h3>{expert ? t('rain.title.expert') : t('rain.title.plain')}</h3>
          <Chart label={t('rain.title.plain')} height={150} left={34} xPad={10}
            xDomain={[rainTs[0], rainTs[rainTs.length - 1]]}
            xTicks={rainTs.filter((_, i) => i % 10 === 0).map((x) => ({ x, label: short(x) }))}
            yFormat={(v) => `${v}`}
            series={[
              { id: 'mean', kind: 'bar', color: 'var(--d-rain)', barUnit: 0.8 * 86400000, points: rain.dates.map((_, i) => ({ x: rainTs[i], y: rain.mean_mm[i], tip: `${short(rainTs[i])}: ${num(rain.mean_mm[i], 1)} mm` })) },
              ...(expert ? [{ id: 'max', kind: 'line' as const, color: 'var(--d-pin)', points: rain.dates.map((_, i) => ({ x: rainTs[i], y: rain.max_cell_mm[i] })) }] : []),
            ]}
            markers={flood.dates.map((d) => dayMs(d.date)).filter((x) => x >= rainTs[0] && x <= rainTs[rainTs.length - 1]).map((x) => ({ x, dashed: true }))} />
          <p className="hint">{t('rain.note', { start: date(rain.dates[0]), end: date(rain.dates[rain.dates.length - 1]), peakDay: date(rain.dates[peakI]), peak: num(rain.mean_mm[peakI], 1) })}</p>
          <p className="fleg"><span><i style={{ background: 'var(--d-rain)' }} />{t('rain.mean')}</span>{expert && <span><i style={{ background: 'var(--d-pin)' }} />{t('rain.max')}</span>}<span><i className="dash" />{t('rain.nisar')}</span></p>
          <p className="hint">{t('rain.source', { source: rain.source })}{story.id ? '' : ''}</p>
        </section>
      )}
    </div>
  )
}

/** People under new flood water and the reported damage sites, with their sources. */
export function FloodImpact({ data, story, onShow, selectedPin }: Common & { onShow: (id: string) => void; selectedPin: string | null }) {
  const { t, num, date } = useI18n()
  const pins = data.pins?.features ?? []
  const ctx = data.flood.context
  const refs = useRef<Record<string, HTMLLIElement | null>>({})
  useEffect(() => { if (selectedPin) refs.current[selectedPin]?.scrollIntoView({ block: 'nearest' }) }, [selectedPin])
  const pop = ctx.population
  const peak = pop?.by_date[data.flood.peak_date]
  const text = story.pinText ?? {}
  return (
    <div className="fevidence">
      {pop && peak && (
        <section>
          <h3>{t('people.title')}</h3>
          <p>{t('people.line', { n: num(peak.in_flood), total: num(pop.total), date: date(data.flood.peak_date) })}</p>
          <table className="ftable">
            <thead><tr><th>{t('people.district')}</th><th>{t('people.under')}</th><th>{t('people.total')}</th></tr></thead>
            <tbody>
              {Object.entries(pop.by_district).map(([k, v]) => <tr key={k}><td>{k}</td><td>{num(v.in_flood)}</td><td>{num(v.total)}</td></tr>)}
            </tbody>
          </table>
          <p className="hint">{t('people.note', { year: pop.source_year })}</p>
        </section>
      )}
      <section>
        <h3>{t('pins.title')}</h3>
        <ul className="fpins">
          {pins.map((f) => {
            const pr = f.properties as { id: string; date: string; approximate: boolean; source: string; url: string }
            return (
              <li key={pr.id} ref={(el) => { refs.current[pr.id] = el }} className={selectedPin === pr.id ? 'on' : ''}>
                <b>{t(`pin.name.${pr.id}`)}</b> <span className="muted">{date(pr.date)}</span>
                <p>{text[pr.id]}</p>
                <p className="muted">
                  {pr.approximate && <em>{t('pins.approx')} · </em>}
                  <a href={pr.url} target="_blank" rel="noreferrer noopener">{t('pins.source', { source: pr.source })}</a>
                </p>
                <button className="btn" onClick={() => onShow(pr.id)}>{t('pins.show')}</button>
              </li>
            )
          })}
        </ul>
        <p className="hint">{story.pinMissing}</p>
      </section>
    </div>
  )
}

/** "How this was made": the processing steps, the threshold check and the known limits. */
export function FloodMethods({ data, onClose }: { data: FloodData; onClose: () => void }) {
  const { t, num } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  const val = (data.validation?.vs_aus_fig14 ?? {}) as Record<string, { precision: number; recall: number; f1: number; pred_frac: number; ref_frac: number }>
  const f = data.flood
  const used = `HH < ${f.threshold_db} dB`
  const jrc = (data.validation?.vs_jrc_dry ?? {}) as Record<string, { precision: number; recall: number; f1: number }>
  const j = jrc[used]
  const steps = ['data', 'box', 'crop', 'water', 'flood', 'area'] as const
  return (
    <dialog ref={ref} className="fdialog" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close() }} aria-labelledby="meth-title">
      <div className="fdialog-in">
        <header><h2 id="meth-title">{t('methods.title')}</h2><button className="btn" onClick={() => ref.current?.close()}>{t('methods.close')}</button></header>
        <h3>{t('methods.steps')}</h3>
        <table className="ftable">
          <tbody>
            {steps.map((k) => <tr key={k}><th scope="row">{t(`methods.${k}.k`)}</th><td>{t(`methods.${k}.v`)}</td></tr>)}
            <tr><th scope="row">{t('methods.result.k')}</th><td>{f.dates.filter((d) => d.date !== f.reference).map((d) => `${d.date.slice(5)} ${num(d.new_water_km2)} km²`).join(' · ')}. {t('methods.result.v')}</td></tr>
          </tbody>
        </table>
        <h3>{t('methods.threshold.title', { db: f.threshold_db })}</h3>
        <p>{t('methods.threshold.body')}</p>
        <div className="tablewrap">
          <table className="ftable num">
            <thead><tr><th>{t('methods.col.mask')}</th><th>{t('methods.col.precision')}</th><th>{t('methods.col.recall')}</th><th>F1</th><th>{t('methods.col.ours')}</th><th>{t('methods.col.theirs')}</th></tr></thead>
            <tbody>
              {Object.entries(val).map(([k, v]) => (
                <tr key={k} className={k === used ? 'used' : ''}>
                  <td>{k}{k === used ? ` (${t('methods.used')})` : ''}</td><td>{num(v.precision, 2)}</td><td>{num(v.recall, 2)}</td><td>{num(v.f1, 2)}</td>
                  <td>{num(Math.round(v.pred_frac * 100))}%</td><td>{num(Math.round(v.ref_frac * 100))}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {j && <p>{t('methods.jrc', { p: num(j.precision, 2), r: num(j.recall, 2), f1: num(j.f1, 2) })}</p>}
        <p><b>{t('methods.verdict')}</b></p>
        <h3>{t('methods.limits')}</h3>
        <ul>{[1, 2, 3, 4].map((i) => <li key={i}>{t(`methods.limit.${i}`)}</li>)}</ul>
        <p><a href="https://github.com/ruisbasement-code/Upper-Assam-India" target="_blank" rel="noreferrer noopener">{t('methods.code')}</a></p>
      </div>
    </dialog>
  )
}

/**
 * What the flood analysis adds to the point card: is this spot under new water, on how many passes, any reported damage close by, and
 * (in Scientist mode) the HH and HV values and the dry-season reference. `waterAt` reads the new-water grid of a pass.
 */
export function FloodPointExtra({ data, story, expert, b, point, waterAt, onChart }: Common & {
  point: [number, number]
  /** HH change versus the dry season where the new-water grid has water, or null where it has none or the spot is outside. */
  waterAt: (date: string) => number | null
  onChart: () => void
}) {
  const { t, num, date } = useI18n()
  const { flood, series } = data
  const vals = pointValues(series, point[0], point[1])
  const di = series.dates.indexOf(flood.dates[b].date)
  const ri = series.dates.indexOf(flood.reference)
  const hh = vals ? vals.HH[di] : null
  const hv = vals ? vals.HV[di] : null
  const ref = vals ? vals.HH[ri] : null
  const thr = flood.threshold_db
  const flooded = (() => { const v = waterAt(flood.dates[b].date); return v == null ? null : v < WET_BELOW })()

  // on how many of the flood passes was this spot under new water? (every pass but the dry-season reference)
  const passes = flood.dates.filter((d) => d.date !== flood.reference)
  const rows = passes.map((d) => ({ date: d.date, wet: ((v) => (v == null ? false : v < WET_BELOW))(waterAt(d.date)) }))
  const wetDates = rows.filter((r) => r.wet).map((r) => r.date)
  const shortDate = (iso: string) => date(iso, { month: 'short', day: 'numeric', year: undefined })
  const histLine = wetDates.length === 0 ? t('f.insp.histNone', { total: rows.length })
    : t('f.insp.hist', { n: wetDates.length, total: rows.length, first: shortDate(wetDates[0]), last: shortDate(wetDates[wetDates.length - 1]) })

  // a reported damage site close by
  const pinText = story.pinText ?? {}
  const near = (data.pins?.features ?? [])
    .map((f) => ({ f, km: kmBetween(point, (f.geometry as GeoJSON.Point).coordinates as [number, number]) }))
    .filter((x) => x.km < 4).sort((x, y) => x.km - y.km)[0]
  const nearId = near ? (near.f.properties as { id: string }).id : null
  const wasWet = ref != null && ref < thr
  const lowEcho = hh != null && hh < thr
  const sentence = vals == null || (hh == null && flooded == null) ? t('f.insp.none')
    : flooded ? t('f.insp.flooded')
    : lowEcho && wasWet ? t('f.insp.waterAll')
    : t('f.insp.dry')
  return (
    <>
      <p>{sentence}</p>
      <p className="fhist">{histLine}</p>
      {nearId && <p className="fhist">{t('f.insp.near', { name: t(`pin.name.${nearId}`), text: pinText[nearId] ?? '' })}</p>}
      {expert && hh != null && (
        <table className="prov"><tbody>
          <tr><th>HH</th><td>{num(hh, 1)} dB</td></tr>
          <tr><th>HV</th><td>{hv == null ? '–' : `${num(hv, 1)} dB`}</td></tr>
          <tr><th>{t('f.insp.ref')}</th><td>{ref == null ? '–' : `${num(ref, 1)} dB`}</td></tr>
        </tbody></table>
      )}
      <button className="cta ghost" onClick={onChart}>{t('f.insp.chart')}</button>
    </>
  )
}

/** Rain and new flood water on one true-date axis, to sit under the shared timeline. Click a bar to move to that pass. */
type TimelineRowProps = Common & { a: number; onPick: (dateIso: string) => void; start: number; end: number }

/** Only redraws when what it shows changes, not on every tick of the playing timeline. */
export const FloodTimelineRow = memo(FloodTimelineRowInner, (p, n) =>
  p.data === n.data && p.story === n.story && p.b === n.b && p.a === n.a && p.start === n.start && p.end === n.end && p.expert === n.expert)

function FloodTimelineRowInner({ data, story, b, a, onPick, start, end }: TimelineRowProps) {
  const { t, num, date } = useI18n()
  const { flood, rain } = data
  const dates = flood.dates
  const DAY = 86400000
  const narrow = typeof window !== 'undefined' && window.innerWidth < 700
  const box = useRef<HTMLDivElement>(null)
  const pick = useRef(onPick)
  useEffect(() => { pick.current = onPick })
  const times = useMemo(() => dates.map((d) => Date.parse(`${d.date}T00:00:00Z`)), [dates])

  // The chart itself never changes while the timeline plays: it is built once, and the highlighted bar is switched on the bars
  // directly (below), so passing a satellite pass costs a few style changes instead of a redraw of every bar.
  const { series, xTicks } = useMemo(() => {
    const t0 = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
    const short = (ms: number) => date(ms, { month: 'short', day: 'numeric', year: undefined })
    // rain is drawn faintly behind the bars, scaled to sit in the lower part of the same small chart
    const maxWater = Math.max(1, ...dates.map((d) => d.new_water_km2))
    const maxRain = rain ? Math.max(1, ...rain.mean_mm) : 1
    const rainScale = (maxWater * 0.4) / maxRain
    const rainSeries = rain ? [{
      id: 'rain', kind: 'bar' as const, color: 'rgba(86, 180, 233, .55)', barUnit: 0.8 * DAY,
      points: rain.dates.map((d, i) => ({ x: t0(d), y: rain.mean_mm[i] * rainScale, color: 'rgba(86, 180, 233, .55)', tip: `${short(t0(d))}: ${num(rain.mean_mm[i], 1)} mm` })),
    }] : []
    return {
      xTicks: times.map((x) => ({ x, label: short(x) })),
      series: [...rainSeries, {
        id: 'water', kind: 'bar' as const, color: 'var(--d-water)', barUnit: 6 * DAY,
        points: dates.map((d, i) => ({ x: times[i], y: d.new_water_km2, tip: `${short(times[i])}: ${num(d.new_water_km2)} ${t('unit.km2')}` })),
      }],
    }
  }, [dates, rain, times, date, num, t])
  const barLabels = useCallback((p: { y: number | null; color?: string }) => (p.y == null || p.color ? null : num(p.y)), [num])
  const onSelect = useCallback((x: number) => { const i = times.indexOf(x); if (i >= 0) pick.current(dates[i].date) }, [times, dates])
  const xDomain = useMemo<[number, number]>(() => [start, end], [start, end])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const sel = times[b]
    el.querySelectorAll<SVGRectElement>('rect[data-x]').forEach((r) => {
      const on = Number(r.dataset.x) === sel
      r.style.fillOpacity = on ? '1' : '.7'
      r.style.stroke = on ? 'var(--ink)' : 'none'
      r.style.strokeWidth = on ? '1.5' : '0'
    })
    el.querySelectorAll<SVGTextElement>('text[data-x]').forEach((x) => x.classList.toggle('sel', Number(x.dataset.x) === sel))
  }, [b, times, series])

  const labels = story.dateLabels ?? {}
  const shortSel = date(times[b], { month: 'short', day: 'numeric', year: undefined })
  const summaryText = t('timeline.value', { date: `${shortSel}, ${labels[dates[b].date] ?? ''}`, km2: `${num(dates[b].new_water_km2)} ${t('unit.km2')}` })
  return (
    <div className="ftl-row">
      <div className="ftl-keys">
        <span className="ftl-key"><i className="k-water" />{t('timeline.water')}</span>
        <span className="ftl-key"><i className="k-rain" />{t('timeline.rain')}</span>
      </div>
      <div className="ftl-charts" ref={box} role="group" aria-label={`${t('timeline.region')}: ${summaryText}`}>
        <Chart label={t('timeline.water')} height={narrow ? 70 : 82} hideY left={0} xDomain={xDomain} xPad={0}
          xTicks={xTicks} series={series} secondX={a !== b ? times[a] : undefined}
          barLabels={barLabels} onSelect={onSelect} />
      </div>
    </div>
  )
}
