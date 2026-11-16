// Converts the published Upper Assam pictures (lossy WebP, 8-bit) into aevion-grid-v1 grids, so Assam can use the same
// map layers as every other story. The original NISAR files are not in this repository, so the values are DERIVED from the
// pictures: roughly 0.1 dB steps plus WebP compression noise. Exact figures (flooded area, preset dB values) stay in flood.json.
//
// Usage (from this folder):  npm i && node assam-to-grids.mjs [srcDir] [outDir]
//   srcDir  the folder holding flood.json, timeseries.json and overlays/<date>_{HH,HV,water}.webp. Those pictures were removed from the
//           app when Assam moved to grids; they are in git history (the commit before "Assam on the shared viewer"):
//           git show <commit>:apps/web/public/stories/upper-assam-floods/overlays/<file> > <file>
//
// What it writes, per NISAR pass:
//   epochs/ep-<date>.deformation.grid.json   HH echo (dB), the "radar picture"
//   epochs/ep-<date>.hv.grid.json            HV echo (dB)
//   epochs/ep-<date>.hh.grid.json            NEW FLOOD WATER: HH change versus the dry-season reference (dB), kept only where the
//                                            published water mask says new water, so only real flooding shows (negative = darker = blue)
// and for the featured pass (the flood peak): deformation / backscatter-hh / backscatter-hv grids and a small coverage grid.

import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'

const SRC = process.argv[2] ?? '../apps/web/public/stories/upper-assam-floods/'
const OUT = process.argv[3] ?? '../apps/web/public/stories/upper-assam-floods/'
const W = 500
const H = 438
// grey level (0..255) to dB, calibrated against the coarse time series in timeseries.json (see calib.mjs): HH about -22.7..0 dB, HV about -30..-8 dB
const RANGE = { HH: [-22.7, 0], HV: [-30, -8] }
const SCALE = 0.1

const flood = JSON.parse(fs.readFileSync(SRC + 'flood.json', 'utf8'))
const [w, s, e, n] = flood.bbox
fs.mkdirSync(OUT + 'epochs', { recursive: true })

const gray = async (file) => {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true })
  return { data, W: info.width, H: info.height }
}
const alpha = async (file) => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const a = new Uint8Array(info.width * info.height)
  for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3]
  return { data: a, W: info.width, H: info.height }
}
const toDb = (g, pol) => RANGE[pol][0] + (g / 255) * (RANGE[pol][1] - RANGE[pol][0])

const writeGrid = (file, name, width, height, values) => {
  const grid = {
    format: 'aevion-grid-v1', name, units: 'dB', width, height, bbox: flood.bbox, rowOrder: 'north-up', nodata: null, scale: SCALE,
    values: Array.from(values, (v) => Math.round(v / SCALE)),
  }
  fs.writeFileSync(file, JSON.stringify(grid))
}

/** Block average of a full-resolution plane into W x H cells (the picture is stretched evenly over the box). */
function blocks(plane, srcW, srcH, fn) {
  const sum = new Float64Array(W * H)
  const cnt = new Float64Array(W * H)
  for (let y = 0; y < srcH; y++) {
    const by = Math.min(H - 1, Math.floor((y * H) / srcH))
    for (let x = 0; x < srcW; x++) {
      const bx = Math.min(W - 1, Math.floor((x * W) / srcW))
      const v = fn(y * srcW + x)
      if (v == null) continue
      sum[by * W + bx] += v
      cnt[by * W + bx] += 1
    }
  }
  return { sum, cnt }
}

const ref = flood.dates.find((d) => d.date === flood.reference)
const refHH = await gray(SRC + ref.layers.HH)
const stats = []

for (const d of flood.dates) {
  const hh = await gray(SRC + d.layers.HH)
  const hv = await gray(SRC + d.layers.HV)
  const water = await alpha(SRC + d.layers.water)
  const N = hh.W * hh.H

  const bHH = blocks(hh.data, hh.W, hh.H, (i) => toDb(hh.data[i], 'HH'))
  const bHV = blocks(hv.data, hv.W, hv.H, (i) => toDb(hv.data[i], 'HV'))
  const echoHH = new Float32Array(W * H)
  const echoHV = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) { echoHH[i] = bHH.sum[i] / bHH.cnt[i]; echoHV[i] = bHV.sum[i] / bHV.cnt[i] }

  // new water: change in HH versus the dry season, only where the mask says water, divided by ALL pixels in the cell so edge cells fade out
  const bW = blocks(hh.data, hh.W, hh.H, (i) => {
    if (water.data[i] <= 40) return 0
    return toDb(hh.data[i], 'HH') - toDb(refHH.data[i], 'HH')
  })
  const change = new Float32Array(W * H)
  let wet = 0
  for (let i = 0; i < W * H; i++) {
    change[i] = d.date === flood.reference ? 0 : bW.sum[i] / bW.cnt[i]
    if (change[i] < -4) wet++ // cells at least about 40% covered by new water
  }

  writeGrid(`${OUT}epochs/ep-${d.date}.deformation.grid.json`, 'hh_echo', W, H, echoHH)
  writeGrid(`${OUT}epochs/ep-${d.date}.hv.grid.json`, 'hv_echo', W, H, echoHV)
  writeGrid(`${OUT}epochs/ep-${d.date}.hh.grid.json`, 'new_water_change', W, H, change)
  // area check: cells carrying new water x cell area, against the published figure
  const cellKm2 = ((e - w) * 111.32 * Math.cos((((s + n) / 2) * Math.PI) / 180) * (n - s) * 110.57) / (W * H)
  stats.push({ date: d.date, cellsWithWater: wet, approxKm2: Math.round(wet * cellKm2), publishedNewKm2: d.new_water_km2 })

  if (d.date === flood.peak_date) {
    writeGrid(OUT + 'deformation.grid.json', 'hh_echo', W, H, echoHH)
    writeGrid(OUT + 'backscatter-hv.grid.json', 'hv_echo', W, H, echoHV)
    writeGrid(OUT + 'backscatter-hh.grid.json', 'new_water_change', W, H, change)
  }
  console.log('done', d.date)
}

// a tiny coverage grid: 1 everywhere (the pictures have no gaps); grids of different sizes are fine, they are sampled by position
fs.writeFileSync(OUT + 'coherence.grid.json', JSON.stringify({
  format: 'aevion-grid-v1', name: 'coverage', units: '1', width: 20, height: 18, bbox: flood.bbox, rowOrder: 'north-up', nodata: null, scale: 1,
  values: new Array(20 * 18).fill(1),
}))
fs.writeFileSync(OUT + 'conversion-check.json', JSON.stringify({ note: 'new-water area implied by the grids vs the published figure', rows: stats }, null, 1))
console.table(stats)
