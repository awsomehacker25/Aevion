import { useMemo } from 'react'
import type { Grid, LayerDef, Story, TourStep } from './types'
import { useI18n } from './i18n'

export function WhyCards({ items }: { items?: Story['why'] }) {
  const { t } = useI18n()
  if (!items?.length) return null
  return (
    <div className="why">
      <h2>{t('s.why')}</h2>
      {items.map((c) => (
        <details key={c.title}>
          <summary>{c.title}</summary>
          <p>{c.body}</p>
        </details>
      ))}
    </div>
  )
}

/** A simple side-view of how the satellite looks at the ground and what orange and blue mean. */
const COMPASS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast',
  'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest']
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]

export function LosDiagram({ sci, incidence, azimuth }: { sci: boolean; incidence?: number; azimuth?: number }) {
  const { t } = useI18n()
  return (
    <details className="los">
      <summary>{sci ? 'Viewing geometry' : t('s.los.title')}</summary>
      <svg viewBox="0 0 300 160" role="img" aria-label={t('s.los.aria')}>
        <defs>
          <marker id="arrO" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#f39237" /></marker>
          <marker id="arrB" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#3b8fd4" /></marker>
        </defs>
        <path d="M0 132 Q60 118 110 124 T220 128 T300 120 L300 160 L0 160 Z" fill="#2a3a2a" />
        <g transform="translate(236 26)">
          <rect x="-9" y="-6" width="18" height="12" rx="2" fill="#cdd8ef" />
          <rect x="-34" y="-3" width="22" height="6" fill="#6aa5ff" />
          <rect x="12" y="-3" width="22" height="6" fill="#6aa5ff" />
        </g>
        <line x1="236" y1="34" x2="116" y2="122" stroke="#9fb4d9" strokeWidth="1.6" strokeDasharray="5 4" />
        <circle cx="116" cy="124" r="4.5" fill="#fff" />
        <line x1="128" y1="100" x2="86" y2="131" stroke="#f39237" strokeWidth="3" markerEnd="url(#arrO)" />
        <line x1="132" y1="148" x2="174" y2="117" stroke="#3b8fd4" strokeWidth="3" markerEnd="url(#arrB)" />
        <text x="14" y="104" fill="#f39237" fontSize="10.5" fontWeight="600">{t('s.los.away')}</text>
        <text x="150" y="150" fill="#74b6ff" fontSize="10.5" fontWeight="600">{t('s.los.toward')}</text>
        <text x="196" y="64" fill="#9fb4d9" fontSize="10">{t('s.los.line')}</text>
      </svg>
      <p>
        {sci
          ? `The satellite looks left of its path at about ${incidence ?? 40} degrees from vertical, toward ${azimuth ?? 260} degrees (${compass(azimuth ?? 260)}). A single pass only measures the part of the motion along this line, so it cannot separate up, down, east and west.`
          : t('s.los.body')}
      </p>
    </details>
  )
}

export function TourButton({ onStart, available }: { onStart: () => void; available: boolean }) {
  const { t } = useI18n()
  if (!available) return null
  return (
    <button className="cta" onClick={onStart}>{t('s.tour.start')}</button>
  )
}

export function ReplayButton({ running, onStart, onStop }: { running: boolean; onStart: () => void; onStop: () => void }) {
  const { t } = useI18n()
  return (
    <button className="cta ghost" onClick={running ? onStop : onStart} aria-pressed={running}>
      {running ? t('s.replay.stop') : t('s.replay')}
    </button>
  )
}

export function TourCard(p: { steps: TourStep[]; index: number; onPrev: () => void; onNext: () => void; onExit: () => void }) {
  const { t } = useI18n()
  const step = p.steps[p.index]
  const last = p.index === p.steps.length - 1
  return (
    <div className="tour" role="dialog" aria-label={t('s.tour.aria')}>
      <div className="tour-top">
        <span className="tour-count">{t('s.tour.step', { i: p.index + 1, n: p.steps.length })}</span>
        <button className="x" onClick={p.onExit} aria-label={t('s.tour.exit')}>&times;</button>
      </div>
      <h3>{step.title}</h3>
      <p>{step.text}</p>
      <div className="tour-dots" aria-hidden="true">
        {p.steps.map((s, i) => <i key={s.title} className={i === p.index ? 'on' : ''} />)}
      </div>
      <div className="tour-nav">
        <button className="btn" onClick={p.onPrev} disabled={p.index === 0}>{t('s.back')}</button>
        <button className="btn primary" onClick={last ? p.onExit : p.onNext}>{last ? t('s.finish') : t('s.next')}</button>
      </div>
    </div>
  )
}

/** A one-line summary of how big the change is, so it is obvious without reading colors. */
export function ChangeStat({ layer, grid, coherence, threshold }: { layer: LayerDef; grid: Grid; coherence: Grid; threshold: number }) {
  const { t } = useI18n()
  const ext = useMemo(() => {
    const v: number[] = []
    for (let i = 0; i < grid.values.length; i++) {
      const d = grid.values[i]
      const c = coherence.values[i]
      if (d != null && Number.isFinite(d) && c != null && c >= threshold) v.push(d)
    }
    if (v.length < 100) return null
    v.sort((a, b) => a - b)
    return { lo: v[Math.floor(v.length * 0.005)], hi: v[Math.floor(v.length * 0.995)] }
  }, [grid, coherence, threshold])
  if (!ext) return null
  const fmt = (x: number) => `${Math.abs(x * layer.displayScale).toFixed(1)} ${layer.displayUnits}`
  return (
    <p className="stat">
      <b>{t('s.stat.title')}</b><br />
      {t('s.stat.up')} <span className="aw">{fmt(ext.hi)} {layer.positiveMeans ?? t('s.awayShort')}</span> {t('s.and')}{' '}
      <span className="tw">{fmt(ext.lo)} {layer.negativeMeans ?? t('s.towardShort')}</span> {t('s.stat.note')}
    </p>
  )
}
