import { useCallback, useEffect, useRef, useState } from 'react'
import FloodMap, { swipeAngle, swipeSlope } from './FloodMap'
import type { FloodLayers, FloodMapHandle } from './FloodMap'
import FloodTimeline from './FloodTimeline'
import { ChartsTab, EvidenceTab, FloodInspector, LayersTab, LearnTab, LegendKey, MethodsDialog, OverviewText } from './FloodPanels'
import { EXCLUSIVE, FLOOD_TABS, initialFloodState, readHash, writeHash } from './lib/flood'
import type { FloodState, FloodTab } from './lib/flood'
import { loadFlood } from './lib/data'
import { useLocalizedStory } from './lib/localize'
import { useI18n } from './i18n'
import { TopBar } from './Panels'
import { CHEVRONS_HTML } from './Icons'
import type { UiMode } from './Panels'
import type { FloodView, LoadedFlood, StoryIndexEntry } from './types'

interface Props {
  id: string
  stories: StoryIndexEntry[]
  onSwitchStory: (id: string) => void
  initialUi: UiMode
  onUiChange: (m: UiMode) => void
}

/** The flood story: a before/after swipe between two NISAR dates, a flood timeline and four panel tabs. */
export default function FloodViewer({ id, stories, onSwitchStory, initialUi, onUiChange }: Props) {
  const { t, date, num } = useI18n()
  const [data, setData] = useState<LoadedFlood | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [st, setSt] = useState<FloodState | null>(null)
  const [swipe, setSwipe] = useState(0.5)
  // The divider slides between the radar picture's own edges, like borders (or the window's edges when the picture runs past them).
  const swipeRange = (): [number, number] => {
    const edges = map.current?.pictureEdges()
    if (!edges) return [0, 1]
    const lo = Math.max(0, edges[0]), hi = Math.min(1, edges[1])
    // while the map is still settling the edges can be nonsense: ignore a picture that seems to be almost off screen
    return hi - lo > 0.15 ? [lo, hi] : [0, 1]
  }
  const clampSwipe = (f: number) => {
    const [lo, hi] = swipeRange()
    return lo < hi ? Math.min(hi, Math.max(lo, f)) : f
  }
  const [point, setPoint] = useState<[number, number] | null>(null)
  const [preset, setPreset] = useState<string | null>(null)
  const [pin, setPin] = useState<string | null>(null)
  const [methods, setMethods] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [terrain, setTerrain] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 760)
  const [startCam, setStartCam] = useState<FloodState['cam']>(null)
  const map = useRef<FloodMapHandle>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const noteTimer = useRef(0)
  const hashTimer = useRef(0)

  useEffect(() => {
    loadFlood(id).then((d) => {
      const base = initialFloodState(d.flood)
      const { state, fromHash } = readHash(d.flood, { ...base, expert: initialUi === 'scientist' })
      setData(d); setSt(state); setStartCam(state.cam)
      // the first time, the divider glides in from the left edge
      if (!fromHash && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setSwipe(swipeRange()[0])
        const t0 = performance.now()
        const step = (now: number) => {
          const x = Math.min(1, (now - t0) / 1300)
          setSwipe(swipeRange()[0] + (0.5 - swipeRange()[0]) * (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2))
          if (x < 1) requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }
    }).catch((e: Error) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const story = useLocalizedStory(id, data?.story)
  useEffect(() => () => { window.clearTimeout(noteTimer.current); window.clearTimeout(hashTimer.current) }, [])

  const update = useCallback((patch: Partial<FloodState>) => setSt((s) => (s ? { ...s, ...patch } : s)), [])
  const flash = useCallback((m: string) => {
    setNote(m)
    window.clearTimeout(noteTimer.current)
    noteTimer.current = window.setTimeout(() => setNote(null), 7000)
  }, [])

  // keep the shareable link current
  const syncHash = useCallback(() => {
    if (!data || !st) return
    window.clearTimeout(hashTimer.current)
    hashTimer.current = window.setTimeout(() => writeHash(data.flood, st), 250)
  }, [data, st])
  useEffect(syncHash, [syncHash])

  // Play steps the right-hand date through the season once and stops on the last date, holding a little longer on the flood peak
  useEffect(() => {
    if (!playing || !data || !st) return
    const last = data.flood.dates.length - 1
    const hold = data.flood.dates[st.b].date === data.flood.peak_date ? 2400 : 1500
    const h = window.setTimeout(() => {
      if (st.b >= last) setPlaying(false)
      else setSt((s) => (s ? { ...s, b: Math.min(last, s.b + 1) } : s))
    }, hold)
    return () => window.clearTimeout(h)
  }, [playing, data, st])

  // Play from the first date; pressing it on the last date starts over
  const togglePlay = () => {
    if (playing) { setPlaying(false); return }
    if (data && st && st.b >= data.flood.dates.length - 1) setSt({ ...st, b: 0 })
    setPlaying(true)
  }

  if (error) return <div className="splash"><b>{t('error.data')}</b><span>{error}</span></div>
  if (!data || !st || !story) return <div className="splash"><img className="splash-logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="Aevion" /><span>{t('loading')}</span></div>

  const { flood } = data
  const dates = flood.dates
  const expert = st.expert
  const lab = (i: number) => `${date(dates[i].date, { year: undefined })}${story.dateLabels[dates[i].date] ? `, ${story.dateLabels[dates[i].date]}` : ''}`
  const ref = dates.findIndex((d) => d.date === flood.reference)
  const left = st.a === ref ? '' : t('view.leftSuffix', { left: lab(st.a) })
  const tail = st.swipeOn ? '' : t('view.noswipe')
  const summary = st.b === ref
    ? t('view.ref', { right: lab(st.b), left: st.swipeOn ? left : '' }) + tail
    : t('view.flood', { date: date(dates[st.b].date, { year: undefined }), km2: num(dates[st.b].new_water_km2), left: st.swipeOn ? left : '' }) + tail

  const setLayer = (l: keyof FloodLayers, on: boolean) => {
    const layers = { ...st.layers, [l]: on }
    if (on && (EXCLUSIVE as readonly string[]).includes(l)) for (const o of EXCLUSIVE) if (o !== l) layers[o] = false
    update({ layers })
  }
  const setTab = (tab: FloodTab) => { update({ tab }); setCollapsed(false) }
  const switchUi = (m: UiMode) => {
    const e = m === 'scientist'
    // plain language drops the colour mix and the C-band layer, which stay one click away in Scientist mode
    const patch: Partial<FloodState> = { expert: e }
    if (!e) { if (st.view === 'RGB') patch.view = 'HH'; patch.layers = { ...st.layers, sentinel1: false } }
    update(patch)
    onUiChange(m)
  }
  const onPick = (lng: number, lat: number) => { setPoint([lng, lat]); setPreset(null) }
  const onPreset = (pid: string) => {
    const p = flood.presets.find((x) => x.id === pid)
    if (!p) return
    setPreset(pid)
    setPoint([p.lng, p.lat])
    const bi = dates.findIndex((d) => d.date === p.date)
    if (bi >= 0) update({ b: bi })
    map.current?.flyTo(p.lng, p.lat, 12)
  }
  const onShowPin = (pid: string) => {
    const f = data.pins?.features.find((x) => (x.properties as { id: string }).id === pid)
    if (!f) return
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates
    setPin(pid)
    update({ layers: { ...st.layers, pins: true } })
    map.current?.flyTo(lng, lat, 12)
  }

  // the dates on either side of the divider, shown on its handle like Before / After in the other stories
  const s1 = st.layers.sentinel1 && flood.context.sentinel1
  const leftDate = date(s1 ? flood.context.sentinel1!.date : dates[st.a].date, { year: undefined })
  const rightDate = date(dates[st.b].date, { year: undefined })

  const TAB_LABEL: Record<FloodTab, string> = { overview: 's.tab.overview', layers: 'panel.layers', charts: 'panel.charts', impact: 's.tab.impact', learn: 's.tab.learn' }
  const hasMix = dates.every((d) => d.layers.RGB)
  const views: { id: FloodView; label: string; title: string }[] = [
    { id: 'HH', label: expert ? 'HH' : t('pol.HH.plain'), title: t('pol.HH.title') },
    { id: 'HV', label: expert ? 'HV' : t('pol.HV.plain'), title: t('pol.HV.title') },
    ...(expert && hasMix ? [{ id: 'RGB' as FloodView, label: t('pol.RGB.expert'), title: t('pol.RGB.title') }] : []),
  ]

  const bodies: Record<FloodTab, React.ReactNode> = {
    overview: (
      <>
        <p className="fsummary" role="status">{summary}</p>
        <OverviewText story={story} />
        <div className="actions">
          <label className="field">
            <span>{t('controls.compare')}</span>
            <select value={st.a} onChange={(e) => update({ a: Number(e.target.value) })}>
              {dates.map((d, i) => <option key={d.date} value={i}>{lab(i)}</option>)}
            </select>
          </label>
          <div className="row-btns">
            <button className="cta ghost" aria-pressed={st.swipeOn} title={t('map.swipeTitle')} onClick={() => update({ swipeOn: !st.swipeOn })}>{st.swipeOn ? t('s.swipe.hide') : t('s.swipe.show')}</button>
            <button className="cta ghost" aria-pressed={playing} onClick={togglePlay}>{playing ? t('controls.pause') : t('controls.animate')}</button>
          </div>
        </div>
        <details className="howto">
          <summary>{t('s.howto')}</summary>
          <ul><li>{t('f.howto.1')}</li><li>{t('f.howto.2')}</li><li>{t('f.howto.3')}</li></ul>
        </details>
      </>
    ),
    layers: <LayersTab data={data} story={story} state={st} setLayer={setLayer} />,
    charts: <ChartsTab data={data} story={story} state={st} point={point} onPreset={onPreset} activePreset={preset} />,
    impact: <EvidenceTab data={data} story={story} state={st} onShow={onShowPin} selectedPin={pin} />,
    learn: <LearnTab story={story} onMethods={() => setMethods(true)} />,
  }

  const nSwipePct = Math.round(swipe * 100)
  return (
    <div className="app flood" ref={wrap}>
      <FloodMap ref={map} data={data} a={st.a} b={st.b} view={st.view} water={st.water} swipeOn={st.swipeOn} terrain={terrain} swipe={swipe} layers={st.layers}
        point={point} startCamera={startCam} onPick={onPick} onPin={(p) => { setPin(p); setTab('impact') }}
        onLoading={setBusy} onMissing={(w) => flash(t('error.layer', { name: w }))} onMoveEnd={() => setSwipe((s) => clampSwipe(s))} />
      {busy && <div className="floadbar" aria-hidden="true" />}
            {st.swipeOn && (
        <div className="fdivider" role="slider" tabIndex={0} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={nSwipePct}
          aria-label={t('divider.label')} aria-valuetext={t('divider.value', { pct: nSwipePct, left: lab(st.a), right: lab(st.b) })}
          style={{ left: `${swipe * 100}%`, top: '-20%', height: '140%', transform: `rotate(${swipeAngle(terrain)}deg)` }}
          onPointerDown={(e) => {
            const el = e.currentTarget
            el.setPointerCapture(e.pointerId)
            const mv = (ev: PointerEvent) => {
              const r = wrap.current!.getBoundingClientRect()
              // the line leans, so find where it crosses the middle of the map from wherever it is grabbed
              const cx = ev.clientX - r.left - (r.height / 2 - (ev.clientY - r.top)) * swipeSlope(terrain)
              setSwipe(clampSwipe(cx / r.width))
            }
            const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up) }
            el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up)
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.1 : 0.02
            const d: Record<string, number> = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -0.1, PageUp: 0.1 }
            if (e.key in d) setSwipe((s) => clampSwipe(s + d[e.key]))
            else if (e.key === 'Home') setSwipe(clampSwipe(0))
            else if (e.key === 'End') setSwipe(clampSwipe(1))
            else return
            e.preventDefault()
          }}>
          <span className="swipe-handle" style={{ transform: `translate(-50%, -50%) rotate(${-swipeAngle(terrain)}deg)` }} aria-hidden="true"><span>{leftDate}</span><b dangerouslySetInnerHTML={{ __html: CHEVRONS_HTML }} /><span>{rightDate}</span></span>
        </div>
      )}

      <div className="fctl" role="group" aria-label={t('map.controls')}>
        <button onClick={() => map.current?.zoomIn()} aria-label={t('map.zoomIn')} title={t('map.zoomIn')}>+</button>
        <button onClick={() => map.current?.zoomOut()} aria-label={t('map.zoomOut')} title={t('map.zoomOut')}>−</button>
        <button onClick={() => setTerrain(!terrain)} aria-pressed={terrain} aria-label={t('map.tilt')} title={t('map.tiltTitle')} className={terrain ? 'on' : ''}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 18l6-9 4 5 3-4 5 8z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <button className="recenter" onClick={() => map.current?.reset()} title={t('s.recenter.tip')} aria-label={t('s.recenter.aria')}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        {t('s.recenter')}
      </button>

      <TopBar story={story} ui={expert ? 'scientist' : 'story'} setUi={switchUi} stories={stories} onSwitchStory={onSwitchStory}
        languages={stories.find((s) => s.id === id)?.languages} />

      <aside className={`side fside ${expert ? 'sci' : ''} ${collapsed ? 'collapsed' : ''}`}>
        <div className="side-head">
          <div className="side-title">
            <h1>{story.title}</h1>
            <button className="collapse" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}
              aria-label={collapsed ? t('panel.show') : t('panel.hide')} title={collapsed ? t('panel.show') : t('panel.hide')}>{collapsed ? '+' : '–'}</button>
          </div>
          <p className="subtitle">{story.subtitle}</p>
          {!collapsed && (
            <>
              <div className="views" role="radiogroup" aria-label={t('controls.polGroup')} data-n={views.length}>
                {views.map((v) => (
                  <button key={v.id} className={`view ${st.view === v.id ? 'on' : ''}`} role="radio" aria-checked={st.view === v.id} title={v.title} onClick={() => update({ view: v.id })}><b>{v.label}</b></button>
                ))}
              </div>

              <div className="legend">
                <div className="legend-title">{st.view === 'RGB' ? (expert ? t('pol.RGB.title') : t('legend.rgb.plain')) : t(`f.legend.${st.view}`)}</div>
                <div className="bar" style={{ background: st.view === 'RGB' ? 'linear-gradient(90deg,#211a4c,#f1afd5,#bbd334)' : 'linear-gradient(90deg, #05070b, #3a3f47, #8b9098, #f1f3f6)' }} />
                {st.view !== 'RGB' && <div className="ends">
                  <span>{st.view === 'HV' ? t('f.legend.HV.dark') : expert ? t('legend.dark.expert') : t('legend.dark.plain')}</span>
                  <span>{st.view === 'HV' ? t('f.legend.HV.bright') : expert ? t('legend.bright.expert') : t('legend.bright.plain')}</span>
                </div>}
              </div>

              <details className="settings">
                <summary>{t('s.colors')}</summary>
                <LegendKey data={data} state={st} />
                <label className="check">
                  <input type="checkbox" checked={st.water} disabled={st.view !== 'HH'} onChange={(e) => update({ water: e.target.checked })} />
                  <span>{t('controls.water')}{st.view !== 'HH' ? ` (${t('f.waterOnly')})` : ''}</span>
                </label>
              </details>

              <div className="tabs" role="tablist" aria-label={t('panel.tabs')}>
                {FLOOD_TABS.map((k) => (
                  <button key={k} role="tab" id={`ft-${k}`} aria-selected={st.tab === k} aria-controls="ft-panel" className={st.tab === k ? 'on' : ''} onClick={() => update({ tab: k })}>{t(TAB_LABEL[k])}</button>
                ))}
              </div>
            </>
          )}
        </div>
        {!collapsed && (
          <div className="side-body" role="tabpanel" id="ft-panel" aria-labelledby={`ft-${st.tab}`}>
            {bodies[st.tab]}
          </div>
        )}
      </aside>

      {point && <FloodInspector data={data} story={story} state={st} point={point} onChart={() => setTab('charts')} onClose={() => setPoint(null)} />}
      <div className={`replay-chip fade note ${note ? 'on' : ''}`} role="status" aria-hidden={!note}>{note}</div>
      <FloodTimeline data={data} story={story} a={st.a} b={st.b} setA={(i) => update({ a: i })} setB={(i) => update({ b: i })} playing={playing} onPlay={togglePlay} expert={expert} />
      {methods && <MethodsDialog data={data} onClose={() => setMethods(false)} />}
    </div>
  )
}
