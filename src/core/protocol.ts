/**
 * Versioned network protocol. All co-op traffic flows through encode/decode so
 * the codec is unit-testable and can evolve (bump v, handle both, then prune).
 */
import type { InputState, SimEvent, Snapshot } from './types'

export const PROTOCOL_VERSION = 1

export type NetMsg =
  | { v: typeof PROTOCOL_VERSION; t: 'hello'; name: string }
  | { v: typeof PROTOCOL_VERSION; t: 'welcome'; seed: string; names: [string, string] }
  | { v: typeof PROTOCOL_VERSION; t: 'full' }
  | { v: typeof PROTOCOL_VERSION; t: 'start' }
  | { v: typeof PROTOCOL_VERSION; t: 'input'; mx: number; mz: number; j: 0 | 1; d: 0 | 1; k: string | null }
  | { v: typeof PROTOCOL_VERSION; t: 'snap'; s: Snapshot }
  | { v: typeof PROTOCOL_VERSION; t: 'ev'; e: SimEvent }
  | { v: typeof PROTOCOL_VERSION; t: 'bye' }

const TYPES = new Set(['hello', 'welcome', 'full', 'start', 'input', 'snap', 'ev', 'bye'])

export function encode(m: NetMsg): string {
  return JSON.stringify(m)
}

export function decode(raw: string): NetMsg {
  let m: unknown
  try {
    m = JSON.parse(raw)
  } catch {
    throw new Error('protocol: malformed JSON')
  }
  if (typeof m !== 'object' || m === null) throw new Error('protocol: not an object')
  const msg = m as Record<string, unknown>
  if (msg.v !== PROTOCOL_VERSION) throw new Error(`protocol: unsupported version ${String(msg.v)}`)
  if (typeof msg.t !== 'string' || !TYPES.has(msg.t)) throw new Error(`protocol: unknown type ${String(msg.t)}`)
  return msg as unknown as NetMsg
}

export function inputToMsg(inp: InputState): NetMsg {
  return { v: PROTOCOL_VERSION, t: 'input', mx: inp.mx, mz: inp.mz, j: inp.jump ? 1 : 0, d: inp.dash ? 1 : 0, k: inp.key }
}

export function msgToInput(m: Extract<NetMsg, { t: 'input' }>): InputState {
  return { mx: m.mx, mz: m.mz, jump: m.j === 1, dash: m.d === 1, key: m.k }
}
