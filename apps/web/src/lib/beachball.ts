const cache = new Map<string, string>()

/**
 * Draws a focal-mechanism "beach ball" (lower hemisphere, equal-area) for a double-couple source
 * given strike, dip and rake in degrees (Aki and Richards convention). Dark = compression.
 * Returns a PNG data URL, or an empty string if no canvas is available.
 */
export function beachball(strike: number, dip: number, rake: number, size = 72): string {
  const key = `${strike}|${dip}|${rake}|${size}`
  const hit = cache.get(key)
  if (hit) return hit
  const cv = document.createElement('canvas')
  cv.width = size
  cv.height = size
  const ctx = cv.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(size, size)

  const rad = Math.PI / 180
  const phi = strike * rad
  const del = dip * rad
  const lam = rake * rad
  // fault normal and slip vector in (north, east, down)
  const nv = [-Math.sin(del) * Math.sin(phi), Math.sin(del) * Math.cos(phi), -Math.cos(del)]
  const lv = [
    Math.cos(lam) * Math.cos(phi) + Math.cos(del) * Math.sin(lam) * Math.sin(phi),
    Math.cos(lam) * Math.sin(phi) - Math.cos(del) * Math.sin(lam) * Math.cos(phi),
    -Math.sin(lam) * Math.sin(del),
  ]

  const c = (size - 1) / 2
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px - c) / c // east
      const y = -(py - c) / c // north
      const rr = Math.hypot(x, y)
      const idx = (py * size + px) * 4
      if (rr > 1) { img.data[idx + 3] = 0; continue }
      const takeoff = 2 * Math.asin(Math.min(1, rr / Math.SQRT2))
      const az = Math.atan2(x, y)
      const g = [Math.sin(takeoff) * Math.cos(az), Math.sin(takeoff) * Math.sin(az), Math.cos(takeoff)]
      const amp = (g[0] * nv[0] + g[1] * nv[1] + g[2] * nv[2]) * (g[0] * lv[0] + g[1] * lv[1] + g[2] * lv[2])
      const edge = rr > 0.94
      const dark = amp > 0
      const v = edge ? 245 : dark ? 28 : 245
      img.data[idx] = v
      img.data[idx + 1] = v
      img.data[idx + 2] = edge ? 245 : dark ? 34 : 245
      img.data[idx + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const url = cv.toDataURL('image/png')
  cache.set(key, url)
  return url
}
