/**
 * Net room: a thin typed wrapper around Trystero (WebRTC data channels with
 * serverless signaling over public Nostr relays — no backend, no keys).
 *
 * Roles: the player who clicks "Create Room" generates the code and becomes
 * HOST (runs the authoritative sim). The joiner is the GUEST.
 */
import { joinRoom } from 'trystero'
import type { MessageAction, Room } from 'trystero'
import { GAME_ID } from '../core/constants'
import { decode, encode, type NetMsg } from '../core/protocol'

export type PeerHandler = (peerId: string) => void

export class NetRoom {
  readonly code: string
  readonly role: 'host' | 'guest'
  private readonly room: Room
  private readonly action: MessageAction<string>
  private readonly peerJoinHandlers = new Set<PeerHandler>()
  private readonly peerLeaveHandlers = new Set<PeerHandler>()
  private readonly msgHandlers = new Set<(msg: NetMsg, peerId: string) => void>()
  private readonly peerIds = new Set<string>()
  private readonly unsubscribes: Array<() => void> = []

  constructor(code: string, role: 'host' | 'guest') {
    this.code = code
    this.role = role
    this.room = joinRoom({ appId: GAME_ID }, `v1-${code}`)
    this.action = this.room.makeAction<string>('m')

    this.unsubscribes.push(
      this.action.onMessage((data, ctx) => {
        try {
          const msg = decode(data)
          for (const h of this.msgHandlers) h(msg, ctx.peerId)
        } catch (err) {
          console.warn('net: dropped malformed message', err)
        }
      }),
      this.room.onPeerJoin(ctx => {
        this.peerIds.add(ctx.peerId)
        for (const h of this.peerJoinHandlers) h(ctx.peerId)
      }),
      this.room.onPeerLeave(ctx => {
        this.peerIds.delete(ctx.peerId)
        for (const h of this.peerLeaveHandlers) h(ctx.peerId)
      }),
      this.room.onError(err => {
        console.warn('net: room error', err)
      }),
    )
  }

  get peers(): string[] {
    return [...this.peerIds]
  }

  /** Broadcast to everyone, or target a single peer. */
  sendMsg(msg: NetMsg, peerId?: string): void {
    void this.action.send(encode(msg), peerId ? { target: peerId } : undefined)
  }

  onMessage(h: (msg: NetMsg, peerId: string) => void): void {
    this.msgHandlers.add(h)
  }

  onPeerJoin(h: PeerHandler): void {
    this.peerJoinHandlers.add(h)
  }

  onPeerLeave(h: PeerHandler): void {
    this.peerLeaveHandlers.add(h)
  }

  leave(): void {
    try {
      this.sendMsg({ v: 1, t: 'bye' })
    } catch {
      /* best effort */
    }
    for (const u of this.unsubscribes) u()
    void this.room.leave()
  }
}
