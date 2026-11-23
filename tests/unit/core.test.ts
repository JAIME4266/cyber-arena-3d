import { describe, expect, it } from 'vitest'
import { RNG, hashString, isValidCode, randomCode } from '../../src/core/rng'
import { decode, encode, inputToMsg, msgToInput, type NetMsg } from '../../src/core/protocol'
import { accuracy, dailySeed, formatClock, formatScore, rank, wpm } from '../../src/core/stats'

describe('rng', () => {
  it('same seed → identical sequence', () => {
    const a = new RNG('seed-x')
    const b = new RNG('seed-x')
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next())
  })

  it('different seeds → different sequences', () => {
    const a = new RNG('seed-x')
    const b = new RNG('seed-y')
    const sa = Array.from({ length: 10 }, () => a.next())
    const sb = Array.from({ length: 10 }, () => b.next())
    expect(sa).not.toEqual(sb)
  })

  it('serializes and restores exact state', () => {
    const a = new RNG('persist')
    a.next(); a.next()
    const b = RNG.deserialize(a.serialize())
    expect(a.next()).toBe(b.next())
  })

  it('stays in range', () => {
    const r = new RNG(12345)
    for (let i = 0; i < 1000; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      expect(r.int(13)).toBeLessThan(13)
    }
  })

  it('hashString is stable and differentiates inputs', () => {
    expect(hashString('daily-2026-11-25')).toBe(hashString('daily-2026-11-25'))
    expect(hashString('a')).not.toBe(hashString('b'))
  })

  it('codes are friendly and validated', () => {
    const r = new RNG('codes')
    for (let i = 0; i < 50; i++) {
      const c = randomCode(6, r)
      expect(c).toMatch(/^[A-Z2-9]{6}$/)
      expect(c).not.toMatch(/[OIL01]/)
      expect(isValidCode(c)).toBe(true)
    }
    expect(isValidCode('lower')).toBe(false)
    expect(isValidCode('ABC1')).toBe(false) // confusable digit 1 is not in the alphabet
    expect(isValidCode('ABC2')).toBe(true)
  })
})

describe('protocol', () => {
  const samples: NetMsg[] = [
    { v: 1, t: 'hello', name: 'ACE' },
    { v: 1, t: 'welcome', seed: 'daily-1', names: ['ACE', 'BYTE'] },
    { v: 1, t: 'full' },
    { v: 1, t: 'start' },
    inputToMsg({ mx: 1, mz: 0, jump: false, dash: false, key: 'A' }),
    {
      v: 1, t: 'snap', s: {
        v: 1, t: 0, tm: 1.5, w: 1, k: 3, ov: 0,
        ps: [[0, 0, 0, 0, 3, 0, 300, 2, 1, 40, 2, 5, 3]],
        es: [[1, 1, 10, -20, 0, 1, 1, 1]],
        bs: [], ss: [], pk: [], bub: [[10, 10, 10]], bh: 0, bmx: 0,
      },
    },
    { v: 1, t: 'ev', e: { t: 'kill', id: 1, x: 5, z: -3, kind: 'GRUNT', by: 0, combo: 4, milestone: false } },
    { v: 1, t: 'bye' },
  ]

  it('round-trips every message type', () => {
    for (const m of samples) expect(decode(encode(m))).toEqual(m)
  })

  it('input messages convert losslessly', () => {
    const inp = { mx: -1, mz: 1, jump: true, dash: false, key: ';' }
    const msg = inputToMsg(inp) as Extract<NetMsg, { t: 'input' }>
    expect(msgToInput(msg)).toEqual(inp)
  })

  it('rejects malformed payloads', () => {
    expect(() => decode('not json')).toThrow()
    expect(() => decode('42')).toThrow()
    expect(() => decode('{"v":1,"t":"nonsense"}')).toThrow()
    expect(() => decode('{"v":99,"t":"hello","name":"X"}')).toThrow()
  })
})

describe('stats', () => {
  it('computes WPM the standard way (chars / 5 per minute)', () => {
    // 250 correct chars in 60s = 50 WPM
    expect(wpm(250, 60_000)).toBe(50)
    expect(wpm(0, 60_000)).toBe(0)
    expect(wpm(100, 0)).toBe(0)
  })

  it('computes accuracy', () => {
    expect(accuracy(90, 10)).toBe(90)
    expect(accuracy(0, 0)).toBe(100)
  })

  it('formats clock, score and rank', () => {
    expect(formatClock(75)).toBe('01:15')
    expect(formatScore(12345)).toBe('12,345')
    expect(rank(25000)).toContain('S')
    expect(rank(100)).toContain('RECRUIT')
  })

  it('daily seed is date-stable', () => {
    expect(dailySeed(new Date(2026, 10, 25))).toBe('daily-2026-11-25')
  })
})
