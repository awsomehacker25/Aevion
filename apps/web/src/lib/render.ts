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

/** The radar picture itself (not a change): dark navy for weak echoes up to white for strong ones. */
// weak echoes dark navy, ordinary ground grey, strong echoes white, the very strongest warm (rough surfaces such as fresh lava)
const RADAR_GRAY = ['#050912', '#141d34', '#2b3858', '#4d5b7e', '#7482a3', '#9ba7c3', '#c3cbdc', '#eef1f8', '#ffd58a', '#ff8a2a']
export const GRAY_GRADIENT = `linear-gradient(90deg, ${RADAR_GRAY.join(',')})`

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
  /** 'gray' draws the values as a radar picture (low to high) instead of a change around zero. */
  colormap?: 'gray'
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
const GRAY_LUT = lut((t) => ramp(RADAR_GRAY, t))

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

/** Catmull-Rom weights for the four neighbors around a position with fractional part t. Sharper than bilinear, so edges stay crisp. */
function cubicW(t: number): [number, number, number, number] {
  const t2 = t * t
  const t3 = t2 * t
  return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2]
}

/**
 * Enlarges a grid to w by h cells with cubic interpolation (sharp) and a separate, hard-edged validity mask. Cells without
 * data are filled from their neighbors only for the interpolation; the mask decides where color is drawn, so gaps keep crisp edges
 * and never bleed color into the gap.
 */
function upsample(g: Grid, w: number, h: number): { vals: Float32Array; valid: Uint8Array } {
  const gw = g.width
  const gh = g.height
  const src = new Float32Array(gw * gh)
  const ok = new Uint8Array(gw * gh)
  for (let i = 0; i < src.length; i++) {
    const v = g.values[i]
    if (v != null && Number.isFinite(v)) { src[i] = v; ok[i] = 1 }
  }
  // fill gaps with the mean of valid neighbors (a few passes), so cubic weights never pull in zeros
  const fill = new Float32Array(src)
  const have = new Uint8Array(ok)
  for (let pass = 0; pass < 3; pass++) {
    const nextFill = new Float32Array(fill)
    const nextHave = new Uint8Array(have)
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (have[y * gw + x]) continue
        let sum = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy
            const xx = x + dx
            if (yy < 0 || yy >= gh || xx < 0 || xx >= gw || !have[yy * gw + xx]) continue
            sum += fill[yy * gw + xx]
            n++
          }
        }
        if (n) { nextFill[y * gw + x] = sum / n; nextHave[y * gw + x] = 1 }
      }
    }
    fill.set(nextFill)
    have.set(nextHave)
  }
  const clampI = (i: number, n: number) => (i < 0 ? 0 : i >= n ? n - 1 : i)
  // horizontal pass for the values and the mask, one row of the source at a time
  const hv = new Float32Array(gh * w)
  const hm = new Float32Array(gh * w)
  const xi = new Int32Array(w)
  const xw: [number, number, number, number][] = []
  const xm = new Float32Array(w)
  const xm0 = new Int32Array(w)
  for (let x = 0; x < w; x++) {
    const fx = (x + 0.5) * (gw / w) - 0.5
    const x0 = Math.floor(fx)
    xi[x] = x0
    xw.push(cubicW(fx - x0))
    xm0[x] = clampI(x0, gw)
    xm[x] = fx - x0
  }
  for (let y = 0; y < gh; y++) {
    const row = y * gw
    for (let x = 0; x < w; x++) {
      const x0 = xi[x]
      const wt = xw[x]
      hv[y * w + x] = wt[0] * fill[row + clampI(x0 - 1, gw)] + wt[1] * fill[row + clampI(x0, gw)] + wt[2] * fill[row + clampI(x0 + 1, gw)] + wt[3] * fill[row + clampI(x0 + 2, gw)]
      const a = ok[row + xm0[x]]
      const b = ok[row + clampI(xm0[x] + 1, gw)]
      hm[y * w + x] = a * (1 - xm[x]) + b * xm[x]
    }
  }
  // vertical pass
  const vals = new Float32Array(w * h)
  const valid = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) * (gh / h) - 0.5
    const y0 = Math.floor(fy)
    const wt = cubicW(fy - y0)
    const ya = clampI(y0 - 1, gh)
    const yb = clampI(y0, gh)
    const yc = clampI(y0 + 1, gh)
    const yd = clampI(y0 + 2, gh)
    const ty = fy - y0
    const ym0 = clampI(y0, gh)
    const ym1 = clampI(y0 + 1, gh)
    for (let x = 0; x < w; x++) {
      vals[y * w + x] = wt[0] * hv[ya * w + x] + wt[1] * hv[yb * w + x] + wt[2] * hv[yc * w + x] + wt[3] * hv[yd * w + x]
      const m = hm[ym0 * w + x] * (1 - ty) + hm[ym1 * w + x] * ty
      valid[y * w + x] = m >= 0.5 ? 1 : 0
    }
  }
  return { vals, valid }
}

const upCache = new WeakMap<Grid, { W: number; H: number; vals: Float32Array; valid: Uint8Array }>()

/** Draws the selected view onto a canvas, enlarged about 4x with cubic interpolation so it stays sharp when zoomed in. */
export function renderOverlay(defo: Grid, coh: Grid, o: RenderOpts): HTMLCanvasElement {
  // aim for about 720 cells across (big grids need less enlarging); the replay draws smaller to stay fast
  const S = o.low ? Math.min(1, 300 / defo.width) : Math.max(2, Math.round(720 / defo.width))
  const W = Math.round(defo.width * S)
  const H = Math.round(defo.height * S)
  // the enlarged picture is the same on every replay frame (only the scale changes), so keep the last one
  let up = upCache.get(defo)
  if (!up || up.W !== W || up.H !== H) { up = { W, H, ...upsample(defo, W, H) }; upCache.set(defo, up) }
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
      if (!up.valid[y * W + x]) continue // no data: stay transparent
      const d = up.vals[y * W + x] * k
      let c = bilinear(coh, fx, fy)
      if (mode === 'coherence' && Number.isNaN(c)) continue
      if (Number.isNaN(c)) c = 0
      let li: number // index into a color table
      let lutArr: Uint8ClampedArray
      let a: number
      if (mode === 'los' && o.colormap === 'gray') {
        li = Math.round(Math.min(1, Math.max(0, (d - lo) / (hi - lo))) * (LUT_N - 1))
        lutArr = GRAY_LUT
        a = 1
      } else if (mode === 'los') {
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
      a *= smooth(0, o.colormap === 'gray' ? feather * 0.5 : feather, Math.min(x, y, W - 1 - x, H - 1 - y)) // soft edges, no visible box
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
