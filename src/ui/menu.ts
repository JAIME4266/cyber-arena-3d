/**
 * Main menu + sub-panels (how to play, settings, co-op lobby) — all plain DOM,
 * keyboard accessible, built once and shown/hidden.
 */
import { VERSION } from '../core/constants'
import { dailySeed } from '../core/stats'
import type { AudioSettings } from '../render/audio'

export interface MenuCallbacks {
  onSolo(): void
  onDaily(): void
  onCoopCreate(): void
  onCoopJoin(): void
  onHowToPlay(): void
  onSettings(): void
}

export interface Settings extends AudioSettings {
  shake: boolean
  speedlines: boolean
  hd: boolean
  name?: string
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function btn(label: string, hint: string, cls: string, onClick: () => void): HTMLElement {
  const b = el('button', `btn ${cls}`)
  b.append(el('span', '', label), el('small', '', hint))
  b.addEventListener('click', onClick)
  return b
}

export class Menu {
  readonly root: HTMLElement
  private readonly menuMain: HTMLElement
  private readonly hdStatus: HTMLElement

  constructor(parent: HTMLElement, cb: MenuCallbacks) {
    this.root = el('div')
    this.root.id = 'menu'

    const h1 = el('h1')
    h1.append('CYBER ARENA ', el('em', '', '3D'))
    this.root.append(h1)
    this.root.append(el('div', 'tagline', 'TYPING COMBAT · ELITE PROTOCOL'))

    this.hdStatus = el('div', 'hd-status', 'HD ASSETS · STANDBY')
    this.root.append(this.hdStatus)

    this.menuMain = el('div', 'menu-grid')
    this.menuMain.append(
      btn('SOLO RUN', 'ENDLESS ARENA', '', cb.onSolo),
      btn('DAILY CHALLENGE', dailySeed().toUpperCase().replace('DAILY-', '· ') + ' · SAME SEED FOR EVERYONE', 'amber', cb.onDaily),
      btn('CO-OP: CREATE ROOM', 'P2P · SHARE A 6-CHAR CODE', 'magenta', cb.onCoopCreate),
      btn('CO-OP: JOIN ROOM', 'ENTER FRIEND\u2019S CODE', 'magenta', cb.onCoopJoin),
      btn('HOW TO PLAY', 'CONTROLS + RULES', 'green', cb.onHowToPlay),
      btn('SETTINGS', 'AUDIO · FX · CALLSIGN', '', cb.onSettings),
    )
    this.root.append(this.menuMain)

    const foot = el('div', 'menu-foot')
    foot.append(el('span', '', `V${VERSION} · ORIGINAL BUILD BY JAIME · ELITE REBUILD`))
    this.root.append(foot)

    parent.append(this.root)
  }

  show(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none'
  }

  /** Boot/progress line for the HD asset pack (shown on the main menu). */
  setHdStatus(text: string, cls = ''): void {
    this.hdStatus.textContent = text
    this.hdStatus.className = `hd-status${cls ? ` ${cls}` : ''}`
  }

  showMain(visible: boolean): void {
    this.menuMain.style.display = visible ? 'flex' : 'none'
  }
}

/**
 * Generic overlay card. `dismiss()` removes the element silently; `close()`
 * removes it AND fires onClose (used by the CLOSE button and Escape).
 */
export function overlayCard(
  parent: HTMLElement,
  title: string,
  onClose: () => void,
): { card: HTMLElement; close: () => void; dismiss: () => void } {
  const wrap = el('div', 'panel-overlay')
  const card = el('div', 'card')
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-label', title)
  card.append(el('h2', '', title))
  let dismissed = false
  const dismiss = (): void => {
    if (dismissed) return
    dismissed = true
    wrap.remove()
  }
  const close = (): void => {
    if (dismissed) return
    dismiss()
    onClose()
  }
  const actions = el('div', 'row-actions')
  const closeBtn = el('button', 'btn', 'CLOSE')
  closeBtn.addEventListener('click', close)
  actions.append(closeBtn)
  wrap.append(card)
  wrap.addEventListener('keydown', e => {
    if (e.key === 'Escape') close()
  })
  parent.append(wrap)
  return {
    card,
    close: () => {
      card.append(actions)
      closeBtn.focus()
    },
    dismiss,
  }
}

export function howToPlayContent(card: HTMLElement): void {
  card.append(el('p', '', 'A typing-combat arena. Enemies close in — kill them by typing the letters above their heads. You cannot stand still: run, jump, and dash while you type.'))
  const k = el('div')
  for (const [a, b] of [
    ['MOVE', 'Arrow keys'],
    ['SHOOT', 'Type home-row keys: A S D F G H J K L ; \' ,'],
    ['JUMP', 'Space — dodge bullets & shockwaves'],
    ['DASH', 'Shift — quick burst with brief invulnerability'],
    ['PAUSE', 'Esc (solo only)'],
  ] as const) {
    const r = el('div', 'krow')
    r.append(el('b', '', a), el('span', '', b))
    k.append(r)
  }
  card.append(k)
  card.append(el('h3', '', 'RULES'))
  const ul = el('ul')
  for (const t of [
    'Correct keys build COMBO. Miss or get hit — combo breaks.',
    'Combo OVERCLOCKS you: faster movement, multiplied score.',
    'THREAT climbs with kills: the arena gets meaner. Waves at 50 and 100 kills.',
    'Wave 2: Elites fire lasers — jump them (they fly low).',
    'Wave 3: the Overlord Core. Shockwaves, bullet rings, aimed volleys.',
    'Green EMP bubbles halve your speed. Yellow cells restore shields.',
  ]) ul.append(el('li', '', t))
  card.append(ul)
  card.append(el('h3', '', 'CO-OP'))
  card.append(el('p', '', 'Create a room, send the 6-char code to a friend, and fight the same arena together over a direct browser-to-browser connection. No server, no account.'))
}

export function settingsContent(card: HTMLElement, s: Settings, onChange: (s: Settings) => void): void {
  const row = (label: string, node: HTMLElement): HTMLElement => {
    const r = el('div', 'set-row')
    const l = el('label', '', label)
    r.append(l, node)
    return r
  }
  const range = (value: number, onInput: (v: number) => void): HTMLInputElement => {
    const i = document.createElement('input')
    i.type = 'range'
    i.min = '0'
    i.max = '100'
    i.value = String(Math.round(value * 100))
    i.addEventListener('input', () => onInput(Number(i.value) / 100))
    return i
  }
  const toggle = (on: boolean, onToggle: (v: boolean) => void): HTMLElement => {
    const t = el('div', `toggle${on ? ' on' : ''}`)
    t.setAttribute('role', 'switch')
    t.setAttribute('aria-checked', String(on))
    t.setAttribute('tabindex', '0')
    const flip = (): void => {
      const now = !t.classList.contains('on')
      t.classList.toggle('on', now)
      t.setAttribute('aria-checked', String(now))
      onToggle(now)
    }
    t.addEventListener('click', flip)
    t.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        flip()
      }
    })
    return t
  }

  const music = range(s.musicVolume, v => onChange({ ...s, musicVolume: v }))
  card.append(row('MUSIC VOLUME', music))
  const sfx = range(s.sfxVolume, v => onChange({ ...s, sfxVolume: v }))
  card.append(row('SFX VOLUME', sfx))
  card.append(row('CAMERA SHAKE', toggle(s.shake, v => onChange({ ...s, shake: v }))))
  card.append(row('SPEED LINES', toggle(s.speedlines, v => onChange({ ...s, speedlines: v }))))
  card.append(row('HD MODELS', toggle(s.hd, v => onChange({ ...s, hd: v }))))

  const nameRow = el('div', 'set-row')
  nameRow.append(el('label', '', 'CALLSIGN (CO-OP)'))
  const nameInput = document.createElement('input')
  nameInput.className = 'text-input'
  nameInput.maxLength = 12
  nameInput.value = s.name ?? ''
  nameInput.setAttribute('aria-label', 'Callsign')
  nameInput.addEventListener('input', () => onChange({ ...s, name: nameInput.value.toUpperCase() }))
  nameRow.append(nameInput)
  card.append(nameRow)
}

/** Co-op join prompt. Returns dismiss so callers can remove it programmatically. */
export function coopJoinCard(parent: HTMLElement, onJoin: (code: string) => void, onClose: () => void): { dismiss: () => void } {
  const { card, close, dismiss } = overlayCard(parent, 'JOIN CO-OP ROOM', onClose)
  card.append(el('p', '', 'Ask your friend for their 6-character room code.'))
  const input = document.createElement('input')
  input.className = 'code-input'
  input.maxLength = 6
  input.placeholder = 'XXXXXX'
  input.setAttribute('aria-label', 'Room code')
  input.autocomplete = 'off'
  card.append(input)
  const actions = el('div', 'row-actions')
  const go = el('button', 'btn magenta', 'CONNECT')
  go.addEventListener('click', () => onJoin(input.value.trim().toUpperCase()))
  actions.append(go)
  card.append(actions)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') go.click()
    if (e.key === 'Escape') close()
  })
  window.setTimeout(() => input.focus(), 50)
  return { dismiss }
}
