import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { DEFAULT_COHERENCE_THRESHOLD, EVENT, TEAM } from './config'
import { estimateOffset, sampleProfile } from './lib/analysis'
import { loadIndex, loadStory, ms } from './lib/data'
import { epochLayer, epochStory, isFeatured, labelledStory } from './lib/epochs'
import { computeVentMotion, epochFor, sortEpochs } from './lib/periods'
import { changeProgress } from './lib/progress'
import { compareToModel } from './lib/physics'
import { EpochChart, PeriodList, PeriodSwitcher } from './Epochs'
import { ImpactPanel } from './Impact'
import MapView from './MapView'
import { Inspector, SidePanel, TopBar } from './Panels'
import type { UiMode } from './Panels'
import { PhysicsCheck, ProfileCard, ProfileControls } from './Scientist'
import { ChangeStat, LosDiagram, ReplayButton, TourButton, TourCard, WhyCards } from './Story'
import Timeline from './Timeline'
import type { Camera, CameraReq, City, EventMark, Grid, LayerDef, LoadedStory, Overlays, StoryIndexEntry, ViewMode } from './types'

function pickLayer(d: LoadedStory, role: LayerDef['role']) {
  const layer = d.story.layers.find((l) => l.role === role)
  if (!layer) throw new Error(`Story "${d.story.id}" has no layer with role "${role}"`)
  return { layer, grid: d.grids[layer.id] }
}

/** A layer a story may or may not have. */
function pickOptional(d: LoadedStory, role: LayerDef['role']) {
  const layer = d.story.layers.find((l) => l.role === role)
  return layer && d.grids[layer.id] ? { layer, grid: d.grids[layer.id] } : undefined
}

type Pt = [number, number]
const NO_OVERLAYS: Overlays = { fault: false, shaking: false, cities: false, mechanisms: false }

interface ViewerProps {
  id?: string
  stories: StoryIndexEntry[]
  onSwitchStory: (id: string) => void
}

/** One story. It is re-created (with fresh state) whenever the story changes. */
function Viewer({ id, stories, onSwitchStory }: ViewerProps) {
  const [data, setData] = useState<LoadedStory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [ui, setUi] = useState<UiMode>('story')
  const [mode, setMode] = useState<ViewMode>('los')
  const [fadeLow, setFadeLow] = useState(true)
  const [threshold, setThreshold] = useState(DEFAULT_COHERENCE_THRESHOLD)
  const [picked, setPicked] = useState<Pt | null>(null)
  const [overlays, setOverlays] = useState<Overlays>(NO_OVERLAYS)
  const [tour, setTour] = useState<number | null>(null)
  const [cameraReq, setCameraReq] = useState<CameraReq | null>(null)
  const [profile, setProfile] = useState<{ a: Pt | null; b: Pt | null }>({ a: null, b: null })
  const [picking, setPicking] = useState(false)
  const [replay, setReplay] = useState<number | null>(null)
  const [swipe, setSwipe] = useState(false)
  const [note, setNote] = useState<string | null>(null) // a short message that fades out by itself
  const noteTimer = useRef(0)
  const [epochId, setEpochId] = useState<string | null>(null) // null = the featured period
  const replayRaf = useRef(0)
  const prevMode = useRef<ViewMode>('los')

  useEffect(() => {
    loadStory(id)
      .then((d) => {
        setData(d)
        setCursor(ms(d.story.timeline.initial))
        if (d.story.defaultThreshold != null) setThreshold(d.story.defaultThreshold)
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  useEffect(() => () => cancelAnimationFrame(replayRaf.current), [])

  const layers = useMemo(() => {
    if (!data) return null
    try { return { displacement: pickLayer(data, 'displacement'), coherence: pickLayer(data, 'coherence') } }
    catch (e) { return { error: (e as Error).message } }
  }, [data])
  const ok = layers && !('error' in layers) ? layers : null
  const radar = useMemo(() => (data ? { hh: pickOptional(data, 'backscatterHH'), hv: pickOptional(data, 'backscatterHV') } : null), [data])

  // Stories that follow the timeline show the latest measured period up to the cursor (before the first one, the first).
  const follow = !!data?.story.copy?.followTimeline
  const shownEpochId = useMemo(() => {
    const eps = data?.story.epochs
    if (!follow || !data || !eps?.length) return epochId
    let pick = sortEpochs(eps)[0]
    for (const e of sortEpochs(eps)) if (ms(`${e.pair.secondary}T00:00:00Z`) <= cursor) pick = e
    return isFeatured(data.story, pick) ? null : pick.id
  }, [follow, data, cursor, epochId])

  // What is on screen: the featured period, or another measured period the viewer picked.
  const view = useMemo(() => {
    if (!data || !ok || !radar) return null
    const e = shownEpochId ? data.story.epochs?.find((x) => x.id === shownEpochId) : undefined
    const g = e ? data.epochGrids?.[e.id] : undefined
    // a story that follows the timeline cross-fades into the next measured period
    let next: { displacement: { layer: LayerDef; grid: Grid }; coherence: { layer: LayerDef; grid: Grid }; radarHV?: { layer: LayerDef; grid: Grid }; radarHH?: { layer: LayerDef; grid: Grid }; from: number; to: number } | undefined
    if (data.story.copy?.followTimeline && data.story.epochs?.length) {
      const rows = sortEpochs(data.story.epochs)
      const cur = e ?? rows.find((x) => isFeatured(data.story, x))
      const nx = cur ? rows[rows.indexOf(cur) + 1] : undefined
      const ng = nx ? (isFeatured(data.story, nx) ? { deformation: ok.displacement.grid, coherence: ok.coherence.grid, hv: radar.hv?.grid, hh: radar.hh?.grid } : data.epochGrids?.[nx.id]) : undefined
      if (cur && nx && ng) {
        next = { displacement: { layer: ok.displacement.layer, grid: ng.deformation }, coherence: { layer: ok.coherence.layer, grid: ng.coherence },
          radarHV: radar.hv && ng.hv ? { layer: radar.hv.layer, grid: ng.hv } : undefined,
          radarHH: radar.hh && ng.hh ? { layer: radar.hh.layer, grid: ng.hh } : undefined, from: ms(`${cur.pair.secondary}T00:00:00Z`), to: ms(`${nx.pair.secondary}T00:00:00Z`) }
      }
    }
    if (!e || !g || isFeatured(data.story, e)) {
      const featured = e ?? data.story.epochs?.find((x) => isFeatured(data.story, x))
      return { story: labelledStory(data.story, featured), displacement: ok.displacement, coherence: ok.coherence, flagship: data.flagship, radar, next }
    }
    const f = data.story.flagshipPair
    const pair = data.pairs.find((p) => p.track === f.track && p.orbitDirection === f.orbitDirection &&
      p.reference.startsWith(e.pair.reference) && p.secondary.startsWith(e.pair.secondary))
    return {
      story: epochStory(data.story, e),
      displacement: { layer: epochLayer(ok.displacement.layer, e, pair), grid: g.deformation },
      coherence: { layer: ok.coherence.layer, grid: g.coherence },
      flagship: pair,
      radar: {
        hh: radar.hh && g.hh ? { layer: radar.hh.layer, grid: g.hh } : undefined,
        hv: radar.hv && g.hv ? { layer: radar.hv.layer, grid: g.hv } : undefined,
      },
      next,
    }
  }, [data, ok, radar, shownEpochId])

  // Switch to another measured period: its grids, its event, and a timeline window around it.
  const selectEpoch = useCallback((id: string) => {
    const e = data?.story.epochs?.find((x) => x.id === id)
    if (!data || !e) return
    const featured = isFeatured(data.story, e)
    const st = featured ? data.story : epochStory(data.story, e)
    setEpochId(featured ? null : id)
    setCursor(data.story.copy?.followTimeline ? ms(`${e.pair.secondary}T12:00:00Z`) : ms(st.timeline.initial))
    setTour(null)
    setPicked(null)
    setProfile({ a: null, b: null })
    setPicking(false)
    if (!featured && !data.story.copy?.followTimeline) setMode((m) => (m === 'hh' || m === 'hv' ? 'los' : m))
  }, [data])

  const flashNote = useCallback((msg: string) => {
    setNote(msg)
    window.clearTimeout(noteTimer.current)
    noteTimer.current = window.setTimeout(() => setNote(null), 5000)
  }, [])
  useEffect(() => () => window.clearTimeout(noteTimer.current), [])

  const selectedEpochId = data?.story.epochs?.find((e) => (shownEpochId ? e.id === shownEpochId : isFeatured(data.story, e)))?.id ?? ''
  const ventMotion = useMemo(() => (data ? computeVentMotion(data.story, data.epochGrids) : null), [data])
  // A click on an eruption dot: go to its NISAR period if one was processed, otherwise just go to the date and say so.
  const onEpisode = useCallback((e: EventMark, t: number) => {
    const ep = data ? epochFor(data.story, t) : undefined
    if (ep) selectEpoch(ep.id)
    setCursor(t)
    if (!ep) flashNote(`No NISAR period has been processed for ${e.name}, so there is no measured change to show for it.`)
  }, [data, selectEpoch, flashNote])
  const stepEpoch = useCallback((delta: number) => {
    const rows = data?.story.epochs ? sortEpochs(data.story.epochs) : []
    const i = rows.findIndex((e) => e.id === selectedEpochId)
    const next = rows[i + delta]
    if (i >= 0 && next) selectEpoch(next.id)
  }, [data, selectedEpochId, selectEpoch])

  // Left and right arrow keys step between periods when nothing else on the page is using them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
      const el = document.activeElement
      if (el && el !== document.body && !(el instanceof HTMLButtonElement && el.closest('.pswitch'))) return
      stepEpoch(e.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stepEpoch])

  const fly = useCallback((camera: Camera) => {
    setCameraReq((r) => ({ nonce: (r?.nonce ?? 0) + 1, camera }))
  }, [])

  // Each tour step defines the whole scene: replay the steps up to this one so going back works too.
  const goTour = useCallback((index: number) => {
    const steps = data?.story.tour
    if (!steps?.[index]) return
    setTour(index)
    let view: ViewMode | undefined
    let date: string | undefined
    let camera: Camera | undefined
    let ov: Overlays = NO_OVERLAYS
    for (let i = 0; i <= index; i++) {
      const st = steps[i]
      view = st.view ?? view
      date = st.date ?? date
      camera = st.camera ?? camera
      ov = { ...ov, ...st.overlays }
    }
    if (view) setMode(view)
    if (date) setCursor(ms(date))
    if (camera) fly(camera)
    setOverlays(ov)
  }, [data, fly])

  // Cross-section: the first click starts a line, the second finishes it (and ends picking).
  const addProfilePoint = (lon: number, lat: number) => {
    if (!profile.a || profile.b) { setProfile({ a: [lon, lat], b: null }); return }
    setProfile({ a: profile.a, b: [lon, lat] })
    setPicking(false)
  }
  const profileData = useMemo(
    () => (view && profile.a && profile.b ? sampleProfile(view.displacement.grid, view.coherence.grid, profile.a, profile.b) : null),
    [view, profile],
  )
  const offset = useMemo(() => (profileData ? estimateOffset(profileData.points, profileData.totalKm) : null), [profileData])

  const physics = useMemo(
    () => (view && data?.context?.model && data.story.geometry ? compareToModel(view.displacement.grid, data.context.model, data.story.geometry) : null),
    [view, data],
  )

  const switchUi = (m: UiMode) => {
    if (m === 'story') { setPicking(false); setProfile({ a: null, b: null }) } else { setTour(null) }
    setUi(m)
  }

  // Illustrative replay: the displacement scales 0 -> 1 so the fringes grow. NISAR itself only saw the end result.
  const stopReplay = useCallback(() => {
    cancelAnimationFrame(replayRaf.current)
    setReplay(null)
    setMode(prevMode.current)
  }, [])
  const startReplay = () => {
    const radarStory = data?.story.kind === 'backscatter'
    // a radar-picture story replays its "what changed" view growing from nothing; it needs that view for this period
    if (radarStory && !view?.radar.hh) { flashNote('There is no change picture for this pass, because there is no earlier pass to compare with.'); return }
    prevMode.current = mode
    setMode(radarStory ? 'hh' : 'fringes')
    const t0 = performance.now()
    let lastDraw = 0
    const DURATION = 7000
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / DURATION)
      if (t >= 1) { setReplay(null); setMode(prevMode.current); return }
      if (now - lastDraw >= 50) {
        lastDraw = now
        setReplay(t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)
      }
      replayRaf.current = requestAnimationFrame(step)
    }
    replayRaf.current = requestAnimationFrame(step)
  }

  const onCity = (c: City) => {
    fly({ center: [c.lon, c.lat], zoom: 10.3, pitch: 50, bearing: -10 })
    setPicked([c.lon, c.lat])
  }

  if (error) return <div className="splash"><b>Could not load the story.</b><span>{error}</span></div>
  if (layers && 'error' in layers) return <div className="splash"><b>Story is not valid.</b><span>{layers.error}</span></div>
  if (!data || !ok || !view) return <div className="splash"><img className="splash-logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="Aevion" /><span>Loading story&hellip;</span><small className="splash-team">{EVENT}</small><small className="splash-names">Built by {TEAM.slice(0, -1).join(', ')} and {TEAM[TEAM.length - 1]}</small></div>

  const { story, flagship: viewPair } = view
  // A radar view that this period does not have (for example HV on a period without it) falls back to the main view.
  const shownMode: ViewMode = (mode === 'hh' && !view.radar.hh) || (mode === 'hv' && !view.radar.hv) ? 'los' : mode
  const { context } = data
  const progress = changeProgress(story, cursor, viewPair?.secondary)
  const showChange = progress >= 1
  const sci = ui === 'scientist'
  const bs = story.kind === 'backscatter'
  const replayBtn = <ReplayButton running={replay != null} onStart={startReplay} onStop={stopReplay} />
  const swipeBtn = (
    <button className="cta ghost" aria-pressed={swipe} onClick={() => {
      if (!swipe && progress < 1) setCursor(ms(story.timeline.initial)) // there must be a measured change to compare against
      setSwipe(!swipe)
    }}>{swipe ? 'Hide swipe' : 'Before / after'}</button>
  )
  const epochs = data.story.epochs
  const periodsTab = epochs?.length ? (
    <>
      {ventMotion && <EpochChart epochs={epochs} motion={ventMotion} selected={selectedEpochId} onSelect={selectEpoch} chart={story.copy?.chart} />}
      <h2>{story.copy?.periodsHeading ?? 'All periods'}</h2>
      <PeriodList epochs={epochs} motion={ventMotion} selected={selectedEpochId} onSelect={selectEpoch} chart={story.copy?.chart} />
    </>
  ) : undefined
  const periodSwitcher = epochs?.length ? (
    <PeriodSwitcher epochs={epochs} motion={ventMotion} selected={selectedEpochId} onSelect={selectEpoch} onStep={stepEpoch} chart={story.copy?.chart} />
  ) : undefined
  const timelineData = { ...data, story, flagship: viewPair }
  const impact = context && (
    <ImpactPanel context={context} defo={view.displacement.grid} cov={view.coherence.grid} ui={ui}
      overlays={overlays} setOverlays={setOverlays} onCity={onCity} />
  )

  return (
    <div className="app">
      <MapView story={story} quakes={data.quakes} context={context} displacement={view.displacement} coherence={view.coherence}
        radarHH={view.radar.hh} radarHV={view.radar.hv} next={view.next}
        mode={shownMode} fadeLow={fadeLow} threshold={threshold} progress={progress} secondaryIso={viewPair?.secondary} swipe={swipe} cursor={cursor}
        overlays={overlays} camera={cameraReq} picked={picked} onPick={(lon, lat) => setPicked([lon, lat])}
        profile={profile} profileMode={picking}
        onProfilePoint={addProfilePoint}
        replayScale={replay} />
      <button className="recenter" onClick={() => fly({ center: story.aoi.center, zoom: story.aoi.zoom, pitch: story.aoi.pitch, bearing: story.aoi.bearing })}
        title="Fly back to the start of this story" aria-label="Recenter the map on this story">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        Recenter
      </button>
      <TopBar story={story} ui={ui} setUi={switchUi} stories={stories} onSwitchStory={onSwitchStory} />
      <SidePanel story={story} ui={ui} mode={shownMode} setMode={setMode} fadeLow={fadeLow} setFadeLow={setFadeLow}
        threshold={threshold} setThreshold={setThreshold}
        displacement={view.displacement.layer} coherence={view.coherence.layer} flagship={viewPair}
        radar={{ hh: view.radar.hh?.layer, hv: view.radar.hv?.layer }}
        slots={sci ? {
          analysis: (
            <>
              <div className="row-btns">{swipeBtn}{replayBtn}</div>
              {!bs && <ProfileControls picking={picking} hasLine={!!profileData}
                onStart={() => { setProfile({ a: null, b: null }); setPicking(true); setPicked(null) }}
                onClear={() => { setProfile({ a: null, b: null }); setPicking(false) }} />}
              <PhysicsCheck context={context} result={physics} geometry={story.geometry} overlays={overlays} setOverlays={setOverlays} />
            </>
          ),
          impact,
          periods: periodsTab,
          los: bs ? undefined : <LosDiagram sci incidence={story.geometry?.incidenceDeg} azimuth={story.geometry?.lookAzimuthDeg} />,
        } : {
          actions: (
            <div className="actions">
              <TourButton available={!!story.tour?.length} onStart={() => goTour(0)} />
              <div className="row-btns">{swipeBtn}{replayBtn}</div>
              {!bs && <ChangeStat layer={view.displacement.layer} grid={view.displacement.grid} coherence={view.coherence.grid} threshold={threshold} />}
            </div>
          ),
          impact,
          periods: periodsTab,
          why: <WhyCards items={story.why} />,
          los: bs ? undefined : <LosDiagram sci={false} />,
        }} />
      {replay != null && (
        <div className="replay-chip">{bs
          ? 'Illustrative replay: NISAR took one picture every 12 days, not the change in between'
          : 'Illustrative replay: the satellite measured the final result, not the motion as it happened'}</div>
      )}
      <div className={`replay-chip fade ${replay == null && progress > 0 && progress < 0.97 ? 'on' : ''}`} aria-hidden={progress <= 0 || progress >= 0.97}>
        {!bs && <>Illustrative build-up: {story.sensor ?? 'NISAR'} measured only the final result, not the motion in between</>}
      </div>
      <div className={`replay-chip fade note ${note ? 'on' : ''}`} role="status" aria-hidden={!note}>{note}</div>
      {picking && <div className="replay-chip">Click two points on the map to draw a cross-section</div>}
      {picked && !picking && (
        <Inspector point={picked} ui={ui} displacement={view.displacement} coherence={view.coherence}
          threshold={threshold} showChange={showChange} sensor={story.sensor} kind={story.kind} radar={view.radar} onClose={() => setPicked(null)} />
      )}
      {sci && profileData && profile.a && profile.b && (
        <ProfileCard points={profileData.points} totalKm={profileData.totalKm} offset={offset} threshold={threshold}
          a={profile.a} b={profile.b} onClose={() => setProfile({ a: null, b: null })} />
      )}
      {!sci && tour != null && story.tour && (
        <TourCard steps={story.tour} index={tour}
          onPrev={() => goTour(Math.max(0, tour - 1))}
          onNext={() => goTour(Math.min(story.tour!.length - 1, tour + 1))}
          onExit={() => setTour(null)} />
      )}
      <Timeline data={timelineData} cursor={cursor} setCursor={setCursor} headExtra={periodSwitcher} onEpisode={onEpisode} />
    </div>
  )
}

export default function App() {
  const [stories, setStories] = useState<StoryIndexEntry[]>([])
  const [id, setId] = useState<string | undefined>(() => new URLSearchParams(location.search).get('story') ?? undefined)

  useEffect(() => { loadIndex().then(setStories).catch(() => setStories([])) }, [])

  const switchStory = (next: string) => {
    const url = new URL(location.href)
    url.searchParams.set('story', next)
    history.replaceState(null, '', url)
    setId(next)
  }

  return <Viewer key={id ?? 'default'} id={id} stories={stories} onSwitchStory={switchStory} />
}
