import type { Grid, UsgsModel } from '../types'

export interface PhysicsResult {
  /** Pearson correlation between the USGS-predicted and NISAR-derived line-of-sight motion */
  r: number
  /** number of model cells compared */
  n: number
  /** observed / predicted amplitude, from a least-squares line */
  slope: number
  modelPeakCm: number
  obsPeakCm: number
}

/**
 * Projects the USGS finite-fault model (east, north, up in meters) onto the radar line of sight and
 * compares it with the NISAR-derived map, averaged over each model cell (about 20 km).
 *
 * Sign convention matches the map: positive = away from the satellite.
 * The satellite looks toward `lookAzimuthDeg` (clockwise from north) at `incidenceDeg` from vertical.
 * Both are approximate values from NASA's description, so this is a consistency check, not a validation.
 */
export function compareToModel(
  defo: Grid, model: UsgsModel, geom: { incidenceDeg: number; lookAzimuthDeg: number },
): PhysicsResult | null {
  const { lons, lats } = model
  if (lons.length < 3 || lats.length < 3) return null
  const dlon = (lons[lons.length - 1] - lons[0]) / (lons.length - 1)
  const dlat = (lats[lats.length - 1] - lats[0]) / (lats.length - 1)
  const th = (geom.incidenceDeg * Math.PI) / 180
  const az = (geom.lookAzimuthDeg * Math.PI) / 180
  const [w, s, e, n] = defo.bbox

  const pred: number[] = []
  const obs: number[] = []
  for (let j = 0; j < lats.length; j++) {
    for (let i = 0; i < lons.length; i++) {
      const ue = model.ue[j]?.[i]
      const un = model.un[j]?.[i]
      const uz = model.uz[j]?.[i]
      if (ue == null || un == null || uz == null) continue
      // block of NISAR cells under this model cell
      const x0 = ((lons[i] - dlon / 2 - w) / (e - w)) * defo.width
      const x1 = ((lons[i] + dlon / 2 - w) / (e - w)) * defo.width
      const y0 = ((n - (lats[j] + dlat / 2)) / (n - s)) * defo.height
      const y1 = ((n - (lats[j] - dlat / 2)) / (n - s)) * defo.height
      if (x0 < 0 || y0 < 0 || x1 > defo.width || y1 > defo.height) continue
      let sum = 0
      let count = 0
      let total = 0
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          total++
          const v = defo.values[y * defo.width + x]
          if (v != null) { sum += v; count++ }
        }
      }
      if (total === 0 || count / total < 0.7) continue
      // away from the satellite, in cm
      const away = (Math.sin(th) * (Math.sin(az) * ue + Math.cos(az) * un) - Math.cos(th) * uz) * 100
      pred.push(away)
      obs.push((sum / count) * 100)
    }
  }
  const nPts = pred.length
  if (nPts < 12) return null
  const mp = pred.reduce((a, b) => a + b, 0) / nPts
  const mo = obs.reduce((a, b) => a + b, 0) / nPts
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let k = 0; k < nPts; k++) {
    const dx = pred[k] - mp
    const dy = obs[k] - mo
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return null
  return {
    r: sxy / Math.sqrt(sxx * syy),
    n: nPts,
    slope: sxy / sxx,
    modelPeakCm: Math.max(...pred.map(Math.abs)),
    obsPeakCm: Math.max(...obs.map(Math.abs)),
  }
}
