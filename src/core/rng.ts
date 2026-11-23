/**
 * Deterministic seeded RNG (mulberry32) with serializable state.
 * The whole simulation draws randomness ONLY from this — never Math.random —
 * so identical seeds plus identical inputs always produce identical runs.
 */
export class RNG {
  private s: number

  constructor(seed: number | string) {
    this.s = typeof seed === 'number' ? seed >>> 0 : hashString(seed)
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.s += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return (this.next() * n) | 0
  }

  /** Uniform float in [a, b). */
  range(a: number, b: number): number {
    return a + this.next() * (b - a)
  }

  /** Random element of an array. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]
  }

  /** Chance in [0,1] returns true with that probability. */
  chance(p: number): boolean {
    return this.next() < p
  }

  serialize(): number {
    return this.s >>> 0
  }

  static deserialize(state: number): RNG {
    const r = new RNG(0)
    r.s = state >>> 0
    return r
  }
}

/** Stable string hash (FNV-1a-ish) used to turn seed strings into 32-bit ints. */
export function hashString(str: string): number {
  let h = 1779033703 >>> 0
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return h >>> 0
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Human-friendly room/seed code (confusable chars removed). */
export function randomCode(len = 6, rng: RNG = new RNG(Date.now() ^ (Math.random() * 0xffffffff))): string {
  let out = ''
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[rng.int(CODE_ALPHABET.length)]
  return out
}

export function isValidCode(code: string): boolean {
  return /^[A-Z2-9]{4,8}$/.test(code)
}
