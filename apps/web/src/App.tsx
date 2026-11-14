import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { DEFAULT_COHERENCE_THRESHOLD } from './config'
import { estimateOffset, sampleProfile } from './lib/analysis'
import { loadIndex, loadStory, ms } from './lib/data'
import { changeProgress } from './lib/progress'
import { compareToModel } from './lib/physics'
import { ImpactPanel } from './Impact'
import MapView from './MapView'
import { Inspector, SidePanel, TopBar } from './Panels'
import type { UiMode } from './Panels'
import { PhysicsCheck, ProfileCard, ProfileControls } from './Scientist'
import { ChangeStat, LosDiagram, ReplayButton, TourButton, TourCard, WhyCards } from './Story'
import Timeline from './Timeline'
import type { Camera, CameraReq, City, LayerDef, LoadedStory, Overlays, StoryIndexEntry, ViewMode } from './types'

function pickLayer(d: LoadedStory, role: LayerDef['role']) {
  const layer = d.story.layers.find((l) => l.role === role)
  if (!layer) throw new Error(`Story "${d.story.id}" has no layer with role "${role}"`)
  return { layer, grid: d.grids[layer.id] }
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
    () => (ok && profile.a && profile.b ? sampleProfile(ok.displacement.grid, ok.coherence.grid, profile.a, profile.b) : null),
    [ok, profile],
  )
  const offset = useMemo(() => (profileData ? estimateOffset(profileData.points, profileData.totalKm) : null), [profileData])

  const physics = useMemo(
    () => (ok && data?.context?.model && data.story.geometry ? compareToModel(ok.displacement.grid, data.context.model, data.story.geometry) : null),
    [ok, data],
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
    prevMode.current = mode
    setMode('fringes')
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
  if (!data || !ok) return <div className="splash"><b>Aevion</b><span>Loading story&hellip;</span></div>

  const { story, context } = data
  const progress = changeProgress(story, cursor, data.flagship?.secondary)
  const showChange = progress >= 1
  const sci = ui === 'scientist'
  const replayBtn = <ReplayButton running={replay != null} onStart={startReplay} onStop={stopReplay} />
  const impact = context && (
    <ImpactPanel context={context} defo={ok.displacement.grid} cov={ok.coherence.grid} ui={ui}
      overlays={overlays} setOverlays={setOverlays} onCity={onCity} />
  )

  return (
    <div className="app">
      <MapView story={story} quakes={data.quakes} context={context} displacement={ok.displacement} coherence={ok.coherence}
        mode={mode} fadeLow={fadeLow} threshold={threshold} progress={progress} secondaryIso={data.flagship?.secondary} cursor={cursor}
        overlays={overlays} camera={cameraReq} picked={picked} onPick={(lon, lat) => setPicked([lon, lat])}
        profile={profile} profileMode={picking}
        onProfilePoint={addProfilePoint}
        replayScale={replay} />
      <TopBar story={story} ui={ui} setUi={switchUi} stories={stories} onSwitchStory={onSwitchStory} />
      <SidePanel story={story} ui={ui} mode={mode} setMode={setMode} fadeLow={fadeLow} setFadeLow={setFadeLow}
        threshold={threshold} setThreshold={setThreshold}
        displacement={ok.displacement.layer} coherence={ok.coherence.layer} flagship={data.flagship}
        slots={sci ? {
          analysis: (
            <>
              <div className="actions">{replayBtn}</div>
              <ProfileControls picking={picking} hasLine={!!profileData}
                onStart={() => { setProfile({ a: null, b: null }); setPicking(true); setPicked(null) }}
                onClear={() => { setProfile({ a: null, b: null }); setPicking(false) }} />
              <PhysicsCheck context={context} result={physics} geometry={story.geometry} overlays={overlays} setOverlays={setOverlays} />
            </>
          ),
          impact,
          los: <LosDiagram sci incidence={story.geometry?.incidenceDeg} azimuth={story.geometry?.lookAzimuthDeg} />,
        } : {
          actions: (
            <div className="actions">
              <ChangeStat layer={ok.displacement.layer} grid={ok.displacement.grid} coherence={ok.coherence.grid} threshold={threshold} />
              <TourButton available={!!story.tour?.length} onStart={() => goTour(0)} />
              {replayBtn}
            </div>
          ),
          impact,
          why: <WhyCards items={story.why} />,
          los: <LosDiagram sci={false} />,
        }} />
      {replay != null && (
        <div className="replay-chip">Illustrative replay: the satellite measured the final result, not the motion as it happened</div>
      )}
      <div className={`replay-chip fade ${replay == null && progress > 0 && progress < 0.97 ? 'on' : ''}`} aria-hidden={progress <= 0 || progress >= 0.97}>
        Illustrative build-up: {story.sensor ?? 'NISAR'} measured only the final result, not the motion in between
      </div>
      {picking && <div className="replay-chip">Click two points on the map to draw a cross-section</div>}
      {picked && !picking && (
        <Inspector point={picked} ui={ui} displacement={ok.displacement} coherence={ok.coherence}
          threshold={threshold} showChange={showChange} sensor={story.sensor} onClose={() => setPicked(null)} />
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
      <Timeline data={data} cursor={cursor} setCursor={setCursor} />
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
