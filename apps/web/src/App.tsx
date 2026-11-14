import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { DEFAULT_COHERENCE_THRESHOLD } from './config'
import { loadStory, ms } from './lib/data'
import MapView from './MapView'
import { Inspector, SidePanel, TopBar } from './Panels'
import type { UiMode } from './Panels'
import Timeline from './Timeline'
import type { LayerDef, LoadedStory, ViewMode } from './types'

function pickLayer(d: LoadedStory, role: LayerDef['role']) {
  const layer = d.story.layers.find((l) => l.role === role)
  if (!layer) throw new Error(`Story "${d.story.id}" has no layer with role "${role}"`)
  return { layer, grid: d.grids[layer.id] }
}

export default function App() {
  const [data, setData] = useState<LoadedStory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [ui, setUi] = useState<UiMode>('story')
  const [mode, setMode] = useState<ViewMode>('los')
  const [fadeLow, setFadeLow] = useState(true)
  const [threshold, setThreshold] = useState(DEFAULT_COHERENCE_THRESHOLD)
  const [picked, setPicked] = useState<[number, number] | null>(null)

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('story') ?? undefined
    loadStory(id)
      .then((d) => { setData(d); setCursor(ms(d.story.timeline.initial)) })
      .catch((e: Error) => setError(e.message))
  }, [])

  const layers = useMemo(() => {
    if (!data) return null
    try { return { displacement: pickLayer(data, 'displacement'), coherence: pickLayer(data, 'coherence') } }
    catch (e) { return { error: (e as Error).message } }
  }, [data])

  if (error) return <div className="splash"><b>Could not load the story.</b><span>{error}</span></div>
  if (layers && 'error' in layers) return <div className="splash"><b>Story is not valid.</b><span>{layers.error}</span></div>
  if (!data || !layers) return <div className="splash"><b>Aevion</b><span>Loading story&hellip;</span></div>

  const showChange = cursor >= ms(`${data.story.flagshipPair.secondary}T00:00:00Z`)

  return (
    <div className="app">
      <MapView story={data.story} quakes={data.quakes} displacement={layers.displacement} coherence={layers.coherence}
        mode={mode} fadeLow={fadeLow} threshold={threshold} showChange={showChange} cursor={cursor}
        picked={picked} onPick={(lon, lat) => setPicked([lon, lat])} />
      <TopBar story={data.story} ui={ui} setUi={setUi} />
      <SidePanel story={data.story} ui={ui} mode={mode} setMode={setMode} fadeLow={fadeLow} setFadeLow={setFadeLow}
        threshold={threshold} setThreshold={setThreshold}
        displacement={layers.displacement.layer} coherence={layers.coherence.layer} flagship={data.flagship} />
      {picked && (
        <Inspector point={picked} displacement={layers.displacement} coherence={layers.coherence}
          threshold={threshold} showChange={showChange} onClose={() => setPicked(null)} />
      )}
      <Timeline data={data} cursor={cursor} setCursor={setCursor} />
    </div>
  )
}
