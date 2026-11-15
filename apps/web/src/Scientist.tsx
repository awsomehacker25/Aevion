import type { OffsetEstimate, ProfilePoint } from './lib/analysis'
import type { PhysicsResult } from './lib/physics'
import type { Overlays, UsgsContext } from './types'

interface ProfileCtl {
  picking: boolean
  hasLine: boolean
  onStart: () => void
  onClear: () => void
}

export function ProfileControls(p: ProfileCtl) {
  return (
    <div className="tool">
      <h2>Cross-section</h2>
      <div className="row-btns">
        <button className={`cta ghost ${p.picking ? 'on' : ''}`} onClick={p.onStart} title="Click two points on the map to draw a line. The chart shows the ground motion along it, so a fault shows up as a step.">
          {p.picking ? 'Click two points on the map...' : p.hasLine ? 'Draw a new cross-section' : 'Draw a cross-section'}
        </button>
        {p.hasLine && <button className="btn" onClick={p.onClear}>Clear</button>}
      </div>
    </div>
  )
}

interface CardProps {
  points: ProfilePoint[]
  totalKm: number
  offset: OffsetEstimate | null
  threshold: number
  a: [number, number]
  b: [number, number]
  onClose: () => void
}

const W = 316
const H = 132
const PAD = { l: 34, r: 8, t: 8, b: 22 }

export function ProfileCard({ points, totalKm, offset, threshold, a, b, onClose }: CardProps) {
  const vals = points.filter((p) => p.d != null).map((p) => (p.d as number) * 100)
  const lim = Math.max(5, ...vals.map(Math.abs))
  const x = (km: number) => PAD.l + (km / Math.max(totalKm, 0.001)) * (W - PAD.l - PAD.r)
  const y = (cm: number) => PAD.t + (1 - (cm + lim) / (2 * lim)) * (H - PAD.t - PAD.b)

  let path = ''
  let pen = false
  for (const p of points) {
    if (p.d == null) { pen = false; continue }
    path += `${pen ? 'L' : 'M'}${x(p.km).toFixed(1)} ${y(p.d * 100).toFixed(1)} `
    pen = true
  }
  const spacing = totalKm / Math.max(points.length - 1, 1)
  const lows = points.filter((p) => p.c != null && p.c < threshold)

  return (
    <div className="profile-card" role="dialog" aria-label="Cross-section">
      <button className="x" onClick={onClose} aria-label="Close">&times;</button>
      <div className="coords">
        {a[1].toFixed(3)}, {a[0].toFixed(3)} to {b[1].toFixed(3)}, {b[0].toFixed(3)} &middot; {totalKm.toFixed(1)} km
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ground motion along the line">
        {lows.map((p) => (
          <rect key={p.km} x={x(p.km) - (spacing / totalKm) * (W - PAD.l - PAD.r) / 2} y={PAD.t} width={Math.max(1, (spacing / totalKm) * (W - PAD.l - PAD.r))} height={H - PAD.t - PAD.b} fill="#ff8a3d" opacity="0.18" />
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="#55637c" strokeDasharray="3 3" />
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} stroke="#55637c" />
        <text x={4} y={y(lim) + 4} fontSize="9" fill="#98a5ba">+{lim.toFixed(0)}</text>
        <text x={4} y={y(0) + 3} fontSize="9" fill="#98a5ba">0</text>
        <text x={4} y={y(-lim) + 2} fontSize="9" fill="#98a5ba">-{lim.toFixed(0)}</text>
        <text x={PAD.l} y={H - 6} fontSize="9" fill="#98a5ba">0 km</text>
        <text x={W - PAD.r} y={H - 6} fontSize="9" fill="#98a5ba" textAnchor="end">{totalKm.toFixed(0)} km</text>
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 6} fontSize="9" fill="#98a5ba" textAnchor="middle">cm along line of sight</text>
        <path d={path} fill="none" stroke="#86a9ff" strokeWidth="1.8" />
        {offset && <line x1={x(offset.atKm)} x2={x(offset.atKm)} y1={PAD.t} y2={H - PAD.b} stroke="#fff" strokeOpacity="0.55" strokeDasharray="2 3" />}
      </svg>
      {offset ? (
        <p>
          Sharpest step: <b>{Math.abs(offset.step * 100).toFixed(1)} cm</b> at {offset.atKm.toFixed(0)} km
          (averaged 6 km either side). Peak to peak along the line: {(offset.peakToPeak * 100).toFixed(1)} cm.
        </p>
      ) : (
        <p>Not enough valid data along this line to estimate a step.</p>
      )}
      <p className="hint">Orange shading marks stretches with low coverage. Values are relative to an unknown reference.</p>
    </div>
  )
}

interface ToggleProps {
  overlays: Overlays
  setOverlays: (f: (o: Overlays) => Overlays) => void
}

export function PhysicsCheck({ context, result, geometry, overlays, setOverlays }: ToggleProps & {
  context?: UsgsContext
  result: PhysicsResult | null
  geometry?: { incidenceDeg: number; lookAzimuthDeg: number }
}) {
  if (!context) return null
  const strength = (r: number) => (r >= 0.7 ? 'strong' : r >= 0.4 ? 'moderate' : 'weak')
  return (
    <div className="tool">
      <h2>Does the physics agree?</h2>
      <ul className="mech">
        {context.events.filter((e) => e.mechanism).map((e) => {
          const pl = e.mechanism!.planes.find((q) => q.kind.startsWith('right')) ?? e.mechanism!.planes[0]
          return (
            <li key={e.id}>
              <b>M{e.mag}</b> (USGS moment tensor): {pl.kind}, plane strike {pl.strike.toFixed(0)}&deg;, dip {pl.dip.toFixed(0)}&deg;, rake {pl.rake.toFixed(0)}&deg;
            </li>
          )
        })}
      </ul>
      {result ? (
        <div className="phys">
          <div className="phys-line">
            <span className={`pill ${result.r > 0 ? 'ok' : 'bad'}`}>{result.r > 0 ? 'Sign agrees' : 'Sign disagrees'}</span>
            <span className="pill neutral">{strength(result.r)} pattern match, r = {result.r.toFixed(2)}</span>
          </div>
          <details className="more"><summary>How this was checked</summary>
          <p className="hint">
            Right-lateral slip on an east-west fault should move the south side west and the north side east, which is the orange south, blue north pattern in the map.{' '}
            Compared with the USGS finite-fault model of the M7.5 projected onto the radar line of sight ({result.n} model cells of about 20 km
            {geometry ? `, incidence ${geometry.incidenceDeg}°, look azimuth ${geometry.lookAzimuthDeg}°` : ''}).
            The amplitude does not match: the model peaks near {result.modelPeakCm.toFixed(0)} cm and the radar map near {result.obsPeakCm.toFixed(0)} cm, with a fitted ratio of {result.slope.toFixed(2)}.
            Likely reasons: the ARIA map is deramped, near-fault cells have no radar data, and the model is coarse and not fit to this data.
            This is a consistency check, not a validation.
          </p></details>
        </div>
      ) : (
        <p className="hint">Not enough overlap with the USGS model to compare.</p>
      )}
      <div className="toggles">
        <label><input type="checkbox" checked={overlays.mechanisms} onChange={(e) => setOverlays((o) => ({ ...o, mechanisms: e.target.checked }))} /> Show fault mechanisms (beach balls)</label>
        <label><input type="checkbox" checked={overlays.fault} onChange={(e) => setOverlays((o) => ({ ...o, fault: e.target.checked }))} /> Show USGS fault slip model</label>
      </div>
    </div>
  )
}
