/**
 * DirectRoom — the guaranteed fallback transport.
 *
 * WebRTC offer/answer exchanged as paste codes over ANY channel the players
 * already have (WhatsApp, Discord, SMS…). Zero infrastructure, zero relays,
 * works even when every signaling network is blocked: the messaging app IS
 * the signaling network.
 *
 * Codes are JSON → deflate → base64url (~1 KB), versioned and length-capped,
 * wrapped as `c3d1.<payload>` so they are self-describing and safe to paste
 * (all whitespace tolerated on decode).
 */
import { decode, encode, type NetMsg } from '../core/protocol'
import { SESSION_PEER_ID, type MessageHandler, type PeerHandler, type Transport } from './transport'
import { RTC_CONFIG } from './ice'

/* ---------------------------- invite codec ---------------------------- */

export const INVITE_PREFIX = 'c3d1'
export const INVITE_PREFIX_PLAIN = 'c3d0'
const MAX_CODE_CHARS = 300_000
const MAX_SDP_CHARS = 200_000

export interface InvitePayload {
  v: 1
  t: 'o' | 'a'
  s: string
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(b64: string): Uint8Array {
  const norm = b64.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(norm + '='.repeat((4 - (norm.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function stream(bytes: Uint8Array, mode: 'd' | 'i'): Promise<Uint8Array> {
  // CompressionStream exists in every browser this game supports; the plain
  // prefix path below covers the rest.
  const cs = new (mode === 'd' ? CompressionStream : DecompressionStream)('deflate-raw')
  const src = new Blob([bytes as BlobPart]).stream().pipeThrough(cs)
  return new Uint8Array(await new Response(src).arrayBuffer())
}

export async function encodeInvite(p: InvitePayload): Promise<string> {
  const json = JSON.stringify(p)
  if (typeof CompressionStream === 'undefined') {
    return `${INVITE_PREFIX_PLAIN}.${toBase64Url(new TextEncoder().encode(json))}`
  }
  const zipped = await stream(new TextEncoder().encode(json), 'd')
  return `${INVITE_PREFIX}.${toBase64Url(zipped)}`
}

export async function decodeInvite(code: string): Promise<InvitePayload> {
  const clean = code.replace(/\s+/g, '')
  if (clean.length > MAX_CODE_CHARS) throw new Error('invite code too long')
  let payload: string
  if (clean.startsWith(`${INVITE_PREFIX}.`)) {
    payload = new TextDecoder().decode(await stream(fromBase64Url(clean.slice(5)), 'i'))
  } else if (clean.startsWith(`${INVITE_PREFIX_PLAIN}.`)) {
    payload = new TextDecoder().decode(fromBase64Url(clean.slice(5)))
  } else {
    throw new Error('not a RANGE HOT invite code')
  }
  const obj = JSON.parse(payload) as Partial<InvitePayload>
  if (
    obj.v !== 1 || (obj.t !== 'o' && obj.t !== 'a') ||
    typeof obj.s !== 'string' || obj.s.length === 0 || obj.s.length > MAX_SDP_CHARS
  ) {
    throw new Error('malformed invite code')
  }
  return { v: 1, t: obj.t, s: obj.s }
}

/* ------------------------------ transport ------------------------------ */

/** Wait until ICE gathering completes (or a bound elapses — TURN candidates
 *  arrive fast; waiting forever on a broken network helps nobody). */
function gatherComplete(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise(resolve => {
    const done = (): void => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    const onChange = (): void => {
      if (pc.iceGatheringState === 'complete') done()
    }
    const timer = setTimeout(done, timeoutMs)
    pc.addEventListener('icegatheringstatechange', onChange)
  })
}

export class DirectRoom implements Transport {
  readonly role: 'host' | 'guest'
  private pc: RTCPeerConnection
  private dc: RTCDataChannel | null = null
  private left = false
  private opened = false

  private readonly msgHandlers = new Set<MessageHandler>()
  private readonly joinHandlers = new Set<PeerHandler>()
  private readonly leaveHandlers = new Set<PeerHandler>()

  private constructor(role: 'host' | 'guest') {
    this.role = role
    this.pc = new RTCPeerConnection(RTC_CONFIG)
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed') this.fireLeave()
    }
  }

  /* ------------------------------ host side ------------------------------ */

  /** Host step 1: build the invite code to send to the friend. */
  static async createInvite(): Promise<{ room: DirectRoom; code: string }> {
    const room = new DirectRoom('host')
    room.dc = room.pc.createDataChannel('game', { ordered: true })
    room.wireChannel()
    const offer = await room.pc.createOffer()
    await room.pc.setLocalDescription(offer)
    await gatherComplete(room.pc)
    const sdp = room.pc.localDescription?.sdp ?? ''
    return { room, code: await encodeInvite({ v: 1, t: 'o', s: sdp }) }
  }

  /** Host step 2: accept the friend's reply code → channel opens. */
  async acceptReply(code: string): Promise<void> {
    const p = await decodeInvite(code)
    if (p.t !== 'a') throw new Error('expected a reply code from your friend')
    await this.pc.setRemoteDescription({ type: 'answer', sdp: p.s })
  }

  /* ----------------------------- guest side ----------------------------- */

  /** Guest step 1+2: paste the host's invite, get the reply code to send back. */
  static async joinFromInvite(code: string): Promise<{ room: DirectRoom; reply: string }> {
    const p = await decodeInvite(code)
    if (p.t !== 'o') throw new Error('expected an invite code from the host')
    const room = new DirectRoom('guest')
    room.pc.ondatachannel = e => {
      room.dc = e.channel
      room.wireChannel()
    }
    await room.pc.setRemoteDescription({ type: 'offer', sdp: p.s })
    const answer = await room.pc.createAnswer()
    await room.pc.setLocalDescription(answer)
    await gatherComplete(room.pc)
    const sdp = room.pc.localDescription?.sdp ?? ''
    return { room, reply: await encodeInvite({ v: 1, t: 'a', s: sdp }) }
  }

  /* ------------------------------ transport ------------------------------ */

  private wireChannel(): void {
    const dc = this.dc
    if (!dc) return
    dc.onopen = () => {
      if (this.opened || this.left) return
      this.opened = true
      for (const h of this.joinHandlers) h(SESSION_PEER_ID)
    }
    dc.onclose = () => this.fireLeave()
    dc.onerror = () => this.fireLeave()
    dc.onmessage = e => {
      if (typeof e.data !== 'string') return
      try {
        const msg = decode(e.data)
        for (const h of this.msgHandlers) h(msg, SESSION_PEER_ID)
      } catch (err) {
        console.warn('net[direct]: dropped malformed message', err)
      }
    }
  }

  private fireLeave(): void {
    if (this.left) return
    this.left = true
    for (const h of this.leaveHandlers) h(SESSION_PEER_ID)
  }

  sendMsg(msg: NetMsg, _peerId?: string): void {
    if (this.dc?.readyState !== 'open') return
    try {
      this.dc.send(encode(msg))
    } catch (err) {
      console.warn('net[direct]: send failed', err)
    }
  }

  onMessage(h: MessageHandler): void {
    this.msgHandlers.add(h)
  }

  onPeerJoin(h: PeerHandler): void {
    this.joinHandlers.add(h)
    if (this.opened && !this.left) h(SESSION_PEER_ID)
  }

  onPeerLeave(h: PeerHandler): void {
    this.leaveHandlers.add(h)
  }

  leave(): void {
    try {
      this.dc?.close()
    } catch {
      /* ignore */
    }
    try {
      this.pc.close()
    } catch {
      /* ignore */
    }
    this.fireLeave()
  }
}
