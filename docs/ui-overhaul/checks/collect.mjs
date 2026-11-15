import { chromium } from 'playwright-core'
import fs from 'fs'
// usage: node collect.mjs <port> <out.json> [shotsDir label]
const [port, out, shotsDir, label] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const result = {}
const lines = (t) => t.split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean)
for (const story of ['kilauea-hawaii', 'upper-assam-floods', 'venezuela-2026']) {
  for (const mode of ['Story', 'Scientist']) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: 'dark' })
    await ctx.addInitScript(() => { try { localStorage.setItem('aevion.theme', 'dark') } catch {} })
    const page = await ctx.newPage()
    await page.goto(`http://localhost:${port}/?story=${story}`)
    await page.waitForSelector('.side', { timeout: 60000 })
    await page.waitForTimeout(5000)
    if (mode === 'Scientist') { await page.getByRole('button', { name: 'Scientist', exact: true }).first().click(); await page.waitForTimeout(2000) }
    const key = `${story}|${mode}`
    const seen = new Set()
    const add = (arr) => arr.forEach((l) => seen.add(l))
    const grab = async () => {
      // visible text of every region, plus the accessible names of controls (icon buttons, map controls)
      for (const sel of ['.side', '.timeline', '.topbar', '.dock', '.recenter', '.maplibregl-ctrl-top-right', '.maplibregl-ctrl-bottom-right', '.tour', '.inspector']) {
        const el = page.locator(sel).first()
        if (await el.count()) add(lines(await el.innerText().catch(() => '')))
      }
      add(await page.evaluate(() => [...document.querySelectorAll('button, a, input, select, [role=tab], summary, [role=option]')].flatMap((e) => [e.getAttribute('aria-label'), e.getAttribute('title'), e.tagName === 'SELECT' ? [...e.options].map((o) => o.text).join(' / ') : null].filter(Boolean)).map((s) => s.replace(/\s+/g, ' ').trim())))
    }
    await grab()
    // walk every tab, and open every disclosure in it
    const tabs = await page.locator('.tabs button').allTextContents()
    for (const t of tabs) {
      await page.locator('.tabs button', { hasText: new RegExp(`^${t.trim()}$`) }).first().click()
      await page.waitForTimeout(500)
      await page.evaluate(() => document.querySelectorAll('.side details').forEach((d) => { d.open = true }))
      await page.waitForTimeout(300)
      await grab()
    }
    // the layers menu and the period menu
    const more = page.locator('.layer-btn').first()
    if (await more.count()) { await more.click().catch(() => {}); await page.waitForTimeout(300); await grab(); await more.click().catch(() => {}) }
    const ps = page.locator('.ps-label').first()
    if (await ps.count()) { await ps.click().catch(() => {}); await page.waitForTimeout(300); await grab(); await page.keyboard.press('Escape'); await page.mouse.click(800, 300) }
    result[key] = [...seen].sort()
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/${label}-${story}-${mode.toLowerCase()}-dark.png` })
    await ctx.close()
  }
}
fs.writeFileSync(out, JSON.stringify(result, null, 1))
await browser.close()
console.log('collected', Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.length])))
