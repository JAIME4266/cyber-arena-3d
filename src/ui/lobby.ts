/**
 * Co-op lobby UI: the room-code flow with live signaling diagnostics, plus
 * the DIRECT LINK fallback (paste-code invite flow) on both sides.
 *
 * Every state the connection hub reports is rendered — no more "connecting…"
 * limbo. Selectors used by E2E: .room-code, .sig-matrix, .lobby-status,
 * .direct-out (host invite textarea), .direct-in (reply textarea).
 */
import { overlayCard } from './menu'
import type { NetStatus } from '../net/transport'

export function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

export function button(cls: string, text: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = cls
  b.textContent = text
  return b
}

const STRATEGY_LABELS: Record<string, string> = {
  nostr: 'NOSTR',
  torrent: 'TORRENT',
  mqtt: 'MQTT',
}

function phaseLine(s: NetStatus): string {
  switch (s.phase) {
    case 'booting':
      return 'LINKING SIGNAL NETWORKS…'
    case 'signaling':
    case 'rescan':
      return `SCANNING FOR PARTNER · ROUND ${s.attempt}`
    case 'peer-found':
      return 'PARTNER FOUND — LINKING'
    case 'connected':
      return 'LINK ESTABLISHED'
  }
}

export class CoopLobby {
  private readonly card: HTMLElement
  private readonly dismiss: () => void
  private readonly isHost: boolean
  private readonly status: HTMLElement
  private readonly matrix: HTMLElement
  private readonly note: HTMLElement
  private launchBtn: HTMLButtonElement | null = null
  private directLaunch: HTMLButtonElement | null = null
  private partnerHere = false
  private hintShown = false
  private started = false
  private dead = false
  private body: HTMLElement

  onLaunch: () => void = () => {}
  onDirectInvite: () => void = () => {}
  onAcceptReply: (reply: string) => void = () => {}
  onBackToCode: () => void = () => {}

  constructor(
    parent: HTMLElement,
    code: string,
    isHost: boolean,
    onExit: () => void,
  ) {
    this.isHost = isHost
    const { card, close, dismiss } = overlayCard(
      parent,
      isHost ? 'CO-OP ROOM CREATED' : 'JOINING CO-OP ROOM',
      onExit,
    )
    this.card = card
    this.dismiss = dismiss

    this.body = el('div', 'lobby-body')
    this.body.append(el('p', '', isHost
      ? 'Send this code to your friend. The run launches once they connect.'
      : 'Connected to the signaling networks — waiting for the host…'))
    this.body.append(el('div', 'room-code', code))

    this.matrix = el('div', 'sig-matrix')
    this.body.append(this.matrix)

    this.status = el('p', 'lobby-status', 'LINKING SIGNAL NETWORKS…')
    this.body.append(this.status)
    this.note = el('p', 'lobby-note')
    this.note.style.display = 'none'
    this.body.append(this.note)

    if (isHost) {
      this.launchBtn = button('btn magenta', 'LAUNCH CO-OP RUN')
      this.launchBtn.disabled = true
      this.launchBtn.addEventListener('click', () => {
        if (this.launchBtn?.disabled) return
        this.started = true
        this.onLaunch()
      })
      this.body.append(this.launchBtn)
    }

    const actions = el('div', 'row-actions')
    const copy = button('btn', 'COPY CODE')
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(code).then(
        () => this.setStatus('CODE COPIED — SEND IT TO YOUR FRIEND', 'ok'),
        () => this.setStatus('COPY BLOCKED — WRITE THE CODE DOWN', 'err'),
      )
    })
    actions.append(copy)
    if (isHost) {
      const direct = button('btn amber', 'DIRECT LINK — NO RELAYS')
      direct.addEventListener('click', () => this.onDirectInvite())
      actions.append(direct)
    }
    this.body.append(actions)

    card.append(this.body)
    close()
  }

  /** Live status from the connection hub (relay path). */
  setNetStatus(s: NetStatus): void {
    if (this.dead || this.started) return
    this.renderMatrix(s)
    let line = phaseLine(s)
    if (this.isHost && this.partnerHere && s.phase === 'connected') {
      line = 'PARTNER CONNECTED — READY'
    } else if (this.isHost && this.partnerHere) {
      line = 'PARTNER FOUND — READY'
    }
    this.status.textContent = line
    this.status.className = `lobby-status${s.phase === 'connected' ? ' ok' : ''}`
    this.note.style.display = s.note ? 'block' : 'none'
    this.note.textContent = s.note ?? ''
    // Actionable hint after a couple of quiet rounds.
    if (!this.isHost && !this.partnerHere && !this.hintShown && s.attempt >= 2
      && (s.phase === 'signaling' || s.phase === 'rescan')) {
      this.hintShown = true
      this.note.style.display = 'block'
      this.note.textContent =
        'STILL SCANNING — CHECK THE CODE WITH THE HOST, OR ASK THEM FOR A DIRECT INVITE'
    }
  }

  private renderMatrix(s: NetStatus): void {
    this.matrix.textContent = ''
    for (const st of s.strategies) {
      const chip = el('span', `sig-chip ${st.state}`)
      const label = STRATEGY_LABELS[st.name] ?? st.name
      chip.textContent = st.state === 'off'
        ? `${label} OFF`
        : st.state === 'ready'
          ? `${label} ${st.open}/${st.total}`
          : `${label} …`
      chip.title = st.state === 'off'
        ? `${label} network unavailable from this device`
        : `${label}: ${st.open}/${st.total} signaling nodes connected`
      this.matrix.append(chip)
    }
  }

  partnerJoined(): void {
    if (this.dead) return
    this.partnerHere = true
    if (this.launchBtn) this.launchBtn.disabled = false
    this.status.textContent = this.isHost
      ? 'PARTNER CONNECTED — READY'
      : 'CONNECTED — WAITING FOR HOST TO LAUNCH'
    if (this.launchBtn && !this.started) this.launchBtn.focus()
  }

  partnerLeft(): void {
    if (this.dead || this.started) return
    this.partnerHere = false
    if (this.launchBtn) this.launchBtn.disabled = true
    this.status.textContent = 'PARTNER LOST — RESUMING SCAN'
  }

  setStatus(text: string, cls: '' | 'ok' | 'err' = ''): void {
    if (this.dead) return
    this.status.textContent = text
    this.status.className = `lobby-status${cls ? ` ${cls}` : ''}`
  }

  /** Tear the card down (session starting or user exited). */
  destroy(): void {
    this.dead = true
    this.dismiss()
  }

  /* --------------------------- DIRECT LINK flow --------------------------- */

  /** Host: show the invite code to send, and the reply box. */
  showHostDirect(inviteCode: string): void {
    if (this.dead) return
    this.card.textContent = ''
    this.card.append(el('h2', '', 'DIRECT LINK — NO RELAYS'))
    this.card.append(el('p', '', 'Works even when every signaling network is blocked. Send this invite to your friend with any messenger (WhatsApp, Discord, SMS):'))
    const out = document.createElement('textarea')
    out.className = 'direct-out'
    out.readOnly = true
    out.value = inviteCode
    out.setAttribute('aria-label', 'Direct invite code')
    this.card.append(out)
    const row1 = el('div', 'row-actions')
    const copy = button('btn amber', 'COPY INVITE')
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(inviteCode).then(
        () => this.setStatus('INVITE COPIED — SEND IT NOW', 'ok'),
        () => {
          out.select()
          this.setStatus('COPY BLOCKED — SELECT AND COPY MANUALLY', 'err')
        },
      )
    })
    row1.append(copy)
    this.card.append(row1)

    this.card.append(el('h3', '', 'THEN PASTE THEIR REPLY'))
    const inp = document.createElement('textarea')
    inp.className = 'direct-in'
    inp.placeholder = 'PASTE REPLY CODE HERE'
    inp.setAttribute('aria-label', 'Friend reply code')
    this.card.append(inp)
    const row2 = el('div', 'row-actions')
    const accept = button('btn magenta', 'ACCEPT REPLY')
    accept.addEventListener('click', () => {
      const v = inp.value.trim()
      if (v.length === 0) {
        this.setStatus('PASTE THE REPLY CODE FIRST', 'err')
        return
      }
      this.setStatus('ACCEPTING REPLY…')
      this.onAcceptReply(v)
    })
    row2.append(accept)
    const back = button('btn', 'BACK TO ROOM CODE')
    back.addEventListener('click', () => this.onBackToCode())
    row2.append(back)
    this.card.append(row2)

    this.status.className = 'lobby-status'
    this.status.textContent = 'INVITE READY — WAITING FOR YOUR FRIEND'
    this.card.append(this.status)
  }

  /** Host: direct flow connected. */
  directConnected(): void {
    if (this.dead) return
    this.setStatus('PARTNER CONNECTED — READY', 'ok')
    if (this.directLaunch) this.directLaunch.disabled = false
    else {
      const launch = button('btn magenta', 'LAUNCH CO-OP RUN')
      launch.addEventListener('click', () => {
        if (launch.disabled) return
        this.started = true
        this.onLaunch()
      })
      this.directLaunch = launch
      this.card.append(launch)
      launch.focus()
    }
  }

  directError(message: string): void {
    if (this.dead) return
    this.setStatus(message, 'err')
    if (this.directLaunch) this.directLaunch.disabled = true
  }
}

/* --------------------------- guest join prompt --------------------------- */

export interface JoinPromptCallbacks {
  onCode(code: string): void
  onDirectInvite(invite: string): void
}

/**
 * Join dialog with two modes: the 6-char room code (relay path) and a
 * direct-invite paste box (fallback path).
 */
export function coopJoinPrompt(
  parent: HTMLElement,
  cb: JoinPromptCallbacks,
  onClose: () => void,
): { dismiss: () => void } {
  const { card, close, dismiss } = overlayCard(parent, 'JOIN CO-OP ROOM', onClose)

  const tabs = el('div', 'join-tabs')
  const tabCode = button('join-tab on', 'ROOM CODE')
  const tabDirect = button('join-tab', 'DIRECT INVITE')
  tabs.append(tabCode, tabDirect)
  card.append(tabs)

  /* --- room code mode --- */
  const codePane = el('div', 'join-pane')
  codePane.append(el('p', '', 'Ask your friend for their 6-character room code.'))
  const input = document.createElement('input')
  input.className = 'code-input'
  input.maxLength = 6
  input.placeholder = 'XXXXXX'
  input.setAttribute('aria-label', 'Room code')
  input.autocomplete = 'off'
  codePane.append(input)
  const go = button('btn magenta', 'CONNECT')
  go.addEventListener('click', () => cb.onCode(input.value.trim().toUpperCase()))
  const rowCode = el('div', 'row-actions')
  rowCode.append(go)
  codePane.append(rowCode)

  /* --- direct mode --- */
  const directPane = el('div', 'join-pane')
  directPane.style.display = 'none'
  directPane.append(el('p', '', 'If the code keeps failing, ask the host for a DIRECT INVITE and paste it below. Works without any relay.'))
  const invite = document.createElement('textarea')
  invite.className = 'direct-in'
  invite.placeholder = 'PASTE INVITE CODE HERE'
  invite.setAttribute('aria-label', 'Direct invite code')
  directPane.append(invite)
  const useInvite = button('btn amber', 'GENERATE REPLY')
  const rowDirect = el('div', 'row-actions')
  rowDirect.append(useInvite)
  directPane.append(rowDirect)

  card.append(codePane, directPane)

  tabCode.addEventListener('click', () => {
    tabCode.classList.add('on')
    tabDirect.classList.remove('on')
    codePane.style.display = ''
    directPane.style.display = 'none'
  })
  tabDirect.addEventListener('click', () => {
    tabDirect.classList.add('on')
    tabCode.classList.remove('on')
    directPane.style.display = ''
    codePane.style.display = 'none'
  })

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') go.click()
  })
  useInvite.addEventListener('click', () => {
    const v = invite.value.trim()
    if (v.length === 0) return
    useInvite.disabled = true
    useInvite.textContent = 'DECODING…'
    cb.onDirectInvite(v)
  })

  close()
  window.setTimeout(() => input.focus(), 50)
  return { dismiss }
}

/** Guest: waiting card after generating a direct reply — shows the reply to
 *  send back and then waits for the host to accept + launch. */
export function directGuestWait(
  parent: HTMLElement,
  reply: string,
  onExit: () => void,
): { setStatus: (text: string, cls?: '' | 'ok' | 'err') => void; dismiss: () => void } {
  const { card, close, dismiss } = overlayCard(parent, 'DIRECT LINK READY', onExit)
  card.append(el('p', '', 'Send this reply code back to the host. The run launches automatically once they accept it.'))
  const out = document.createElement('textarea')
  out.className = 'direct-out'
  out.readOnly = true
  out.value = reply
  out.setAttribute('aria-label', 'Reply code')
  card.append(out)
  const copy = button('btn amber', 'COPY REPLY')
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(reply).then(() => {
      copy.textContent = 'COPIED — SEND IT TO THE HOST'
    })
  })
  const row = el('div', 'row-actions')
  row.append(copy)
  card.append(row)
  const status = el('p', 'lobby-status', 'WAITING FOR THE HOST TO ACCEPT…')
  card.append(status)
  close()
  return {
    setStatus: (text, cls = '') => {
      status.textContent = text
      status.className = `lobby-status${cls ? ` ${cls}` : ''}`
    },
    dismiss,
  }
}
