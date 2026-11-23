/**
 * Juice department: spark/ring object pools, tracer beam, floating combat
 * text, camera rig with shake/FOV-kick/combo pull-back, and the CSS speedline
 * overlay driver.
 */
import * as THREE from 'three'
import type { ViewModel } from '../core/types'

interface Spark {
  mesh: THREE.Mesh
  vx: number
  vy: number
  vz: number
  life: number
}

interface Ring {
  mesh: THREE.Mesh
  life: number
}

export interface VfxOptions {
  fxLayer: HTMLElement
  speedlinesEl: HTMLElement
  camera: THREE.PerspectiveCamera
  shakeEnabled: () => boolean
}

export class VFX {
  private readonly camera: THREE.PerspectiveCamera
  private readonly fxLayer: HTMLElement
  private readonly speedlinesEl: HTMLElement
  private readonly shakeEnabled: () => boolean

  private readonly sparks: Spark[] = []
  private readonly sparkPool: THREE.Mesh[] = []
  private readonly rings: Ring[] = []
  private readonly ringPool: THREE.Mesh[] = []
  private readonly sparkMats = new Map<number, THREE.MeshBasicMaterial>()

  private readonly beam: THREE.Mesh
  private readonly camBase = new THREE.Vector3(0, 27, 41)
  private shake = 0
  private kick = 0
  private speedlineV = 0
  private beamT = 0

  constructor(scene: THREE.Scene, opts: VfxOptions) {
    this.camera = opts.camera
    this.fxLayer = opts.fxLayer
    this.speedlinesEl = opts.speedlinesEl
    this.shakeEnabled = opts.shakeEnabled

    const sparkGeo = new THREE.BoxGeometry(0.32, 0.32, 0.32)
    for (let i = 0; i < 220; i++) {
      const m = new THREE.Mesh(sparkGeo, this.mat(0xffffff))
      m.visible = false
      scene.add(m)
      this.sparkPool.push(m)
    }
    const ringGeo = new THREE.RingGeometry(0.6, 1, 40)
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
      )
      m.rotation.x = -Math.PI / 2
      m.visible = false
      scene.add(m)
      this.ringPool.push(m)
    }

    this.beam = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    this.beam.visible = false
    this.beam.frustumCulled = false
    scene.add(this.beam)
  }

  private mat(color: number): THREE.MeshBasicMaterial {
    let m = this.sparkMats.get(color)
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })
      this.sparkMats.set(color, m)
    }
    return m
  }

  sparkBurst(x: number, y: number, z: number, color: number, n = 18, power = 1): void {
    for (let i = 0; i < n; i++) {
      const mesh = this.sparkPool.pop()
      if (!mesh) return
      mesh.material = this.mat(color)
      mesh.position.set(x, y, z)
      mesh.visible = true
      const th = Math.random() * Math.PI * 2
      const ph = (Math.random() - 0.5) * Math.PI
      const v = (12 + Math.random() * 22) * power
      this.sparks.push({
        mesh,
        vx: Math.cos(th) * Math.cos(ph) * v,
        vy: Math.sin(ph) * v + 6,
        vz: Math.sin(th) * Math.cos(ph) * v,
        life: 0.6,
      })
    }
  }

  ring(x: number, z: number, color: number): void {
    const mesh = this.ringPool.pop()
    if (!mesh) return
    ;(mesh.material as THREE.MeshBasicMaterial).color.setHex(color)
    mesh.position.set(x, 0.25, z)
    mesh.visible = true
    this.rings.push({ mesh, life: 0.5 })
  }

  /** Show the tracer beam from a muzzle to a target for a few frames. */
  showBeam(from: THREE.Vector3, to: THREE.Vector3, width: number): void {
    this.beam.position.copy(from).lerp(to, 0.5)
    this.beam.scale.set(width, width, from.distanceTo(to))
    this.beam.lookAt(to)
    this.beam.visible = true
    this.beamT = 0.14
  }

  text(str: string, x: number, y: number, z: number): void {
    const v = new THREE.Vector3(x, y, z).project(this.camera)
    const el = document.createElement('div')
    el.className = 'ft'
    el.textContent = str
    el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`
    el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`
    this.fxLayer.appendChild(el)
    window.setTimeout(() => el.remove(), 900)
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount)
  }

  addKick(amount: number): void {
    this.kick = Math.min(1, this.kick + amount)
  }

  hitStop = 0

  update(dt: number, vm: ViewModel, focus: { x: number; z: number; y: number }): void {
    // Sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!
      s.mesh.position.x += s.vx * dt
      s.mesh.position.y += s.vy * dt
      s.mesh.position.z += s.vz * dt
      s.vy -= 28 * dt
      s.life -= dt
      s.mesh.scale.setScalar(Math.max(0.01, s.life / 0.6))
      if (s.life <= 0 || s.mesh.position.y < 0) {
        s.mesh.visible = false
        this.sparkPool.push(s.mesh)
        this.sparks.splice(i, 1)
      }
    }
    // Rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!
      r.life -= dt
      r.mesh.scale.setScalar(1 + (1 - r.life / 0.5) * 10)
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, r.life * 2)
      if (r.life <= 0) {
        r.mesh.visible = false
        this.ringPool.push(r.mesh)
        this.rings.splice(i, 1)
      }
    }
    // Beam
    this.beamT = Math.max(0, this.beamT - dt)
    if (this.beamT <= 0) this.beam.visible = false

    // Camera: follow focus, combo pull-back, FOV kick, shake.
    const combo = Math.min(vm.players[0]?.combo ?? 0, 20)
    const k = Math.min(1, dt * 5)
    this.camBase.x += (focus.x - this.camBase.x) * k
    this.camBase.y += (27 - combo * 0.12 - this.camBase.y) * k
    this.camBase.z += (focus.z + 41 - combo * 0.3 - this.camBase.z) * k
    this.shake = Math.max(0, this.shake - dt * 1.8)
    const shakeAmt = this.shakeEnabled() ? this.shake : 0
    this.camera.position.set(
      this.camBase.x + (Math.random() - 0.5) * shakeAmt * 2.4,
      this.camBase.y + (Math.random() - 0.5) * shakeAmt * 1.6,
      this.camBase.z,
    )
    this.camera.fov += (55 + combo * 0.75 + shakeAmt * 5 - this.camera.fov) * Math.min(1, dt * 6)
    this.camera.updateProjectionMatrix()
    this.camera.lookAt(focus.x, 4 + focus.y * 0.4, focus.z)
    if (shakeAmt > 0) this.camera.rotation.z += (Math.random() - 0.5) * shakeAmt * 0.05

    // Speed lines
    this.kick = Math.max(0, this.kick - dt * 5)
    this.speedlineV += (Math.min(Math.max((combo - 3) / 12, 0), 1) * 0.7 + this.kick * 0.45 - this.speedlineV) * Math.min(1, dt * 8)
    this.speedlinesEl.style.opacity = this.speedlineV.toFixed(2)
  }

  resetCamera(): void {
    this.camBase.set(0, 27, 41)
    this.shake = 0
    this.kick = 0
  }
}
