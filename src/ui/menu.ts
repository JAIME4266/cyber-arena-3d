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

    const board = el('div', 'menu-board')

    const h1 = el('h1')
    h1.append('RANGE ', el('em', '', 'HOT'))
    board.append(h1)
    board.append(el('div', 'title-rule'))
    board.append(el('div', 'tagline', 'LIVE-FIRE TYPING RANGE'))

    this.hdStatus = el('div', 'hd-status', 'HD MODELS · STANDBY')
    board.append(this.hdStatus)

    this.menuMain = el('div', 'menu-grid')
    this.menuMain.append(
      btn('SOLO DRILL', 'FREE RANGE · ENDLESS', 'primary', cb.onSolo),
      btn('DAILY DRILL', dailySeed().toUpperCase().replace('DAILY-', '\u00b7 ') + ' · SAME SEED FOR EVERYONE', '', cb.onDaily),
      btn('SQUAD: HOST ROOM', 'P2P · SHARE A 6-CHAR CODE', '', cb.onCoopCreate),
      btn('SQUAD: JOIN ROOM', 'ENTER FRIEND\u2019S CODE', '', cb.onCoopJoin),
      btn('HOW TO PLAY', 'BRIEFING + CONTROLS', '', cb.onHowToPlay),
      btn('SETTINGS', 'AUDIO · FX · CALLSIGN', '', cb.onSettings),
    )
    board.append(this.menuMain)

    const foot = el('div', 'menu-foot')
    foot.append(el('span', '', `V${VERSION} · A JAIME ORIGINAL · RANGE HOT REBUILD`))
    board.append(foot)

    this.root.append(board)

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
  card.append(el('p', '', 'A live-fire typing range. Hostiles close in — put them down by typing the letters stenciled above their heads. You cannot stand still: run, jump, and sprint while you type.'))
  const k = el('div')
  for (const [a, b] of [
    ['MOVE', 'Arrow keys'],
    ['SHOOT', 'Type home-row keys: A S D F G H J K L ; \' ,'],
    ['JUMP', 'Space — dodge rounds & blast waves'],
    ['SPRINT', 'Shift — quick burst with brief invulnerability'],
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
    'Correct keys build a STREAK. Miss or get hit — the streak breaks.',
    'The streak feeds ADRENALINE: faster movement, multiplied score.',
    'THREAT climbs with kills: the range gets meaner. Waves at 50 and 100 kills.',
    'Wave 2: Gunners fire low — jump their rounds. They need 2-key sequences.',
    'Wave 3: the JUGGERNAUT. Blast waves, bullet rings, aimed volleys.',
    'Yellow-green GAS clouds halve your speed. White MED KITS restore armor plates.',
  ]) ul.append(el('li', '', t))
  card.append(ul)
  card.append(el('h3', '', 'SQUAD LINK'))
  card.append(el('p', '', 'Host a room, send the 6-char code to a friend, and fight the same range together over a direct browser-to-browser connection. No server, no account.'))
  card.append(el('p', '', 'If the code ever fails to connect, switch to DIRECT LINK: send the invite code over any messenger and paste the reply back — it works with zero relays.'))
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
