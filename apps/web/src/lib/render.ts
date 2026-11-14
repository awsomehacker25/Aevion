import type { Grid, ViewMode } from '../types'

/**
 * L-band wavelength in meters: c / 1.239 GHz, the centerFrequency stored in the NISAR GUNW granule.
 * One fringe = half a wavelength (about 12 cm) of line-of-sight motion.
 */
export const LAMBDA = 0.24196

type RGB = [number, number, number]
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

function ramp(stops: string[], t: number): RGB {
  const c = stops.map(hex)
  const x = Math.min(1, Math.max(0, t)) * (c.length - 1)
  const i = Math.min(c.length - 2, Math.floor(x))
  return mix(c[i], c[i + 1], x - i)
}

// Blue-white-orange: readable for most color-blind viewers (not red/green).
const DIVERGING = ['#1d4f91', '#3b8fd4', '#f4f4f4', '#f39237', '#b8430a']
const CONFIDENCE = ['#0b0b1a', '#3b1f6b', '#8a2f87', '#e0556a', '#ffd479']

export const LEGEND_GRADIENTS: Record<ViewMode, string> = {
  los: `linear-gradient(90deg, ${DIVERGING.join(',')})`,
  fringes: 'linear-gradient(90deg, hsl(0 85% 55%), hsl(60 85% 55%), hsl(120 85% 45%), hsl(180 85% 45%), hsl(240 85% 60%), hsl(300 85% 55%), hsl(360 85% 55%))',
  coherence: `linear-gradient(90deg, ${CONFIDENCE.join(',')})`,
}

export interface RenderOpts {
  mode: ViewMode
  range: [number, number]
  fadeLow: boolean
  threshold: number
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function bilinear(g: Grid, fx: number, fy: number): number {
  const x0 = Math.min(g.width - 1, Math.max(0, Math.floor(fx)))
  const y0 = Math.min(g.height - 1, Math.max(0, Math.floor(fy)))
  const x1 = Math.min(g.width - 1, x0 + 1)
  const y1 = Math.min(g.height - 1, y0 + 1)
  const tx = fx - x0
  const ty = fy - y0
  const v = (x: number, y: number) => g.values[y * g.width + x]
  const a = v(x0, y0), b = v(x1, y0), c = v(x0, y1), d = v(x1, y1)
  if (a == null || b == null || c == null || d == null) return NaN // gap in the data
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}

function hsl(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/** Draws the selected view to a PNG data URL, upsampled 2x with bilinear interpolation. */
export function renderOverlay(defo: Grid, coh: Grid, o: RenderOpts): string {
  const S = defo.width >= 400 ? 1 : 2 // big grids are already detailed; keep redraws fast
  const W = defo.width * S
  const H = defo.height * S
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(W, H)
  const [lo, hi] = o.range
  const half = Math.max(Math.abs(lo), Math.abs(hi))

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / S - 0.5
      const fy = (y + 0.5) / S - 0.5
      const d = bilinear(defo, fx, fy)
      let c = bilinear(coh, fx, fy)
      if (Number.isNaN(d) || (o.mode === 'coherence' && Number.isNaN(c))) continue // no data: stay transparent
      if (Number.isNaN(c)) c = 0
      let rgb: RGB
      let a: number
      if (o.mode === 'los') {
        const t = d / half // -1..1
        rgb = ramp(DIVERGING, (t + 1) / 2)
        a = 0.22 + 0.7 * Math.pow(Math.min(1, Math.abs(t)), 0.55)
      } else if (o.mode === 'fringes') {
        const phase = (((d / (LAMBDA / 2)) % 1) + 1) % 1
        rgb = hsl(phase * 360, 0.85, 0.52)
        a = 0.78
      } else {
        rgb = ramp(CONFIDENCE, (c - lo) / (hi - lo))
        a = 0.85
      }
      if (o.fadeLow && o.mode !== 'coherence') {
        a *= smooth(o.threshold - 0.12, o.threshold + 0.04, c)
        if (c < o.threshold && (x + y) % 10 < 2) { // hatching over unreliable areas
          rgb = [235, 235, 235]
          a = Math.max(a, 0.32)
        }
      }
      const i = (y * W + x) * 4
      img.data[i] = rgb[0]
      img.data[i + 1] = rgb[1]
      img.data[i + 2] = rgb[2]
      img.data[i + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return cv.toDataURL('image/png')
}
