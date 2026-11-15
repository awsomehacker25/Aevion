import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * One small SVG chart used by every story: bars, lines and dots on a numeric x axis (a true time axis or plain 0, 1, 2 for categories),
 * with optional vertical markers, horizontal reference lines and a selected point. Colours are CSS values so they follow the theme.
 */
export interface ChartPoint {
  x: number
  y: number | null
  /** Native tooltip text. */
  tip?: string
  /** Colour override for this point (bars and dots). */
  color?: string
}

export interface ChartSeries {
  id: string
  kind: 'bar' | 'line' | 'dot'
  color: string
  points: ChartPoint[]
  /** Bar width in px (default 18). Dot radius for dots. */
  size?: number
  /** Bar width in x units (for example one day on a time axis); takes the place of size. */
  barUnit?: number
  /** Draw a small dot on every line vertex. */
  vertices?: boolean
  dashed?: boolean
}

export interface ChartMarker { x: number; label?: string; dashed?: boolean; color?: string }
export interface ChartRef { y: number; label?: string; color?: string; dashed?: boolean }
export interface ChartTick { x: number; label: string }

export interface ChartProps {
  series: ChartSeries[]
  xDomain: [number, number]
  xTicks: ChartTick[]
  yDomain?: [number, number]
  yTicks?: number
  /** Formats the y tick labels. */
  yFormat?: (v: number) => string
  height?: number
  /** Extra room (px) at both ends of the x axis so a bar on the first or last date is not cut off. */
  xPad?: number
  markers?: ChartMarker[]
  refs?: ChartRef[]
  /** Index of the bar or point to highlight, for the first series that has points at this x. */
  selectedX?: number
  secondX?: number
  onSelect?: (x: number) => void
  /** Show value labels above bars. */
  barLabels?: (p: ChartPoint) => string | null
  /** Hide the y axis labels (used when a title says it all). */
  hideY?: boolean
  label: string
  /** Left margin in px (room for y labels). */
  left?: number
  children?: ReactNode
}

const nice = (lo: number, hi: number, n: number): { lo: number; hi: number; ticks: number[] } => {
  if (hi === lo) hi = lo + 1
  const raw = (hi - lo) / Math.max(1, n)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const a = Math.floor(lo / step) * step
  const b = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Math.round(v / step) * step)
  return { lo: a, hi: b, ticks }
}

/** Drops x labels that would overlap the one before them. */
function thin(ticks: ChartTick[], X: (x: number) => number, gap = 44): ChartTick[] {
  const out: ChartTick[] = []
  let last = -Infinity
  for (const t of [...ticks].filter((q) => q.label).sort((a, b) => a.x - b.x)) {
    const px = X(t.x)
    if (px - last >= gap) { out.push(t); last = px }
  }
  return out
}

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(320)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(120, Math.round(el.clientWidth))))
    ro.observe(el)
    setW(Math.max(120, Math.round(el.clientWidth)))
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

export default function Chart(p: ChartProps) {
  const [box, W] = useWidth<HTMLDivElement>()
  const H = p.height ?? 130
  const L = p.left ?? (p.hideY ? 6 : 38)
  const R = 8, T = 14, B = 22
  const pad = p.xPad ?? 12
  const iw = Math.max(10, W - L - R - 2 * pad)
  const ih = H - T - B
  const [xa, xb] = p.xDomain
  const X = (x: number) => L + pad + ((x - xa) / (xb - xa || 1)) * iw

  const ys = p.series.flatMap((s) => s.points.map((q) => q.y).filter((v): v is number => v != null))
  const hasBars = p.series.some((s) => s.kind === 'bar')
  const dLo = p.yDomain ? p.yDomain[0] : hasBars ? 0 : Math.min(...ys, 0)
  const dHi = p.yDomain ? p.yDomain[1] : Math.max(...ys, 1) * 1.08
  const sc = p.yDomain ? { lo: dLo, hi: dHi, ticks: nice(dLo, dHi, p.yTicks ?? 3).ticks.filter((v) => v >= dLo - 1e-9 && v <= dHi + 1e-9) } : nice(dLo, dHi, p.yTicks ?? 3)
  const Y = (y: number) => T + ih - ((y - sc.lo) / (sc.hi - sc.lo || 1)) * ih
  const fmt = p.yFormat ?? ((v: number) => String(Math.round(v * 100) / 100))

  return (
    <div ref={box} className="chart">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={p.label}>
        {sc.ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="c-grid" />
            {!p.hideY && <text x={L - 6} y={Y(v) + 3.5} textAnchor="end" className="c-tick">{fmt(v)}</text>}
          </g>
        ))}
        {p.markers?.map((m, i) => (
          <g key={i}>
            <line x1={X(m.x)} x2={X(m.x)} y1={T} y2={T + ih} className="c-marker" stroke={m.color} strokeDasharray={m.dashed === false ? undefined : '3 3'} />
            {m.label && <text x={X(m.x)} y={T - 3} textAnchor="middle" className="c-mlabel">{m.label}</text>}
          </g>
        ))}
        {p.refs?.map((r, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={Y(r.y)} y2={Y(r.y)} className="c-ref" stroke={r.color} strokeDasharray={r.dashed === false ? undefined : '5 4'} />
            {r.label && <text x={W - R - 2} y={Y(r.y) - 4} textAnchor="end" className="c-rlabel" fill={r.color}>{r.label}</text>}
          </g>
        ))}
        {p.series.map((s) => {
          if (s.kind === 'line') {
            const segs: string[] = []
            let cur = ''
            for (const q of s.points) {
              if (q.y == null) { if (cur) segs.push(cur); cur = ''; continue }
              cur += `${cur ? 'L' : 'M'}${X(q.x).toFixed(1)} ${Y(q.y).toFixed(1)}`
            }
            if (cur) segs.push(cur)
            return (
              <g key={s.id}>
                {segs.map((d, i) => <path key={i} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" />)}
                {s.vertices && s.points.map((q, i) => q.y != null && (
                  <circle key={i} cx={X(q.x)} cy={Y(q.y)} r={p.selectedX === q.x ? 5 : 2.8} fill={p.selectedX === q.x ? 'var(--ink)' : s.color} stroke={s.color} strokeWidth={p.selectedX === q.x ? 2 : 1}>
                    {q.tip && <title>{q.tip}</title>}
                  </circle>
                ))}
              </g>
            )
          }
          if (s.kind === 'dot') {
            return (
              <g key={s.id}>
                {s.points.map((q, i) => q.y != null && (
                  <circle key={i} cx={X(q.x)} cy={Y(q.y)} r={s.size ?? 4} fill={q.color ?? s.color} fillOpacity={0.85} stroke="var(--surface)" strokeWidth={1}>
                    {q.tip && <title>{q.tip}</title>}
                  </circle>
                ))}
              </g>
            )
          }
          const bw = s.barUnit != null ? Math.max(2, (s.barUnit / (xb - xa || 1)) * iw) : s.size ?? 18
          return (
            <g key={s.id}>
              {s.points.map((q, i) => {
                if (q.y == null) return null
                const sel = p.selectedX === q.x
                const y0 = Y(Math.max(0, sc.lo)), y1 = Y(q.y)
                const top = Math.min(y0, y1)
                const h = Math.max(q.y === 0 ? 1.5 : 1, Math.abs(y0 - y1))
                const lbl = p.barLabels?.(q)
                return (
                  <g key={i}>
                    <rect x={X(q.x) - bw / 2} y={top} width={bw} height={h} fill={q.color ?? s.color} fillOpacity={sel || p.selectedX == null ? 1 : 0.7}
                      stroke={sel ? 'var(--ink)' : 'none'} strokeWidth={sel ? 1.5 : 0}
                      className={p.onSelect ? 'c-click' : undefined} onClick={p.onSelect ? () => p.onSelect!(q.x) : undefined}>
                      {q.tip && <title>{q.tip}</title>}
                    </rect>
                    {lbl && <text x={X(q.x)} y={top - 4} textAnchor="middle" className={`c-blabel ${sel ? 'sel' : ''}`}>{lbl}</text>}
                  </g>
                )
              })}
            </g>
          )
        })}
        {p.secondX != null && (
          <path d={`M${X(p.secondX)} ${T + ih + 4} l-5 6 h10 z`} className="c-diamond"><title>compare</title></path>
        )}
        {thin(p.xTicks, X).map((t) => <text key={t.x + t.label} x={X(t.x)} y={H - 6} textAnchor="middle" className="c-tick">{t.label}</text>)}
        <line x1={L} x2={W - R} y1={T + ih} y2={T + ih} className="c-axis" />
        {p.children}
      </svg>
    </div>
  )
}
