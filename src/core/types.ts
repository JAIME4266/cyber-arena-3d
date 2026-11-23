/** Shared types for the simulation, the view layer and the network protocol. */
import type { EnemyKind } from './constants'

export type { EnemyKind }

export interface InputState {
  /** Movement axes, each -1 | 0 | 1 (screen-space: x right, z down). */
  mx: number
  mz: number
  jump: boolean
  dash: boolean
  /** One typed combat key this tick, or null. */
  key: string | null
}

export function emptyInput(): InputState {
  return { mx: 0, mz: 0, jump: false, dash: false, key: null }
}

export interface PlayerState {
  id: number
  name: string
  alive: boolean
  x: number
  z: number
  y: number
  vy: number
  ang: number
  facing: number
  lives: number
  inv: number
  score: number
  kills: number
  combo: number
  comboT: number
  bestCombo: number
  correct: number
  wrong: number
  dashT: number
  dashCd: number
  dashDirX: number
  dashDirZ: number
  moving: boolean
  /** Enemy id this player's typing is locked onto, or -1. */
  lockId: number
  /** Slow-field timer mirror (derived each tick, kept for the view). */
  slowed: boolean
}

export interface Enemy {
  id: number
  kind: EnemyKind
  x: number
  z: number
  seq: string
  ti: number
  hp: number
  maxhp: number
  shootCd: number
  patternCd: number
  volleyLeft: number
  volleyT: number
  addCd: number
}

export interface Bullet { x: number; z: number; dx: number; dz: number; speed: number; life: number }
export interface Shock { x: number; z: number; r: number }
export interface Pickup { x: number; z: number; life: number }
export interface Bubble { x: number; z: number; r: number }

export type SimEvent =
  | { t: 'kill'; id: number; x: number; z: number; kind: EnemyKind; by: number; combo: number; milestone: boolean }
  | { t: 'hurt'; p: number; x: number; z: number }
  | { t: 'death'; p: number; x: number; z: number }
  | { t: 'wave'; w: number }
  | { t: 'boss'; hp: number; max: number }
  | { t: 'bossphase'; phase: number }
  | { t: 'seq'; id: number; seq: string; kind: EnemyKind }
  | { t: 'pickup'; p: number; x: number; z: number }
  | { t: 'shot'; x: number; z: number; kind: EnemyKind }
  | { t: 'shock'; x: number; z: number }
  | { t: 'over'; win: boolean; score: number; kills: number }

export type KeyResult = 'none' | 'advance' | 'complete' | 'miss'

/* ---------- View models (what the renderer consumes every frame) ---------- */

export interface ViewPlayer {
  id: number
  x: number
  z: number
  y: number
  ang: number
  lives: number
  inv: number
  score: number
  combo: number
  alive: boolean
  moving: boolean
  dashing: boolean
  dashCd: number
  slowed: boolean
  hurtFlash: number
}

export interface ViewEnemy {
  id: number
  kind: EnemyKind
  x: number
  z: number
  ti: number
  seq: string
  hp: number
  maxhp: number
}

export interface ViewBullet { x: number; z: number; dx: number; dz: number }
export interface ViewShock { x: number; z: number; r: number }
export interface ViewPickup { x: number; z: number }

export interface ViewModel {
  time: number
  wave: number
  kills: number
  over: 0 | 1 | 2 // 0 running, 1 won, 2 lost
  players: ViewPlayer[]
  enemies: ViewEnemy[]
  bullets: ViewBullet[]
  shocks: ViewShock[]
  pickups: ViewPickup[]
  bubbles: Bubble[]
  bossHp: number
  bossMax: number
  /** Which enemy the local player is locked onto (-1 = none). */
  lockId: number
}

/* ---------- Network snapshots (compact, array-of-arrays) ---------- */

export type SnapPlayer = [
  number, number, number, number, number, number, number, number, number,
  number, number, number, number,
]
// [x, z, y, ang, lives, inv, score, combo, alive, correct, wrong, bestCombo, kills]

export type SnapEnemy = [number, number, number, number, number, number, number, number]
// [id, kindIdx, x, z, ti, hp, maxhp, moving]

export interface Snapshot {
  v: 1
  t: number // game time
  tm: number // run clock seconds
  w: number
  k: number
  ov: 0 | 1 | 2
  ps: SnapPlayer[]
  es: SnapEnemy[]
  bs: [number, number, number, number][]
  ss: [number, number, number][]
  pk: [number, number][]
  bub: [number, number, number][]
  bh: number
  bmx: number
}

export const ENEMY_KIND_ORDER: EnemyKind[] = ['RUNNER', 'GRUNT', 'ELITE', 'BOSS']
