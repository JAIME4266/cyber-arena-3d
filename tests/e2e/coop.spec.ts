import { expect, test } from '@playwright/test'

/**
 * Co-op verification: two independent browser contexts must actually meet and
 * play together.
 *
 *  - the DIRECT LINK test is fully deterministic (offer/answer pasted between
 *    the two pages — zero network dependency beyond localhost);
 *  - the ROOM CODE test exercises the real production path: public signaling
 *    networks (nostr relays / WebTorrent trackers / MQTT brokers) + WebRTC
 *    between the two contexts.
 *
 * Serial mode: each test spawns two WebGL pages and a fleet of relay sockets —
 * running them in parallel starves CPU and turns ICE timing into noise.
 */
test.describe.configure({ mode: 'serial' })

/** Small viewport = cheap software-WebGL fill; these tests assert DOM state,
 *  not pixels. Keeps the two co-op pages fast enough on SwiftShader runners. */
const coopViewport = { viewport: { width: 480, height: 320 } }

test.describe('co-op P2P', () => {
  test('DIRECT LINK: two players connect via invite codes and play', async ({ browser }) => {
    const errors: string[] = []
    const host = await browser.newContext(coopViewport)
    const guest = await browser.newContext(coopViewport)
    const hostPage = await host.newPage()
    const guestPage = await guest.newPage()
    for (const p of [hostPage, guestPage]) p.on('pageerror', err => errors.push(String(err)))

    // Host creates a room, then switches to the direct flow.
    await hostPage.goto('/')
    await expect(hostPage.locator('#menu')).toBeVisible({ timeout: 30_000 })
    await hostPage.locator('.btn', { hasText: 'SQUAD: HOST ROOM' }).click()
    await expect(hostPage.locator('.room-code')).toBeVisible()
    await hostPage.locator('.btn', { hasText: 'DIRECT LINK' }).click()
    const invite = await hostPage.locator('.direct-out').inputValue()
    expect(invite.startsWith('c3d')).toBe(true)
    expect(invite.length).toBeGreaterThan(100)

    // Guest pastes the invite and generates a reply.
    await guestPage.goto('/')
    await expect(guestPage.locator('#menu')).toBeVisible({ timeout: 30_000 })
    await guestPage.locator('.btn', { hasText: 'SQUAD: JOIN ROOM' }).click()
    await guestPage.locator('.join-tab', { hasText: 'DIRECT INVITE' }).click()
    await guestPage.locator('.direct-in').fill(invite)
    await guestPage.locator('.btn', { hasText: 'GENERATE REPLY' }).click()
    const reply = await guestPage
      .locator('.direct-out')
      .inputValue({ timeout: 15_000 })
    expect(reply.startsWith('c3d')).toBe(true)

    // Host accepts the reply → the data channel opens on both sides.
    await hostPage.locator('.direct-in').fill(reply)
    await hostPage.locator('.btn', { hasText: 'ACCEPT REPLY' }).click()
    await expect(
      hostPage.locator('.lobby-status', { hasText: 'PARTNER CONNECTED' }),
    ).toBeVisible({ timeout: 30_000 })

    // Host launches; both sides enter the run and the guest receives snapshots.
    // (Software renderers run the sim in slow motion — allow generous time.)
    await hostPage.locator('.btn', { hasText: 'LAUNCH SQUAD RUN' }).click()
    await expect(hostPage.locator('#hud')).toBeVisible({ timeout: 30_000 })
    await expect(guestPage.locator('#hud')).toBeVisible({ timeout: 30_000 })
    await expect(guestPage.locator('#hud .hud-time')).not.toHaveText('00:00', { timeout: 90_000 })
    await expect(hostPage.locator('#hud .hud-time')).not.toHaveText('00:00', { timeout: 90_000 })

    expect(errors).toEqual([])
    await host.close()
    await guest.close()
  })

  test('ROOM CODE: two players find each other through signaling networks', async ({ browser }) => {
    test.setTimeout(150_000)
    const errors: string[] = []
    const host = await browser.newContext(coopViewport)
    const guest = await browser.newContext(coopViewport)
    const hostPage = await host.newPage()
    const guestPage = await guest.newPage()
    for (const p of [hostPage, guestPage]) p.on('pageerror', err => errors.push(String(err)))

    // Host creates a room and shows the code.
    await hostPage.goto('/')
    await expect(hostPage.locator('#menu')).toBeVisible({ timeout: 30_000 })
    await hostPage.locator('.btn', { hasText: 'SQUAD: HOST ROOM' }).click()
    await expect(hostPage.locator('.room-code')).toBeVisible()
    const code = (await hostPage.locator('.room-code').textContent())?.trim() ?? ''
    expect(code).toMatch(/^[A-Z2-9]{6}$/)

    // The signal matrix must come alive on the host side.
    await expect(
      hostPage.locator('.sig-chip.ready', { hasText: 'NOSTR' }),
    ).toBeVisible({ timeout: 30_000 })

    // Guest joins with the code.
    await guestPage.goto('/')
    await expect(guestPage.locator('#menu')).toBeVisible({ timeout: 30_000 })
    await guestPage.locator('.btn', { hasText: 'SQUAD: JOIN ROOM' }).click()
    await guestPage.locator('.code-input').fill(code)
    await guestPage.locator('.btn', { hasText: 'CONNECT' }).click()

    // Both sides must reach the linked state through the networks.
    await expect(
      hostPage.locator('.lobby-status', { hasText: /PARTNER (CONNECTED|FOUND)/ }),
    ).toBeVisible({ timeout: 60_000 })
    await expect(
      guestPage.locator('.lobby-status', { hasText: 'LINK ESTABLISHED' }),
    ).toBeVisible({ timeout: 30_000 })

    // Launch and verify the full game loop end-to-end.
    await hostPage.locator('.btn', { hasText: 'LAUNCH SQUAD RUN' }).click()
    await expect(hostPage.locator('#hud')).toBeVisible({ timeout: 30_000 })
    await expect(guestPage.locator('#hud')).toBeVisible({ timeout: 30_000 })
    await expect(guestPage.locator('#hud .hud-time')).not.toHaveText('00:00', { timeout: 90_000 })
    await expect(hostPage.locator('#hud .hud-time')).not.toHaveText('00:00', { timeout: 90_000 })

    expect(errors).toEqual([])
    await host.close()
    await guest.close()
  })
})
