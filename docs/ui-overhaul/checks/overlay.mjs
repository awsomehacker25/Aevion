import { chromium } from 'playwright-core'
const [port, out, tag] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: 'dark' })
const page = await ctx.newPage()
const logs = []
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text().slice(0, 160)) })
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message))
await page.goto(`http://localhost:${port}/?story=upper-assam-floods`)
for (const s of [4, 8, 14]) {
  await page.waitForTimeout(s === 4 ? 4000 : s === 8 ? 4000 : 6000)
  const st = await page.evaluate(() => {
    const m = window.__map
    if (!m) return 'no map'
    const l = m.getLayer('overlay')
    return JSON.stringify({ ready: document.querySelector('.map')?.dataset.ready ?? null, op: l ? m.getPaintProperty('overlay', 'raster-opacity') : null, zoom: m.getZoom().toFixed(2), loaded: m.loaded() })
  })
  console.log(tag, s + 's', st)
}
await page.screenshot({ path: `${out}/overlay-${tag}.png` })
console.log(tag, 'logs', logs.slice(0, 5))
await browser.close()
