import { chromium } from 'playwright-core'
const out = process.argv[2]
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: 'dark' })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
await page.goto('http://localhost:5210/?story=upper-assam-floods')
await page.waitForSelector('.dock', { timeout: 60000 })
await page.waitForTimeout(5000)
// story menu: open with the mouse, shot
await page.locator('.dock-story .menu-btn').click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${out}/menu-story-open.png` })
const opts = await page.locator('.dock-story [role=option]').allTextContents()
console.log('story options:', opts)
// keyboard: ArrowDown, Escape returns focus to the button
await page.keyboard.press('ArrowDown')
console.log('active after ArrowDown:', await page.locator('.dock-story li.active .mi-label').textContent())
await page.keyboard.press('Escape')
console.log('menu closed:', (await page.locator('.dock-story .menu-pop').count()) === 0, 'focus on button:', await page.evaluate(() => document.activeElement?.classList.contains('menu-btn')))
// language menu -> Assamese -> machine note
await page.locator('.dock-lang .menu-btn').click()
await page.waitForTimeout(300)
await page.screenshot({ path: `${out}/menu-lang-open.png` })
await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
await page.waitForTimeout(1500)
console.log('machine note:', await page.locator('.mt-note').allTextContents())
await page.screenshot({ path: `${out}/dock-assamese.png` })
// theme switch persistence
await page.getByRole('button', { name: 'Light' }).click()
console.log('theme attr:', await page.evaluate(() => document.documentElement.dataset.theme), 'stored:', await page.evaluate(() => localStorage.getItem('aevion.theme')))
// pick a story via keyboard
await page.locator('.dock-story .menu-btn').focus()
await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
await page.waitForTimeout(4000)
console.log('url after pick:', page.url())
// small desktop window
await page.setViewportSize({ width: 1280, height: 720 })
await page.waitForTimeout(800)
await page.getByRole('button', { name: 'Scientist', exact: true }).click()
await page.waitForTimeout(800)
await page.screenshot({ path: `${out}/dock-1280.png` })
console.log('errors:', errs.slice(0, 3))
await browser.close()
