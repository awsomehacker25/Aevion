import { useEffect, useRef, useState } from 'react'
import Chart from './charts/Chart'
import type { FloodLayers } from './FloodMap'
import { dayMs, floodHistory, floodedAt, kmBetween, pointValues } from './lib/flood'
import type { FloodState } from './lib/flood'
import { Paras } from './lib/rich'
import { useI18n } from './i18n'
import type { FloodStory, LoadedFlood } from './types'

type Layer = keyof FloodLayers

interface TabProps {
  data: LoadedFlood
  story: FloodStory
  state: FloodState
}

/** The first story section, as plain paragraphs (Overview tab). */
export function OverviewText({ story }: { story: FloodStory }) {
  return (
    <>
      {story.personal && (
        <section className="fpersonal">
          <h2>{story.personal.title}</h2>
          <Paras items={story.personal.body} className="lead" />
        </section>
      )}
      <Paras items={story.sections[0]?.body.slice(0, 1) ?? []} className="lead" />
    </>
  )
}

/** The rest of the story as cards (Learn tab), like the other stories. */
export function LearnTab({ story, onMethods }: { story: FloodStory; onMethods: () => void }) {
  const { t } = useI18n()
  return (
    <>
      <div className="why">
        <h2>{t('s.why')}</h2>
        {story.sections.map((s, i) => {
          const body = i === 0 ? s.body.slice(1) : s.body // the first paragraph of the first section is the Overview
          return body.length ? (
            <details key={s.id}>
              <summary>{s.title}</summary>
              <Paras items={body} />
            </details>
          ) : null
        })}
      </div>
      <button className="cta ghost" onClick={onMethods}>{t('methods.button')}</button>
      <p className="foot">{story.credits}</p>
      <p className="foot">{t('s.si')}</p>
    </>
  )
}

/** What each colour on the map means, for the layers that are switched on. */
export function LegendKey({ data, state }: { data: LoadedFlood; state: FloodState }) {
  const { t, date } = useI18n()
  const { flood } = data
  const ctx = flood.context
  const L = state.layers
  const sw = flood.rgb?.swatches
  const rgb = (c?: [number, number, number]) => (c ? `rgb(${c[0]},${c[1]},${c[2]})` : 'transparent')
  return (
    <>
      <ul className="key">
        {state.view === 'RGB' && (['water', 'floodveg', 'forest', 'built'] as const).map((k) => <li key={k}><i style={{ background: rgb(sw?.[k]) }} />{t(`legend.rgb.${k}`)}</li>)}
        {state.water && state.view === 'HH' && <li><i style={{ background: 'var(--d-water)' }} />{t('legend.new')}</li>}
        {L.permwater && ctx.permanent_water && <li><i className="stripes" />{t('legend.permwater')}</li>}
        {L.districts && data.districts && <li><i className="dash" />{t('legend.districts')}</li>}
        {L.pins && data.pins && <li><i className="ring" />{t('legend.pins')}</li>}
        {L.aftermath && ctx.aftermath && <><li><i style={{ background: '#e8a33d' }} />{t('legend.aftermath.up')}</li><li><i style={{ background: '#4aa3d8' }} />{t('legend.aftermath.down')}</li></>}
        {L.population && ctx.population && <li><i style={{ background: 'linear-gradient(90deg,#fde8c8,#c2410c)' }} />{t('legend.population')}</li>}
      </ul>
      {state.view === 'RGB' && <p className="hint">{t('legend.rgb.note', { date: date(flood.rgb?.swatch_date ?? flood.peak_date) })}</p>}
    </>
  )
}

const GROUPS: { id: string; layers: { id: Layer; expertOnly?: boolean }[] }[] = [
  { id: 'water', layers: [{ id: 'permwater' }, { id: 'aftermath' }] },
  { id: 'people', layers: [{ id: 'districts' }, { id: 'pins' }, { id: 'population' }] },
  { id: 'sat', layers: [{ id: 'optical' }, { id: 'sentinel1', expertOnly: true }] },
]

export function LayersTab({ data, state, setLayer }: TabProps & { setLayer: (l: Layer, on: boolean) => void }) {
  const { t, num, date } = useI18n()
  const { flood } = data
  const ctx = flood.context
  const has: Record<Layer, boolean> = {
    districts: !!data.districts, permwater: !!ctx.permanent_water, aftermath: !!ctx.aftermath, population: !!ctx.population,
    optical: !!ctx.sentinel2, pins: !!data.pins, sentinel1: !!ctx.sentinel1,
  }
  const L = state.layers
  const people = (n: number) => (n >= 1e6 ? t('num.million', { n: num(n / 1e6, 1) }) : num(Math.round(n / 1000) * 1000))
  const popDate = flood.dates[state.b].date
  const pd = ctx.population?.by_date[popDate]

  const summaries: string[] = []
  if (L.aftermath && ctx.aftermath) {
    const a = ctx.aftermath
    const ch = (k: string) => num(a.by_river[k]?.channel_brighter_km2 ?? 0, 1)
    summaries.push(state.expert
      ? t('ctx.aftermath.expert', { from: date(a.from), to: date(a.to), up: num(a.brighter_km2), pct: num(a.brighter_pct), down: num(a.darker_km2), dikhow: ch('Dikhow'), jhanji: ch('Jhanji'), disang: ch('Disang') })
      : t('ctx.aftermath.plain', { from: date(a.from), to: date(a.to), up: num(a.brighter_km2), down: num(a.darker_km2) }))
    if (state.expert) summaries.push(t('ctx.aftermath.offset', { to: date(a.to), db: num(Math.abs(a.offset_db), 1) }))
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
          {g.layers.filter((l) => has[l.id] && (!l.expertOnly || state.expert)).map((l) => (
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

export function ChartsTab({ data, story, state, point, onPreset, activePreset }: TabProps & {
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
  const sel = xs[dates.indexOf(flood.dates[state.b].date)]
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
      if (state.expert) {
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
  const peakI = rain ? rain.mean_mm.reduce((b, v, i) => (v > rain.mean_mm[b] ? i : b), 0) : 0

  return (
    <div className="fcharts">
      <section>
        <h3>{state.expert ? t('point.title.expert') : t('point.title.plain')}</h3>
        {vals && (
          <Chart label={t('point.title.plain')} height={150} left={state.expert ? 40 : 8} hideY={!state.expert} xPad={14}
            xDomain={[xs[0], xs[xs.length - 1]]} xTicks={xs.map((x, i) => ({ x, label: i % 2 === 0 || window.innerWidth > 700 ? short(x) : '' }))}
            yTicks={3} yFormat={(v) => `${v}`}
            series={[
              { id: 'hh', kind: 'line', color: 'var(--d-water)', vertices: true, points: xs.map((x, i) => ({ x, y: vals.HH[i], tip: `HH ${short(x)}: ${vals.HH[i] == null ? '–' : num(vals.HH[i]!, 1)} dB` })) },
              ...(state.expert ? [{ id: 'hv', kind: 'line' as const, color: 'var(--d-hv)', vertices: true, points: xs.map((x, i) => ({ x, y: vals.HV[i], tip: `HV ${short(x)}: ${vals.HV[i] == null ? '–' : num(vals.HV[i]!, 1)} dB` })) }] : []),
            ]}
            refs={state.expert ? [{ y: thr, label: `${thr} dB`, color: 'var(--muted)' }] : []}
            selectedX={sel} />
        )}
        <p className="hint" role="status">{text}</p>
        {vals && <p className="fleg"><span><i style={{ background: 'var(--d-water)' }} />HH{state.expert ? '' : ` (${t('pol.HH.plain')})`}</span>{state.expert && <span><i style={{ background: 'var(--d-hv)' }} />HV</span>}</p>}
      </section>

      {state.expert && presets.length > 0 && (
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
          <h3>{state.expert ? t('rain.title.expert') : t('rain.title.plain')}</h3>
          <Chart label={t('rain.title.plain')} height={150} left={34} xPad={10}
            xDomain={[rainTs[0], rainTs[rainTs.length - 1]]}
            xTicks={rainTs.filter((_, i) => i % 10 === 0).map((x) => ({ x, label: short(x) }))}
            yFormat={(v) => `${v}`}
            series={[
              { id: 'mean', kind: 'bar', color: 'var(--d-rain)', barUnit: 0.8 * 86400000, points: rain.dates.map((_, i) => ({ x: rainTs[i], y: rain.mean_mm[i], tip: `${short(rainTs[i])}: ${num(rain.mean_mm[i], 1)} mm` })) },
              ...(state.expert ? [{ id: 'max', kind: 'line' as const, color: 'var(--d-pin)', points: rain.dates.map((_, i) => ({ x: rainTs[i], y: rain.max_cell_mm[i] })) }] : []),
            ]}
            markers={flood.dates.map((d) => dayMs(d.date)).filter((x) => x >= rainTs[0] && x <= rainTs[rainTs.length - 1]).map((x) => ({ x, dashed: true }))} />
          <p className="hint">{t('rain.note', { start: date(rain.dates[0]), end: date(rain.dates[rain.dates.length - 1]), peakDay: date(rain.dates[peakI]), peak: num(rain.mean_mm[peakI], 1) })}</p>
          <p className="fleg"><span><i style={{ background: 'var(--d-rain)' }} />{t('rain.mean')}</span>{state.expert && <span><i style={{ background: 'var(--d-pin)' }} />{t('rain.max')}</span>}<span><i className="dash" />{t('rain.nisar')}</span></p>
          <p className="hint">{t('rain.source', { source: rain.source })}{story.id ? '' : ''}</p>
        </section>
      )}
    </div>
  )
}

export function EvidenceTab({ data, story, state, onShow, selectedPin }: TabProps & { onShow: (id: string) => void; selectedPin: string | null }) {
  const { t, num, date } = useI18n()
  const pins = data.pins?.features ?? []
  const ctx = data.flood.context
  const refs = useRef<Record<string, HTMLLIElement | null>>({})
  useEffect(() => { if (selectedPin) refs.current[selectedPin]?.scrollIntoView({ block: 'nearest' }) }, [selectedPin])
  const pop = ctx.population
  const peak = pop?.by_date[data.flood.peak_date]
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
          <p className="hint">{t('people.note', { year: pop.source_year })} {state.expert ? '' : ''}</p>
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
                <p>{story.pinText[pr.id]}</p>
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
export function MethodsDialog({ data, onClose }: { data: LoadedFlood; onClose: () => void }) {
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

interface InspectorProps { data: LoadedFlood; story: FloodStory; state: FloodState; point: [number, number]; onChart: () => void; onClose: () => void }

/** The small card that opens when you click the map: what the radar says at that spot on the chosen date. */
export function FloodInspector({ data, story, state, point, onChart, onClose }: InspectorProps) {
  const { t, num, date } = useI18n()
  const { flood, series } = data
  const vals = pointValues(series, point[0], point[1])
  const di = series.dates.indexOf(flood.dates[state.b].date)
  const ri = series.dates.indexOf(flood.reference)
  const hh = vals ? vals.HH[di] : null
  const hv = vals ? vals.HV[di] : null
  const ref = vals ? vals.HH[ri] : null
  const thr = flood.threshold_db
  // is this spot in the new-water picture drawn on the map? (read from the picture itself, not the coarse series)
  const [mask, setMask] = useState<{ key: string; wet: boolean | null } | null>(null)
  const maskUrl = flood.dates[state.b].layers.water
  const key = `${maskUrl}|${point[0]}|${point[1]}`
  useEffect(() => {
    let live = true
    floodedAt(maskUrl, flood.bbox, point[0], point[1]).then((wet) => { if (live) setMask({ key, wet }) })
    return () => { live = false }
  }, [maskUrl, key, flood.bbox, point])
  const flooded = mask && mask.key === key ? mask.wet : null

  // how many of the flood passes was this spot under new water? (every pass but the dry-season reference)
  const passes = flood.dates.filter((d) => d.date !== flood.reference)
  const [hist, setHist] = useState<{ key: string; rows: { date: string; wet: boolean | null }[] } | null>(null)
  const hkey = `${point[0]}|${point[1]}`
  useEffect(() => {
    let live = true
    floodHistory(passes.map((d) => ({ date: d.date, url: d.layers.water })), flood.bbox, point[0], point[1]).then((rows) => { if (live) setHist({ key: hkey, rows }) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hkey, flood])
  const rows = hist && hist.key === hkey ? hist.rows.filter((r) => r.wet != null) : []
  const wetDates = rows.filter((r) => r.wet).map((r) => r.date)
  const shortDate = (iso: string) => date(iso, { month: 'short', day: 'numeric', year: undefined })
  const histLine = rows.length === 0 ? null
    : wetDates.length === 0 ? t('f.insp.histNone', { total: rows.length })
    : t('f.insp.hist', { n: wetDates.length, total: rows.length, first: shortDate(wetDates[0]), last: shortDate(wetDates[wetDates.length - 1]) })

  // a reported damage site close by
  const near = (data.pins?.features ?? [])
    .map((f) => ({ f, km: kmBetween(point, (f.geometry as GeoJSON.Point).coordinates as [number, number]) }))
    .filter((x) => x.km < 4).sort((a, b) => a.km - b.km)[0]
  const nearId = near ? (near.f.properties as { id: string }).id : null
  const wasWet = ref != null && ref < thr
  const lowEcho = hh != null && hh < thr
  const isWet = flooded ?? lowEcho
  const sentence = vals == null || (hh == null && flooded == null) ? t('f.insp.none')
    : flooded ? t('f.insp.flooded')
    : lowEcho && wasWet ? t('f.insp.waterAll')
    : t('f.insp.dry')
  return (
    <div className={`inspector fin ${state.expert ? 'sci' : ''}`} role="dialog" aria-label={t('s.point')}>
      <button className="x" onClick={onClose} aria-label={t('s.close')}>&times;</button>
      <div className="coords">{num(point[1], state.expert ? 5 : 2)}&deg;, {num(point[0], state.expert ? 5 : 2)}&deg; &middot; {date(flood.dates[state.b].date)}</div>
      {(hh != null || flooded != null) && <div className="big">{state.expert && hh != null ? <>{num(hh, 1)} <small>dB HH</small></> : isWet ? t('f.insp.bigWater') : t('f.insp.bigLand')}</div>}
      <p>{sentence}</p>
      {histLine && <p className="fhist">{histLine}</p>}
      {nearId && <p className="fhist">{t('f.insp.near', { name: t(`pin.name.${nearId}`), text: story.pinText[nearId] })}</p>}
      {state.expert && hh != null && (
        <table className="prov"><tbody>
          <tr><th>HH</th><td>{num(hh, 1)} dB</td></tr>
          <tr><th>HV</th><td>{hv == null ? '–' : `${num(hv, 1)} dB`}</td></tr>
          <tr><th>{t('f.insp.ref')}</th><td>{ref == null ? '–' : `${num(ref, 1)} dB`}</td></tr>
        </tbody></table>
      )}
      <button className="cta ghost" onClick={onChart}>{t('f.insp.chart')}</button>
    </div>
  )
}


