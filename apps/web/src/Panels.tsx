import type { ReactNode } from 'react'
import { LAMBDA, LEGEND_GRADIENTS } from './lib/render'
import { sampleGrid } from './lib/data'
import type { AcquisitionPair, DataStatus, Grid, LayerDef, Resource, Story, ViewMode } from './types'

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
  const sci = ui === 'scientist'
  return (
    <header className="topbar">
      <div className="brand">Aevion</div>
      <div className={`status s-${story.dataStatus}`} title={story.dataStatusNote}>
        <span className="dot" />
        {STATUS_LABEL[story.dataStatus]}
        {(story.statusDetail || story.dataStatus === 'placeholder') && (
          <em> &middot; {story.statusDetail
            ? (sci ? story.statusDetail.scientist : story.statusDetail.story)
            : sci ? 'LOS and coherence grids are synthetic; USGS events and CMR pass dates are real' : 'ground motion is synthetic, earthquakes and pass dates are real'}</em>
        )}
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
  /** Rendered right after the intro text (tour and replay buttons). */
  top?: ReactNode
  /** Rendered after the main controls, before the resource links. */
  children?: ReactNode
}

export function SidePanel(p: SideProps) {
  const sci = p.ui === 'scientist'
  const tech = p.story.technical
  const active = p.mode === 'coherence' ? p.coherence : p.displacement
  const [lo, hi] = active.range
  const half = LAMBDA / 2

  // Story: friendly units and plain sentences. Scientist: raw units, numbers and the physics.
  const legend =
    p.mode === 'fringes'
      ? {
          left: '0',
          right: sci ? `1 fringe = ${half.toFixed(3)} m` : '1 color cycle',
          title: sci ? 'Wrapped phase (re-wrapped from displacement)' : 'Interferogram fringes',
          hint: sci
            ? `Derived by wrapping the displacement map. One full color cycle is a phase change of 2π, which is λ/2 = ${half.toFixed(4)} m of line-of-sight motion (λ = ${LAMBDA} m, L-band).`
            : 'Each full color cycle is about 12 cm of motion toward or away from the satellite. More bands packed together means more motion.',
        }
      : p.mode === 'coherence'
        ? {
            left: '0',
            right: '1',
            title: sci
              ? (p.coherence.titleScientist ?? 'Coherence magnitude (0 to 1)')
              : (p.coherence.titleStory ?? 'How much we can trust it'),
            hint: sci
              ? (p.coherence.hintScientist ?? `Unitless. Cells below the threshold (${p.threshold.toFixed(2)}) are faded and hatched when masking is on.`)
              : (p.coherence.hintStory ?? 'Bright means the two radar passes matched well. Dark means the ground changed too much to trust the measurement.'),
          }
        : {
            left: sci ? fmtNum(lo) : fmtNum(lo * active.displayScale),
            right: sci ? fmtNum(hi) : fmtNum(hi * active.displayScale),
            title: sci ? `LOS displacement (${active.units})` : `How far the ground moved (${active.displayUnits})`,
            hint: sci
              ? (p.displacement.hintScientist ?? 'Line-of-sight displacement in meters. Sign convention and reference point are listed under Evidence.')
              : (p.displacement.hintStory ?? 'Blue and orange show the ground moving toward or away from the satellite, not up or down.'),
          }

  const pairLine = p.flagship
    ? `Track ${p.flagship.track} ${p.flagship.orbitDirection === 'A' ? 'ascending' : 'descending'} · ${p.story.flagshipPair.reference} → ${p.story.flagshipPair.secondary}`
    : ''

  return (
    <aside className={`side ${sci ? 'sci' : ''}`}>
      <h1>{sci && tech ? tech.title : p.story.title}</h1>
      <p className="subtitle">{sci && tech?.subtitle ? tech.subtitle : p.story.subtitle}</p>
      {sci ? (
        <>
          <p className="pair mono">{pairLine}</p>
          {tech && <p className="lead tech">{tech.summary}</p>}
        </>
      ) : <p className="lead">{p.story.storyText}</p>}
      {p.top}

      <h2>{sci ? 'Layer' : 'What do you want to see?'}</h2>
      <div className="views">
        <ViewBtn on={p.mode === 'los'} onClick={() => p.setMode('los')}
          title={sci ? 'LOS displacement' : 'Ground motion'} sub={sci ? 'Unwrapped, meters' : 'How far the ground moved'} />
        <ViewBtn on={p.mode === 'fringes'} onClick={() => p.setMode('fringes')}
          title={sci ? 'Wrapped phase' : 'Fringes'} sub={sci ? 'One cycle per λ/2' : 'The raw radar pattern'} />
        <ViewBtn on={p.mode === 'coherence'} onClick={() => p.setMode('coherence')}
          title={sci ? (p.coherence.label ?? 'Coherence') : 'Confidence'} sub={sci ? 'Quality mask, 0 to 1' : 'Where we can trust it'} />
      </div>

      <div className="legend">
        <div className="legend-title">{legend.title} <Badge kind={active.badge} synthetic={active.synthetic} /></div>
        <div className="bar" style={{ background: LEGEND_GRADIENTS[p.mode] }} />
        <div className="ends"><span>{legend.left}</span><span>{legend.right}</span></div>
        <p className="hint">{legend.hint}</p>
      </div>

      <label className="check">
        <input type="checkbox" checked={p.fadeLow} onChange={(e) => p.setFadeLow(e.target.checked)} />
        <span>{sci ? `Mask cells below the ${(p.coherence.label ?? 'coherence').toLowerCase()} threshold` : 'Fade and hatch areas where the measurement is unreliable'}</span>
      </label>
      {sci && p.fadeLow && (
        <label className="slider">
          {p.coherence.label ?? 'Coherence'} threshold: <b>{p.threshold.toFixed(2)}</b>
          <input type="range" min={0.1} max={0.9} step={0.05} value={p.threshold} onChange={(e) => p.setThreshold(Number(e.target.value))} />
        </label>
      )}

      {!sci && (
        <div className="howto">
          <h2>How to read this</h2>
          <ul>
            <li>Drag the timeline to the second NISAR pass to see the change appear.</li>
            <li>Click anywhere on the map to see how far that spot moved.</li>
            <li>Switch to Scientist mode for exact values and sources.</li>
          </ul>
        </div>
      )}

      {sci && (
        <>
          <h2>Evidence</h2>
          <table className="prov">
            <tbody>
              {Object.entries(active.provenance).map(([k, v]) => (
                <tr key={k}><th>{label(k)}</th><td>{v}</td></tr>
              ))}
              {p.flagship && <tr><th>NISAR pair</th><td className="mono">{p.flagship.granuleId}</td></tr>}
            </tbody>
          </table>
          <p className="hint">Displacement = unwrapped phase &times; &lambda; / (4&pi;), with &lambda; = {LAMBDA} m for L-band.</p>
          {tech?.caveats && tech.caveats.length > 0 && (
            <>
              <h2>Limitations</h2>
              <ul className="caveats">
                {tech.caveats.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </>
          )}
        </>
      )}

      {p.children}

      <Resources items={p.story.resources} ui={p.ui} />

      <p className="foot">
        Imagery &copy; Esri &middot; Terrain: AWS Terrain Tiles &middot; Earthquakes: USGS &middot; NISAR pass dates: NASA CMR
      </p>
    </aside>
  )
}

const GROUP_TITLE: Record<Resource['group'], string> = {
  learn: 'Learn more',
  data: 'Data and documentation',
  partner: 'Other SAR missions',
}

/** Links from the challenge resource list. Story mode shows learning links; Scientist mode shows data links. */
function Resources({ items, ui }: { items?: Resource[]; ui: UiMode }) {
  if (!items?.length) return null
  const shown = items.filter((r) => r.audience === 'both' || r.audience === ui)
  const groups = (['learn', 'data', 'partner'] as const).filter((g) => shown.some((r) => r.group === g))
  return (
    <div className="res">
      {groups.map((g, i) => (
        <details key={g} open={i === 0 && ui === 'story'}>
          <summary>{GROUP_TITLE[g]}</summary>
          <ul>
            {shown.filter((r) => r.group === g).map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noreferrer noopener">{r.title}</a>
                <span>{r.description}</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
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
  ui: UiMode
  displacement: { layer: LayerDef; grid: Grid }
  coherence: { layer: LayerDef; grid: Grid }
  threshold: number
  showChange: boolean
  onClose: () => void
}

export function Inspector({ point, ui, displacement, coherence, threshold, showChange, onClose }: InspectProps) {
  const sci = ui === 'scientist'
  const g = displacement.grid
  const d = sampleGrid(g, point[0], point[1])
  const c = sampleGrid(coherence.grid, point[0], point[1])
  const cm = d == null ? null : d * displacement.layer.displayScale
  const conf = c == null ? null : c >= 0.7 ? 'High' : c >= threshold ? 'Medium' : 'Low'
  const pos = displacement.layer.positiveMeans ?? 'toward the satellite'
  const neg = displacement.layer.negativeMeans ?? 'away from the satellite'
  const dir = cm == null ? '' : cm > 0 ? pos : neg
  const [w, s, e, n] = g.bbox
  const col = Math.min(g.width - 1, Math.floor(((point[0] - w) / (e - w)) * g.width))
  const row = Math.min(g.height - 1, Math.floor(((n - point[1]) / (n - s)) * g.height))
  const sign = displacement.layer.provenance.signConvention

  return (
    <div className={`inspector ${sci ? 'sci' : ''}`} role="dialog" aria-label="Point details">
      <button className="x" onClick={onClose} aria-label="Close">&times;</button>
      <div className="coords">{point[1].toFixed(sci ? 5 : 2)}&deg;, {point[0].toFixed(sci ? 5 : 2)}&deg;</div>
      {!showChange ? (
        <p>{sci ? 'No post-event NISAR acquisition at the selected date.' : 'No NISAR change is available at this date. Move the timeline to the post-event pass.'}</p>
      ) : d == null ? (
        <p>Outside the processed area.</p>
      ) : sci ? (
        <>
          <div className="big mono">{d.toFixed(4)} <small>{displacement.layer.units}</small></div>
          <table className="prov">
            <tbody>
              <tr><th>LOS (display)</th><td>{cm! > 0 ? '+' : ''}{cm!.toFixed(2)} {displacement.layer.displayUnits}</td></tr>
              <tr><th>{coherence.layer.label ?? 'Coherence'}</th><td>{c!.toFixed(3)} ({conf}{c! < threshold ? ', masked' : ''})</td></tr>
              <tr><th>Grid cell</th><td>col {col}, row {row} of {g.width} &times; {g.height}</td></tr>
              {sign && <tr><th>Sign</th><td>{sign}</td></tr>}
            </tbody>
          </table>
          <Badge kind={displacement.layer.badge} synthetic={displacement.layer.synthetic} />
        </>
      ) : (
        <>
          <div className="big">{cm! > 0 ? '+' : ''}{cm!.toFixed(0)} <small>{displacement.layer.displayUnits}</small></div>
          <p>{Math.abs(cm!) < 1 ? 'The ground here barely moved.' : `The ground here moved ${dir}.`} {conf === 'Low' ? 'We are not very sure about this spot.' : conf === 'High' ? 'We are confident in this measurement.' : 'This measurement is fairly reliable.'}</p>
          <Badge kind={displacement.layer.badge} synthetic={displacement.layer.synthetic} />
        </>
      )}
    </div>
  )
}
