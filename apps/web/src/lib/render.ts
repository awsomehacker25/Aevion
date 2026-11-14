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
  hh: `linear-gradient(90deg, ${DIVERGING.join(',')})`,
  hv: `linear-gradient(90deg, ${DIVERGING.join(',')})`,
}

export interface RenderOpts {
  mode: ViewMode
  range: [number, number]
  fadeLow: boolean
  threshold: number
  /** 0..1 multiplier on the displacement. Used only by the illustrative replay. Default 1. */
  scale?: number
  /** Render at half resolution (fast), used while animating. */
  low?: boolean
  /** Displacement smaller than this (same units as range) is fully transparent in the ground-motion view. */
  quiet?: number
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// Color lookup tables, built once. Looking colors up is far cheaper than blending stops for every pixel.
const LUT_N = 256
function lut(rgbAt: (t: number) => RGB): Uint8ClampedArray {
  const out = new Uint8ClampedArray(LUT_N * 3)
  for (let i = 0; i < LUT_N; i++) {
    const c = rgbAt(i / (LUT_N - 1))
    out[i * 3] = c[0]
    out[i * 3 + 1] = c[1]
    out[i * 3 + 2] = c[2]
  }
  return out
}

function hsl(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

const DIVERGING_LUT = lut((t) => ramp(DIVERGING, t))
const CONFIDENCE_LUT = lut((t) => ramp(CONFIDENCE, t))
const FRINGE_LUT = lut((t) => hsl(t * 360, 0.85, 0.52))

/** Bilinear sample of a grid, NaN where any neighbor is a gap. */
function bilinear(g: Grid, fx: number, fy: number): number {
  const w = g.width
  const x0 = Math.min(w - 1, Math.max(0, Math.floor(fx)))
  const y0 = Math.min(g.height - 1, Math.max(0, Math.floor(fy)))
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(g.height - 1, y0 + 1)
  const tx = fx - x0
  const ty = fy - y0
  const vals = g.values
  const a = vals[y0 * w + x0], b = vals[y0 * w + x1], c = vals[y1 * w + x0], d = vals[y1 * w + x1]
  if (a == null || b == null || c == null || d == null) return NaN // gap in the data
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}

/** Draws the selected view onto a canvas, upsampled 2x with bilinear interpolation. */
export function renderOverlay(defo: Grid, coh: Grid, o: RenderOpts): HTMLCanvasElement {
  const S = o.low ? 0.5 : defo.width >= 400 ? 1 : 2 // big grids are already detailed; keep redraws fast
  const W = Math.round(defo.width * S)
  const H = Math.round(defo.height * S)
  const k = o.scale ?? 1
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(W, H)
  const data = img.data
  const [lo, hi] = o.range
  const half = Math.max(Math.abs(lo), Math.abs(hi))
  const feather = Math.max(4, Math.round(Math.min(W, H) * 0.05))
  // where color starts, as a share of the range. A story's own 'quiet' level scales with the build-up, so the same pattern
  // fades in smoothly instead of staying invisible until the change is already large.
  const q0 = o.quiet ? Math.min(0.85, (o.quiet * Math.max(k, 0.001)) / half) : 0.03
  const ramp0 = o.quiet ? 0.22 * Math.max(k, 0.001) : 0.22
  const grow = o.quiet ? Math.min(1, k * 3) : 1
  const mode = o.mode
  const fadeLow = o.fadeLow && mode !== 'coherence'
  const thr = o.threshold

  for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) / S - 0.5
    for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / S - 0.5
      const d = bilinear(defo, fx, fy) * k
      let c = bilinear(coh, fx, fy)
      if (Number.isNaN(d) || (mode === 'coherence' && Number.isNaN(c))) continue // no data: stay transparent
      if (Number.isNaN(c)) c = 0
      let li: number // index into a color table
      let lutArr: Uint8ClampedArray
      let a: number
      if (mode === 'los') {
        const tt = d / half // -1..1
        li = Math.round(Math.min(1, Math.max(0, (tt + 1) / 2)) * (LUT_N - 1))
        lutArr = DIVERGING_LUT
        // Near-zero motion is fully transparent so the imagery shows through; only real motion gets color.
        a = 0.92 * grow * Math.pow(smooth(q0, q0 + ramp0, Math.abs(tt)), 0.7)
      } else if (mode === 'fringes') {
        const phase = (((d / (LAMBDA / 2)) % 1) + 1) % 1
        li = Math.round(phase * (LUT_N - 1))
        lutArr = FRINGE_LUT
        // Almost no motion would all be one flat color, so fade it out like the ground-motion view.
        a = 0.85 * smooth(0.008, 0.05, Math.abs(d))
      } else {
        li = Math.round(Math.min(1, Math.max(0, (c - lo) / (hi - lo))) * (LUT_N - 1))
        lutArr = CONFIDENCE_LUT
        a = 0.85
      }
      let r = lutArr[li * 3], g = lutArr[li * 3 + 1], b = lutArr[li * 3 + 2]
      if (fadeLow) {
        // Very low coverage is speckle: hide it. Moderately low coverage is faded and hatched.
        if (c < thr * 0.5) continue
        a *= smooth(thr - 0.12, thr + 0.04, c)
        if (c < thr && (x + y) % 10 < 2) {
          r = g = b = 235
          a = Math.max(a, 0.22)
        }
      }
      a *= smooth(0, feather, Math.min(x, y, W - 1 - x, H - 1 - y)) // soft edges, no visible box
      const i = (y * W + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return cv
}
