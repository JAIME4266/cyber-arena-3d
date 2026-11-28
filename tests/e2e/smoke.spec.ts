import { expect, test } from '@playwright/test'

/**
 * Smoke tests: verify the built site actually boots, renders WebGL content,
 * starts a run, and reacts to input — catching the "white screen on Pages"
 * class of failure before deployment.
 */
test('boots to the menu without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(String(err)))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#menu')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('#menu h1')).toContainText('RANGE')
  await page.waitForTimeout(1000)
  expect(errors).toEqual([])
})

test('starts a solo run, spawns the HUD, and reacts to typing', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(String(err)))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#menu')).toBeVisible({ timeout: 30_000 })

  await page.locator('.btn', { hasText: 'SOLO DRILL' }).click()
  const hud = page.locator('#hud')
  await expect(hud).toBeVisible({ timeout: 20_000 })
  // The run clock starts ticking (any value past 00:00 — software renderers
  // can be slow, so allow generous time rather than assuming 60 fps).
  await expect(page.locator('#hud .hud-time')).not.toHaveText('00:00', { timeout: 40_000 })

  // Type something — combat keys must not crash and the HUD must stay alive.
  await page.keyboard.type('ASDF')
  await page.waitForTimeout(800)
  await expect(hud).toBeVisible()

  // Screen-space enemy labels must appear, stay within viewport, and never overlap each other or NEXT KEY plate.
  await expect(page.locator('#labels .enemy-label:visible').first()).toBeVisible({ timeout: 10_000 })
  const layoutOk = await page.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const tk = document.querySelector('#hud .tk-plate')?.getBoundingClientRect()
    const els = [...document.querySelectorAll('#labels .enemy-label')]
      .filter(el => getComputedStyle(el).display !== 'none')
      .map(el => el.getBoundingClientRect())
    if (!els.length) return { ok: false, reason: 'no visible labels' }
    for (let i = 0; i < els.length; i++) {
      const a = els[i]!
      if (a.left < 0 || a.top < 0 || a.right > vw || a.bottom > vh) {
        return { ok: false, reason: `out of bounds: ${JSON.stringify(a)}` }
      }
      if (tk && !(a.right <= tk.left || a.left >= tk.right || a.bottom <= tk.top || a.top >= tk.bottom)) {
        return { ok: false, reason: 'overlaps tk-plate' }
      }
      for (let j = i + 1; j < els.length; j++) {
        const b = els[j]!
        if (!(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)) {
          return { ok: false, reason: `label overlap: ${i} & ${j}` }
        }
      }
    }
    return { ok: true, count: els.length }
  })
  expect(layoutOk).toMatchObject({ ok: true })

  // Curriculum panel & camera mode switcher must render and cycle via Tab without breaking typing.
  await expect(page.locator('#hud .curr-panel')).toBeVisible()
  await expect(page.locator('#hud .cam-chip')).toContainText('STANDARD')
  await page.keyboard.press('Tab')
  await expect(page.locator('#hud .cam-chip')).toContainText('WIDE TACTICAL')
  await page.keyboard.press('Tab')
  await expect(page.locator('#hud .cam-chip')).toContainText('COMBAT FOCUS')
  await page.keyboard.press('Tab')
  await expect(page.locator('#hud .cam-chip')).toContainText('OVERVIEW')

  expect(errors).toEqual([])
})

test('how-to-play overlay opens and closes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', err => errors.push(String(err)))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#menu')).toBeVisible({ timeout: 30_000 })
  await page.locator('.btn', { hasText: 'HOW TO PLAY' }).click()
  await expect(page.locator('.card h2')).toHaveText('HOW TO PLAY')
  await page.locator('.card .row-actions .btn', { hasText: 'CLOSE' }).click()
  await expect(page.locator('#menu')).toBeVisible()
  expect(errors).toEqual([])
})

test('renders cleanly at 1280x720 laptop resolution without label overlap', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const errors: string[] = []
  page.on('pageerror', err => errors.push(String(err)))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#menu')).toBeVisible({ timeout: 30_000 })
  await page.locator('.btn', { hasText: 'SOLO DRILL' }).click()
  await expect(page.locator('#hud')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('#hud .hud-time')).not.toHaveText('00:00', { timeout: 45_000 })
  await expect(page.locator('#labels .enemy-label:visible').first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1500)
  const currBox = await page.locator('#hud .curr-panel').boundingBox()
  expect(currBox).not.toBeNull()
  const overlapCount = await page.evaluate(() => {
    const els = [...document.querySelectorAll('#labels .enemy-label')]
      .filter(el => getComputedStyle(el).display !== 'none')
      .map(el => el.getBoundingClientRect())
    let ov = 0
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i]!, b = els[j]!
        if (!(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)) ov++
      }
    }
    return ov
  })
  expect(overlapCount).toBe(0)
  expect(errors).toEqual([])
})
