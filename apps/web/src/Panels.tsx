import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { GRAY_GRADIENT, LAMBDA, LEGEND_GRADIENTS } from './lib/render'
import { sampleGrid } from './lib/data'
import { EVENT, TEAM } from './config'
import { LANGS, isLang, rememberLang, useI18n } from './i18n'
import type { Lang } from './i18n'
import type { AcquisitionPair, Grid, LayerDef, Resource, Story, StoryIndexEntry, ViewMode } from './types'

export type UiMode = 'story' | 'scientist'

export function Badge({ kind, synthetic }: { kind: string; synthetic?: boolean }) {
  return (
    <span className="badges">
      <span className={`badge b-${kind.toLowerCase().replace('-', '')}`}>{kind}</span>
      {synthetic && <span className="badge b-placeholder">Placeholder</span>}
    </span>
  )
}

interface TopBarProps {
  story: Pick<Story, 'id' | 'dataStatus' | 'dataStatusNote' | 'statusDetail'>
  ui: UiMode
  setUi: (m: UiMode) => void
  stories: StoryIndexEntry[]
  onSwitchStory: (id: string) => void
  /** Languages this story is offered in. The switcher is hidden when there is only English. */
  languages?: string[]
}

export function TopBar({ story, ui, setUi, stories, onSwitchStory, languages }: TopBarProps) {
  const { t, lang, setLang, machine } = useI18n()
  const sci = ui === 'scientist'
  const langs = (languages ?? ['en']).filter(isLang)
  return (
    <header className="topbar">
      <div className="brand"><img src={`${import.meta.env.BASE_URL}logo-horizontal.svg`} alt="Aevion" /></div>
      {stories.length > 1 && (
        <select className="picker" value={story.id} onChange={(e) => onSwitchStory(e.target.value)} aria-label={t('top.chooseStory')}>
          {stories.map((s) => <option key={s.id} value={s.id}>{s.label ?? s.title}</option>)}
        </select>
      )}
      <div className={`status s-${story.dataStatus}`} title={[story.dataStatusNote, story.statusDetail ? (sci ? story.statusDetail.scientist : story.statusDetail.story) : ''].filter(Boolean).join(' - ')}>
        <span className="dot" />
        <span className="s-full">{t(`status.${story.dataStatus}`)}</span>
        <span className="s-short">{t(`status.short.${story.dataStatus}`)}</span>
        {sci && (story.statusDetail || story.dataStatus === 'placeholder') && (
          <em> &middot; {story.statusDetail ? story.statusDetail.scientist : t('status.placeholderDetail')}</em>
        )}
      </div>
      {langs.length > 1 && (
        <label className="langsel">
          <span className="sr-only">{t('top.language')}</span>
          <select className="picker lang" value={lang} onChange={(e) => { const l = e.target.value as Lang; rememberLang(l); setLang(l) }} aria-label={t('top.language')}>
            {langs.map((l) => <option key={l} value={l}>{LANGS[l].native}</option>)}
          </select>
        </label>
      )}
      {machine && <span className="status mt" title={t('lang.machine.title')}>{t('lang.machine')}</span>}
      <div className="seg" role="group" aria-label={t('top.mode')}>
        <button aria-pressed={ui === 'story'} className={ui === 'story' ? 'on' : ''} onClick={() => setUi('story')}>{t('top.story')}</button>
        <button aria-pressed={ui === 'scientist'} className={ui === 'scientist' ? 'on' : ''} onClick={() => setUi('scientist')}>{t('top.scientist')}</button>
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
  const { t } = useI18n()
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
          right: sci ? `1 fringe = ${half.toFixed(3)} m` : t('s.cycle'),
          title: sci ? 'Wrapped phase (re-wrapped from displacement)' : t('s.fringesTitle'),
          hint: sci
            ? `Derived by wrapping the displacement map. One full color cycle is a phase change of 2π, which is λ/2 = ${half.toFixed(4)} m of line-of-sight motion (λ = ${LAMBDA} m, L-band).`
            : t('s.fringesHint'),
        }
      : p.mode === 'coherence'
        ? {
            left: '0',
            right: '1',
            title: sci
              ? (p.coherence.titleScientist ?? 'Coherence magnitude (0 to 1)')
              : (p.coherence.titleStory ?? t('s.cohTitle')),
            hint: sci
              ? (p.coherence.hintScientist ?? `Unitless. Cells below the threshold (${p.threshold.toFixed(2)}) are faded and hatched when masking is on.`)
              : (p.coherence.hintStory ?? t('s.cohHint')),
          }
        : {
            left: sci ? fmtNum(lo) : fmtNum(lo * active.displayScale),
            right: sci ? fmtNum(hi) : fmtNum(hi * active.displayScale),
            title: bs
              ? (sci ? (p.displacement.titleScientist ?? p.displacement.name) : (p.displacement.titleStory ?? p.displacement.name))
              : sci ? `LOS displacement (${active.units})` : t('s.moved', { u: active.displayUnits }),
            hint: sci
              ? (p.displacement.hintScientist ?? 'Line-of-sight displacement in meters. Sign convention and reference point are listed under Data.')
              : (p.displacement.hintStory ?? t('s.movedHint')),
          }

  // What the colors mean in the view on screen: the story's own key if it has one, otherwise a standard one built from the layer's wording.
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const keyItems: { color: string; text: string }[] | undefined = p.story.copy?.key?.[p.mode] ?? (
    p.mode === 'fringes'
      ? [{ color: LEGEND_GRADIENTS.fringes, text: t('s.key.cycle') },
         { color: '#f7f7f7', text: t('s.key.bands') }]
      : p.mode === 'coherence'
        ? [{ color: '#ffd479', text: t('s.key.cohHi') },
           { color: '#3b1f6b', text: t('s.key.cohLo') }]
        : radarLayer
          ? [{ color: '#f39237', text: cap(t('s.key.echo', { d: radarLayer.positiveMeans ?? t('s.brighter') })) },
             { color: '#3b8fd4', text: cap(t('s.key.echo', { d: radarLayer.negativeMeans ?? t('s.darker') })) },
             { color: '#f7f7f7', text: t('s.key.little') }]
          : bs
            ? undefined
            : [{ color: '#f39237', text: cap(t('s.key.moved', { d: p.displacement.positiveMeans ?? t('s.away') })) },
               { color: '#3b8fd4', text: cap(t('s.key.moved', { d: p.displacement.negativeMeans ?? t('s.toward') })) },
               { color: '#f7f7f7', text: t('s.key.barely') }])

  const pairLine = p.flagship
    ? `Track ${p.flagship.track} ${p.flagship.orbitDirection === 'A' ? 'ascending' : 'descending'} · ${p.story.flagshipPair.reference} → ${p.story.flagshipPair.secondary}`
    : ''

  const [tabs, setTabs] = useState<Record<UiMode, string>>({ story: 'overview', scientist: 'analysis' })
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 760)

  const credits = (
    <p className="foot">
      {p.story.credits ?? t('s.credits')}
    </p>
  )
  const team = (
    <p className="foot team">
      <b>{t('s.builtBy')}</b> {t('s.team', { names: TEAM.slice(0, -1).join(', '), last: TEAM[TEAM.length - 1] })}<br />{EVENT}
    </p>
  )
  const sources = <><Resources items={p.story.resources} ui={p.ui} />{credits}{team}</>
  const caveats = tech?.caveats && tech.caveats.length > 0 && (
    <>
      <h2>{t('s.limits')}</h2>
      <ul className="caveats">
        {tech.caveats.map((c) => <li key={c}>{c}</li>)}
      </ul>
    </>
  )
  const why = p.slots.why || p.slots.los ? <>{p.slots.why}{p.slots.los}</> : null

  const all: { id: string; label: string; body: ReactNode }[] = sci
    ? [
        {
          id: 'analysis', label: t('s.tab.analysis'), body: (
            <>
              <p className="pair mono">{pairLine}</p>
              {p.slots.analysis}
              {tech && <details className="more"><summary>{t('s.method')}</summary><p className="lead tech">{tech.summary}</p></details>}
            </>
          ),
        },
        ...(p.slots.periods ? [{ id: 'periods', label: t('s.tab.periods'), body: p.slots.periods }] : []),
        {
          id: 'data', label: t('s.tab.data'), body: (
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
              {caveats}{p.slots.impact}{p.slots.los}
            </>
          ),
        },
        { id: 'sources', label: t('s.tab.sources'), body: sources },
      ]
    : [
        {
          id: 'overview', label: t('s.tab.overview'), body: (
            <>
              <p className="lead">{p.story.storyText}</p>
              {p.slots.actions}
              <details className="howto">
                <summary>{t('s.howto')}</summary>
                <ul>
                  {(p.story.copy?.howTo ?? [
                    t('s.howto.1', { sensor: p.story.sensor ?? 'NISAR' }),
                    t('s.howto.2'),
                    t('s.howto.3'),
                  ]).map((t) => <li key={t}>{t}</li>)}
                </ul>
              </details>
            </>
          ),
        },
        ...(p.slots.periods ? [{ id: 'periods', label: t('s.tab.periods'), body: p.slots.periods }] : []),
        ...(p.slots.impact ? [{ id: 'impact', label: t('s.tab.impact'), body: p.slots.impact }] : []),
        { id: 'learn', label: t('s.tab.learn'), body: <>{why}{sources}</> },
      ]
  // how many view buttons sit in the switcher, so the grid can lay them out in even rows
  const nViews = !sci ? 2 : bs ? 1 + (p.radar?.hv ? 1 : 0) + (p.radar?.hh ? 1 : 0) : 3 + (p.radar?.hh ? 1 : 0) + (p.radar?.hv ? 1 : 0)
  // Story mode keeps the first view simple: the other map views live in a menu that opens, picks one and closes again.
  const layerItems: LayerItem[] = bs
    ? [
        ...(p.radar?.hv ? [{ id: 'hv' as const, title: t('s.layer.hv'), sub: t('s.layer.hv.sub') }] : []),
        ...(p.radar?.hh ? [{ id: 'hh' as const, title: t('s.layer.changed'), sub: t('s.layer.changed.sub') }] : []),
      ]
    : [
        { id: 'fringes', title: t('s.layer.fringes'), sub: t('s.layer.fringes.sub') },
        { id: 'coherence', title: t('s.layer.conf'), sub: t('s.layer.conf.sub') },
        ...(p.radar?.hh ? [{ id: 'hh' as const, title: t('s.layer.surface'), sub: t('s.layer.surface.sub') }] : []),
        ...(p.radar?.hv ? [{ id: 'hv' as const, title: t('s.layer.hv'), sub: p.radar.hv.colormap === 'gray' ? t('s.layer.hv.sub') : t('s.layer.hvchange.sub') }] : []),
      ]
  const current = all.find((t) => t.id === tabs[p.ui]) ?? all[0]

  return (
    <aside className={`side ${sci ? 'sci' : ''} ${collapsed ? 'collapsed' : ''}`}>
      <div className="side-head">
        <div className="side-title">
          <h1>{sci && tech ? tech.title : p.story.title}</h1>
          <button className="collapse" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}
            aria-label={collapsed ? t('panel.show') : t('panel.hide')} title={collapsed ? t('panel.show') : t('panel.hide')}>{collapsed ? '+' : '–'}</button>
        </div>
        <p className="subtitle">{sci && tech?.subtitle ? tech.subtitle : p.story.subtitle}</p>
        {!collapsed && <>

        <div className="views" role="group" aria-label={t('s.mapView')} data-n={nViews}>
          <ViewBtn on={p.mode === 'los'} onClick={() => p.setMode('los')}
            title={(p.story.copy?.mainView ?? [t('s.view.motion'), 'LOS displacement'])[sci ? 1 : 0]}
            sub={bs ? (sci ? 'GCOV HHHH change, dB' : t('s.view.brighterDarker')) : sci ? 'Unwrapped, meters' : t('s.view.howFar')} />
          {!sci && <LayerMenu items={layerItems} mode={p.mode} setMode={p.setMode} />}
          {!bs && sci && <ViewBtn on={p.mode === 'fringes'} onClick={() => p.setMode('fringes')}
            title={sci ? 'Wrapped phase' : 'Fringes'} sub={sci ? 'One cycle per λ/2' : 'The raw radar pattern'} />}
          {!bs && sci && <ViewBtn on={p.mode === 'coherence'} onClick={() => p.setMode('coherence')}
            title={sci ? (p.coherence.label ?? 'Coherence') : 'Confidence'} sub={sci ? 'Quality mask, 0 to 1' : 'Where we can trust it'} />}
          {bs && sci && p.radar?.hv && <ViewBtn on={p.mode === 'hv'} onClick={() => p.setMode('hv')}
            title="Radar HV" sub={sci ? 'GCOV HVHV, dB' : 'Rough surfaces and plants'} />}
          {bs && sci && p.radar?.hh && <ViewBtn on={p.mode === 'hh'} onClick={() => p.setMode('hh')}
            title="What changed" sub={sci ? 'HH change vs the previous pass, dB' : 'Difference from the previous pass'} />}
          {!bs && sci && (p.radar?.hh || p.radar?.hv) && <>
            {p.radar.hh && <ViewBtn on={p.mode === 'hh'} onClick={() => p.setMode('hh')}
              title="Radar HH" sub={sci ? 'GCOV HHHH change, dB' : 'Ground-sensitive brightness change'} />}
            {p.radar.hv && <ViewBtn on={p.mode === 'hv'} onClick={() => p.setMode('hv')}
              title="Radar HV" sub={p.radar.hv.colormap === 'gray' ? (sci ? 'GCOV HVHV, dB' : 'Rough surfaces and plants') : sci ? 'GCOV HVHV change, dB' : 'Plant-sensitive brightness change'} />}
          </>}
        </div>

        <div className="legend">
          <div className="legend-title">{legend.title} {(sci || active.synthetic) && <Badge kind={active.badge} synthetic={active.synthetic} />}</div>
          <div className="bar" style={{ background: (radarLayer ?? (p.mode === 'los' ? p.displacement : undefined))?.colormap === 'gray' ? GRAY_GRADIENT : LEGEND_GRADIENTS[p.mode] }} />
          <div className="ends"><span>{legend.left}</span><span>{legend.right}</span></div>
        </div>

        <details className="settings">
          <summary>{sci ? 'About this layer and display settings' : t('s.colors')}</summary>
          {keyItems && (
            <ul className="key">
              {keyItems.map((k) => <li key={k.text}><i style={{ background: k.color }} />{k.text}</li>)}
            </ul>
          )}
          <p className="hint">{legend.hint}</p>
          {!bs && <label className="check">
            <input type="checkbox" checked={p.fadeLow} onChange={(e) => p.setFadeLow(e.target.checked)} />
            <span>{sci ? `Mask cells below the ${(p.coherence.label ?? 'coherence').toLowerCase()} threshold` : t('s.fade')}</span>
          </label>}
          {sci && !bs && p.fadeLow && (
            <label className="slider">
              {p.coherence.label ?? 'Coherence'} threshold: <b>{p.threshold.toFixed(2)}</b>
              <input type="range" min={0.1} max={0.9} step={0.05} value={p.threshold} onChange={(e) => p.setThreshold(Number(e.target.value))} />
            </label>
          )}
        </details>

        <div className="tabs" role="tablist" aria-label={t('panel.tabs')}>
          {all.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === current.id} className={t.id === current.id ? 'on' : ''}
              onClick={() => setTabs((s) => ({ ...s, [p.ui]: t.id }))}>{t.label}</button>
          ))}
        </div>
        </>}
      </div>

      {!collapsed && <div className="side-body" role="tabpanel">{current.body}</div>}
    </aside>
  )
}


/** Links from the challenge resource list. Story mode shows learning links; Scientist mode shows data links. */
function Resources({ items, ui }: { items?: Resource[]; ui: UiMode }) {
  const { t } = useI18n()
  if (!items?.length) return null
  const shown = items.filter((r) => r.audience === 'both' || r.audience === ui)
  const groups = (['learn', 'data', 'partner'] as const).filter((g) => shown.some((r) => r.group === g))
  return (
    <div className="res">
      {groups.map((g) => (
        <details key={g}>
          <summary>{t(`s.res.${g}`)}</summary>
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

interface LayerItem { id: ViewMode; title: string; sub: string }

/** "More layers": a menu that opens on click, lists the other map views with a line each, and closes when one is picked. */
function LayerMenu({ items, mode, setMode }: { items: LayerItem[]; mode: ViewMode; setMode: (m: ViewMode) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const active = items.find((i) => i.id === mode)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  if (!items.length) return null
  return (
    <div className="lmenu-wrap" ref={box}>
      <button className={`view layer-btn ${active ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <b>{active ? active.title : t('s.moreLayers')}</b>
        <i aria-hidden="true" />
      </button>
      {open && (
        <div className="lmenu" role="menu">
          {items.map((i) => (
            <button key={i.id} role="menuitemradio" aria-checked={i.id === mode} className={`lm-item ${i.id === mode ? 'on' : ''}`}
              onClick={() => { setMode(i.id); setOpen(false) }}>
              <span className="lm-title">{i.title}</span>
              <span className="lm-sub">{i.sub}</span>
            </button>
          ))}
        </div>
      )}
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
  /** Moves the timeline to the second pass, where the change is shown. */
  onJump?: () => void
  onClose: () => void
}

export function Inspector({ point, ui, displacement, coherence, threshold, showChange, sensor = 'NISAR', kind, radar, onJump, onClose }: InspectProps) {
  const { t } = useI18n()
  const bs = kind === 'backscatter'
  const sci = ui === 'scientist'
  const g = displacement.grid
  const d = sampleGrid(g, point[0], point[1])
  const c = sampleGrid(coherence.grid, point[0], point[1])
  const cm = d == null ? null : d * displacement.layer.displayScale
  const conf = c == null ? null : c >= 0.7 ? 'High' : c >= threshold ? 'Medium' : 'Low'
  const pos = displacement.layer.positiveMeans ?? t('s.toward')
  const neg = displacement.layer.negativeMeans ?? t('s.away')
  const dir = cm == null ? '' : cm > 0 ? pos : neg
  const [w, s, e, n] = g.bbox
  const col = Math.min(g.width - 1, Math.floor(((point[0] - w) / (e - w)) * g.width))
  const row = Math.min(g.height - 1, Math.floor(((n - point[1]) / (n - s)) * g.height))
  const sign = displacement.layer.provenance.signConvention

  return (
    <div className={`inspector ${sci ? 'sci' : ''}`} role="dialog" aria-label={t('s.point')}>
      <button className="x" onClick={onClose} aria-label={t('s.close')}>&times;</button>
      <div className="coords">{point[1].toFixed(sci ? 5 : 2)}&deg;, {point[0].toFixed(sci ? 5 : 2)}&deg;</div>
      {!showChange ? (
        <>
          <p>{bs ? t('s.insp.noPicture', { sensor }) : sci ? t('s.insp.noSecond', { sensor }) : t('s.insp.notYet')} {t('s.insp.move')}</p>
          {onJump && <button className="cta ghost" onClick={onJump}>{t('s.insp.jump')}</button>}
        </>
      ) : d == null ? (
        <p>{t('s.insp.outside')}</p>
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
              ? <p>{cm! > -5 ? t('s.insp.echo1') : cm! > -9 ? t('s.insp.echo2') : cm! > -14 ? t('s.insp.echo3') : t('s.insp.echo4')} {t('s.insp.echoNote')}</p>
              : <p>{Math.abs(cm!) < 1.5 ? t('s.insp.brightSame') : t('s.insp.brightDir', { dir })} {t('s.insp.brightNote')}</p>)
            : <p>{Math.abs(cm!) < 1 ? t('s.insp.still') : t('s.insp.moved', { dir })} {conf === 'Low' ? t('s.insp.low') : conf === 'High' ? t('s.insp.high') : t('s.insp.mid')}</p>}
          <Badge kind={displacement.layer.badge} synthetic={displacement.layer.synthetic} />
        </>
      )}
    </div>
  )
}
