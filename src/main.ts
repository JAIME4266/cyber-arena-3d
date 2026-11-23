/**
 * Entry point: boot splash → menu (over the idle arena scene) → sessions.
 *
 * URL modes:
 *   ?seed=XYZ      — solo run on a specific seed (shareable challenges)
 *   ?mode=daily    — daily challenge seed
 *   ?room=CODE     — pre-filled co-op join
 */
import './ui/styles.css'
import { randomCode, isValidCode } from './core/rng'
import { dailySeed } from './core/stats'
import { GameRenderer, isSoftwareRenderer } from './render/renderer'
import { AudioEngine } from './render/audio'
import { Menu, howToPlayContent, overlayCard, settingsContent, coopJoinCard, type MenuCallbacks, type Settings } from './ui/menu'
import { OverlayScreens } from './ui/overlay'
import { IdleScene } from './app/menuscene'
import { Session, type SessionMode } from './app/session'
import { loadSettings, saveSettings } from './app/persist'
import { assets } from './render/assets'
import { NetRoom } from './net/room'
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

function button(cls: string, text: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = cls
  b.textContent = text
  return b
}

class App {
  private readonly renderer: GameRenderer
  private readonly audio = new AudioEngine()
  private settings: Settings
  private readonly menu: Menu
  private readonly screens: OverlayScreens
  private idle: IdleScene | null = null
  private session: Session | null = null
  private netRoom: NetRoom | null = null
  private netHost: NetHost | null = null
  private netClient: NetClient | null = null
  private lobbyDismiss: (() => void) | null = null
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
    document.body.append(elId('div', 'vig'), elId('div', 'sl'), elId('div', 'scanlines'))

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
          this.screens.toast('HD MODELS ONLINE — FULL VISUAL LOADOUT DEPLOYED', 'ok')
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
    box.append(el('div', 'hd-title', 'DEPLOYING HD ASSETS'))
    const bar = elId('div', 'hd-bar')
    bar.append(el('i'))
    box.append(bar)
    box.append(el('div', 'hd-sub', 'STREAMING MODELS · WEAPONS · SKYLINE'))
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
      net: isCoop && this.netRoom
        ? { room: this.netRoom, host: this.netHost ?? undefined, client: this.netClient ?? undefined }
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
    this.netRoom?.leave()
    this.netRoom = null
    this.netHost = null
    this.netClient = null
    this.lobbyDismiss?.()
    this.lobbyDismiss = null
  }

  /* ---------------- co-op flow ---------------- */

  private coopCreate(): void {
    this.audio.unlock()
    this.audio.sfx('ui')
    this.teardownNet()
    const code = randomCode()
    this.netRoom = new NetRoom(code, 'host')
    this.netHost = new NetHost(this.netRoom, code, this.settings.name || 'HOST')
    this.showLobby(code, true)
  }

  private coopJoinPrompt(): void {
    const app = document.getElementById('app')!
    const prompt = coopJoinCard(app, code => {
      prompt.dismiss()
      this.coopJoin(code)
    }, () => undefined)
  }

  private coopJoin(code: string): void {
    if (!isValidCode(code)) {
      this.screens.toast('INVALID CODE — 6 CHARACTERS (NO O/I/L/0/1)', 'err')
      this.bootIdle()
      return
    }
    this.teardownNet()
    this.netRoom = new NetRoom(code, 'guest')
    this.netClient = new NetClient(this.netRoom, this.settings.name || 'GUEST')
    this.showLobby(code, false)
  }

  private showLobby(code: string, isHost: boolean): void {
    this.menu.show(false)
    this.stopIdle()
    const app = document.getElementById('app')!
    const { card, close, dismiss } = overlayCard(app, isHost ? 'CO-OP ROOM CREATED' : 'JOINING CO-OP ROOM', () => this.exitLobby())
    this.lobbyDismiss = dismiss
    const wrap = el('div')
    wrap.append(el('p', '', isHost
      ? 'Send this code to your friend. The run launches once they connect.'
      : 'Waiting for the host to launch the run...'))
    wrap.append(el('div', 'room-code', code))
    const status = el('p', 'lobby-status', isHost ? 'WAITING FOR PARTNER' : 'CONNECTING...')
    wrap.append(status)

    if (isHost) {
      const launch = button('btn magenta', 'LAUNCH CO-OP RUN')
      launch.disabled = true
      launch.addEventListener('click', () => {
        this.netHost?.start()
        dismiss()
        this.startSession('coop-host', code)
      })
      wrap.append(launch)
      this.netRoom!.onPeerJoin(() => {
        if (this.netHost?.started) return
        status.textContent = 'PARTNER CONNECTED — READY'
        launch.disabled = false
        launch.focus()
        this.audio.sfx('pickup')
      })
      this.netRoom!.onPeerLeave(() => {
        if (this.netHost?.started) return
        status.textContent = 'PARTNER LEFT — WAITING...'
        launch.disabled = true
      })
    } else {
      this.netClient!.onStart = () => {
        dismiss()
        this.startSession('coop-guest', code)
      }
      this.netClient!.onKick = reason => {
        dismiss()
        this.screens.toast(reason, 'err')
        this.exitLobby()
      }
      window.setTimeout(() => {
        if (this.netClient && !this.netClient.started && !this.netClient.hasSnapshots && this.lobbyDismiss) {
          status.textContent = 'STILL CONNECTING — CHECK THE CODE AND BOTH NETWORKS'
        }
      }, 12000)
    }

    const copy = button('btn', 'COPY CODE')
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(code).then(() => this.screens.toast('CODE COPIED', 'ok'))
    })
    wrap.append(copy)
    card.append(wrap)
    close()
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

// Boot once DOM is ready.
const boot = (): void => {
  new App()
  document.getElementById('boot')?.remove()
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}
