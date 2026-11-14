import { LEGEND_GRADIENTS } from './lib/render'
import { sampleGrid } from './lib/data'
import type { AcquisitionPair, DataStatus, Grid, LayerDef, Story, ViewMode } from './types'

export type UiMode = 'story' | 'scientist'

export function Badge({ kind, synthetic }: { kind: string; synthetic?: boolean }) {
  return (
    <span className="badges">
      <span className={`badge b-${kind.toLowerCase().replace('-', '')}`}>{kind}</span>
      {synthetic && <span className="badge b-placeholder">PLACEHOLDER</span>}
    </span>
  )
}

const STATUS_LABEL: Record<DataStatus, string> = {
  placeholder: 'PLACEHOLDER DATA',
  beta: 'BETA NISAR DATA',
  provisional: 'PROVISIONAL NISAR DATA',
  validated: 'VALIDATED NISAR DATA',
}

export function TopBar({ story, ui, setUi }: { story: Story; ui: UiMode; setUi: (m: UiMode) => void }) {
  return (
    <header className="topbar">
      <div className="brand">Aevion</div>
      <div className={`status s-${story.dataStatus}`} title={story.dataStatusNote}>
        <span className="dot" />
        {STATUS_LABEL[story.dataStatus]}
        {story.dataStatus === 'placeholder' && <em> &middot; ground motion is synthetic, earthquakes and pass dates are real</em>}
      </div>
      <div className="seg" role="tablist" aria-label="Mode">
        <button role="tab" aria-selected={ui === 'story'} className={ui === 'story' ? 'on' : ''} onClick={() => setUi('story')}>Story</button>
        <button role="tab" aria-selected={ui === 'scientist'} className={ui === 'scientist' ? 'on' : ''} onClick={() => setUi('scientist')}>Scientist</button>
      </div>
    </header>
  )
}

interface SideProps {
  story: Story
  ui: UiMode
  mode: ViewMode
  setMode: (m: ViewMode) => void
  fadeLow: boolean
  setFadeLow: (v: boolean) => void
  threshold: number
  setThreshold: (v: number) => void
  displacement: LayerDef
  coherence: LayerDef
  flagship?: AcquisitionPair
}

export function SidePanel(p: SideProps) {
  const active = p.mode === 'coherence' ? p.coherence : p.displacement
  const [lo, hi] = active.range
  const scale = active.displayScale
  const legend =
    p.mode === 'fringes'
      ? { left: '0', right: '1 fringe', title: 'Interferogram fringes', hint: 'One full color cycle = about 12 cm of motion along the line of sight.' }
      : { left: fmtNum(lo * scale), right: fmtNum(hi * scale), title: `${active.name}${active.displayUnits ? ` (${active.displayUnits})` : ''}`, hint: '' }

  return (
    <aside className="side">
      <h1>{p.story.title}</h1>
      <p className="subtitle">{p.story.subtitle}</p>
      {p.ui === 'story' && <p className="lead">{p.story.storyText}</p>}

      <h2>View</h2>
      <div className="views">
        <ViewBtn on={p.mode === 'los'} onClick={() => p.setMode('los')} title="Ground motion" sub="How far the ground moved" />
        <ViewBtn on={p.mode === 'fringes'} onClick={() => p.setMode('fringes')} title="Fringes" sub="The raw radar pattern" />
        <ViewBtn on={p.mode === 'coherence'} onClick={() => p.setMode('coherence')} title="Confidence" sub="Where we can trust it" />
      </div>

      <div className="legend">
        <div className="legend-title">{legend.title} <Badge kind={active.badge} synthetic={active.synthetic} /></div>
        <div className="bar" style={{ background: LEGEND_GRADIENTS[p.mode] }} />
        <div className="ends"><span>{legend.left}</span><span>{legend.right}</span></div>
        {legend.hint && <p className="hint">{legend.hint}</p>}
        {p.mode === 'los' && <p className="hint">Blue and orange show motion toward or away from the satellite, not up or down.</p>}
      </div>

      <label className="check">
        <input type="checkbox" checked={p.fadeLow} onChange={(e) => p.setFadeLow(e.target.checked)} />
        <span>Fade and hatch areas where the measurement is unreliable</span>
      </label>
      {p.ui === 'scientist' && p.fadeLow && (
        <label className="slider">
          Coherence threshold: <b>{p.threshold.toFixed(2)}</b>
          <input type="range" min={0.1} max={0.9} step={0.05} value={p.threshold} onChange={(e) => p.setThreshold(Number(e.target.value))} />
        </label>
      )}

      {p.ui === 'scientist' && (
        <>
          <h2>Evidence</h2>
          <table className="prov">
            <tbody>
              {Object.entries(active.provenance).map(([k, v]) => (
                <tr key={k}><th>{label(k)}</th><td>{v}</td></tr>
              ))}
              {p.flagship && <tr><th>Granule</th><td className="mono">{p.flagship.granuleId}</td></tr>}
            </tbody>
          </table>
          <p className="hint">Displacement = unwrapped phase &times; wavelength / (4&pi;). L-band wavelength is about 24 cm.</p>
        </>
      )}

      <p className="foot">
        Imagery &copy; Esri &middot; Terrain: AWS Terrain Tiles &middot; Earthquakes: USGS &middot; NISAR pass dates: NASA CMR
      </p>
    </aside>
  )
}

function ViewBtn(p: { on: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button className={`view ${p.on ? 'on' : ''}`} onClick={p.onClick} aria-pressed={p.on}>
      <b>{p.title}</b><span>{p.sub}</span>
    </button>
  )
}

const fmtNum = (n: number) => (n > 0 && n !== 1 ? `+${trim(n)}` : trim(n))
const trim = (n: number) => String(Number(n.toFixed(2)))
const label = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())

interface InspectProps {
  point: [number, number]
  displacement: { layer: LayerDef; grid: Grid }
  coherence: { layer: LayerDef; grid: Grid }
  threshold: number
  showChange: boolean
  onClose: () => void
}

export function Inspector({ point, displacement, coherence, threshold, showChange, onClose }: InspectProps) {
  const d = sampleGrid(displacement.grid, point[0], point[1])
  const c = sampleGrid(coherence.grid, point[0], point[1])
  const cm = d == null ? null : d * displacement.layer.displayScale
  const conf = c == null ? null : c >= 0.7 ? 'High' : c >= threshold ? 'Medium' : 'Low'
  const dir = cm == null ? '' : Math.abs(cm) < 1 ? 'about zero' : cm > 0 ? 'toward the satellite' : 'away from the satellite'

  return (
    <div className="inspector" role="dialog" aria-label="Point details">
      <button className="x" onClick={onClose} aria-label="Close">&times;</button>
      <div className="coords">{point[1].toFixed(3)}&deg;, {point[0].toFixed(3)}&deg;</div>
      {!showChange ? (
        <p>No NISAR change is available at this date. Move the timeline to the post-event pass.</p>
      ) : d == null ? (
        <p>Outside the processed area.</p>
      ) : (
        <>
          <div className="big">{cm! > 0 ? '+' : ''}{cm!.toFixed(1)} <small>{displacement.layer.displayUnits}</small></div>
          <p>Ground moved {dir} along the radar line of sight.</p>
          <div className="row"><span>Confidence</span><b className={`conf c-${conf}`}>{conf} ({c!.toFixed(2)})</b></div>
          <Badge kind={displacement.layer.badge} synthetic={displacement.layer.synthetic} />
        </>
      )}
    </div>
  )
}
