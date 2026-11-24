/**
 * Dynamic prop rendering: explosive/inert barrels and supply crates from the
 * combat-physics sim, plus the visual mortar shells fired by the boss.
 *
 * Barrels roll about their motion axis (heading-locked yaw + accumulated
 * roll from the sim); crates tumble in the air and settle flat on landing.
 * Mesh positions ease toward the authoritative state every frame, which
 * smooths both the host (direct drive) and the guest (10 Hz snapshots).
 *
 * All textures are painted at runtime — no asset downloads.
 */
import * as THREE from 'three'
import type { ViewProp } from '../core/types'

function propTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  draw(ctx, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Explosive barrel: rust red-brown, ribs, FLAMMABLE stencil, hazard band. */
const barrelExplTex = () => propTexture(256, (g, s) => {
  g.fillStyle = '#7d4a33'
  g.fillRect(0, 0, s, s)
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(40, 22, 14, ${0.05 + Math.random() * 0.12})`
    g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 14, 2 + Math.random() * 5)
  }
  for (let i = 0; i < 50; i++) {
    g.fillStyle = `rgba(150, 92, 62, ${0.04 + Math.random() * 0.08})`
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 4, 2 + Math.random() * 9)
  }
  g.fillStyle = 'rgba(20, 12, 8, 0.55)'
  g.fillRect(0, s * 0.3, s, 7)
  g.fillRect(0, s * 0.62, s, 7)
  g.save()
  g.translate(s / 2, s * 0.47)
  g.fillStyle = 'rgba(235, 229, 210, 0.88)'
  g.font = '700 30px "Barlow Condensed", "Arial Narrow", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('FLAMMABLE', 0, 0)
  g.restore()
  g.fillStyle = '#c9a437'
  g.fillRect(0, s * 0.84, s, 8)
  g.fillStyle = '#2a2c22'
  for (let x = -s; x < s * 2; x += 26) {
    g.beginPath()
    g.moveTo(x, s)
    g.lineTo(x + 13, s)
    g.lineTo(x + 33, s * 0.84)
    g.lineTo(x + 20, s * 0.84)
    g.fill()
  }
})

/** Inert water drum: olive drab, WATER stencil. */
const barrelInertTex = () => propTexture(256, (g, s) => {
  g.fillStyle = '#5c6147'
  g.fillRect(0, 0, s, s)
  for (let i = 0; i < 80; i++) {
    g.fillStyle = `rgba(30, 34, 22, ${0.05 + Math.random() * 0.1})`
    g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 12, 2 + Math.random() * 5)
  }
  g.fillStyle = 'rgba(18, 20, 14, 0.5)'
  g.fillRect(0, s * 0.3, s, 7)
  g.fillRect(0, s * 0.62, s, 7)
  g.save()
  g.translate(s / 2, s * 0.47)
  g.fillStyle = 'rgba(233, 228, 210, 0.85)'
  g.font = '700 34px "Barlow Condensed", "Arial Narrow", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('WATER', 0, 0)
  g.restore()
})

/** Supply crate: plywood faces, slat shadows, 5.56 BALL stencil, corner steel. */
const crateTex = () => propTexture(256, (g, s) => {
  g.fillStyle = '#9a7d4e'
  g.fillRect(0, 0, s, s)
  for (let x = 0; x < s; x += 42) {
    g.fillStyle = 'rgba(60, 42, 22, 0.28)'
    g.fillRect(x, 0, 3, s)
    g.fillStyle = 'rgba(255, 240, 200, 0.06)'
    g.fillRect(x + 3, 0, 16, s)
  }
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(70, 50, 26, ${0.04 + Math.random() * 0.08})`
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 22, 1)
  }
  g.strokeStyle = 'rgba(40, 26, 12, 0.5)'
  g.lineWidth = 8
  g.strokeRect(4, 4, s - 8, s - 8)
  g.fillStyle = 'rgba(50, 52, 44, 0.9)'
  g.fillRect(0, 0, 26, 26)
  g.fillRect(s - 26, 0, 26, 26)
  g.fillRect(0, s - 26, 26, 26)
  g.fillRect(s - 26, s - 26, 26, 26)
  g.save()
  g.translate(s / 2, s * 0.52)
  g.rotate(-0.04)
  g.fillStyle = 'rgba(28, 24, 18, 0.75)'
  g.font = '700 36px "Barlow Condensed", "Arial Narrow", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('5.56 BALL', 0, 0)
  g.font = '600 20px "Barlow Condensed", "Arial Narrow", sans-serif'
  g.fillText('LOT 7 · 880 RDS', 0, 34)
  g.restore()
})

interface BarrelView {
  group: THREE.Group
  inner: THREE.Mesh
  kind: 'CRATE' | 'BARREL'
  expl: boolean
  px: number
  pz: number
  heading: number
  rest: number // eased rest rotation for settled crates
}

interface ShellView {
  mesh: THREE.Group
  x: number
  z: number
  y: number
  vx: number
  vz: number
  vy: number
  smokeT: number
  done: number // > 0: landed, waiting for the authoritative blast to reap it
}

const SHELL_GEO = new THREE.ConeGeometry(0.45, 1.6, 10)

export class PropRenderer {
  private readonly scene: THREE.Scene
  private readonly vfxSpark: (x: number, y: number, z: number, color: number, n: number, power: number) => void
  private readonly views = new Map<number, BarrelView>()
  private readonly shells: ShellView[] = []
  private readonly barrelGeo = new THREE.CylinderGeometry(1.15, 1.15, 2.6, 16)
  private readonly crateGeo = new THREE.BoxGeometry(2.9, 2.6, 2.9)
  private explMat: THREE.MeshStandardMaterial | null = null
  private inertMat: THREE.MeshStandardMaterial | null = null
  private crateMat: THREE.MeshStandardMaterial | null = null

  constructor(
    scene: THREE.Scene,
    spark: (x: number, y: number, z: number, color: number, n: number, power: number) => void,
  ) {
    this.scene = scene
    this.vfxSpark = spark
  }

  private mat(kind: 'expl' | 'inert' | 'crate'): THREE.MeshStandardMaterial {
    if (kind === 'expl' && this.explMat) return this.explMat
    if (kind === 'inert' && this.inertMat) return this.inertMat
    if (kind === 'crate' && this.crateMat) return this.crateMat
    const m = new THREE.MeshStandardMaterial({
      map: kind === 'expl' ? barrelExplTex() : kind === 'inert' ? barrelInertTex() : crateTex(),
      roughness: kind === 'crate' ? 0.85 : 0.6,
      metalness: kind === 'crate' ? 0.05 : 0.35,
    })
    if (kind === 'expl') this.explMat = m
    else if (kind === 'inert') this.inertMat = m
    else this.crateMat = m
    return m
  }

  /** Drive prop meshes toward authoritative state (host: direct; guest: eased). */
  sync(props: ViewProp[], dt: number): void {
    const seen = new Set<number>()
    for (const p of props) {
      seen.add(p.id)
      let v = this.views.get(p.id)
      if (!v) {
        const group = new THREE.Group()
        const inner = new THREE.Mesh(
          p.kind === 'BARREL' ? this.barrelGeo : this.crateGeo,
          this.mat(p.kind === 'BARREL' ? (p.expl ? 'expl' : 'inert') : 'crate'),
        )
        if (p.kind === 'BARREL') inner.position.y = 1.3
        else inner.position.y = 1.3
        inner.castShadow = true
        inner.receiveShadow = true
        group.add(inner)
        group.position.set(p.x, 0, p.z)
        this.scene.add(group)
        v = { group, inner, kind: p.kind, expl: p.expl, px: p.x, pz: p.z, heading: 0, rest: 0 }
        this.views.set(p.id, v)
      }
      // Derive motion for the roll axis.
      const mvx = (p.x - v.px) / Math.max(dt, 1e-4)
      const mvz = (p.z - v.pz) / Math.max(dt, 1e-4)
      const sp = Math.hypot(mvx, mvz)
      v.px = p.x
      v.pz = p.z
      if (sp > 0.6) {
        const target = Math.atan2(mvx, mvz)
        // Ease the heading so direction flips don't whip.
        let d = target - v.heading
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        v.heading += d * Math.min(1, dt * 8)
      }
      const k = 1 - Math.exp(-14 * dt)
      v.group.position.x += (p.x - v.group.position.x) * k
      v.group.position.z += (p.z - v.group.position.z) * k
      v.group.position.y += (p.y - v.group.position.y) * k

      if (v.kind === 'BARREL') {
        v.group.rotation.y = v.heading
        v.inner.rotation.x = p.rot
      } else {
        if (p.y > 0.15) {
          // Airborne: chaotic tumble.
          v.inner.rotation.x = p.rot
          v.inner.rotation.z = p.rot * 0.6
          v.inner.rotation.y = p.rot * 0.35
          v.rest = p.rot
        } else {
          // Grounded: settle to the nearest flat face.
          const flat = Math.round(v.rest / (Math.PI / 2)) * (Math.PI / 2)
          v.inner.rotation.x += (flat - v.inner.rotation.x) * Math.min(1, dt * 6)
          v.inner.rotation.z += (0 - v.inner.rotation.z) * Math.min(1, dt * 6)
          v.inner.rotation.y += (0 - v.inner.rotation.y) * Math.min(1, dt * 6)
        }
      }
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        v.group.removeFromParent()
        this.views.delete(id)
      }
    }
  }

  /** A mortar was fired: spawn a visual shell that flies the same arc. */
  spawnShell(x: number, z: number, vx: number, vz: number, vy: number): void {
    const g = new THREE.Group()
    const body = new THREE.Mesh(
      SHELL_GEO,
      new THREE.MeshStandardMaterial({ color: 0x2c2e28, roughness: 0.5, metalness: 0.7 }),
    )
    body.rotation.x = Math.PI / 2
    const flare = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.7, 8),
      new THREE.MeshBasicMaterial({ color: 0xe8742c }),
    )
    flare.rotation.x = Math.PI / 2
    flare.position.z = -0.9
    g.add(body, flare)
    g.position.set(x, 4, z)
    this.scene.add(g)
    this.shells.push({ mesh: g, x, z, y: 4, vx, vz, vy, smokeT: 0, done: 0 })
  }

  /** The authoritative blast landed: reap any shell near it. */
  reapShells(x: number, z: number): void {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]!
      if (s.done > 0 || Math.hypot(s.x - x, s.z - z) < 5) {
        s.mesh.removeFromParent()
        this.shells.splice(i, 1)
      }
    }
  }

  update(dt: number): void {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]!
      if (s.done > 0) {
        s.done -= dt
        if (s.done <= 0) {
          s.mesh.removeFromParent()
          this.shells.splice(i, 1)
        }
        continue
      }
      s.vy -= 70 * dt
      s.x += s.vx * dt
      s.z += s.vz * dt
      s.y += s.vy * dt
      s.mesh.position.set(s.x, s.y, s.z)
      s.mesh.lookAt(s.x + s.vx, s.y + s.vy, s.z + s.vz)
      s.smokeT -= dt
      if (s.smokeT <= 0) {
        s.smokeT = 0.07
        this.vfxSpark(s.x, s.y, s.z, 0x8a8272, 1, 0.12)
      }
      if (s.y <= 0.2 && s.vy < 0) s.done = 0.3 // hold briefly; the blast event reaps it
    }
  }

  clear(): void {
    for (const [, v] of this.views) v.group.removeFromParent()
    this.views.clear()
    for (const s of this.shells) s.mesh.removeFromParent()
    this.shells.length = 0
  }
}
