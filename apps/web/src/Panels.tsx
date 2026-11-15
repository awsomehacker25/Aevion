import { useState } from 'react'
import type { ReactNode } from 'react'
import { GRAY_GRADIENT, LAMBDA, LEGEND_GRADIENTS } from './lib/render'
import { sampleGrid } from './lib/data'
import { EVENT, TEAM } from './config'
import type { AcquisitionPair, DataStatus, Grid, LayerDef, Resource, Story, StoryIndexEntry, ViewMode } from './types'

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

interface TopBarProps {
  story: Story
  ui: UiMode
  setUi: (m: UiMode) => void
  stories: StoryIndexEntry[]
  onSwitchStory: (id: string) => void
}

export function TopBar({ story, ui, setUi, stories, onSwitchStory }: TopBarProps) {
  const sci = ui === 'scientist'
  return (
    <header className="topbar">
      <div className="brand"><img src={`${import.meta.env.BASE_URL}logo-horizontal.svg`} alt="Aevion" /></div>
      {stories.length > 1 && (
        <select className="picker" value={story.id} onChange={(e) => onSwitchStory(e.target.value)} aria-label="Choose a story">
          {stories.map((s) => <option key={s.id} value={s.id}>{s.label ?? s.title}</option>)}
        </select>
      )}
      <div className={`status s-${story.dataStatus}`} title={story.dataStatusNote}>
        <span className="dot" />
        {STATUS_LABEL[story.dataStatus]}
        {(story.statusDetail || story.dataStatus === 'placeholder') && (
          <em> &middot; {story.statusDetail
            ? (sci ? story.statusDetail.scientist : story.statusDetail.story)
            : sci ? 'LOS and coherence grids are synthetic placeholders' : 'ground motion is a synthetic placeholder'}</em>
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
  /** Radar brightness (backscatter) change layers, when the story has them. */
  radar?: { hh?: LayerDef; hv?: LayerDef }
  /** Content blocks the app supplies; the panel decides which tab each one lives in. */
  slots: {
    /** Story: tour and replay buttons. */
    actions?: ReactNode
    /** Scientist: cross-section and physics check. */
    analysis?: ReactNode
    impact?: ReactNode
    why?: ReactNode
    los?: ReactNode
    /** The period chart and list, shown as its own tab. */
    periods?: ReactNode
  }
}

export function SidePanel(p: SideProps) {
  const sci = p.ui === 'scientist'
  const bs = p.story.kind === 'backscatter'
  const tech = p.story.technical
  const radarLayer = p.mode === 'hh' ? p.radar?.hh : p.mode === 'hv' ? p.radar?.hv : undefined
  const active = radarLayer ?? (p.mode === 'coherence' ? p.coherence : p.displacement)
  const [lo, hi] = active.range
  const half = LAMBDA / 2

  // Story: friendly units and plain sentences. Scientist: raw units, numbers and the physics.
  const legend = radarLayer
    ? {
        left: `${fmtNum(lo)} dB`,
        right: `${fmtNum(hi)} dB`,
        title: sci ? (radarLayer.titleScientist ?? radarLayer.name) : (radarLayer.titleStory ?? radarLayer.name),
        hint: sci ? (radarLayer.hintScientist ?? '') : (radarLayer.hintStory ?? ''),
      }
    : p.mode === 'fringes'
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
            title: bs
              ? (sci ? (p.displacement.titleScientist ?? p.displacement.name) : (p.displacement.titleStory ?? p.displacement.name))
              : sci ? `LOS displacement (${active.units})` : `How far the ground moved (${active.displayUnits})`,
            hint: sci
              ? (p.displacement.hintScientist ?? 'Line-of-sight displacement in meters. Sign convention and reference point are listed under Evidence.')
              : (p.displacement.hintStory ?? 'Blue and orange show the ground moving toward or away from the satellite, not up or down.'),
          }

  // What the colors mean in the view on screen: the story's own key if it has one, otherwise a standard one built from the layer's wording.
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const keyItems: { color: string; text: string }[] | undefined = p.story.copy?.key?.[p.mode] ?? (
    p.mode === 'fringes'
      ? [{ color: LEGEND_GRADIENTS.fringes, text: 'One full color cycle is about 12 cm of motion toward or away from the satellite' },
         { color: '#f4f4f4', text: 'Many tight bands: a lot of motion. Wide bands: little.' }]
      : p.mode === 'coherence'
        ? [{ color: '#ffd479', text: 'Bright: the two passes matched well, so it can be trusted' },
           { color: '#3b1f6b', text: 'Dark: the ground changed too much, so it is unreliable' }]
        : radarLayer
          ? [{ color: '#f39237', text: cap(`echo got ${radarLayer.positiveMeans ?? 'brighter'}`) },
             { color: '#3b8fd4', text: cap(`echo got ${radarLayer.negativeMeans ?? 'darker'}`) },
             { color: '#f4f4f4', text: `Little change: left clear` }]
          : bs
            ? undefined
            : [{ color: '#f39237', text: cap(`moved ${p.displacement.positiveMeans ?? 'away from the satellite'}`) },
               { color: '#3b8fd4', text: cap(`moved ${p.displacement.negativeMeans ?? 'toward the satellite'}`) },
               { color: '#f4f4f4', text: 'Barely moved: left clear' }])

  const pairLine = p.flagship
    ? `Track ${p.flagship.track} ${p.flagship.orbitDirection === 'A' ? 'ascending' : 'descending'} · ${p.story.flagshipPair.reference} → ${p.story.flagshipPair.secondary}`
    : ''

  const [tabs, setTabs] = useState<Record<UiMode, string>>({ story: 'overview', scientist: 'analysis' })

  const credits = (
    <p className="foot">
      {p.story.credits ?? 'Imagery © Esri · Terrain: AWS Terrain Tiles · Earthquakes: USGS · NISAR pass dates: NASA CMR'}
    </p>
  )
  const team = (
    <p className="foot team">
      <b>Built by</b> {TEAM.slice(0, -1).join(', ')} and {TEAM[TEAM.length - 1]}<br />{EVENT}
    </p>
  )
  const sources = <><Resources items={p.story.resources} ui={p.ui} />{credits}{team}</>
  const caveats = tech?.caveats && tech.caveats.length > 0 && (
    <>
      <h2>Limitations</h2>
      <ul className="caveats">
        {tech.caveats.map((c) => <li key={c}>{c}</li>)}
      </ul>
    </>
  )
  const why = p.slots.why || p.slots.los ? <>{p.slots.why}{p.slots.los}</> : null

  const all: { id: string; label: string; body: ReactNode }[] = sci
    ? [
        {
          id: 'analysis', label: 'Analysis', body: (
            <>
              <p className="pair mono">{pairLine}</p>
              {tech && <p className="lead tech">{tech.summary}</p>}
              {p.slots.analysis}
            </>
          ),
        },
        ...(p.slots.periods ? [{ id: 'periods', label: 'Periods', body: p.slots.periods }] : []),
        {
          id: 'evidence', label: 'Evidence', body: (
            <>
              <table className="prov">
                <tbody>
                  {Object.entries(active.provenance).map(([k, v]) => (
                    <tr key={k}><th>{label(k)}</th><td>{v}</td></tr>
                  ))}
                  {p.flagship && <tr><th>{p.story.sensor ?? 'NISAR'} pair</th><td className="mono">{p.flagship.granuleId}</td></tr>}
                </tbody>
              </table>
              {p.story.copy?.evidenceNote
                ? <p className="hint">{p.story.copy.evidenceNote}</p>
                : <p className="hint">Displacement = unwrapped phase &times; &lambda; / (4&pi;), with &lambda; = {LAMBDA} m for L-band.</p>}
            </>
          ),
        },
        { id: 'context', label: 'Context', body: <>{caveats}{p.slots.impact}{p.slots.los}</> },
        { id: 'sources', label: 'Sources', body: sources },
      ]
    : [
        {
          id: 'overview', label: 'Overview', body: (
            <>
              <p className="lead">{p.story.storyText}</p>
              {p.slots.actions}
              <div className="howto">
                <h2>How to read this</h2>
                <ul>
                  {(p.story.copy?.howTo ?? [
                    `Drag the timeline to the second ${p.story.sensor ?? 'NISAR'} pass to see the change appear.`,
                    'Click anywhere on the map to see how far that spot moved.',
                    'Switch to Scientist mode for exact values and sources.',
                  ]).map((t) => <li key={t}>{t}</li>)}
                </ul>
              </div>
            </>
          ),
        },
        ...(p.slots.periods ? [{ id: 'periods', label: 'Periods', body: p.slots.periods }] : []),
        ...(p.slots.impact ? [{ id: 'impact', label: 'Impact', body: p.slots.impact }] : []),
        ...(why ? [{ id: 'why', label: 'Why', body: why }] : []),
        { id: 'learn', label: 'Learn', body: sources },
      ]
  const current = all.find((t) => t.id === tabs[p.ui]) ?? all[0]

  return (
    <aside className={`side ${sci ? 'sci' : ''}`}>
      <div className="side-head">
        <h1>{sci && tech ? tech.title : p.story.title}</h1>
        <p className="subtitle">{sci && tech?.subtitle ? tech.subtitle : p.story.subtitle}</p>

        <div className={`views ${bs ? (p.radar?.hh && p.radar?.hv ? '' : 'two') : ''}`}>
          <ViewBtn on={p.mode === 'los'} onClick={() => p.setMode('los')}
            title={(p.story.copy?.mainView ?? ['Ground motion', 'LOS displacement'])[sci ? 1 : 0]}
            sub={bs ? (sci ? 'GCOV HHHH change, dB' : 'How much brighter or darker') : sci ? 'Unwrapped, meters' : 'How far the ground moved'} />
          {!bs && <ViewBtn on={p.mode === 'fringes'} onClick={() => p.setMode('fringes')}
            title={sci ? 'Wrapped phase' : 'Fringes'} sub={sci ? 'One cycle per λ/2' : 'The raw radar pattern'} />}
          {!bs && <ViewBtn on={p.mode === 'coherence'} onClick={() => p.setMode('coherence')}
            title={sci ? (p.coherence.label ?? 'Coherence') : 'Confidence'} sub={sci ? 'Quality mask, 0 to 1' : 'Where we can trust it'} />}
          {bs && p.radar?.hv && <ViewBtn on={p.mode === 'hv'} onClick={() => p.setMode('hv')}
            title="Radar HV" sub={sci ? 'GCOV HVHV, dB' : 'Rough surfaces and plants'} />}
          {bs && p.radar?.hh && <ViewBtn on={p.mode === 'hh'} onClick={() => p.setMode('hh')}
            title="What changed" sub={sci ? 'HH change vs the previous pass, dB' : 'Difference from the previous pass'} />}
        </div>
        {!bs && (p.radar?.hh || p.radar?.hv) && (
          <div className="views radar">
            {p.radar.hh && <ViewBtn on={p.mode === 'hh'} onClick={() => p.setMode('hh')}
              title="Radar HH" sub={sci ? 'GCOV HHHH change, dB' : 'Ground-sensitive brightness change'} />}
            {p.radar.hv && <ViewBtn on={p.mode === 'hv'} onClick={() => p.setMode('hv')}
              title="Radar HV" sub={p.radar.hv.colormap === 'gray' ? (sci ? 'GCOV HVHV, dB' : 'Rough surfaces and plants') : sci ? 'GCOV HVHV change, dB' : 'Plant-sensitive brightness change'} />}
          </div>
        )}

        <div className="legend">
          <div className="legend-title">{legend.title} <Badge kind={active.badge} synthetic={active.synthetic} /></div>
          <div className="bar" style={{ background: (radarLayer ?? (p.mode === 'los' ? p.displacement : undefined))?.colormap === 'gray' ? GRAY_GRADIENT : LEGEND_GRADIENTS[p.mode] }} />
          <div className="ends"><span>{legend.left}</span><span>{legend.right}</span></div>
          {keyItems && (
            <ul className="key">
              {keyItems.map((k) => <li key={k.text}><i style={{ background: k.color }} />{k.text}</li>)}
            </ul>
          )}
        </div>

        <details className="settings">
          <summary>About this layer and display settings</summary>
          <p className="hint">{legend.hint}</p>
          {!bs && <label className="check">
            <input type="checkbox" checked={p.fadeLow} onChange={(e) => p.setFadeLow(e.target.checked)} />
            <span>{sci ? `Mask cells below the ${(p.coherence.label ?? 'coherence').toLowerCase()} threshold` : 'Fade and hatch areas where the measurement is unreliable'}</span>
          </label>}
          {sci && !bs && p.fadeLow && (
            <label className="slider">
              {p.coherence.label ?? 'Coherence'} threshold: <b>{p.threshold.toFixed(2)}</b>
              <input type="range" min={0.1} max={0.9} step={0.05} value={p.threshold} onChange={(e) => p.setThreshold(Number(e.target.value))} />
            </label>
          )}
        </details>

        <div className="tabs" role="tablist" aria-label="Panel sections">
          {all.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === current.id} className={t.id === current.id ? 'on' : ''}
              onClick={() => setTabs((s) => ({ ...s, [p.ui]: t.id }))}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="side-body" role="tabpanel">{current.body}</div>
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
      {groups.map((g) => (
        <details key={g}>
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
    <button className={`view ${p.on ? 'on' : ''}`} onClick={p.onClick} aria-pressed={p.on} title={p.sub}>
      <b>{p.title}</b>
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
  sensor?: string
  /** 'backscatter' stories describe a brightness change instead of ground motion. */
  kind?: 'interferometry' | 'backscatter'
  radar?: { hh?: { layer: LayerDef; grid: Grid }; hv?: { layer: LayerDef; grid: Grid } }
  onClose: () => void
}

export function Inspector({ point, ui, displacement, coherence, threshold, showChange, sensor = 'NISAR', kind, radar, onClose }: InspectProps) {
  const bs = kind === 'backscatter'
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
        <p>{bs ? `No ${sensor} radar picture is shown yet at this date. Move the timeline forward.` : sci ? `No second ${sensor} acquisition at the selected date.` : `No ${sensor} change is available at this date. Move the timeline to the second pass.`}</p>
      ) : d == null ? (
        <p>Outside the processed area.</p>
      ) : sci ? (
        <>
          <div className="big mono">{d.toFixed(4)} <small>{displacement.layer.units}</small></div>
          <table className="prov">
            <tbody>
              {!bs && <tr><th>LOS (display)</th><td>{cm! > 0 ? '+' : ''}{cm!.toFixed(2)} {displacement.layer.displayUnits}</td></tr>}
              {!bs && <tr><th>{coherence.layer.label ?? 'Coherence'}</th><td>{c!.toFixed(3)} ({conf}{c! < threshold ? ', masked' : ''})</td></tr>}
              {(['hh', 'hv'] as const).map((k) => {
                const r = radar?.[k]
                const v = r ? sampleGrid(r.grid, point[0], point[1]) : null
                const name = bs ? (k === 'hh' ? 'Change vs previous pass' : 'HV echo') : `${k.toUpperCase()} brightness`
                return r ? <tr key={k}><th>{name}</th><td>{v == null ? 'no data' : `${v > 0 && (!bs || k === 'hh') ? '+' : ''}${v.toFixed(1)} dB`}</td></tr> : null
              })}
              <tr><th>Grid cell</th><td>col {col}, row {row} of {g.width} &times; {g.height}</td></tr>
              {sign && <tr><th>Sign</th><td>{sign}</td></tr>}
            </tbody>
          </table>
          <Badge kind={displacement.layer.badge} synthetic={displacement.layer.synthetic} />
        </>
      ) : (
        <>
          <div className="big">{cm! > 0 ? '+' : ''}{cm!.toFixed(bs ? 1 : 0)} <small>{displacement.layer.displayUnits}</small></div>
          {bs
            ? (displacement.layer.colormap === 'gray'
              ? <p>{cm! > -5 ? 'A strong echo: a rough or wet surface, such as fresh lava, bare rock or wet ground.' : cm! > -9 ? 'A typical echo for rough, bare ground.' : cm! > -14 ? 'A weak echo: a smoother surface, or ground covered by wet snow.' : 'A very weak echo: a smooth surface that mirrors the radar away, or wet snow.'} The radar picture does not say by itself which one it is.</p>
              : <p>{Math.abs(cm!) < 1.5 ? 'The radar brightness here barely changed.' : `This spot looks ${dir} to the radar than on the first pass.`} Brightness changes can come from lava, but also from snow, wet ground and plants, so a change alone does not say which.</p>)
            : <p>{Math.abs(cm!) < 1 ? 'The ground here barely moved.' : `The ground here moved ${dir}.`} {conf === 'Low' ? 'We are not very sure about this spot.' : conf === 'High' ? 'We are confident in this measurement.' : 'This measurement is fairly reliable.'}</p>}
          <Badge kind={displacement.layer.badge} synthetic={displacement.layer.synthetic} />
        </>
      )}
    </div>
  )
}
