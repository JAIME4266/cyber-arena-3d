/**
 * Floating letter labels above enemies. Canvas-rendered, with an LRU texture
 * cache keyed by (sequence, progress, locked) — no per-keystroke allocation.
 */
import * as THREE from 'three'
import { ACTOR_H, KINDS } from '../core/constants'
import type { EnemyKind } from '../core/constants'

const CACHE_MAX = 96

export class LabelSystem {
  private readonly cache = new Map<string, THREE.CanvasTexture>()
  private readonly labels = new Map<number, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; key: string }>()

  private texture(seq: string, ti: number, locked: boolean): THREE.CanvasTexture {
    const key = `${seq}|${ti}|${locked ? 1 : 0}`
    const hit = this.cache.get(key)
    if (hit) {
      // LRU refresh
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit
    }
    const cv = document.createElement('canvas')
    cv.width = 512
    cv.height = 160
    const g = cv.getContext('2d')!
    g.fillStyle = locked ? 'rgba(6,14,32,.95)' : 'rgba(10,16,30,.82)'
    g.strokeStyle = locked ? '#38bdf8' : 'rgba(255,255,255,.35)'
    g.lineWidth = 8
    g.beginPath()
    if (typeof g.roundRect === 'function') g.roundRect(20, 10, 472, 112, 22)
    else g.rect(20, 10, 472, 112)
    g.fill()
    g.stroke()
    g.fillStyle = locked ? '#ff3b5c' : 'rgba(255,59,92,.5)'
    g.fillRect(140, 134, 232, 10)
    g.font = 'bold 64px monospace'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const chars = [...seq].map(c => (c === ' ' ? '␣' : c))
    const sx = 256 - ((chars.length - 1) * 72) / 2
    chars.forEach((c, i) => {
      g.fillStyle = i < ti ? '#22c55e' : i === ti ? (locked ? '#38bdf8' : '#fff') : 'rgba(148,163,184,.5)'
      g.fillText(c, sx + i * 72, 68)
    })
    const tex = new THREE.CanvasTexture(cv)
    tex.minFilter = THREE.LinearFilter
    tex.colorSpace = THREE.SRGBColorSpace
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) {
        this.cache.get(oldest)?.dispose()
        this.cache.delete(oldest)
      }
    }
    this.cache.set(key, tex)
    return tex
  }

  /** Ensure a label exists for an enemy; returns its mesh. */
  ensure(id: number, kind: EnemyKind): THREE.Mesh {
    let entry = this.labels.get(id)
    if (!entry) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.875), mat)
      mesh.renderOrder = 10
      mesh.scale.setScalar(kind === 'BOSS' ? 2.2 : 1.3)
      entry = { mesh, mat, key: '' }
      this.labels.set(id, entry)
    }
    return entry.mesh
  }

  /** Update label content + billboard position. */
  update(id: number, kind: EnemyKind, seq: string, ti: number, locked: boolean, x: number, y: number, z: number, camQuat: THREE.Quaternion): void {
    const entry = this.labels.get(id)
    if (!entry) return
    const key = `${seq}|${ti}|${locked ? 1 : 0}`
    if (key !== entry.key) {
      entry.key = key
      entry.mat.map = this.texture(seq, ti, locked)
      entry.mat.needsUpdate = true
    }
    entry.mesh.position.set(x, y + (kind === 'BOSS' ? 6 : 1.8), z)
    entry.mesh.quaternion.copy(camQuat)
  }

  labelY(kind: EnemyKind): number {
    return ACTOR_H * KINDS[kind].scale + 1.8
  }

  remove(id: number): void {
    const entry = this.labels.get(id)
    if (!entry) return
    entry.mesh.removeFromParent()
    entry.mat.dispose()
    entry.mesh.geometry.dispose()
    this.labels.delete(id)
  }

  clear(): void {
    for (const id of [...this.labels.keys()]) this.remove(id)
  }
}
