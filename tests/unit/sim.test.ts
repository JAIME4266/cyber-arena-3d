import { describe, expect, it } from 'vitest'
import { Sim, pickKind } from '../../src/core/sim'
import { KEYS, KINDS } from '../../src/core/constants'
import { emptyInput } from '../../src/core/types'
import { RNG } from '../../src/core/rng'

function drive(sim: Sim, ticks: number, input = emptyInput()): void {
  for (let i = 0; i < ticks; i++) sim.step(1 / 60, [input])
}

function firstEnemy(sim: Sim) {
  return sim.enemies[0]
}

describe('waves', () => {
  it('spawns enemies on first step, capped', () => {
    const sim = new Sim({ seed: 'w1', playerCount: 1 })
    drive(sim, 5)
    expect(sim.enemies.length).toBeGreaterThan(0)
    expect(sim.enemies.length).toBeLessThanOrEqual(14)
  })

  it('transitions to wave 2 at 50 kills; every wave-2 enemy has a 2-key combo', () => {
    const sim = new Sim({ seed: 'w2', playerCount: 1 })
    drive(sim, 5)
    sim.debugAddKills(50)
    drive(sim, 5)
    expect(sim.wave).toBe(2)
    expect(sim.events.some(e => e.t === 'wave' && e.w === 2)).toBe(true)
    // Clear the wave-1 leftovers (1-char sequences).
    for (const e of [...sim.enemies]) {
      while (sim.enemies.includes(e)) sim.debugTypeAt(0, e.seq[e.ti]!, e.id)
    }
    drive(sim, 5)
    expect(sim.enemies.length).toBeGreaterThan(0)
    for (const e of sim.enemies) expect(e.seq.length).toBe(2)
  })

  it('wave-2 mix is elite-heavy, wave-1 grunt-heavy (pickKind distribution)', () => {
    const rng = new RNG('mix')
    const wave2 = Array.from({ length: 2000 }, () => pickKind(2, rng))
    const elites = wave2.filter(k => k === 'ELITE').length
    expect(elites).toBeGreaterThan(1100)
    expect(elites).toBeLessThan(1500)
    const rng2 = new RNG('mix2')
    const wave1 = Array.from({ length: 2000 }, () => pickKind(1, rng2))
    const runners = wave1.filter(k => k === 'RUNNER').length
    expect(runners).toBeGreaterThan(550)
    expect(runners).toBeLessThan(850)
  })

  it('clears the field and summons the boss at 100 kills', () => {
    const sim = new Sim({ seed: 'w3', playerCount: 1 })
    drive(sim, 5)
    sim.debugAddKills(100)
    drive(sim, 5)
    expect(sim.wave).toBe(3)
    expect(sim.boss).not.toBeNull()
    expect(sim.boss!.kind).toBe('BOSS')
    expect(sim.enemies.filter(e => e.kind !== 'BOSS').length).toBe(0)
    expect(sim.events.some(e => e.t === 'boss')).toBe(true)
  })

  it('same seed produces identical spawns', () => {
    const a = new Sim({ seed: 'same', playerCount: 1 })
    const b = new Sim({ seed: 'same', playerCount: 1 })
    drive(a, 30)
    drive(b, 30)
    expect(a.hash()).toBe(b.hash())
  })
})

describe('combat', () => {
  it('advances a letter, locks, and kills on completion', () => {
    const sim = new Sim({ seed: 'c1', playerCount: 1 })
    drive(sim, 5)
    const e = firstEnemy(sim)
    const pid = 0
    let guard = 0
    while (sim.enemies.includes(e) && guard++ < 50) {
      const ch = e.seq[e.ti]
      const r = sim.debugTypeAt(pid, ch, e.id)
      expect(r === 'advance' || r === 'complete').toBe(true)
    }
    expect(sim.enemies.includes(e)).toBe(false)
    expect(sim.kills).toBe(1)
    expect(sim.players[0]!.kills).toBe(1)
    expect(sim.players[0]!.score).toBeGreaterThan(0)
    expect(sim.players[0]!.correct).toBe(e.seq.length)
  })

  it('MISS BREAKS THE COMBO (the fix the original README promised)', () => {
    const sim = new Sim({ seed: 'c2', playerCount: 1 })
    drive(sim, 5)
    sim.debugAddKills(50) // wave 2: every sequence is 2 keys
    drive(sim, 5)
    // Cull wave-1 leftovers so wave-2 spawns refill the field.
    for (const e of [...sim.enemies]) {
      while (sim.enemies.includes(e)) sim.debugTypeAt(0, e.seq[e.ti]!, e.id)
    }
    drive(sim, 5)
    expect(sim.enemies.length).toBeGreaterThan(0)
    // Grab a wave-2 spawn (2-char seq).
    const e = sim.enemies[0]!
    expect(e.seq.length).toBe(2)
    // Advance one correct letter to build the lock + grow the combo.
    const comboBefore = sim.players[0]!.combo
    expect(sim.debugTypeAt(0, e.seq[0]!, e.id)).toBe('advance')
    expect(sim.players[0]!.combo).toBe(comboBefore + 1)
    expect(sim.players[0]!.lockId).toBe(e.id)
    // Type a wrong letter mid-sequence.
    const wrong = KEYS.find(k => k !== e.seq[1])!
    expect(sim.debugTypeAt(0, wrong, e.id)).toBe('miss')
    expect(sim.players[0]!.combo).toBe(0)
    expect(sim.players[0]!.wrong).toBe(1)
    expect(e.ti).toBe(0) // sequence reset
  })

  it('typing a key matching nothing counts as a miss', () => {
    const sim = new Sim({ seed: 'c3', playerCount: 1 })
    drive(sim, 5)
    // Wave 1: 6 enemies, each with a 1-char sequence — at most 6 of the 13
    // keys are covered, so a guaranteed-free key always exists.
    const candidates = new Set(sim.enemies.map(e => e.seq[e.ti]))
    const dead = KEYS.find(k => !candidates.has(k))
    expect(dead).toBeDefined()
    const p = sim.players[0]!
    p.combo = 5
    expect(sim.typeKey(0, dead!)).toBe('miss')
    expect(p.combo).toBe(0)
    expect(p.wrong).toBe(1)
  })

  it('boss takes 10 sequences, changes phases, and ends the game when down', () => {
    const sim = new Sim({ seed: 'c4', playerCount: 1 })
    drive(sim, 5)
    sim.debugAddKills(100)
    drive(sim, 5)
    const boss = sim.boss!
    expect(boss.hp).toBe(10)
    let rounds = 0
    while (sim.boss && rounds++ < 40) {
      for (const ch of boss.seq) {
        if (!sim.boss) break
        sim.debugTypeAt(0, ch, boss.id)
      }
      drive(sim, 2)
    }
    expect(sim.boss).toBeNull()
    expect(sim.over).toBe(1) // win
    expect(rounds).toBe(10)
    // Phase events fired somewhere along the way.
    const phases = sim.events.filter(e => e.t === 'bossphase').map(e => (e as { phase: number }).phase)
    expect(phases).toContain(3)
  })

  it('combo multiplies kill score by the documented formula', () => {
    const sim = new Sim({ seed: 'c5', playerCount: 1 })
    drive(sim, 3)
    const a = sim.enemies[0]!
    const valA = KINDS[a.kind].value
    const before = sim.players[0]!.score
    for (const ch of a.seq) sim.debugTypeAt(0, ch, a.id)
    const gained = sim.players[0]!.score - before
    // Combo equals sequence length at the moment of the killing blow.
    expect(gained).toBe(Math.round(valA * (1 + a.seq.length * 0.25)))
  })
})

describe('determinism', () => {
  it('identical seeds + scripted inputs = identical hashes over 20 seconds', () => {
    const run = (seed: string) => {
      const sim = new Sim({ seed, playerCount: 2 })
      const rng = new RNG('inputs')
      for (let tick = 0; tick < 1200; tick++) {
        const inputs = [0, 1].map(() => ({
          mx: rng.int(3) - 1,
          mz: rng.int(3) - 1,
          jump: rng.chance(0.02),
          dash: rng.chance(0.01),
          key: rng.chance(0.25) ? KEYS[rng.int(KEYS.length)]! : null,
        }))
        sim.step(1 / 60, inputs)
        if (sim.over !== 0) break
      }
      return sim.hash()
    }
    expect(run('det-1')).toBe(run('det-1'))
    expect(run('det-1')).not.toBe(run('det-2'))
  })
})
