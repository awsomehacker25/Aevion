import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { DEFAULT_COHERENCE_THRESHOLD } from './config'
import { estimateOffset, sampleProfile } from './lib/analysis'
import { loadStory, ms } from './lib/data'
import { compareToModel } from './lib/physics'
import { ImpactPanel } from './Impact'
import MapView from './MapView'
import { Inspector, SidePanel, TopBar } from './Panels'
import type { UiMode } from './Panels'
import { PhysicsCheck, ProfileCard, ProfileControls } from './Scientist'
import { LosDiagram, ReplayButton, TourButton, TourCard, WhyCards } from './Story'
import Timeline from './Timeline'
import type { Camera, CameraReq, City, LayerDef, LoadedStory, Overlays, ViewMode } from './types'

function pickLayer(d: LoadedStory, role: LayerDef['role']) {
  const layer = d.story.layers.find((l) => l.role === role)
  if (!layer) throw new Error(`Story "${d.story.id}" has no layer with role "${role}"`)
  return { layer, grid: d.grids[layer.id] }
}

type Pt = [number, number]
const NO_OVERLAYS: Overlays = { fault: false, shaking: false, cities: false, mechanisms: false }

export default function App() {
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
    const id = new URLSearchParams(location.search).get('story') ?? undefined
    loadStory(id)
      .then((d) => { setData(d); setCursor(ms(d.story.timeline.initial)) })
      .catch((e: Error) => setError(e.message))
  }, [])

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
  useEffect(() => {
    const steps = data?.story.tour
    if (tour == null || !steps?.[tour]) return
    let view: ViewMode | undefined
    let date: string | undefined
    let camera: Camera | undefined
    let ov: Overlays = NO_OVERLAYS
    for (let i = 0; i <= tour; i++) {
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
  }, [tour, data, fly])

  // Cross-section: the second click finishes picking.
  useEffect(() => { if (picking && profile.a && profile.b) setPicking(false) }, [picking, profile])
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
  const showChange = cursor >= ms(`${story.flagshipPair.secondary}T00:00:00Z`)
  const sci = ui === 'scientist'
  const replayBtn = <ReplayButton running={replay != null} onStart={startReplay} onStop={stopReplay} />
  const impact = context && (
    <ImpactPanel context={context} defo={ok.displacement.grid} cov={ok.coherence.grid} ui={ui}
      overlays={overlays} setOverlays={setOverlays} onCity={onCity} />
  )

  return (
    <div className="app">
      <MapView story={story} quakes={data.quakes} context={context} displacement={ok.displacement} coherence={ok.coherence}
        mode={mode} fadeLow={fadeLow} threshold={threshold} showChange={showChange} cursor={cursor}
        overlays={overlays} camera={cameraReq} picked={picked} onPick={(lon, lat) => setPicked([lon, lat])}
        profile={profile} profileMode={picking}
        onProfilePoint={(lon, lat) => setProfile((p) => (!p.a || (p.a && p.b) ? { a: [lon, lat], b: null } : { a: p.a, b: [lon, lat] }))}
        replayScale={replay} />
      <TopBar story={story} ui={ui} setUi={switchUi} />
      <SidePanel story={story} ui={ui} mode={mode} setMode={setMode} fadeLow={fadeLow} setFadeLow={setFadeLow}
        threshold={threshold} setThreshold={setThreshold}
        displacement={ok.displacement.layer} coherence={ok.coherence.layer} flagship={data.flagship}
        top={
          <div className="actions">
            {!sci && <TourButton available={!!story.tour?.length} onStart={() => setTour(0)} />}
            {replayBtn}
          </div>
        }>
        {sci ? (
          <>
            <ProfileControls picking={picking} hasLine={!!profileData}
              onStart={() => { setProfile({ a: null, b: null }); setPicking(true); setPicked(null) }}
              onClear={() => { setProfile({ a: null, b: null }); setPicking(false) }} />
            <PhysicsCheck context={context} result={physics} geometry={story.geometry} overlays={overlays} setOverlays={setOverlays} />
            {impact}
            <LosDiagram sci incidence={story.geometry?.incidenceDeg} azimuth={story.geometry?.lookAzimuthDeg} />
          </>
        ) : (
          <>
            {impact}
            <WhyCards items={story.why} />
            <LosDiagram sci={false} />
          </>
        )}
      </SidePanel>
      {replay != null && (
        <div className="replay-chip">Illustrative replay: NISAR measured the final result, not the shaking itself</div>
      )}
      {picking && <div className="replay-chip">Click two points on the map to draw a cross-section</div>}
      {picked && !picking && (
        <Inspector point={picked} ui={ui} displacement={ok.displacement} coherence={ok.coherence}
          threshold={threshold} showChange={showChange} onClose={() => setPicked(null)} />
      )}
      {sci && profileData && profile.a && profile.b && (
        <ProfileCard points={profileData.points} totalKm={profileData.totalKm} offset={offset} threshold={threshold}
          a={profile.a} b={profile.b} onClose={() => setProfile({ a: null, b: null })} />
      )}
      {!sci && tour != null && story.tour && (
        <TourCard steps={story.tour} index={tour}
          onPrev={() => setTour((t) => Math.max(0, (t ?? 0) - 1))}
          onNext={() => setTour((t) => Math.min(story.tour!.length - 1, (t ?? 0) + 1))}
          onExit={() => setTour(null)} />
      )}
      <Timeline data={data} cursor={cursor} setCursor={setCursor} />
    </div>
  )
}
