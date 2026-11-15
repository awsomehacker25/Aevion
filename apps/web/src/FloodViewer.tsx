import { useCallback, useEffect, useRef, useState } from 'react'
import FloodMap from './FloodMap'
import type { FloodLayers, FloodMapHandle } from './FloodMap'
import FloodTimeline from './FloodTimeline'
import { ChartsTab, EvidenceTab, LayersTab, MethodsDialog, StoryTab } from './FloodPanels'
import { EXCLUSIVE, FLOOD_TABS, initialFloodState, readHash, writeHash } from './lib/flood'
import type { FloodState, FloodTab } from './lib/flood'
import { loadFlood } from './lib/data'
import { useLocalizedStory } from './lib/localize'
import { useI18n } from './i18n'
import { TopBar } from './Panels'
import type { UiMode } from './Panels'
import type { LoadedFlood, StoryIndexEntry } from './types'

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
  const [point, setPoint] = useState<[number, number] | null>(null)
  const [preset, setPreset] = useState<string | null>(null)
  const [pin, setPin] = useState<string | null>(null)
  const [methods, setMethods] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
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
        setSwipe(0.02)
        const t0 = performance.now()
        const step = (now: number) => {
          const x = Math.min(1, (now - t0) / 1300)
          setSwipe(0.02 + 0.48 * (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2))
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
    hashTimer.current = window.setTimeout(() => writeHash(data.flood, { ...st, cam: map.current?.camera() ?? st.cam }), 250)
  }, [data, st])
  useEffect(syncHash, [syncHash])

  // Animate: step the right-hand date through the season
  useEffect(() => {
    if (!playing || !data) return
    const n = data.flood.dates.length
    const h = window.setInterval(() => setSt((s) => (s ? { ...s, b: (s.b + 1) % n } : s)), 1500)
    return () => window.clearInterval(h)
  }, [playing, data])

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
  const onPick = (lng: number, lat: number) => { setPoint([lng, lat]); setPreset(null); setTab('charts') }
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

  const tag = (i: number, leftSide: boolean) => {
    const s1 = leftSide && st.layers.sentinel1 && flood.context.sentinel1
    const d = s1 ? flood.context.sentinel1!.date : dates[i].date
    const sub = s1 ? t('ctx.sentinel1.tag') : [story.dateLabels[dates[i].date], expert ? t(`pol.${st.view}.expert`) : ''].filter(Boolean).join(', ')
    return <div className={`ftag ${leftSide ? 'left' : 'right'}`}><b>{date(d, { year: undefined })}</b><span>{sub}</span></div>
  }

  const bodies: Record<FloodTab, React.ReactNode> = {
    story: <StoryTab story={story} />,
    layers: <LayersTab data={data} story={story} state={st} setLayer={setLayer} setView={(v) => update({ view: v })} setWater={(w) => update({ water: w })} />,
    charts: <ChartsTab data={data} story={story} state={st} point={point} onPreset={onPreset} activePreset={preset} />,
    evidence: <EvidenceTab data={data} story={story} state={st} onShow={onShowPin} selectedPin={pin} />,
  }

  const nSwipePct = Math.round(swipe * 100)
  return (
    <div className="app flood" ref={wrap}>
      <FloodMap ref={map} data={data} a={st.a} b={st.b} view={st.view} water={st.water} swipeOn={st.swipeOn} swipe={swipe} layers={st.layers}
        point={point} startCamera={startCam} onPick={onPick} onPin={(p) => { setPin(p); setTab('evidence') }}
        onLoading={setBusy} onMissing={(w) => flash(t('error.layer', { name: w }))} onMoveEnd={syncHash} />
      {busy && <div className="floadbar" aria-hidden="true" />}
      {tag(st.a, true)}
      {tag(st.b, false)}
      {st.swipeOn && (
        <div className="fdivider" role="slider" tabIndex={0} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={nSwipePct}
          aria-label={t('divider.label')} aria-valuetext={t('divider.value', { pct: nSwipePct, left: lab(st.a), right: lab(st.b) })}
          style={{ left: `${swipe * 100}%` }}
          onPointerDown={(e) => {
            const el = e.currentTarget
            el.setPointerCapture(e.pointerId)
            const mv = (ev: PointerEvent) => {
              const r = wrap.current!.getBoundingClientRect()
              setSwipe(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)))
            }
            const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up) }
            el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up)
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.1 : 0.02
            const d: Record<string, number> = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -0.1, PageUp: 0.1 }
            if (e.key in d) setSwipe((s) => Math.min(1, Math.max(0, s + d[e.key])))
            else if (e.key === 'Home') setSwipe(0)
            else if (e.key === 'End') setSwipe(1)
            else return
            e.preventDefault()
          }}>
          <span className="grip" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        </div>
      )}

      <div className="fctl" role="group" aria-label={t('map.controls')}>
        <button onClick={() => map.current?.zoomIn()} aria-label={t('map.zoomIn')} title={t('map.zoomIn')}>+</button>
        <button onClick={() => map.current?.zoomOut()} aria-label={t('map.zoomOut')} title={t('map.zoomOut')}>−</button>
        <button onClick={() => map.current?.reset()} aria-label={t('map.reset')} title={t('map.resetTitle')}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <button onClick={() => update({ swipeOn: !st.swipeOn })} aria-pressed={st.swipeOn} aria-label={t('controls.swipe')} title={t('map.swipeTitle')} className={st.swipeOn ? 'on' : ''}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 5v14" stroke="currentColor" strokeWidth="2" /></svg>
        </button>
      </div>

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
              <div className="tabs" role="tablist" aria-label={t('panel.tabs')}>
                {FLOOD_TABS.map((k) => (
                  <button key={k} role="tab" id={`ft-${k}`} aria-selected={st.tab === k} aria-controls="ft-panel" className={st.tab === k ? 'on' : ''} onClick={() => update({ tab: k })}>{t(`panel.${k}`)}</button>
                ))}
              </div>
            </>
          )}
        </div>
        {!collapsed && (
          <div className="side-body" role="tabpanel" id="ft-panel" aria-labelledby={`ft-${st.tab}`}>
            <p className="fsummary" role="status">{summary}</p>
            <div className="fcontrols">
              <label className="fcompare">
                <span>{t('controls.compare')}</span>
                <select value={st.a} onChange={(e) => update({ a: Number(e.target.value) })}>
                  {dates.map((d, i) => <option key={d.date} value={i}>{lab(i)}</option>)}
                </select>
              </label>
              <div className="fview2" role="radiogroup" aria-label={t('controls.polGroup')}>
                {(['HH', 'HV'] as const).map((v) => (
                  <button key={v} role="radio" aria-checked={st.view === v} className={st.view === v ? 'on' : ''} onClick={() => update({ view: v })} title={t(`pol.${v}.title`)}>
                    {expert ? v : t(`pol.${v}.plain`)}
                  </button>
                ))}
                {expert && dates.every((d) => d.layers.RGB) && (
                  <button role="radio" aria-checked={st.view === 'RGB'} className={st.view === 'RGB' ? 'on' : ''} onClick={() => update({ view: 'RGB' })} title={t('pol.RGB.title')}>{t('pol.RGB.expert')}</button>
                )}
              </div>
              <label className="chk"><input type="checkbox" checked={st.water} onChange={(e) => update({ water: e.target.checked })} />{t('controls.water')}</label>
            </div>
            {bodies[st.tab]}
            <p className="foot">{story.credits}</p>
            <button className="cta ghost" onClick={() => setMethods(true)}>{t('methods.button')}</button>
          </div>
        )}
      </aside>

      <div className={`replay-chip fade note ${note ? 'on' : ''}`} role="status" aria-hidden={!note}>{note}</div>
      <FloodTimeline data={data} story={story} a={st.a} b={st.b} setA={(i) => update({ a: i })} setB={(i) => update({ b: i })} playing={playing} onPlay={() => setPlaying(!playing)} expert={expert} />
      {methods && <MethodsDialog data={data} onClose={() => setMethods(false)} />}
    </div>
  )
}
