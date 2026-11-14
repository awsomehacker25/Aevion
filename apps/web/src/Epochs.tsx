import { useMemo } from 'react'
import { areaMean } from './lib/analysis'
import type { Epoch, Grid } from './types'

interface Props {
  epochs: Epoch[]
  grids: Record<string, { deformation: Grid }>
  selected: string
  vent: { lon: number; lat: number }
  onSelect: (id: string) => void
}

const W = 316
const H = 150
const PAD = { l: 30, r: 6, t: 14, b: 34 }
const RADIUS_CELLS = 15 // about 2 km

/** Mean ground motion near the vent for each 12-day period, as bars. Click a bar to view that period. */
export function EpochChart({ epochs, grids, selected, vent, onSelect }: Props) {
  const rows = useMemo(
    () => [...epochs].sort((a, b) => a.pair.reference.localeCompare(b.pair.reference)).map((e) => {
      const g = grids[e.id]?.deformation
      const v = g ? areaMean(g, vent.lon, vent.lat, RADIUS_CELLS) : null
      return { e, mm: v == null ? null : v * 1000 }
    }),
    [epochs, grids, vent.lon, vent.lat],
  )
  const lim = Math.max(20, ...rows.map((r) => Math.abs(r.mm ?? 0)))
  const slot = (W - PAD.l - PAD.r) / rows.length
  const y = (mm: number) => PAD.t + (1 - (mm + lim) / (2 * lim)) * (H - PAD.t - PAD.b)
  const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

  return (
    <div className="epochs">
      <b>Ground motion at the vent, period by period</b>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Mean line-of-sight motion near the vent for each 12-day period">
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="#6b7a99" strokeDasharray="3 3" />
        <text x={2} y={y(lim) + 4} fontSize="9" fill="#93a3c4">+{lim.toFixed(0)}</text>
        <text x={2} y={y(0) + 3} fontSize="9" fill="#93a3c4">0</text>
        <text x={2} y={y(-lim) + 4} fontSize="9" fill="#93a3c4">-{lim.toFixed(0)}</text>
        <text x={2} y={9} fontSize="8" fill="#93a3c4">mm</text>
        {rows.map(({ e, mm }, i) => {
          const x = PAD.l + i * slot + slot * 0.16
          const bw = slot * 0.68
          const on = e.id === selected
          const top = mm == null ? y(0) : Math.min(y(0), y(mm))
          const ht = mm == null ? 0 : Math.max(1.5, Math.abs(y(mm) - y(0)))
          return (
            <g key={e.id} role="button" tabIndex={0} className={`ep-bar ${on ? 'on' : ''}`}
              aria-label={`${e.label}${e.event ? `, ${e.event.name}` : ', no eruption episode'}: ${mm == null ? 'no data' : `${mm.toFixed(0)} millimeters`}`}
              aria-pressed={on} onClick={() => onSelect(e.id)}
              onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(e.id) } }}>
              <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={H - PAD.t - PAD.b} fill="transparent" />
              <rect x={x} y={top} width={bw} height={ht} rx="2" fill={mm != null && mm < 0 ? '#3b8fd4' : '#f39237'} stroke={on ? '#fff' : 'none'} strokeWidth="2" />
              <text x={x + bw / 2} y={H - 20} fontSize="8.5" textAnchor="middle" fill={on ? '#fff' : '#93a3c4'}>{short(e.pair.reference)}</text>
              {e.event && (
                <g>
                  <circle cx={x + bw / 2} cy={H - 8} r="3.5" fill="#ff5a4d" />
                  <title>{e.event.name}</title>
                </g>
              )}
            </g>
          )
        })}
      </svg>
      <p className="hint">Each bar is one 12-day NISAR period (start date shown). Orange is motion away from the satellite, blue toward it. A red dot marks an eruption episode in that period (USGS HVO timeline, to verify). Click a bar to see that period on the map.</p>
    </div>
  )
}
