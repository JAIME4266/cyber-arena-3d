/**
 * Transport contract: anything that can carry NetMsg frames between the two
 * players. Implemented by:
 *   - ConnectionHub  (automatic path: three racing signaling networks)
 *   - DirectRoom     (manual path: copy/paste invite codes, zero infrastructure)
 *
 * Keeping this seam narrow means NetHost/NetClient/Session never care which
 * transport is live — swapping mid-lobby (relay → direct invite) just works.
 */
import type { NetMsg } from '../core/protocol'

export type PeerHandler = (peerId: string) => void
export type MessageHandler = (msg: NetMsg, peerId: string) => void

export interface Transport {
  readonly role: 'host' | 'guest'
  /** Send to one peer (scoped id) or broadcast. Never throws; failures are logged. */
  sendMsg(msg: NetMsg, peerId?: string): void
  onMessage(h: MessageHandler): void
  onPeerJoin(h: PeerHandler): void
  onPeerLeave(h: PeerHandler): void
  leave(): void
}

/** Stable virtual id for the single co-op partner — every transport presents
 *  the same human as "P1" regardless of which network carries the traffic. */
export const SESSION_PEER_ID = 'P1'

/* ------------------------- status reporting ------------------------- */

export type StrategyName = 'nostr' | 'torrent' | 'mqtt'

export interface StrategyStatus {
  name: StrategyName
  /** off = module failed to load / disabled; connecting = sockets pending; ready = ≥1 socket open */
  state: 'off' | 'connecting' | 'ready'
  /** open relay sockets / total relay sockets for this strategy */
  open: number
  total: number
}

export type NetPhase =
  | 'booting'     // strategy modules loading
  | 'signaling'   // on signaling networks, scanning for the partner
  | 'peer-found'  // partner seen, game handshake in flight
  | 'connected'   // channel pinned and passing game traffic
  | 'rescan'      // re-announcing on fresh connections (no partner yet)

export interface NetStatus {
  phase: NetPhase
  /** 1-based announcement round (increments per rescan). */
  attempt: number
  strategies: StrategyStatus[]
  /** epoch ms when the current phase began */
  since: number
  /** optional human note (e.g. relay error, ICE hint) */
  note?: string
}
