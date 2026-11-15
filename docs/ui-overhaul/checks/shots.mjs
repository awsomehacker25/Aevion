import { chromium } from 'playwright-core'
import fs from 'fs'
// usage: node shots.mjs <outDir> <label> [stories=kilauea-hawaii,upper-assam-floods]
const [out, label, storiesArg] = process.argv.slice(2)
const stories = (storiesArg || 'kilauea-hawaii,upper-assam-floods').split(',')
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
for (const theme of ['dark', 'light']) {
  for (const story of stories) {
    for (const mode of ['Story', 'Scientist']) {
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: theme })
      await ctx.addInitScript((t) => { try { localStorage.setItem('aevion.theme', t) } catch {} }, theme)
      const page = await ctx.newPage()
      const errs = []
      page.on('pageerror', (e) => errs.push(e.message))
      await page.goto(`http://localhost:5210/?story=${story}`)
      await page.waitForSelector('.side', { timeout: 60000 }).catch(() => {})
      await page.waitForTimeout(6000)
      if (mode === 'Scientist') { await page.getByRole('button', { name: 'Scientist', exact: true }).click().catch(() => {}); await page.waitForTimeout(2500) }
      await page.screenshot({ path: `${out}/${label}-${story}-${mode.toLowerCase()}-${theme}.png` })
      if (errs.length) console.log(story, mode, theme, 'PAGEERRORS', errs.slice(0, 3))
      await ctx.close()
    }
  }
}
await browser.close()
console.log('done')
