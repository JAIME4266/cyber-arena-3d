/** Global tuning constants. Pure data — no runtime imports. */

export const VERSION = '2.0.0'
export const GAME_ID = 'cyber-arena-3d-elite'

/** Home-row combat keys (US QWERTY). */
export const KEYS: readonly string[] = [...'ASDFGHJKL;\',']

/** Arena half-size (playfield spans -90..90 on X and Z). */
export const ARENA = 90

export const PLAYER_SPEED = 30
export const PLAYER_RADIUS = 1.6
export const GRAVITY = 70
export const JUMP_VY = 26
export const DASH_TIME = 0.18
export const DASH_MULT = 3
export const DASH_CD = 1.8
export const DASH_INV = 0.3

export const LIVES_MAX = 3
export const INV_TIME = 1
export const COMBO_WINDOW = 2.2
export const COMBO_SPEED_PER = 0.03
export const COMBO_SPEED_MAX = 0.36
export const COMBO_SCORE_PER = 0.25
export const COMBO_SCORE_CAP = 20

/** Enemy threat ramps with total kills (shared across players). */
export const THREAT_BASE = 0.4
export const THREAT_GAIN = 1.1
export const THREAT_KILLS = 140
export const THREAT_MAX = 1.5

export const WAVE2_KILLS = 50
export const WAVE3_KILLS = 100

/** Fixed simulation timestep (60 Hz). */
export const TICK = 1 / 60

/** Snapshot broadcast rate for co-op host. */
export const SNAP_HZ = 10
/** Guest renders this far behind the newest snapshot, for smooth interpolation. */
export const INTERP_DELAY = 0.12

export const FIXED_DT = TICK

export type EnemyKind = 'RUNNER' | 'GRUNT' | 'ELITE' | 'BOSS'

export interface KindDef {
  color: number
  scale: number
  speed: number
  radius: number
  value: number
  gun: boolean
  shoot: boolean
  boss: boolean
}

export const KINDS: Record<EnemyKind, KindDef> = {
  RUNNER: { color: 0xfacc15, scale: 0.82, speed: 13, radius: 1.4, value: 80, gun: false, shoot: false, boss: false },
  GRUNT: { color: 0xff2d4d, scale: 1.0, speed: 8.5, radius: 1.8, value: 100, gun: false, shoot: false, boss: false },
  ELITE: { color: 0xff3df0, scale: 1.15, speed: 7, radius: 1.9, value: 200, gun: true, shoot: true, boss: false },
  BOSS: { color: 0xff6a00, scale: 2.3, speed: 3.5, radius: 4.5, value: 2000, gun: false, shoot: false, boss: true },
}

/** Power generator obstacles: static AABBs (x, z, half-w, half-d, height). */
export interface Obstacle { x: number; z: number; hw: number; hd: number; h: number }
export const OBSTACLES: readonly Obstacle[] = [
  { x: -42, z: -28, hw: 9, hd: 6, h: 7 },
  { x: 42, z: -32, hw: 8, hd: 6.5, h: 8 },
  { x: -40, z: 34, hw: 10, hd: 6.5, h: 7 },
  { x: 44, z: 30, hw: 9, hd: 6, h: 8 },
  { x: 0, z: -56, hw: 13, hd: 4.5, h: 9 },
  { x: 0, z: 56, hw: 13, hd: 4.5, h: 9 },
]

export const BULLET_LIFE = 4
export const PICKUP_LIFE = 25

export const KILL_MSGS: readonly string[] = [
  'CYBER HIT', 'CORE PURGED', 'DATA CLEARED', 'OVERCLOCK',
  'NODE SECURED', 'RAPID REACTION', 'HOSTILE DOWN', 'PRIME PROTOCOL',
]

/** Character height in world units (drives actor scaling). */
export const ACTOR_H = 8.5
