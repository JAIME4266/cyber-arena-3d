/**
 * Overlay screens: game-over stats card, pause menu, and a toast system.
 */
import { accuracy, formatClock, formatScore, rank, wpm } from '../core/stats'
import type { ViewModel } from '../core/types'
import type { PlayerState } from '../core/types'

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

export interface GameOverActions {
  onRetry(): void
  onMenu(): void
  onShare(): void
}

export class OverlayScreens {
  private readonly gameover: HTMLElement
  private readonly pause: HTMLElement
  private readonly toasts: HTMLElement
  private readonly dmgEl: HTMLElement
  private shareText = ''

  constructor(parent: HTMLElement) {
    this.gameover = el('div')
    this.gameover.id = 'gameover'
    this.pause = el('div')
    this.pause.id = 'pause'
    this.toasts = el('div')
    this.toasts.id = 'toasts'
    this.toasts.setAttribute('aria-live', 'polite')
    this.dmgEl = el('div')
    this.dmgEl.id = 'dmg'
    this.dmgEl.style.position = 'absolute'
    parent.append(this.gameover, this.pause, this.toasts)
    document.body.append(this.dmgEl)
  }

  damageFlash(): void {
    this.dmgEl.style.transition = 'none'
    this.dmgEl.style.opacity = '1'
    requestAnimationFrame(() => {
      this.dmgEl.style.transition = 'opacity .5s'
      this.dmgEl.style.opacity = '0'
    })
  }

  toast(msg: string, kind: 'info' | 'err' | 'ok' = 'info'): void {
    const t = el('div', `toast ${kind}`, msg)
    this.toasts.append(t)
    window.setTimeout(() => t.remove(), 4200)
  }

  showGameOver(vm: ViewModel, players: PlayerState[], elapsedMs: number, mode: string, seed: string, actions: GameOverActions): void {
    const win = vm.over === 1
    this.gameover.innerHTML = ''
    const box = el('div', `go-box${win ? ' win' : ''}`)
    box.append(el('h1', '', win ? 'RANGE CLEAR' : 'OPERATOR DOWN'))
    const total = players.reduce((s, p) => s + p.score, 0)
    box.append(el('div', 'go-rank', rank(total)))
    const stats = el('div', 'go-stats')
    const addStat = (k: string, v: string): void => {
      const r = el('div')
      r.append(el('span', '', `${k} `), el('b', '', v))
      stats.append(r)
    }
    for (const p of players) {
      const label = players.length > 1 ? `${p.name} SCORE` : 'SCORE'
      addStat(label, formatScore(p.score))
      addStat(`${p.name} KILLS`, String(p.kills))
      addStat(`${p.name} WPM`, String(wpm(p.correct, elapsedMs)))
      addStat(`${p.name} ACCURACY`, `${accuracy(p.correct, p.wrong)}%`)
      addStat(`${p.name} BEST STREAK`, `${p.bestCombo}x`)
    }
    addStat('TIME', formatClock(vm.time))
    addStat('WAVE', vm.wave === 3 ? 'BOSS' : String(vm.wave))
    box.append(stats)
    const row = el('div', 'row-actions')
    const retry = el('button', 'btn primary', 'RUN IT BACK')
    retry.addEventListener('click', actions.onRetry)
    const share = el('button', 'btn', 'SHARE RESULT')
    share.addEventListener('click', actions.onShare)
    const menu = el('button', 'btn', 'MAIN MENU')
    menu.addEventListener('click', actions.onMenu)
    row.append(retry, share, menu)
    box.append(row)
    this.gameover.append(box)
    this.shareText = `RANGE HOT — ${mode}${seed ? ` (${seed})` : ''}\n` +
      `${rank(total)}\n` +
      players.map(p => `${p.name}: ${formatScore(p.score)} pts · ${p.kills} kills · ${wpm(p.correct, elapsedMs)} WPM · ${accuracy(p.correct, p.wrong)}% acc`).join('\n')
    this.gameover.classList.add('show')
    retry.focus()
  }

  getShareText(): string {
    return this.shareText
  }

  hideGameOver(): void {
    this.gameover.classList.remove('show')
  }

  showPause(actions: { onResume(): void; onRestart(): void; onMenu(): void }): void {
    this.pause.innerHTML = ''
    const card = el('div', 'card')
    card.style.textAlign = 'center'
    card.append(el('h2', '', 'PAUSED'))
    const r = el('div', 'row-actions')
    const resume = el('button', 'btn primary', 'RESUME')
    resume.addEventListener('click', actions.onResume)
    const restart = el('button', 'btn', 'RESTART')
    restart.addEventListener('click', actions.onRestart)
    const menu = el('button', 'btn', 'QUIT TO MENU')
    menu.addEventListener('click', actions.onMenu)
    r.append(resume, restart, menu)
    card.append(r)
    this.pause.append(card)
    this.pause.classList.add('show')
    resume.focus()
  }

  hidePause(): void {
    this.pause.classList.remove('show')
  }
}
