/**
 * StrategyRoom: one trystero signaling strategy (nostr / torrent / mqtt)
 * wrapped as a routed room. Peer ids are namespaced (`nostr:abcd…`) so the
 * hub can route traffic to the exact strategy that owns a peer — each
 * strategy assigns the same human a *different* wire id.
 */
import type { MessageAction, Room } from '@trystero-p2p/nostr'
import { GAME_ID } from '../core/constants'
import { decode, encode, type NetMsg } from '../core/protocol'
import type { MessageHandler, PeerHandler, StrategyName } from './transport'
import { RTC_CONFIG } from './ice'
import { relayUrls, type StrategyModule } from './strategies'

/** Room id namespace. Wire-compatible with the previous build. */
export function roomTopic(code: string): string {
  return `v1-${code.toUpperCase()}`
}

export class StrategyRoom {
  readonly name: StrategyName
  private readonly room: Room
  private readonly action: MessageAction<string>
  private readonly peerIds = new Set<string>()
  private readonly unsubs: Array<() => void> = []
  private closed = false

  /* Routing targets, wired by the hub. */
  onMessage: MessageHandler = () => {}
  onJoin: PeerHandler = () => {}
  onLeave: PeerHandler = () => {}

  constructor(
    mod: StrategyModule,
    code: string,
    private readonly role: 'host' | 'guest',
  ) {
    this.name = mod.name
    this.room = mod.joinRoom(
      {
        appId: GAME_ID,
        relayConfig: { urls: relayUrls(mod.name) },
        rtcConfig: RTC_CONFIG,
      },
      roomTopic(code),
    )
    this.action = this.room.makeAction<string>('m')
    this.unsubs.push(
      this.action.onMessage((data, ctx) => {
        try {
          const msg = decode(data)
          this.onMessage(msg, this.scope(ctx.peerId))
        } catch (err) {
          console.warn(`net[${this.name}]: dropped malformed message`, err)
        }
      }),
      this.room.onPeerJoin(ctx => {
        this.peerIds.add(ctx.peerId)
        this.onJoin(this.scope(ctx.peerId))
      }),
      this.room.onPeerLeave(ctx => {
        this.peerIds.delete(ctx.peerId)
        this.onLeave(this.scope(ctx.peerId))
      }),
      this.room.onError(err => {
        console.warn(`net[${this.name}]: room error`, err)
      }),
    )
  }

  get transportRole(): 'host' | 'guest' {
    return this.role
  }

  private scope(peerId: string): string {
    return `${this.name}:${peerId}`
  }

  private unscope(scopedId: string): string | null {
    return scopedId.startsWith(`${this.name}:`) ? scopedId.slice(this.name.length + 1) : null
  }

  get peers(): string[] {
    return [...this.peerIds].map(p => this.scope(p))
  }

  hasPeer(scopedId: string): boolean {
    const raw = this.unscope(scopedId)
    return raw !== null && this.peerIds.has(raw)
  }

  /** Send to one scoped peer (must belong to this strategy) or broadcast. */
  sendMsg(msg: NetMsg, scopedId?: string): void {
    if (this.closed) return
    const raw = scopedId === undefined ? undefined : this.unscope(scopedId)
    if (scopedId !== undefined && raw === null) return
    // 0.27 action.send returns a promise; swallow rejections (peer flaps are
    // routine mid-handshake and must never surface as unhandled rejections).
    this.action.send(encode(msg), raw === undefined ? undefined : { target: raw }).catch(err => {
      console.warn(`net[${this.name}]: send failed`, err)
    })
  }

  leave(): void {
    if (this.closed) return
    this.closed = true
    for (const u of this.unsubs) {
      try {
        u()
      } catch {
        /* ignore */
      }
    }
    void this.room.leave().catch(() => {})
  }
}
