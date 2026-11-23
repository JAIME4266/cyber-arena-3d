/**
 * Net host: owns the authoritative Sim, applies local + guest inputs,
 * broadcasts snapshots at 10 Hz and forwards sim events immediately.
 */
import { Sim } from '../core/sim'
import type { InputState, SimEvent } from '../core/types'
import { emptyInput } from '../core/types'
import { SNAP_HZ } from '../core/constants'
import type { Transport } from './transport'

export class NetHost {
  sim: Sim
  private readonly room: Transport
  private guestInput: InputState = emptyInput()
  private guestName = 'PLAYER 2'
  /** Peer id of the accepted guest (guards against a second joiner). */
  private guestPeerId: string | null = null
  private readonly localName: string
  private guestConnected = false
  private snapAccum = 0
  started = false
  onEvent: (e: SimEvent) => void = () => {}

  constructor(room: Transport, seed: string, localName: string) {
    this.room = room
    this.localName = localName
    this.sim = new Sim({ seed, playerCount: 2, names: [localName, 'PLAYER 2'] })

    room.onPeerJoin(peerId => {
      if (this.guestConnected) {
        room.sendMsg({ v: 1, t: 'full' }, peerId)
        return
      }
      this.guestConnected = true
    })
    room.onPeerLeave(() => {
      this.guestConnected = false
      this.guestPeerId = null
      this.guestInput = emptyInput()
    })
    room.onMessage((msg, peerId) => {
      switch (msg.t) {
        case 'hello': {
          // A second human trying to join mid-session: show them the door.
          // (guestPeerId === null means the joined peer hasn't said hello
          //  yet — this IS the guest, not a stranger.)
          if (this.guestConnected && this.guestPeerId !== null && peerId !== this.guestPeerId) {
            room.sendMsg({ v: 1, t: 'full' }, peerId)
            break
          }
          this.guestPeerId = peerId
          this.guestName = msg.name.slice(0, 12).toUpperCase() || 'PLAYER 2'
          this.sim.players[1]!.name = this.guestName
          room.sendMsg({ v: 1, t: 'welcome', seed, names: [this.localName, this.guestName] }, peerId)
          break
        }
        case 'input':
          this.guestInput = { mx: msg.mx, mz: msg.mz, jump: msg.j === 1, dash: msg.d === 1, key: msg.k }
          break
        case 'bye':
          this.guestConnected = false
          this.guestInput = emptyInput()
          break
      }
    })
  }

  get guestReady(): boolean {
    return this.guestConnected
  }

  get guestNameResolved(): string {
    return this.guestName
  }

  start(): void {
    this.started = true
    this.room.sendMsg({ v: 1, t: 'start' })
  }

  /** Reboot the run with a fresh seed (guest detects the timeline reset). */
  restart(seed: string): void {
    this.sim = new Sim({ seed, playerCount: 2, names: [this.localName, this.guestName] })
    this.snapAccum = 0
  }

  /** Called every frame by the session. dt = real frame delta. */
  tick(dt: number, localInput: InputState): void {
    if (!this.started) return
    const guestKey = this.guestInput.key
    const inputs: InputState[] = [localInput, this.guestInput]
    // Consume one-shot guest key so it isn't applied on multiple ticks.
    this.guestInput = { ...this.guestInput, key: null, jump: false, dash: false }

    this.sim.step(1 / 60, inputs)
    // Report back what the guest actually typed (host may have consumed it differently).
    if (guestKey) {
      // Input was consumed by sim.step above; nothing further needed.
    }

    for (const e of this.sim.events) {
      this.onEvent(e)
      this.room.sendMsg({ v: 1, t: 'ev', e })
    }
    this.sim.events.length = 0

    this.snapAccum += dt
    if (this.snapAccum >= 1 / SNAP_HZ) {
      this.snapAccum = 0
      this.room.sendMsg({ v: 1, t: 'snap', s: this.sim.snapshot() })
    }
  }
}
