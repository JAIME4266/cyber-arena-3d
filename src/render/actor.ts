/**
 * Procedural rigged actors: an 11-bone skeleton built in code with hand-written
 * skin weights, box-and-cylinder body parts merged per material, and fully
 * procedural animation (walk cycle, aim pose, recoil, hit reaction, death).
 *
 * Zero asset downloads, always animated — this is the default actor path.
 * (GLB "HD" models are a future opt-in once they carry animation clips.)
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ACTOR_H } from '../core/constants'

export interface Palette {
  suit: number
  armor: number
  neon: number
  hood?: boolean
  gun?: boolean
  heavy?: boolean
  scale?: number
  playerRifle?: boolean
}

const BONES = [
  ['hips', null, 0, 2.8, 0],
  ['spine', 'hips', 0, 0.3, 0],
  ['head', 'spine', 0, 1.95, 0],
  ['armL', 'spine', -1.15, 1.7, 0],
  ['foreL', 'armL', 0, -1.05, 0],
  ['armR', 'spine', 1.15, 1.7, 0],
  ['foreR', 'armR', 0, -1.05, 0],
  ['legL', 'hips', -0.5, -0.1, 0],
  ['shinL', 'legL', 0, -1.35, 0],
  ['legR', 'hips', 0.5, -0.1, 0],
  ['shinR', 'legR', 0, -1.35, 0],
] as const

type BoneName = (typeof BONES)[number][0]

interface RigGeoms {
  suit?: THREE.BufferGeometry
  arm?: THREE.BufferGeometry
  ne?: THREE.BufferGeometry
  dk?: THREE.BufferGeometry
}

const rigCache = new Map<string, RigGeoms>()
const matCache = new Map<string, Record<string, THREE.Material>>()

function variantKey(v: { hood?: boolean; gun?: boolean; heavy?: boolean }): string {
  return `${v.hood ? 1 : 0}${v.gun ? 1 : 0}${v.heavy ? 1 : 0}`
}

function buildRig(v: { hood?: boolean; gun?: boolean; heavy?: boolean }): RigGeoms {
  const key = variantKey(v)
  const cached = rigCache.get(key)
  if (cached) return cached

  // World-space rest positions for each bone.
  const world: number[][] = []
  BONES.forEach(b => {
    const parent = b[1] ? world[BONES.findIndex(x => x[0] === b[1])] : [0, 0, 0]
    world.push([parent[0] + b[2], parent[1] + b[3], parent[2] + b[4]])
  })

  const buckets: Record<string, THREE.BufferGeometry[]> = { suit: [], arm: [], ne: [], dk: [] }

  const add = (bone: BoneName, mat: string, geo: THREE.BufferGeometry, x = 0, y = 0, z = 0): void => {
    const i = BONES.findIndex(b => b[0] === bone)
    const w = world[i]!
    const n = geo.attributes.position.count
    const si = new Uint16Array(n * 4)
    const sw = new Float32Array(n * 4)
    for (let k = 0; k < n; k++) {
      si[k * 4] = i
      sw[k * 4] = 1
    }
    geo.translate(w[0] + x, w[1] + y, w[2] + z)
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4))
    buckets[mat]!.push(geo)
  }
  const bx = (bone: BoneName, mat: string, w: number, h: number, d: number, x = 0, y = 0, z = 0): void =>
    add(bone, mat, new THREE.BoxGeometry(w, h, d), x, y, z)
  const limb = (bone: BoneName, len: number, r0: number, r1: number): void => {
    add(bone, 'suit', new THREE.CylinderGeometry(r0, r1, len, 10), 0, -len / 2, 0)
    add(bone, 'suit', new THREE.SphereGeometry(r0 * 1.06, 10, 8))
  }

  bx('hips', 'arm', 1.3, 0.55, 0.85)
  bx('hips', 'ne', 1.4, 0.1, 0.92, 0, 0.2, 0)
  bx('spine', 'suit', 1.5, 1.5, 0.9, 0, 0.8, 0)
  bx('spine', 'arm', 1.75, 1, 1.05, 0, 1.1, 0.02)
  bx('spine', 'ne', 0.5, 0.5, 0.1, 0, 1.15, 0.56)
  bx('spine', 'ne', 0.07, 0.9, 0.06, -0.6, 1.1, 0.56)
  bx('spine', 'ne', 0.07, 0.9, 0.06, 0.6, 1.1, 0.56)
  bx('spine', 'arm', 1.1, 1.3, 0.55, 0, 0.95, -0.78)
  bx('spine', 'ne', 0.9, 0.08, 0.1, 0, 1.5, -1.06)
  if (v.heavy) bx('spine', 'arm', 2.8, 0.5, 1.3, 0, 1.75, 0) // shoulder cannons
  bx('head', 'suit', 0.3, 0.35, 0.3, 0, -0.3, 0)
  const headLump = new THREE.SphereGeometry(0.6, 18, 14)
  headLump.scale(1, 1.05, 1.1)
  add('head', 'arm', headLump, 0, 0.25, 0)
  bx('head', 'ne', 0.8, 0.2, 0.4, 0, 0.28, 0.45) // visor
  bx('head', v.hood ? 'dk' : 'ne', 0.14, 0.3, 1, 0, 0.88, -0.05) // antenna
  if (v.hood) bx('head', 'dk', 1.1, 0.8, 0.5, 0, 0.3, -0.55)

  for (const s of [-1, 1] as const) {
    const a = s < 0 ? 'armL' : 'armR'
    const f = s < 0 ? 'foreL' : 'foreR'
    const l = s < 0 ? 'legL' : 'legR'
    const k = s < 0 ? 'shinL' : 'shinR'
    bx(a, 'arm', 0.8, 0.55, 1.05, s * 0.05, 0.05, 0)
    limb(a, 1.05, 0.27, 0.21)
    limb(f, 1, 0.21, 0.17)
    bx(f, 'arm', 0.46, 0.55, 0.46, 0, -0.5, 0)
    bx(f, 'ne', 0.08, 0.5, 0.1, s * 0.24, -0.5, 0.1)
    limb(l, 1.35, 0.4, 0.3)
    bx(l, 'arm', 0.66, 0.85, 0.72, 0, -0.5, 0)
    limb(k, 1.35, 0.3, 0.23)
    bx(k, 'arm', 0.52, 0.95, 0.58, 0, -0.7, 0.04)
    bx(k, 'ne', 0.07, 0.8, 0.07, s * 0.27, -0.7, 0.2)
    bx(k, 'arm', 0.58, 0.35, 1, 0, -1.2, 0.2)
  }
  if (v.gun) {
    bx('foreR', 'dk', 0.26, 1.5, 0.34, 0, -1.2, 0.1)
    bx('foreR', 'ne', 0.08, 1.1, 0.08, 0, -1.3, 0.3)
  }

  const out: RigGeoms = {}
  for (const [m, geos] of Object.entries(buckets)) {
    if (geos.length) out[m as keyof RigGeoms] = mergeGeometries(geos)!
  }
  rigCache.set(key, out)
  return out
}

function buildMats(p: Palette): Record<string, THREE.Material> {
  const key = `${p.suit}-${p.armor}-${p.neon}`
  const cached = matCache.get(key)
  if (cached) return cached
  const mats: Record<string, THREE.Material> = {
    suit: new THREE.MeshStandardMaterial({ color: p.suit, roughness: 0.65, metalness: 0.25 }),
    arm: new THREE.MeshStandardMaterial({ color: p.armor, roughness: 0.3, metalness: 0.85 }),
    ne: new THREE.MeshBasicMaterial({ color: p.neon }),
    dk: new THREE.MeshStandardMaterial({ color: 0x06080e, roughness: 0.5, metalness: 0.6 }),
  }
  matCache.set(key, mats)
  return mats
}

export interface ActorAnimState {
  moving: boolean
  aiming: boolean
  speed: number
  air: boolean
}

/**
 * The actor contract every renderer satisfies — procedural (this file) and
 * HD GLB actors (glbactor.ts) are interchangeable at runtime.
 */
export interface ActorView {
  readonly root: THREE.Object3D
  dead: boolean
  update(dt: number, st: ActorAnimState): void
  hit(): void
  shoot(): void
  die(): void
  reset(): void
  muzzle(out?: THREE.Vector3): THREE.Vector3
}

export class Actor implements ActorView {
  readonly root = new THREE.Group()
  private readonly j: Record<string, THREE.Object3D> = {}
  private readonly bones: THREE.Bone[] = []
  private readonly skeleton: THREE.Skeleton
  private readonly palette: Palette
  private phase = Math.random() * 6
  private t = Math.random() * 6
  private hurtT = 0
  private shotAt = -1e9
  dead = false
  private deadT = 0

  constructor(p: Palette) {
    this.palette = p
    const geos = buildRig({ hood: p.hood, gun: p.gun, heavy: p.heavy })
    const mats = buildMats(p)
    for (const b of BONES) {
      const bone = new THREE.Bone()
      bone.position.set(b[2], b[3], b[4])
      bone.name = b[0]
      ;(b[1] ? this.j[b[1]]! : this.root).add(bone)
      this.j[b[0]] = bone
      this.bones.push(bone)
    }
    this.root.updateMatrixWorld(true)
    this.skeleton = new THREE.Skeleton(this.bones)
    for (const [m, geo] of Object.entries(geos)) {
      const mesh = new THREE.SkinnedMesh(geo, mats[m]!)
      mesh.frustumCulled = false
      mesh.castShadow = m !== 'ne'
      this.root.add(mesh)
      mesh.bind(this.skeleton)
    }
    if (p.playerRifle) {
      const rifle = new THREE.Group()
      const dk = mats.dk!
      const ne = mats.ne!
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.5, 0.34), dk)
      body.position.set(0, -1.2, 0.1)
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), ne)
      glow.position.set(0, -1.3, 0.3)
      rifle.add(body, glow)
      ;(this.j.foreR as THREE.Object3D).add(rifle)
    }
    if (p.gun) {
      const flash = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xbff6ff }))
      flash.position.set(0, -2.05, 0.1)
      flash.visible = false
      flash.name = 'muzzleFlash'
      ;(this.j.foreR as THREE.Object3D).add(flash)
    }
    this.root.scale.setScalar((ACTOR_H / 6) * (p.scale ?? 1))
  }

  private get flash(): THREE.Object3D | null {
    return this.j.foreR?.children.find(c => c.name === 'muzzleFlash') ?? null
  }

  hit(): void {
    this.hurtT = 0.4
  }

  shoot(): void {
    this.shotAt = performance.now()
    const f = this.flash
    if (f) {
      f.visible = true
      f.scale.setScalar(0.7 + Math.random() * 0.9)
    }
  }

  die(): void {
    this.dead = true
  }

  /** Restore to a live pose (used when rebooting a run). */
  reset(): void {
    this.dead = false
    this.deadT = 0
    this.root.rotation.x = 0
  }

  muzzle(out = new THREE.Vector3()): THREE.Vector3 {
    if (this.palette.gun && this.j.foreR) return this.j.foreR.localToWorld(out.set(0, -2.05, 0.1))
    return this.root.localToWorld(out.set(0, ACTOR_H * 0.55, ACTOR_H * 0.3))
  }

  update(dt: number, st: ActorAnimState): void {
    const k = 1 - Math.exp(-dt * 14)
    const ease = (o: THREE.Object3D, x: number, z = 0): void => {
      o.rotation.x += (x - o.rotation.x) * k
      o.rotation.z += (z - o.rotation.z) * k
    }
    this.t += dt
    const alive = !this.dead
    const moving = st.moving && alive
    if (moving) this.phase += dt * (st.speed || 10)
    const s = Math.sin(this.phase)
    const rec = Math.max(0, 1 - (performance.now() - this.shotAt) / 120)
    const breathe = Math.sin(this.t * 2) * 0.02
    const f = this.flash
    if (f && rec < 0.05) f.visible = false
    this.hurtT = Math.max(0, this.hurtT - dt)
    const j = this.j
    const hips = j.hips!

    if (this.dead) {
      this.deadT += dt
      const p = Math.min(1, this.deadT / 0.9)
      const q = p * p
      this.root.rotation.x += (-1.5 * q - this.root.rotation.x) * k
      hips.position.y += (2.8 - 1.1 * q - hips.position.y) * k
      ease(j.legL!, -0.9 * q, 0.1 * q)
      ease(j.legR!, -0.4 * q, -0.1 * q)
      ease(j.shinL!, 1.5 * q)
      ease(j.shinR!, 1.1 * q)
      ease(j.armL!, -0.4, -1.2 * q)
      ease(j.armR!, -0.6, 1.2 * q)
      ease(j.foreL!, -0.5 * q)
      ease(j.foreR!, -0.4 * q)
      ease(j.spine!, 0.1 * q)
      ease(j.head!, -0.4 * q)
      return
    }

    const hurt = this.hurtT > 0 ? Math.sin((this.hurtT / 0.4) * Math.PI) : 0
    hips.position.y += (2.8 + (moving ? Math.abs(s) * 0.13 : breathe) - hips.position.y) * k
    ease(j.spine!, (moving ? 0.14 : 0) + breathe - hurt * 0.5 - rec * 0.1, s * 0.05 * (moving ? 1 : 0))
    ease(j.head!, (moving ? -0.07 : 0) + hurt * 0.4)
    ease(j.legL!, s * 0.8 * (moving ? 1 : 0))
    ease(j.legR!, -s * 0.8 * (moving ? 1 : 0))
    ease(j.shinL!, Math.max(0, -s) * 1.1 * (moving ? 1 : 0) + 0.1)
    ease(j.shinR!, Math.max(0, s) * 1.1 * (moving ? 1 : 0) + 0.1)
    if (st.air) {
      ease(j.legL!, -0.6)
      ease(j.legR!, 0.25)
      ease(j.shinL!, 1.1)
      ease(j.shinR!, 0.4)
    }
    if (this.palette.gun) {
      const aiming = st.aiming || rec > 0
      ease(j.armR!, aiming ? -1.15 - rec * 0.12 : -0.5 - s * 0.1 * (moving ? 1 : 0), -0.05)
      ease(j.foreR!, aiming ? -0.4 : -0.5)
      ease(j.armL!, aiming ? -1.25 : -0.5, aiming ? 0.4 : 0.25)
      ease(j.foreL!, -0.8)
    } else {
      ease(j.armL!, -s * 0.75 * (moving ? 1 : 0) + 0.1 - hurt, 0.12 + hurt * 0.9)
      ease(j.armR!, s * 0.75 * (moving ? 1 : 0) + 0.1 - hurt, -0.12 - hurt * 0.9)
      ease(j.foreL!, -0.35 - Math.max(0, s) * 0.5 * (moving ? 1 : 0) - hurt * 0.6)
      ease(j.foreR!, -0.35 - Math.max(0, -s) * 0.5 * (moving ? 1 : 0) - hurt * 0.6)
    }
  }
}

/* ---------- Shared palettes ---------- */

export const PLAYER_PALETTE: Palette = { suit: 0x0c1626, armor: 0x16263f, neon: 0x35e0ff, gun: false, scale: 1, playerRifle: true }
export const PLAYER2_PALETTE: Palette = { suit: 0x1a0c26, armor: 0x2f1663, neon: 0xff3df0, gun: false, scale: 1, playerRifle: true }
export const ENEMY_PALETTES: Record<string, Palette> = {
  RUNNER: { suit: 0x0a0b10, armor: 0x15161d, neon: 0xfacc15, hood: true, scale: 0.82 },
  GRUNT: { suit: 0x0a0b10, armor: 0x15161d, neon: 0xff2d4d, hood: true, scale: 1 },
  ELITE: { suit: 0x0a0b10, armor: 0x15161d, neon: 0xff3df0, hood: true, gun: true, scale: 1.15 },
  BOSS: { suit: 0x0a0b10, armor: 0x15161d, neon: 0xff6a00, hood: true, heavy: true, scale: 2.3 },
}
