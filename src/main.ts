/**
 * Entry point: boot splash → menu (over the idle arena scene) → sessions.
 *
 * URL modes:
 *   ?seed=XYZ      — solo run on a specific seed (shareable challenges)
 *   ?mode=daily    — daily challenge seed
 *   ?room=CODE     — pre-filled co-op join
 */
// Self-hosted fonts (Fontsource) — no external requests on GitHub Pages.
import '@fontsource/barlow/400.css'
import '@fontsource/barlow/500.css'
import '@fontsource/barlow/600.css'
import '@fontsource/barlow-condensed/500.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import '@fontsource/big-shoulders-stencil-display/400'
import '@fontsource/big-shoulders-stencil-display/700'
import '@fontsource/big-shoulders-stencil-display/900'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/600.css'
import './ui/styles.css'
import { randomCode, isValidCode } from './core/rng'
import { dailySeed } from './core/stats'
import { GameRenderer, isSoftwareRenderer } from './render/renderer'
import { AudioEngine } from './render/audio'
import { Menu, howToPlayContent, overlayCard, settingsContent, type MenuCallbacks, type Settings } from './ui/menu'
import { OverlayScreens } from './ui/overlay'
import { IdleScene } from './app/menuscene'
import { Session, type SessionMode } from './app/session'
import { loadSettings, saveSettings } from './app/persist'
import { assets } from './render/assets'
import { ConnectionHub } from './net/hub'
import { DirectRoom } from './net/direct'
import type { Transport } from './net/transport'
import { CoopLobby, coopJoinPrompt, directGuestWait } from './ui/lobby'
import { NetHost } from './net/host'
import { NetClient } from './net/client'

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function elId(tag: string, id: string): HTMLElement {
  const e = document.createElement(tag)
  e.id = id
  return e
}

class App {
  private readonly renderer: GameRenderer
  private readonly audio = new AudioEngine()
  private settings: Settings
  private readonly menu: Menu
  private readonly screens: OverlayScreens
  private idle: IdleScene | null = null
  private session: Session | null = null
  private netTransport: Transport | null = null
  private netHub: ConnectionHub | null = null
  private netHost: NetHost | null = null
  private netClient: NetClient | null = null
  private lobby: CoopLobby | null = null
  private lobbyCode: string | null = null
  private lobbyDirect: DirectRoom | null = null
  private guestWait: { setStatus: (text: string, cls?: '' | 'ok' | 'err') => void; dismiss: () => void } | null = null
  private raf = 0
  private lastIdle = 0
  private hdGate: HTMLElement | null = null
  private hdPoll: number | null = null

  constructor() {
    const canvas = document.getElementById('c') as HTMLCanvasElement
    this.renderer = new GameRenderer(canvas)
    this.settings = loadSettings()
    this.audio.applySettings(this.settings)

    const app = document.getElementById('app')!
    app.append(elId('div', 'fx'))
    document.body.append(elId('div', 'vig'), elId('div', 'sl'))

    this.screens = new OverlayScreens(app)
    this.menu = new Menu(app, this.menuCallbacks())

    window.addEventListener('resize', () => this.renderer.resize())
    this.bootAssets()
    this.bootIdle()
    this.routeUrl()
  }

  /* ---------------- HD asset pack ---------------- */

  /** True when HD models should be used: user setting on, and either a real
   *  GPU or an explicit ?hd=1 override (also used for verification). Software
   *  renderers (CI SwiftShader, weak iGPUs) fall back to procedural actors,
   *  which keeps the game fast exactly where models would crush frame times. */
  private hdAllowed(): boolean {
    const forceHd = new URLSearchParams(location.search).get('hd') === '1'
    return !isSoftwareRenderer() || forceHd
  }

  /** Kick off the model download and reflect progress on the menu. */
  private bootAssets(): void {
    const wanted = this.settings.hd && this.hdAllowed()
    assets.setHdWanted(wanted)
    if (!this.settings.hd) {
      this.menu.setHdStatus('HD MODELS · OFF (SETTINGS)', 'off')
      return
    }
    if (!this.hdAllowed()) {
      this.menu.setHdStatus('HD MODELS · PERFORMANCE MODE OFF', 'off')
      return
    }
    if (this.hdPoll !== null) window.clearInterval(this.hdPoll)
    this.hdPoll = window.setInterval(() => {
      const pct = Math.round(assets.progress * 100)
      if (assets.pending()) {
        this.menu.setHdStatus(`HD ASSETS · ${pct}%`)
      } else {
        if (this.hdPoll !== null) window.clearInterval(this.hdPoll)
        this.hdPoll = null
        if (assets.state === 'ready') {
          this.menu.setHdStatus('HD MODELS · ONLINE', 'on')
          this.screens.toast('HD MODELS ONLINE — FULL LOADOUT READY', 'ok')
        } else {
          this.menu.setHdStatus('HD MODELS · OFFLINE', 'off')
          this.screens.toast('HD MODELS UNAVAILABLE — PROCEDURAL MODE ACTIVE', 'err')
        }
      }
    }, 120)
  }

  /** Full-screen progress gate shown when a run starts mid-download. */
  private showHdGate(): void {
    if (this.hdGate) return
    const gate = elId('div', 'hd-gate')
    const box = el('div')
    box.append(el('div', 'hd-title', 'LOADING EQUIPMENT'))
    const bar = elId('div', 'hd-bar')
    bar.append(el('i'))
    box.append(bar)
    box.append(el('div', 'hd-sub', 'STREAMING MODELS · WEAPONS · SCENERY'))
    gate.append(box)
    document.getElementById('app')!.append(gate)
    this.hdGate = gate
  }

  private hideHdGate(): void {
    this.hdGate?.remove()
    this.hdGate = null
  }

  /** Wait (bounded) for the pack so sessions start with models, not stubs. */
  private async gateAssets(): Promise<void> {
    if (!assets.pending()) return
    this.showHdGate()
    const bar = this.hdGate?.querySelector('.hd-bar i') as HTMLElement | null
    const tick = window.setInterval(() => {
      if (bar) bar.style.width = `${Math.round(assets.progress * 100)}%`
    }, 80)
    const timeout = new Promise<void>(resolve => window.setTimeout(resolve, 15_000))
    await Promise.race([assets.whenReady(), timeout])
    window.clearInterval(tick)
    this.hideHdGate()
  }

  private menuCallbacks(): MenuCallbacks {
    return {
      onSolo: () => this.startSession('solo', randomCode()),
      onDaily: () => this.startSession('daily', dailySeed()),
      onCoopCreate: () => this.coopCreate(),
      onCoopJoin: () => this.coopJoinPrompt(),
      onHowToPlay: () => {
        const { card, close } = overlayCard(document.getElementById('app')!, 'HOW TO PLAY', () => undefined)
        howToPlayContent(card)
        close()
      },
      onSettings: () => {
        const { card, close } = overlayCard(document.getElementById('app')!, 'SETTINGS', () => undefined)
        settingsContent(card, this.settings, s => {
          const hdChanged = s.hd !== this.settings.hd
          this.settings = s
          saveSettings(s)
          this.audio.applySettings(s)
          if (hdChanged) this.bootAssets()
        })
        close()
      },
    }
  }

  /* ---------------- idle menu scene ---------------- */

  private bootIdle(): void {
    this.stopIdle()
    this.idle = new IdleScene(this.renderer)
    this.menu.show(true)
    this.menu.showMain(true)
    const tick = (now: number): void => {
      if (!this.idle) return
      this.raf = requestAnimationFrame(tick)
      this.idle.update(Math.min(0.05, (now - this.lastIdle) / 1000 || 0.016))
      this.lastIdle = now
    }
    this.lastIdle = performance.now()
    this.raf = requestAnimationFrame(tick)
  }

  private stopIdle(): void {
    cancelAnimationFrame(this.raf)
    this.idle?.dispose()
    this.idle = null
  }

  /* ---------------- sessions ---------------- */

  private async startSession(mode: SessionMode, seed: string): Promise<void> {
    this.audio.unlock()
    this.audio.sfx('ui')
    await this.gateAssets()
    this.stopIdle()
    this.menu.show(false)
    const isCoop = mode === 'coop-host' || mode === 'coop-guest'
    if (!isCoop) this.teardownNet()
    this.session?.stop()
    this.session = new Session({
      mode,
      seed,
      renderer: this.renderer,
      fxLayer: document.getElementById('fx')!,
      speedlinesEl: document.getElementById('sl')!,
      settings: this.settings,
      audio: this.audio,
      net: isCoop && this.netTransport
        ? { room: this.netTransport, host: this.netHost ?? undefined, client: this.netClient ?? undefined }
        : undefined,
      onExitToMenu: () => {
        this.teardownNet()
        this.session = null
        this.bootIdle()
      },
    })
    this.session.start()
  }

  private teardownNet(): void {
    this.netTransport?.leave()
    this.netTransport = null
    this.netHub = null
    this.netHost = null
    this.netClient = null
    this.lobbyDirect = null
    this.guestWait?.dismiss()
    this.guestWait = null
    this.lobby?.destroy()
    this.lobby = null
    this.lobbyCode = null
  }

  /* ---------------- co-op flow ---------------- */

  /** Host: create a room (relays + trackers + brokers raced in parallel). */
  private coopCreate(code = randomCode()): void {
    this.audio.unlock()
    this.audio.sfx('ui')
    this.teardownNet()
    this.lobbyCode = code
    const hub = new ConnectionHub(code, 'host')
    this.netTransport = hub
    this.netHub = hub
    this.netHost = new NetHost(hub, code, this.settings.name || 'HOST')
    hub.onPeerJoin(() => this.lobby?.partnerJoined())
    hub.onPeerLeave(() => this.lobby?.partnerLeft())
    this.openLobby(code, true)
    void hub.start()
  }

  /** Guest: join prompt with room-code and direct-invite modes. */
  private coopJoinPrompt(): void {
    this.audio.unlock()
    this.audio.sfx('ui')
    const prompt = coopJoinPrompt(
      document.getElementById('app')!,
      {
        onCode: code => {
          prompt.dismiss()
          this.coopJoin(code)
        },
        onDirectInvite: invite => {
          prompt.dismiss()
          void this.coopJoinDirect(invite)
        },
      },
      () => undefined,
    )
  }

  /** Guest: join a room code through the signaling networks. */
  private coopJoin(code: string): void {
    if (!isValidCode(code)) {
      this.screens.toast('INVALID CODE — 6 CHARACTERS (NO O/I/L/0/1)', 'err')
      this.bootIdle()
      return
    }
    this.teardownNet()
    this.lobbyCode = code
    const hub = new ConnectionHub(code, 'guest')
    this.netTransport = hub
    this.netHub = hub
    this.netClient = new NetClient(hub, this.settings.name || 'GUEST')
    this.openLobby(code, false)
    void hub.start()
  }

  /** Guest: direct-invite path — no relays at all. */
  private async coopJoinDirect(invite: string): Promise<void> {
    this.teardownNet()
    let room: DirectRoom
    let reply: string
    try {
      ;({ room, reply } = await DirectRoom.joinFromInvite(invite))
    } catch (err) {
      this.screens.toast(`INVALID INVITE — ${err instanceof Error ? err.message.toUpperCase() : 'DECODE FAILED'}`, 'err')
      this.bootIdle()
      return
    }
    this.netTransport = room
    this.lobbyDirect = room
    this.netClient = new NetClient(room, this.settings.name || 'GUEST')
    this.menu.show(false)
    this.stopIdle()
    const wait = directGuestWait(document.getElementById('app')!, reply, () => this.exitLobby())
    this.guestWait = wait
    room.onPeerJoin(() => wait.setStatus('CONNECTED — WAITING FOR HOST TO LAUNCH', 'ok'))
    room.onPeerLeave(() => wait.setStatus('CONNECTION LOST', 'err'))
    this.netClient.onStart = () => {
      wait.dismiss()
      this.guestWait = null
      this.startSession('coop-guest', this.lobbyCode ?? '')
    }
    this.netClient.onKick = reason => {
      wait.dismiss()
      this.guestWait = null
      this.screens.toast(reason, 'err')
      this.exitLobby()
    }
  }

  /** Shared lobby wiring for the relay path. */
  private openLobby(code: string, isHost: boolean): void {
    this.menu.show(false)
    this.stopIdle()
    const lobby = new CoopLobby(
      document.getElementById('app')!,
      code,
      isHost,
      () => this.exitLobby(),
    )
    this.lobby = lobby
    this.netHub?.onStatus(s => lobby.setNetStatus(s))

    if (isHost && this.netHost) {
      lobby.onLaunch = () => {
        this.netHost?.start()
        lobby.destroy()
        this.lobby = null
        this.startSession('coop-host', code)
      }
      lobby.onDirectInvite = () => this.hostDirectInvite()
      lobby.onAcceptReply = reply => void this.hostAcceptReply(reply)
      lobby.onBackToCode = () => this.coopCreate(code)
    } else if (this.netClient) {
      this.netClient.onStart = () => {
        lobby.destroy()
        this.lobby = null
        this.startSession('coop-guest', code)
      }
      this.netClient.onKick = reason => {
        lobby.destroy()
        this.lobby = null
        this.screens.toast(reason, 'err')
        this.exitLobby()
      }
    }
  }

  /** Host: switch the lobby to the direct-invite flow. */
  private async hostDirectInvite(): Promise<void> {
    const lobby = this.lobby
    if (!lobby || !this.lobbyCode) return
    if (this.netHost?.guestReady) {
      lobby.directError('PARTNER ALREADY CONNECTED VIA RELAYS — LAUNCH!')
      return
    }
    let room: DirectRoom
    let invite: string
    try {
      ;({ room, code: invite } = await DirectRoom.createInvite())
    } catch (err) {
      console.warn('direct: invite failed', err)
      lobby.directError('COULD NOT BUILD INVITE — BROWSER BLOCKED WEBRTC')
      return
    }
    // The hub's job is done: swap the transport under the host.
    this.netHub?.leave()
    this.netHub = null
    this.netTransport = room
    this.lobbyDirect = room
    const code = this.lobbyCode
    this.netHost = new NetHost(room, code, this.settings.name || 'HOST')
    room.onPeerJoin(() => lobby.directConnected())
    room.onPeerLeave(() => lobby.directError('FRIEND DISCONNECTED — GENERATE A NEW INVITE'))
    lobby.showHostDirect(invite)
  }

  /** Host: accept the friend's direct reply code. */
  private async hostAcceptReply(reply: string): Promise<void> {
    const lobby = this.lobby
    const room = this.lobbyDirect
    if (!lobby || !room) return
    try {
      await room.acceptReply(reply)
      lobby.setStatus('ACCEPTED — OPENING LINK…')
    } catch (err) {
      lobby.directError(`INVALID REPLY — ${err instanceof Error ? err.message.toUpperCase() : 'DECODE FAILED'}`)
    }
  }

  private exitLobby(): void {
    this.teardownNet()
    this.bootIdle()
  }

  /* ---------------- URL routing ---------------- */

  private routeUrl(): void {
    const params = new URLSearchParams(location.search)
    const seed = params.get('seed')
    const mode = params.get('mode')
    const room = params.get('room')
    if (mode === 'daily') {
      this.startSession('daily', dailySeed())
      return
    }
    if (seed) {
      this.startSession('solo', seed.toUpperCase().slice(0, 24))
      return
    }
    if (room && isValidCode(room.toUpperCase())) {
      window.setTimeout(() => this.coopJoin(room.toUpperCase()), 400)
    }
  }
}

// Boot once DOM is ready — after the stencil/condensed faces are available,
// so every canvas texture (target placards, containers) paints with them.
const boot = (): void => {
  void Promise.all([
    document.fonts.load('700 78px "Barlow Condensed"'),
    document.fonts.load('900 34px "Big Shoulders Stencil Display"'),
  ]).catch(() => undefined).finally(() => {
    new App()
    document.getElementById('boot')?.remove()
  })
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}
