import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import './Extras.css'
import { DEFAULT_COHERENCE_THRESHOLD, EVENT, TEAM } from './config'
import { estimateOffset, sampleProfile } from './lib/analysis'
import { loadIndex, loadStory, ms, sampleGrid } from './lib/data'
import { epochLayer, epochStory, isFeatured, labelledStory } from './lib/epochs'
import { computeVentMotion, epochFor, sortEpochs } from './lib/periods'
import { changeProgress } from './lib/progress'
import { compareToModel } from './lib/physics'
import { EpochChart, PeriodList, PeriodSwitcher } from './Epochs'
import { ImpactPanel } from './Impact'
import MapView from './MapView'
import type { MapExtras } from './MapView'
import type { MixOpts } from './lib/render'
import { Inspector, SidePanel, TopBar } from './Panels'
import { useTheme } from './theme'
import { Logo } from './Logo'
import type { UiMode } from './Panels'
import { PhysicsCheck, ProfileCard, ProfileControls } from './Scientist'
import { ChangeStat, LosDiagram, ReplayButton, TourButton, TourCard, WhyCards } from './Story'
import Timeline from './Timeline'
import StoryCharts from './StoryCharts'
import { epochCode, epochFromCode, readLink, shortDate, writeLink } from './lib/link'
import { DEFAULT_LAYERS, EXCLUSIVE, FloodImpact, FloodLayersPanel, FloodLegendKey, FloodMethods, FloodPointExtra, FloodSummary, FloodTimelineRow, FloodCharts } from './FloodExtras'
import type { FloodLayers } from './FloodExtras'
import { I18nProvider, initialLang, useI18n } from './i18n'
import type { Lang } from './i18n'
import { offers, useLocalizedStory } from './lib/localize'
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
  /** The mode (Story or Scientist) carries over when another story is chosen. */
  initialUi: UiMode
  onUiChange: (m: UiMode) => void
}

/** One story. It is re-created (with fresh state) whenever the story changes. */
function Viewer({ id, stories, onSwitchStory, initialUi, onUiChange }: ViewerProps) {
  const { t } = useI18n()
  const theme = useTheme()
  const [raw, setRaw] = useState<LoadedStory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [ui, setUi] = useState<UiMode>(initialUi)
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
  const [compareId, setCompareId] = useState<string | null>(null) // the period west of the swipe line, when the story compares two dates
  const [fl, setFl] = useState<FloodLayers>(DEFAULT_LAYERS) // the flood story's extra map layers
  const [preset, setPreset] = useState<string | null>(null)
  const [pin, setPin] = useState<string | null>(null)
  const [methods, setMethods] = useState(false)
  const [tabReq, setTabReq] = useState<{ id: string; nonce: number } | null>(null)
  const [panelTab, setPanelTab] = useState<string | null>(null) // the open side-panel tab, for the shared link
  const [initialTab, setInitialTab] = useState<string | undefined>(undefined)
  const replayRaf = useRef(0)
  const prevMode = useRef<ViewMode>('los')

  useEffect(() => {
    loadStory(id)
      .then((d) => {
        setRaw(d)
        setCursor(ms(d.story.timeline.initial))
        if (d.story.defaultThreshold != null) setThreshold(d.story.defaultThreshold)
        if (d.story.copy?.defaultView) setMode(d.story.copy.defaultView)
        setCompareId(d.story.copy?.compareDefault ?? null)
        // a shared link can carry the view (v), the date (d) and the measured period (p)
        const h = readLink()
        const epId = epochFromCode(h.p, (d.story.epochs ?? []).map((e) => e.id))
        const ep = d.story.epochs?.find((e) => e.id === epId)
        if (ep && !isFeatured(d.story, ep)) setEpochId(ep.id)
        if (h.t) setInitialTab(h.t)
        const v = h.v as ViewMode | null
        if (v && ['los', 'fringes', 'coherence', 'hh', 'hv', 'mix'].includes(v)) setMode(v)
        const t0 = Date.parse(`${h.d}T12:00:00Z`)
        if (Number.isFinite(t0) && t0 >= ms(d.story.timeline.start) && t0 <= ms(d.story.timeline.end)) setCursor(t0)
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  // the story in the viewer's language: the English story with that language's text laid over it
  const localized = useLocalizedStory(raw?.story.id ?? '', raw?.story)
  const data = useMemo(() => (raw && localized ? { ...raw, story: localized } : raw), [raw, localized])

  useEffect(() => () => cancelAnimationFrame(replayRaf.current), [])

  // keep the link current (view, date, period) once the viewer stops moving
  useEffect(() => {
    if (!raw || replay != null) return
    const h = window.setTimeout(() => {
      writeLink({ v: mode, d: shortDate(new Date(cursor).toISOString().slice(0, 10)), t: panelTab, p: epochId ? epochCode(epochId) : null })
    }, 400)
    return () => window.clearTimeout(h)
  }, [raw, mode, cursor, epochId, replay, panelTab])

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
  // the flood story's extra layers, passed to the map; the people layer follows the date on screen
  const bIso = data?.story.epochs?.find((e) => e.id === selectedEpochId)?.pair.secondary
  const openTab = useCallback((id: string) => setTabReq((r) => ({ id, nonce: (r?.nonce ?? 0) + 1 })), [])
  const onPinClick = useCallback((id: string) => { setPin(id); setFl((l) => ({ ...l, pins: true })); openTab('impact') }, [openTab])
  const extras: MapExtras | undefined = useMemo(() => {
    const fd = data?.floodData
    if (!fd) return undefined
    const ctx = fd.flood.context
    const pop = ctx.population
    const images: MapExtras['images'] = [
      ...(ctx.sentinel1 ? [{ id: 'sentinel1', url: ctx.sentinel1.url, opacity: 1, above: false }] : []),
      ...(ctx.sentinel2 ? [{ id: 'optical', url: ctx.sentinel2.url, opacity: 1, above: false }] : []),
      ...(pop ? [{ id: 'population', url: (bIso && pop.by_date[bIso]?.url) || pop.url, opacity: 0.9, resampling: 'nearest' as const, above: false }] : []),
      ...(ctx.aftermath ? [{ id: 'aftermath', url: ctx.aftermath.url, opacity: 0.9, resampling: 'nearest' as const, above: true }] : []),
      ...(ctx.permanent_water ? [{ id: 'permwater', url: ctx.permanent_water.url, opacity: 1, resampling: 'nearest' as const, above: true }] : []),
    ]
    const whole = fl.optical || fl.sentinel1 || fl.population
    return { districts: fd.districts ?? undefined, pins: fd.pins ?? undefined, images, visible: fl as unknown as Record<string, boolean>, onPin: onPinClick, hideData: whole && mode !== 'hh' }
  }, [data, fl, bIso, mode, onPinClick])
  const setLayer = (l: keyof FloodLayers, on: boolean) => setFl((cur) => {
    const next = { ...cur, [l]: on }
    if (on && (EXCLUSIVE as readonly string[]).includes(l)) for (const o of EXCLUSIVE) if (o !== l) next[o] = false
    return next
  })
  // A click on an eruption dot: go to its NISAR period if one was processed, otherwise just go to the date and say so.
  const onEpisode = useCallback((e: EventMark, time: number) => {
    const ep = data ? epochFor(data.story, time) : undefined
    if (ep) selectEpoch(ep.id)
    setCursor(time)
    if (!ep) flashNote(t('s.note.noPeriod', { name: e.name }))
  }, [data, selectEpoch, flashNote, t])
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
    if (m === 'story') { setPicking(false); setProfile({ a: null, b: null }); setFl((l) => ({ ...l, sentinel1: false })) } else { setTour(null) }
    setUi(m)
    onUiChange(m)
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
    if (radarStory && !view?.radar.hh) { flashNote(t('s.note.noChange')); return }
    prevMode.current = mode
    setMode(radarStory ? 'hh' : 'fringes')
    setReplay(0) // start from an empty map in the same render, so the finished picture never flashes first
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

  if (error) return <div className="splash"><b>{t('s.err.load')}</b><span>{error}</span></div>
  if (layers && 'error' in layers) return <div className="splash"><b>{t('s.err.invalid')}</b><span>{layers.error}</span></div>
  if (!data || !ok || !view) return <div className="splash"><Logo variant="stacked" height={150} className="splash-logo" /><span>{t('loading')}</span><small className="splash-team">{EVENT}</small><small className="splash-names">{t('s.builtBy')} {t('s.team', { names: TEAM.slice(0, -1).join(', '), last: TEAM[TEAM.length - 1] })}</small></div>

  const { story, flagship: viewPair } = view
  // A radar view that this period does not have (for example HV on a period without it) falls back to the main view.
  // the colour mix needs both channels: the echo pictures (radar-picture stories) or both change pictures
  const mixKind: 'echo' | 'change' | undefined = view.displacement.layer.colormap === 'gray' ? (view.radar.hv ? 'echo' : undefined) : view.radar.hh && view.radar.hv ? 'change' : undefined
  const mixOpts: MixOpts | undefined = mixKind === 'echo' && view.radar.hv
    ? { kind: 'echo', hh: view.displacement.grid, hv: view.radar.hv.grid, rHH: view.displacement.layer.range, rHV: view.radar.hv.layer.range }
    : mixKind === 'change' && view.radar.hh && view.radar.hv
      ? { kind: 'change', hh: view.radar.hh.grid, hv: view.radar.hv.grid, rHH: view.radar.hh.layer.range, rHV: view.radar.hv.layer.range }
      : undefined
  const shownMode: ViewMode = (mode === 'hh' && !view.radar.hh) || (mode === 'hv' && !view.radar.hv) || (mode === 'mix' && !mixOpts) ? 'los' : mode
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
    }}>{swipe ? t('s.swipe.hide') : t('s.swipe.show')}</button>
  )
  const epochs = data.story.epochs
  // Two-date compare: the period chosen in the picker is drawn west of the swipe line, the selected period east of it.
  const cmpEpoch = compareId && compareId !== selectedEpochId ? epochs?.find((e) => e.id === compareId) : undefined
  const cg = cmpEpoch ? data.epochGrids?.[cmpEpoch.id] : undefined
  const selLabel = epochs?.find((e) => e.id === selectedEpochId)?.label ?? ''
  const compare = cmpEpoch && cg
    ? {
        displacement: { layer: view.displacement.layer, grid: cg.deformation },
        coherence: view.coherence,
        radarHH: cg.hh && view.radar.hh ? { layer: view.radar.hh.layer, grid: cg.hh } : undefined,
        radarHV: cg.hv && view.radar.hv ? { layer: view.radar.hv.layer, grid: cg.hv } : undefined,
        mix: mixKind === 'echo' && cg.hv && view.radar.hv
          ? { kind: 'echo' as const, hh: cg.deformation, hv: cg.hv, rHH: view.displacement.layer.range, rHV: view.radar.hv.layer.range }
          : mixKind === 'change' && cg.hh && cg.hv && view.radar.hh && view.radar.hv
            ? { kind: 'change' as const, hh: cg.hh, hv: cg.hv, rHH: view.radar.hh.layer.range, rHV: view.radar.hv.layer.range }
            : undefined,
        labels: [cmpEpoch.label, selLabel] as [string, string],
      }
    : undefined
  const compareSelect = story.copy?.compareDefault && swipe && epochs ? (
    <label className="compare-pick">
      <span>{t('s.compare.with')}</span>
      <select value={compareId ?? ''} onChange={(e) => setCompareId(e.target.value)}>
        {epochs.filter((e) => e.id !== selectedEpochId).map((e) => <option key={e.id} value={e.id}>{e.label}{e.title ? ` · ${e.title}` : ''}</option>)}
      </select>
    </label>
  ) : null
  // The flood analysis (Upper Assam): index of the pass on screen and of the compare pass in the flood manifest
  const fd = data.floodData
  const fdates = fd?.flood.dates ?? []
  const bIdx = Math.max(0, fdates.findIndex((d) => d.date === bIso))
  const aIdx = Math.max(0, fdates.findIndex((d) => d.date === (cmpEpoch?.pair.secondary ?? fd?.flood.reference)))
  const fcommon = fd ? { data: fd, story: data.story, expert: sci, b: bIdx } : null
  const onPreset = (id: string) => {
    const pr = fd?.flood.presets.find((x) => x.id === id)
    if (!pr) return
    const ep = epochs?.find((e) => e.pair.secondary === pr.date)
    if (ep) selectEpoch(ep.id)
    setPreset(id)
    setPicked([pr.lng, pr.lat])
    fly({ center: [pr.lng, pr.lat], zoom: 12, pitch: story.aoi.pitch, bearing: 0 })
  }
  const onShowPin = (id: string) => {
    const f = fd?.pins?.features.find((x) => (x.properties as { id: string }).id === id)
    if (!f) return
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates
    setPin(id)
    setFl((l) => ({ ...l, pins: true }))
    fly({ center: [lng, lat], zoom: 12, pitch: story.aoi.pitch, bearing: 0 })
  }
  const waterAt = (iso: string) => {
    const g = data.epochGrids?.[`ep-${iso}`]?.hh
    return g && picked ? sampleGrid(g, picked[0], picked[1]) : null
  }
  const methodsBtn = fd ? <button className="cta ghost" onClick={() => setMethods(true)}>{t('methods.button')}</button> : null
  const periodsTab = epochs?.length ? (
    <>
      {ventMotion && <EpochChart epochs={epochs} motion={ventMotion} selected={selectedEpochId} onSelect={selectEpoch} chart={story.copy?.chart} />}
      <h2>{story.copy?.periodsHeading ?? t('s.periods.all')}</h2>
      <PeriodList epochs={epochs} motion={ventMotion} selected={selectedEpochId} onSelect={selectEpoch} chart={story.copy?.chart} />
    </>
  ) : undefined
  const periodSwitcher = epochs?.length ? (
    <PeriodSwitcher epochs={epochs} motion={ventMotion} selected={selectedEpochId} onSelect={selectEpoch} onStep={stepEpoch} chart={story.copy?.chart} />
  ) : undefined
  const charts = fcommon ? <FloodCharts {...fcommon} point={picked} onPreset={onPreset} activePreset={preset} /> : (
    <StoryCharts data={data} displacement={view.displacement.grid} coherence={view.coherence.grid} scale={view.displacement.layer.displayScale}
      unit={view.displacement.layer.displayUnits} threshold={threshold} picked={picked} sci={sci} />
  )
  const timelineData = { ...data, story, flagship: viewPair }
  const impact = fcommon ? <FloodImpact {...fcommon} onShow={onShowPin} selectedPin={pin} /> : context && (
    <ImpactPanel context={context} defo={view.displacement.grid} cov={view.coherence.grid} ui={ui}
      overlays={overlays} setOverlays={setOverlays} onCity={onCity} />
  )

  return (
    <div className="app">
      <MapView story={story} quakes={data.quakes} context={context} displacement={view.displacement} coherence={view.coherence}
        radarHH={view.radar.hh} radarHV={view.radar.hv} mix={mixOpts} compare={compare} extras={extras} next={view.next}
        mode={shownMode} fadeLow={fadeLow} threshold={threshold} progress={progress} secondaryIso={viewPair?.secondary} swipe={swipe} cursor={cursor}
        overlays={overlays} camera={cameraReq} picked={picked} onPick={(lon, lat) => setPicked([lon, lat])}
        profile={profile} profileMode={picking}
        onProfilePoint={addProfilePoint}
        replayScale={replay} />
      <button className="recenter" onClick={() => fly({ center: story.aoi.center, zoom: story.aoi.zoom, pitch: story.aoi.pitch, bearing: story.aoi.bearing })}
        title={t('s.recenter.tip')} aria-label={t('s.recenter.aria')}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        {t('s.recenter')}
      </button>
      <TopBar story={story} ui={ui} setUi={switchUi} stories={stories} onSwitchStory={onSwitchStory} languages={stories.find((x) => x.id === story.id)?.languages} theme={theme} />
      <SidePanel story={story} ui={ui} mode={shownMode} setMode={setMode} fadeLow={fadeLow} setFadeLow={setFadeLow}
        threshold={threshold} setThreshold={setThreshold}
        displacement={view.displacement.layer} coherence={view.coherence.layer} flagship={viewPair}
        radar={{ hh: view.radar.hh?.layer, hv: view.radar.hv?.layer }} mix={mixKind} initialTab={initialTab} onTab={setPanelTab}
        tabRequest={tabReq ?? undefined} keyExtra={fd ? <FloodLegendKey data={fd} layers={fl} /> : undefined}
        slots={sci ? {
          analysis: (
            <>
              {fcommon && <FloodSummary {...fcommon} a={aIdx} swipeOn={swipe} />}
              <div className="row-btns">{swipeBtn}{replayBtn}</div>{compareSelect}
              {methodsBtn}
              {!bs && <ProfileControls picking={picking} hasLine={!!profileData}
                onStart={() => { setProfile({ a: null, b: null }); setPicking(true); setPicked(null) }}
                onClear={() => { setProfile({ a: null, b: null }); setPicking(false) }} />}
              <PhysicsCheck context={context} result={physics} geometry={story.geometry} overlays={overlays} setOverlays={setOverlays} />
            </>
          ),
          impact,
          periods: periodsTab,
          layers: fcommon ? <FloodLayersPanel {...fcommon} layers={fl} setLayer={setLayer} /> : undefined,
          charts,
          los: bs ? undefined : <LosDiagram sci incidence={story.geometry?.incidenceDeg} azimuth={story.geometry?.lookAzimuthDeg} />,
        } : {
          actions: (
            <div className="actions">
              {fcommon && <FloodSummary {...fcommon} a={aIdx} swipeOn={swipe} />}
              {!bs && <ChangeStat layer={view.displacement.layer} grid={view.displacement.grid} coherence={view.coherence.grid} threshold={threshold} />}
              <TourButton available={!!story.tour?.length} onStart={() => goTour(0)} />
              <div className="row-btns">{swipeBtn}{replayBtn}</div>{compareSelect}
            </div>
          ),
          impact,
          periods: periodsTab,
          layers: fcommon ? <FloodLayersPanel {...fcommon} layers={fl} setLayer={setLayer} /> : undefined,
          charts,
          why: <><WhyCards items={story.why} />{methodsBtn}</>,
          los: bs ? undefined : <LosDiagram sci={false} />,
        }} />
      {replay != null && (
        <div className="replay-chip">{bs
          ? t('s.replay.chipRadar')
          : t('s.replay.chipMotion')}</div>
      )}
      {!bs && (
        <div className={`replay-chip fade ${replay == null && progress > 0 && progress < 0.97 ? 'on' : ''}`} aria-hidden={progress <= 0 || progress >= 0.97}>
          {t('s.replay.buildup', { sensor: story.sensor ?? 'NISAR' })}
        </div>
      )}
      <div className={`replay-chip fade note ${note ? 'on' : ''}`} role="status" aria-hidden={!note}>{note}</div>
      {picking && <div className="replay-chip">{t('s.picking')}</div>}
      {picked && !picking && (
        <Inspector point={picked} ui={ui} displacement={view.displacement} coherence={view.coherence}
          threshold={threshold} showChange={showChange} sensor={story.sensor} kind={story.kind} radar={view.radar} changeLabel={story.copy?.changeView?.inspector}
          extra={fcommon ? <FloodPointExtra {...fcommon} point={picked} waterAt={waterAt} onChart={() => openTab('charts')} /> : undefined}
          onJump={viewPair?.secondary ? () => setCursor(ms(`${viewPair.secondary}T12:00:00Z`)) : undefined} onClose={() => setPicked(null)} />
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
      <Timeline data={timelineData} cursor={cursor} setCursor={setCursor} headExtra={periodSwitcher} onEpisode={onEpisode}
        extraRow={fcommon ? <FloodTimelineRow {...fcommon} a={aIdx} start={ms(story.timeline.start)} end={ms(story.timeline.end)} onPick={(iso) => { const ep = epochs?.find((e) => e.pair.secondary === iso); if (ep) selectEpoch(ep.id) }} /> : undefined} />
      {methods && fd && <FloodMethods data={fd} onClose={() => setMethods(false)} />}
    </div>
  )
}

export default function App() {
  const [stories, setStories] = useState<StoryIndexEntry[] | null>(null)
  const [ui, setUi] = useState<UiMode>('story')
  const [id, setId] = useState<string | undefined>(() => new URLSearchParams(location.search).get('story') ?? undefined)
  const [lang, setLang] = useState<Lang>(initialLang)

  useEffect(() => { loadIndex().then(setStories).catch(() => setStories([])) }, [])

  const switchStory = (next: string) => {
    const url = new URL(location.href)
    url.searchParams.set('story', next)
    url.hash = ''
    history.replaceState(null, '', url)
    setId(next)
  }

  if (!stories) return <div className="splash"><Logo variant="stacked" height={150} className="splash-logo" /></div>
  // Upper Assam is the flagship: it opens first unless a story is asked for in the address.
  const entry = stories.find((s) => s.id === id) ?? stories[0]
  // A story only offers its own languages: anything else shows English until the viewer picks again.
  const shown: Lang = offers(entry?.languages, lang) ? lang : 'en'

  return (
    <I18nProvider lang={shown} setLang={setLang}>
      <Viewer key={entry?.id ?? 'default'} id={entry?.id} stories={stories} onSwitchStory={switchStory} initialUi={ui} onUiChange={setUi} />
    </I18nProvider>
  )
}
