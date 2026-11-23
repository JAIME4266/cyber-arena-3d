/**
 * DOM HUD. Elements are built once and updated through dirty-checked
 * setters, so a 60fps update loop costs almost nothing.
 */
import { LIVES_MAX } from '../core/constants'
import { formatClock, formatScore, rank } from '../core/stats'
import type { ViewModel } from '../core/types'

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

export interface HudCallbacks {
  onPause(): void
}

export class Hud {
  readonly root: HTMLElement
  private readonly pips: HTMLElement[] = []
  private readonly timeEl: HTMLElement
  private readonly waveEl: HTMLElement
  private readonly scoreEl: HTMLElement
  private readonly comboEl: HTMLElement
  private readonly comboWrap: HTMLElement
  private readonly statusEl: HTMLElement
  private readonly killsEl: HTMLElement
  private readonly threatFill: HTMLElement
  private readonly overclockFill: HTMLElement
  private readonly wpmEl: HTMLElement
  private readonly dashFill: HTMLElement
  private readonly targetEl: HTMLElement
  private readonly bossBar: HTMLElement
  private readonly bossFill: HTMLElement
  private readonly partnerChip: HTMLElement
  private readonly partnerName: HTMLElement
  private readonly partnerScore: HTMLElement
  private readonly partnerLives: HTMLElement
  private readonly modeEl: HTMLElement
  private readonly seedEl: HTMLElement
  private cache = new Map<string, string>()
  private partnerVisible = false

  constructor(parent: HTMLElement, cb: HudCallbacks) {
    this.root = el('div')
    this.root.id = 'hud'
    this.root.style.display = 'none'

    // Top-left: armor plates
    const tl = el('div', 'u p hud-tl')
    tl.append(el('span', 'hud-label', 'ARMOR'))
    const pips = el('div', 'pips')
    for (let i = 0; i < LIVES_MAX; i++) {
      const p = el('i')
      this.pips.push(p)
      pips.append(p)
    }
    tl.append(pips)
    // Top-left second row: sprint
    const dash = el('div', 'dash-row')
    dash.append(el('span', 'hud-label', 'SPRINT'))
    this.dashFill = el('i')
    const dashBar = el('div', 'dash-bar')
    dashBar.append(this.dashFill)
    dash.append(dashBar)
    tl.append(dash)

    // Top-center: clock + wave
    const tc = el('div', 'u p hud-tc')
    this.timeEl = el('b', 'hud-time', '00:00')
    this.waveEl = el('span', 'hud-sub', 'WAVE 1')
    tc.append(this.timeEl, this.waveEl)

    // Top-right: score
    const tr = el('div', 'u p hud-tr')
    tr.append(el('span', 'hud-label', 'SCORE'))
    this.scoreEl = el('b', 'hud-score', '0')
    tr.append(this.scoreEl)

    // Boss bar (hidden until wave 3)
    this.bossBar = el('div', 'u p boss-bar')
    this.bossBar.style.display = 'none'
    this.bossBar.append(el('span', 'boss-title', 'JUGGERNAUT'))
    const bar = el('div', 'bar')
    this.bossFill = el('i')
    bar.append(this.bossFill)
    this.bossBar.append(bar)

    // Left rail: streak
    this.comboWrap = el('div', 'u combo-wrap')
    this.comboWrap.append(el('span', 'combo-label', 'STREAK'))
    this.comboEl = el('b', 'combo-val', '0x')
    this.comboWrap.append(this.comboEl)

    // Left rail: meters
    const meters = el('div', 'u meters')
    const threat = el('div', 'meter')
    threat.append(el('span', 'hud-label', 'THREAT'))
    this.threatFill = el('i')
    const tb = el('div', 'meter-bar')
    tb.append(this.threatFill)
    threat.append(tb)
    const oc = el('div', 'meter')
    oc.append(el('span', 'hud-label', 'ADRENALINE'))
    this.overclockFill = el('i')
    const ob = el('div', 'meter-bar oc')
    ob.append(this.overclockFill)
    oc.append(ob)
    meters.append(threat, oc)

    // Left rail: run stats
    const st = el('div', 'u runstats')
    this.killsEl = el('b', '', '0')
    this.wpmEl = el('b', '', '0')
    st.append(el('span', '', 'KILLS '), this.killsEl, el('br'), el('span', '', 'WPM/ACC '), this.wpmEl)

    // Right: partner chip (co-op)
    this.partnerChip = el('div', 'u p partner')
    this.partnerChip.style.display = 'none'
    this.partnerName = el('span', 'partner-name', '')
    this.partnerScore = el('b', 'partner-score', '0')
    this.partnerLives = el('span', 'partner-lives', '')
    this.partnerChip.append(this.partnerName, this.partnerScore, this.partnerLives)

    // Mode / seed chip
    const modeChip = el('div', 'u p mode-chip')
    this.modeEl = el('span', '', '')
    this.seedEl = el('span', 'seed', '')
    modeChip.append(this.modeEl, this.seedEl)

    // Next-key plate
    const tk = el('div', 'u p tk-plate')
    this.targetEl = el('b', '', '-')
    tk.append(this.targetEl, el('small', '', 'NEXT KEY'))

    // Status line + controls hint
    const bottom = el('div', 'u hud-bottom')
    this.statusEl = el('div', 'p status', 'RANGE HOT')
    const hint = el('div', 'p hint', 'MOVE ARROWS · TYPE HOME ROW A S D F G H J K L ; \' · SPACE JUMP · SHIFT SPRINT · ESC PAUSE')
    bottom.append(this.statusEl, hint)

    const pauseBtn = el('button', 'u pause-btn', 'II')
    pauseBtn.setAttribute('aria-label', 'Pause')
    pauseBtn.addEventListener('click', cb.onPause)

    this.root.append(tl, tc, tr, this.bossBar, this.comboWrap, meters, st, this.partnerChip, modeChip, tk, bottom, pauseBtn)
    parent.append(this.root)
  }

  private set(node: HTMLElement, key: string, value: string): void {
    if (this.cache.get(key) === value) return
    this.cache.set(key, value)
    node.textContent = value
  }

  show(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none'
  }

  setMode(mode: string, seed: string): void {
    this.set(this.modeEl, 'mode', mode)
    this.set(this.seedEl, 'seed', seed ? ` / ${seed}` : '')
  }

  setPartner(name: string): void {
    this.partnerVisible = true
    this.partnerChip.style.display = 'block'
    this.set(this.partnerName, 'pname', name)
  }

  update(vm: ViewModel, threat: number, wpmVal: number, accVal: number): void {
    const p = vm.players[0]
    if (p) {
      this.pips.forEach((pip, i) => pip.classList.toggle('on', i < p.lives))
      this.set(this.scoreEl, 'score', formatScore(p.score))
      const combo = p.combo
      this.set(this.comboEl, 'combo', `${combo}x`)
      this.comboWrap.classList.toggle('hot', combo >= 7)
      this.overclockFill.style.width = `${Math.min(100, (combo / 12) * 100)}%`
      this.dashFill.style.width = `${Math.min(100, (1 - p.dashCd / 1.8) * 100)}%`
    }
    this.set(this.timeEl, 'time', formatClock(vm.time))
    this.set(this.waveEl, 'wave', vm.wave === 3 ? 'FINAL WAVE' : `WAVE ${vm.wave}`)
    this.set(this.killsEl, 'kills', String(vm.kills))
    this.set(this.wpmEl, 'wpm', `${wpmVal} / ${accVal}%`)
    this.threatFill.style.width = `${Math.min(100, threat * 66)}%`

    const boss = vm.bossMax > 0 && vm.enemies.some(e => e.kind === 'BOSS')
    this.bossBar.style.display = boss ? 'block' : 'none'
    if (boss) this.bossFill.style.width = `${Math.max(0, vm.bossHp / vm.bossMax) * 100}%`

    // Target key: locked enemy, else nearest.
    const lock = vm.enemies.find(e => e.id === vm.lockId)
    const target = lock ?? vm.enemies[0]
    const ch = target ? (target.seq[target.ti] ?? '-') : '-'
    this.set(this.targetEl, 'tk', ch === ' ' ? '␣' : ch)

    const status = vm.over === 1
      ? 'RANGE CLEAR'
      : vm.over === 2
        ? 'OPERATOR DOWN'
        : (p?.combo ?? 0) >= 7
          ? `ADRENALINE RUSH ${p!.combo}x`
          : vm.wave === 2
            ? 'GUNNERS: 2-KEY SEQUENCES'
            : vm.wave === 3
              ? 'JUGGERNAUT — JUMP THE BLAST WAVES'
              : 'RANGE HOT'
    this.set(this.statusEl, 'status', status)

    if (this.partnerVisible && vm.players[1]) {
      this.set(this.partnerScore, 'pscore', formatScore(vm.players[1].score))
      this.set(this.partnerLives, 'plives', `${vm.players[1].lives} ARMOR`)
    }
  }

  updateGameOverRank(score: number): string {
    return rank(score)
  }
}
