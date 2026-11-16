import { chromium } from 'playwright-core'
const out = process.argv[2]
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const errs = []
for (const theme of ['dark', 'light']) {
  const open = async (story, sci) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: theme })
    await ctx.addInitScript((t) => { try { localStorage.setItem('aevion.theme', t) } catch {} }, theme)
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errs.push(e.message))
    await page.goto(`http://localhost:5210/?story=${story}`)
    await page.waitForSelector('.dock', { timeout: 60000 })
    await page.waitForTimeout(9000)
    if (sci) { await page.getByRole('button', { name: 'Scientist', exact: true }).click(); await page.waitForTimeout(1500) }
    return { ctx, page }
  }
  // tour card + period menu on an interferometry story
  let { ctx, page } = await open('kilauea-hawaii', false)
  await page.getByRole('button', { name: /Start the story tour/ }).click().catch((e) => errs.push('tour ' + e.message))
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${out}/state-tour-${theme}.png` })
  await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  await page.locator('.ps-label').first().click().catch(() => {})
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/state-periods-${theme}.png` })
  await ctx.close()
  // inspector in Scientist mode
  ;({ ctx, page } = await open('kilauea-hawaii', true))
  await page.mouse.click(1000, 450)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${out}/state-inspector-sci-${theme}.png` })
  await ctx.close()
  // flood: layers tab, charts tab and the methods dialog
  ;({ ctx, page } = await open('upper-assam-floods', false))
  await page.locator('.tabs button', { hasText: /^Layers$/ }).click().catch(() => {})
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${out}/state-layers-${theme}.png` })
  await page.locator('.tabs button', { hasText: /^Charts$/ }).click().catch(() => {})
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/state-charts-${theme}.png` })
  await page.locator('.tabs button', { hasText: /^Learn$/ }).click().catch(() => {})
  await page.getByRole('button', { name: /How this was made/ }).first().click().catch((e) => errs.push('methods ' + e.message))
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/state-methods-${theme}.png` })
  await ctx.close()
}
console.log('errors', errs.slice(0, 5))
await browser.close()
