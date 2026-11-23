/**
 * ConnectionHub — the automatic co-op transport.
 *
 * Races three independent serverless signaling networks (nostr relays,
 * WebTorrent trackers, public MQTT brokers) in parallel and pins exactly one
 * data channel for game traffic, deterministically, on both sides:
 *
 *   guest                              host
 *   ─────                              ────
 *   wire peer join (any network)  →    session peer "P1" announced once
 *   hello (broadcast everywhere)  →    host pins the network the hello
 *                                      arrived on, replies welcome there only
 *   first welcome seen  ←              guest pins that same network
 *
 * Key invariants that make multi-network racing safe:
 *
 *  - SESSION PEER: one human = one virtual peer id ("P1"). Their parallel
 *    channels (one per network) are aliased; the app layer never sees the
 *    same human join three times (which would trip "room full").
 *  - DETERMINISTIC PIN: both sides converge on the same network because the
 *    host is the sole decision maker (first hello wins) and only ever
 *    answers on the network it pinned.
 *  - INBOUND DEDUP: game frames from non-pinned networks are dropped, so
 *    broadcasting pre-pin can never duplicate a message.
 *  - HOT SPARES: the other networks stay connected as live backups. If the
 *    pinned channel dies, both hubs unpin inside a short grace window; the
 *    regular 10 Hz game traffic itself re-pins a spare — failover completes
 *    without the game noticing. Only if nothing recovers within the grace
 *    window is a peer-leave reported.
 *  - RESCAN CYCLING: while scanning, the hub re-joins every network every
 *    few seconds — fresh peer ids force fresh announcements, so a missed
 *    round (flaky relay, slow tracker) never means "waiting forever".
 */
import { loadStrategies, strategyStatus, type StrategyModule } from './strategies'
import { StrategyRoom } from './room'
import {
  SESSION_PEER_ID,
  type MessageHandler,
  type NetStatus,
  type NetPhase,
  type PeerHandler,
  type StrategyName,
  type Transport,
} from './transport'
import type { NetMsg } from '../core/protocol'

/** Re-announce cadence while scanning (ms). */
const RESCAN_MS = 14_000
/** Max announcement rounds (≈ 7 minutes) before suggesting the direct link. */
const MAX_ATTEMPTS = 30
/** A joined-but-silent peer is recycled after this long (ms). */
const HANDSHAKE_TIMEOUT_MS = 12_000
/** Dead-channel grace before reporting the partner gone (ms). */
const FAILOVER_GRACE_MS = 3_000
/** Pinned-channel silence watchdog (ms) — 4× handshake bound. */
const SILENCE_TIMEOUT_MS = HANDSHAKE_TIMEOUT_MS * 4
/** Status tick (ms). */
const TICK_MS = 1_000

export class ConnectionHub implements Transport {
  readonly role: 'host' | 'guest'
  readonly code: string

  private rooms = new Map<StrategyName, StrategyRoom>()
  private modules: Partial<Record<StrategyName, StrategyModule>> = {}
  /** The network currently carrying game traffic. */
  private pinned: StrategyName | null = null
  /** True once the partner's wire peer has been seen this session. */
  private sessionPeer = false
  /** Wire peer ids belonging to the session partner (scoped ids). */
  private readonly aliases = new Set<string>()
  private phase: NetPhase = 'booting'
  private attempt = 1
  private phaseSince = Date.now()
  private note: string | undefined
  private lastInbound = 0
  private joinSeenAt = 0
  private graceTimer: ReturnType<typeof setTimeout> | null = null
  private rescanTimer: ReturnType<typeof setTimeout> | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private dead = false

  private readonly msgHandlers = new Set<MessageHandler>()
  private readonly joinHandlers = new Set<PeerHandler>()
  private readonly leaveHandlers = new Set<PeerHandler>()
  private readonly statusHandlers = new Set<(s: NetStatus) => void>()

  constructor(code: string, role: 'host' | 'guest') {
    this.code = code.toUpperCase()
    this.role = role
  }

  /* ------------------------------ public API ------------------------------ */

  /** Load strategy modules and join every network. Call once. */
  async start(): Promise<void> {
    if (this.dead) return
    this.modules = await loadStrategies()
    if (this.dead) return
    this.joinAll()
    this.setPhase('signaling')
    this.tickTimer = setInterval(() => this.tick(), TICK_MS)
  }

  onMessage(h: MessageHandler): void {
    this.msgHandlers.add(h)
  }

  onPeerJoin(h: PeerHandler): void {
    this.joinHandlers.add(h)
  }

  onPeerLeave(h: PeerHandler): void {
    this.leaveHandlers.add(h)
  }

  onStatus(h: (s: NetStatus) => void): void {
    this.statusHandlers.add(h)
    h(this.snapshot())
  }

  /**
   * Routing rules:
   *   - no target / the session peer → pinned network only (broadcast
   *     everywhere while still unpinned);
   *   - a scoped wire id (`nostr:xyz`) → that exact network and peer, used by
   *     the host to answer strangers with "room full".
   */
  sendMsg(msg: NetMsg, peerId?: string): void {
    if (this.dead) return
    if (peerId === undefined || peerId === SESSION_PEER_ID) {
      if (this.pinned) {
        this.rooms.get(this.pinned)?.sendMsg(msg)
      } else {
        for (const room of this.rooms.values()) room.sendMsg(msg)
      }
      return
    }
    const name = peerId.split(':', 1)[0] as StrategyName
    this.rooms.get(name)?.sendMsg(msg, peerId)
  }

  leave(): void {
    if (this.dead) return
    this.dead = true
    if (this.tickTimer !== null) clearInterval(this.tickTimer)
    if (this.rescanTimer !== null) clearTimeout(this.rescanTimer)
    if (this.graceTimer !== null) clearTimeout(this.graceTimer)
    for (const room of this.rooms.values()) room.leave()
    this.rooms.clear()
  }

  /* ------------------------------ internals ------------------------------ */

  private joinAll(): void {
    for (const name of ['nostr', 'torrent', 'mqtt'] as const) {
      const mod = this.modules[name]
      if (!mod) continue
      try {
        const room = new StrategyRoom(mod, this.code, this.role)
        this.wireRoom(room)
        this.rooms.set(name, room)
      } catch (err) {
        console.warn(`net: failed to join ${name}`, err)
      }
    }
  }

  private wireRoom(room: StrategyRoom): void {
    room.onJoin = scopedId => {
      if (this.dead) return
      this.joinSeenAt = Date.now()
      if (!this.sessionPeer) {
        // First wire peer of this session: the partner. Announce once.
        this.sessionPeer = true
        this.aliases.add(scopedId)
        this.setPhase('peer-found')
        for (const h of this.joinHandlers) h(SESSION_PEER_ID)
      } else {
        // Additional channels of the same partner (or a spare arriving late):
        // alias silently so their frames map to the session peer and the app
        // never sees a duplicate join. Strangers are handled at hello level.
        this.aliases.add(scopedId)
        if (this.phase === 'signaling' || this.phase === 'rescan') {
          this.setPhase('peer-found')
        }
      }
    }

    room.onLeave = scopedId => {
      if (this.dead) return
      this.aliases.delete(scopedId)
      // Only the pinned network's death affects the session; spare flapping
      // is background noise.
      if (this.pinned !== room.name) return
      if (this.graceTimer !== null) return
      this.pinned = null
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null
        this.endSession('LINK LOST — RESUMING SCAN')
      }, FAILOVER_GRACE_MS)
      // Recovery path: while unpinned, any inbound frame on a spare re-pins.
      // In-game traffic (10 Hz input / snapshots) completes the failover on
      // its own inside the grace window; nothing else to do here.
    }

    room.onMessage = (msg, scopedId) => {
      if (this.dead) return
      if (this.pinned === null) {
        if (this.graceTimer !== null) {
          clearTimeout(this.graceTimer)
          this.graceTimer = null
        }
        this.pinned = room.name
        this.setPhase('connected')
      } else if (this.pinned !== room.name) {
        return // duplicate on a spare network — already handled on the pin
      }
      this.lastInbound = Date.now()
      const appPeerId = this.aliases.has(scopedId) ? SESSION_PEER_ID : scopedId
      for (const h of this.msgHandlers) h(msg, appPeerId)
    }
  }

  /** Report the partner gone, reset session state, resume scanning. */
  private endSession(note: string): void {
    const hadSession = this.sessionPeer
    this.sessionPeer = false
    this.aliases.clear()
    this.pinned = null
    this.lastInbound = 0
    if (hadSession) {
      for (const h of this.leaveHandlers) h(SESSION_PEER_ID)
    }
    this.setPhase('signaling', note)
  }

  private setPhase(phase: NetPhase, note?: string): void {
    this.phase = phase
    this.phaseSince = Date.now()
    if (note !== undefined) this.note = note
    else if (phase === 'connected' || phase === 'peer-found') this.note = undefined
    this.emitStatus()
  }

  private scheduleRescan(delay: number): void {
    if (this.rescanTimer !== null || this.dead) return
    this.rescanTimer = setTimeout(() => {
      this.rescanTimer = null
      this.rescan()
    }, delay)
  }

  /** Re-join every network: fresh peer ids, fresh announcements. */
  private rescan(): void {
    if (this.dead || this.sessionPeer || this.pinned !== null) return
    if (this.attempt >= MAX_ATTEMPTS) {
      this.setPhase('signaling', 'NO PARTNER FOUND — USE THE DIRECT LINK')
      return
    }
    this.attempt++
    for (const room of this.rooms.values()) room.leave()
    this.rooms.clear()
    this.joinAll()
    this.setPhase('rescan')
  }

  private tick(): void {
    if (this.dead) return
    const now = Date.now()
    if (this.phase === 'signaling' || this.phase === 'rescan') {
      if (now - this.phaseSince > RESCAN_MS) this.rescan()
    } else if (this.phase === 'peer-found') {
      // Peer connected at the WebRTC level but no game frame ever arrived.
      if (now - this.joinSeenAt > HANDSHAKE_TIMEOUT_MS) {
        this.endSession('PARTNER SILENT — RESUMING SCAN')
        this.scheduleRescan(600)
      }
    } else if (this.phase === 'connected' && this.lastInbound > 0) {
      if (now - this.lastInbound > SILENCE_TIMEOUT_MS) {
        this.endSession('LINK WENT SILENT — RESUMING SCAN')
        this.scheduleRescan(600)
      }
    }
    this.emitStatus()
  }

  private snapshot(): NetStatus {
    return {
      phase: this.phase,
      attempt: this.attempt,
      strategies: (['nostr', 'torrent', 'mqtt'] as const).map(name =>
        strategyStatus(name, this.modules[name]),
      ),
      since: this.phaseSince,
      note: this.note,
    }
  }

  private emitStatus(): void {
    const s = this.snapshot()
    for (const h of this.statusHandlers) h(s)
  }
}
