import { chromium } from 'playwright-core'
const out = process.argv[2]
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: theme })
  await ctx.addInitScript((t) => { try { localStorage.setItem('aevion.theme', t) } catch {} }, theme)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  // slow the story file so the splash is on screen for a while, then let it through
  await page.route('**/stories/*/story.json', async (r) => { await new Promise((res) => setTimeout(res, 2500)); r.continue() })
  await page.goto('http://localhost:5210/?story=kilauea-hawaii', { waitUntil: 'commit' })
  for (const ms of [150, 450, 750]) { await page.waitForTimeout(ms === 150 ? 150 : 300); await page.screenshot({ path: `${out}/splash-${theme}-${ms}.png` }) }
  await page.waitForSelector('.dock', { timeout: 60000 })
  await page.screenshot({ path: `${out}/splash-${theme}-fading.png` })
  await page.waitForTimeout(1500)
  console.log(theme, 'boot gone:', (await page.locator('.boot').count()) === 0)
  // switching story: the shell skeleton, not the splash
  await page.locator('.dock-story .menu-btn').click()
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
  console.log(theme, 'skeleton shown:', (await page.locator('.skeleton-shell').count()) > 0, 'splash replayed:', (await page.locator('.boot').count()) > 0)
  await page.screenshot({ path: `${out}/skeleton-${theme}.png` })
  await page.waitForSelector('.dock .menu-btn', { timeout: 60000 })
  console.log(theme, 'errors:', errs.slice(0, 3))
  await ctx.close()
}
// reduced motion: static logo, no fade
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, reducedMotion: 'reduce' })
const page = await ctx.newPage()
await page.route('**/stories/*/story.json', async (r) => { await new Promise((res) => setTimeout(res, 1500)); r.continue() })
await page.goto('http://localhost:5210/?story=kilauea-hawaii', { waitUntil: 'commit' })
await page.waitForTimeout(500)
await page.screenshot({ path: `${out}/splash-reduced.png` })
await browser.close()
