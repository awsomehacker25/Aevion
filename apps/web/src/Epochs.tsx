import { useEffect, useMemo, useRef, useState } from 'react'
import { eventTime, periodDates, periodTitle, sortEpochs } from './lib/periods'
import type { VentMotion } from './lib/periods'
import type { Epoch, StoryCopy } from './types'
import { useI18n } from './i18n'
import { ChevronDown, ChevronLeft, ChevronRight } from './Icons'

type Chart = NonNullable<StoryCopy['chart']>
const DEFAULT_CHART: Chart = { title: '', unit: 'mm', scale: 1000, minLim: 20, hint: '' }
const valText = (v: number | null | undefined, c: Chart, none = 'no data') =>
  v == null ? none : `${v > 0 ? '+' : ''}${v.toFixed(c.digits ?? 0)} ${c.unit}`

interface PickProps {
  epochs: Epoch[]
  motion: VentMotion | null
  selected: string
  onSelect: (id: string) => void
  /** Chart wording and units (from story.copy.chart). */
  chart?: StoryCopy['chart']
}

/** All periods as rows: title, dates, event time and the motion at the vent. */
export function PeriodList({ epochs, motion, selected, onSelect, chart, role = 'list' }: PickProps & { role?: 'list' | 'listbox' }) {
  const { t: tr } = useI18n()
  const rows = useMemo(() => sortEpochs(epochs), [epochs])
  const c = chart ?? DEFAULT_CHART
  return (
    <div className="plist" role={role} aria-label={tr('s.periods.list')}>
      {rows.map((e) => {
        const on = e.id === selected
        const mm = motion?.[e.id]
        const t = eventTime(e)
        return (
          <button key={e.id} type="button" className={`prow ${on ? 'on' : ''}`} role={role === 'listbox' ? 'option' : undefined}
            aria-selected={role === 'listbox' ? on : undefined} aria-pressed={role === 'list' ? on : undefined} onClick={() => onSelect(e.id)}>
            <span className={`pdot ${e.event ? 'ev' : ''}`} aria-hidden="true" />
            <span className="ptext">
              <b>{periodTitle(e)}</b> <span className="pdates">{periodDates(e)}</span>
              {t && <span className="ptime">{t}</span>}
            </span>
            {motion && <span className={`pmm ${mm == null ? '' : mm < 0 ? 'neg' : 'pos'}`}>{valText(mm, c, tr('s.nodata'))}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** The always-visible control: previous, a menu of all periods, next. Lives in the timeline header. */
export function PeriodSwitcher({ epochs, motion, selected, onSelect, onStep, chart }: PickProps & { onStep: (delta: number) => void }) {
  const { t: tr } = useI18n()
  const rows = useMemo(() => sortEpochs(epochs), [epochs])
  const idx = rows.findIndex((e) => e.id === selected)
  const cur = rows[idx]
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (ev: MouseEvent) => { if (box.current && !box.current.contains(ev.target as Node)) setOpen(false) }
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  if (!cur) return null
  return (
    <div className="pswitch" ref={box} role="group" aria-label={tr('s.periods.one')}>
      <button type="button" className="btn ps-step" onClick={() => onStep(-1)} disabled={idx <= 0} aria-label={tr('s.periods.prev')} title={tr('s.periods.prevTip')}><ChevronLeft /></button>
      <button type="button" className="btn ps-label" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} title={tr('s.periods.choose')}>
        <span className="ps-dates">{periodDates(cur)}</span>
        <ChevronDown />
      </button>
      <button type="button" className="btn ps-step" onClick={() => onStep(1)} disabled={idx >= rows.length - 1} aria-label={tr('s.periods.next')} title={tr('s.periods.nextTip')}><ChevronRight /></button>
      {open && (
        <div className="pmenu">
          <PeriodList epochs={epochs} motion={motion} selected={selected} chart={chart} onSelect={(id) => { onSelect(id); setOpen(false) }} role="listbox" />
        </div>
      )}
    </div>
  )
}

const W = 316
const H = 150
const PAD = { l: 30, r: 6, t: 14, b: 34 }

/** Mean ground motion near the vent for each 12-day period, as bars. Click a bar to view that period. */
export function EpochChart({ epochs, motion, selected, onSelect, chart }: PickProps) {
  const { t: tr, date } = useI18n()
  const c = chart ?? { ...DEFAULT_CHART, title: tr('s.epoch.title'), ariaLabel: tr('s.epoch.aria'), hint: tr('s.epoch.hint') }
  const rows = useMemo(() => sortEpochs(epochs).map((e) => ({ e, mm: motion?.[e.id] ?? null })), [epochs, motion])
  const lim = Math.max(c.minLim, ...rows.map((r) => Math.abs(r.mm ?? 0)))
  const tick = (x: number) => x.toFixed(lim < 10 ? 1 : 0)
  const slot = (W - PAD.l - PAD.r) / rows.length
  const y = (mm: number) => PAD.t + (1 - (mm + lim) / (2 * lim)) * (H - PAD.t - PAD.b)
  const short = (d: string) => date(d, { month: 'short', day: 'numeric', year: undefined })

  return (
    <div className="epochs">
      <b>{c.title}</b>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={c.ariaLabel ?? c.title}>
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="#55637c" strokeDasharray="3 3" />
        <text x={2} y={y(lim) + 4} fontSize="9" fill="#98a5ba">+{tick(lim)}</text>
        <text x={2} y={y(0) + 3} fontSize="9" fill="#98a5ba">0</text>
        <text x={2} y={y(-lim) + 4} fontSize="9" fill="#98a5ba">-{tick(lim)}</text>
        <text x={2} y={9} fontSize="8" fill="#98a5ba">{c.unit}</text>
        {rows.map(({ e, mm }, i) => {
          const x = PAD.l + i * slot + slot * 0.16
          const bw = slot * 0.68
          const on = e.id === selected
          const top = mm == null ? y(0) : Math.min(y(0), y(mm))
          const ht = mm == null ? 0 : Math.max(1.5, Math.abs(y(mm) - y(0)))
          return (
            <g key={e.id} role="button" tabIndex={0} className={`ep-bar ${on ? 'on' : ''}`}
              aria-label={`${periodTitle(e)}, ${periodDates(e)}: ${valText(mm, c, tr('s.nodata'))}`}
              aria-pressed={on} onClick={() => onSelect(e.id)}
              onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(e.id) } }}>
              <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={H - PAD.t - PAD.b} fill="transparent" />
              <rect x={x} y={top} width={bw} height={ht} fill={mm != null && mm < 0 ? '#3b8fd4' : '#f39237'} stroke={on ? '#fff' : 'none'} strokeWidth="2" />
              <text x={x + bw / 2} y={H - 20} fontSize="8.5" textAnchor="middle" fill={on ? '#fff' : '#98a5ba'}>{short(c.label === 'end' ? e.pair.secondary : e.pair.reference)}</text>
              {e.event && (
                <g>
                  <circle cx={x + bw / 2} cy={H - 8} r="3.5" fill="#d92d20" />
                  <title>{e.event.name}</title>
                </g>
              )}
            </g>
          )
        })}
      </svg>
      <p className="hint">{c.hint}</p>
    </div>
  )
}
