/**
 * Screen-space Target Label Manager: projects live enemy anchors into screen
 * coordinates inside a pooled DOM overlay (#labels), eliminating CanvasTexture
 * uploads while guaranteeing:
 *  - Anti-overlap separation across crowded packs (locked target anchored first)
 *  - Viewport boundary & HUD safe-area clamping
 *  - Locked-target priority, candidate highlight, and inactive de-emphasis
 *  - Crowd simplification / graceful hiding for distant background enemies
 *  - Zero per-frame layout reads or unnecessary DOM mutations
 */
import * as THREE from 'three'
import { ACTOR_H, KINDS } from '../core/constants'
import type { EnemyKind } from '../core/constants'

export interface LabelSubmit {
  id: number
  kind: EnemyKind
  seq: string
  ti: number
  locked: boolean
  candidate: boolean
  x: number
  y: number
  z: number
  dist: number
}

interface EdgeNode {
  el: HTMLElement
  arrowEl: HTMLElement
  tagEl: HTMLElement
  key: string
  lastX: number
  lastY: number
  lastAng: number
  lastVis: boolean
}

interface LabelNode {
  id: number
  el: HTMLElement
  wordEl: HTMLElement
  progEl: HTMLElement
  progFill: HTMLElement
  key: string
  w: number
  h: number
  lastX: number
  lastY: number
  lastVis: boolean
}

interface ProjectedItem {
  id: number
  kind: EnemyKind
  seq: string
  ti: number
  locked: boolean
  candidate: boolean
  dist: number
  wx: number
  wy: number
  wz: number
  sx: number
  sy: number
  w: number
  h: number
  compact: boolean
  visible: boolean
}

const _proj = new THREE.Vector3()
const _camFwd = new THREE.Vector3()
const _toEnemy = new THREE.Vector3()

export class LabelSystem {
  private readonly layer: HTMLElement
  private readonly active = new Map<number, LabelNode>()
  private readonly pool: LabelNode[] = []
  private readonly edgeActive = new Map<number, EdgeNode>()
  private readonly edgePool: EdgeNode[] = []
  private readonly queue: ProjectedItem[] = []

  constructor(parent: HTMLElement) {
    const existing = parent.querySelector('#labels') as HTMLElement | null
    if (existing) {
      this.layer = existing
    } else {
      this.layer = document.createElement('div')
      this.layer.id = 'labels'
      parent.appendChild(this.layer)
    }
  }

  labelY(kind: EnemyKind): number {
    return ACTOR_H * KINDS[kind].scale + 1.8
  }

  ensure(id: number, _kind: EnemyKind): void {
    if (this.active.has(id)) return
    let node = this.pool.pop()
    if (!node) {
      const el = document.createElement('div')
      el.className = 'enemy-label'
      const wordEl = document.createElement('div')
      wordEl.className = 'el-word'
      const progEl = document.createElement('div')
      progEl.className = 'el-prog'
      const progFill = document.createElement('i')
      progEl.appendChild(progFill)
      el.append(wordEl, progEl)
      el.style.display = 'none'
      this.layer.appendChild(el)
      node = { id, el, wordEl, progEl, progFill, key: '', w: 80, h: 38, lastX: -9999, lastY: -9999, lastVis: false }
    }
    node.id = id
    node.key = ''
    this.active.set(id, node)
  }

  beginFrame(): void {
    this.queue.length = 0
  }

  submit(item: LabelSubmit): void {
    this.ensure(item.id, item.kind)
    this.queue.push({
      id: item.id,
      kind: item.kind,
      seq: item.seq,
      ti: item.ti,
      locked: item.locked,
      candidate: item.candidate,
      dist: item.dist,
      wx: item.x,
      wy: item.y,
      wz: item.z,
      sx: 0,
      sy: 0,
      w: 0,
      h: 0,
      compact: false,
      visible: true,
    })
  }

  private acquireEdge(id: number): EdgeNode {
    let e = this.edgeActive.get(id)
    if (e) return e
    e = this.edgePool.pop()
    if (!e) {
      const el = document.createElement('div')
      el.className = 'edge-ind'
      const arrowEl = document.createElement('span')
      arrowEl.className = 'ei-arrow'
      arrowEl.textContent = '▲'
      const tagEl = document.createElement('span')
      tagEl.className = 'ei-tag'
      el.append(arrowEl, tagEl)
      el.style.display = 'none'
      this.layer.appendChild(el)
      e = { el, arrowEl, tagEl, key: '', lastX: -9999, lastY: -9999, lastAng: 0, lastVis: false }
    }
    this.edgeActive.set(id, e)
    return e
  }

  private hideEdge(id: number): void {
    const e = this.edgeActive.get(id)
    if (!e) return
    if (e.lastVis) {
      e.el.style.display = 'none'
      e.lastVis = false
    }
    e.key = ''
    this.edgeActive.delete(id)
    this.edgePool.push(e)
  }

  /** Project, prioritize, simplify crowds, clamp to HUD safe areas, separate overlaps, and commit DOM. */
  commit(camera: THREE.PerspectiveCamera, vw: number, vh: number, hasBoss: boolean): void {
    if (vw <= 0 || vh <= 0) return
    if (!this.queue.length) {
      for (const id of [...this.edgeActive.keys()]) this.hideEdge(id)
      return
    }

    camera.updateMatrixWorld()
    camera.getWorldDirection(_camFwd)
    const cx = vw * 0.5
    const cy = vh * 0.5

    // HUD safe-area insets (clears top HUD/boss bar, left rail, right curriculum rail, bottom NEXT KEY plate).
    const compactScreen = vw <= 760
    const safeTop = hasBoss ? (compactScreen ? 116 : 146) : (compactScreen ? 72 : 84)
    const safeBot = compactScreen ? 148 : 164
    const safeLeft = compactScreen ? 12 : 158
    const safeRight = compactScreen ? 12 : 212

    const offscreenIds = new Set<number>()

    // 1. Project 3D world anchors into screen pixels and track off-screen threats.
    for (const q of this.queue) {
      _toEnemy.set(q.wx - camera.position.x, q.wy - camera.position.y, q.wz - camera.position.z)
      const inFront = _toEnemy.dot(_camFwd) > 0.5
      _proj.set(q.wx, q.wy, q.wz).project(camera)

      if (inFront) {
        q.sx = (_proj.x * 0.5 + 0.5) * vw
        q.sy = (-_proj.y * 0.5 + 0.5) * vh
      } else {
        // Behind camera plane: mirror horizontally and anchor cleanly at lower edge so threat stays visible.
        q.sx = cx - _proj.x * cx
        q.sy = vh - 24
      }

      const mustShow = q.locked || q.candidate || q.kind === 'BOSS' || q.ti > 0
      const offscreen = !inFront || q.sx < 14 || q.sx > vw - 14 || q.sy < 14 || q.sy > vh - 14
      if (offscreen) {
        offscreenIds.add(q.id)
        if (!mustShow) q.visible = false
        const en = this.acquireEdge(q.id)
        if (!en.lastVis) {
          en.el.style.display = 'flex'
          en.lastVis = true
        }
        const dx = q.sx - cx
        const dy = q.sy - cy
        const angDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 90)
        const padX = 28
        const padY = 24
        const maxX = vw * 0.5 - padX
        const maxY = vh * 0.5 - padY
        const scale = Math.min(
          Math.abs(dx) > 1 ? maxX / Math.abs(dx) : 999,
          Math.abs(dy) > 1 ? maxY / Math.abs(dy) : 999,
        )
        const ex = Math.round(cx + dx * Math.min(1, scale))
        const ey = Math.round(cy + dy * Math.min(1, scale))
        const urgency = q.kind === 'BOSS' || q.kind === 'ELITE' ? 'danger' : q.dist < 38 ? 'warn' : 'info'
        const eKey = `${q.seq[q.ti] ?? ''}|${urgency}|${q.locked ? 1 : 0}`
        if (eKey !== en.key) {
          en.key = eKey
          en.el.className = `edge-ind ${urgency}${q.locked ? ' locked' : ''}`
          en.tagEl.textContent = q.seq[q.ti] ?? '!'
        }
        if (ex !== en.lastX || ey !== en.lastY) {
          en.lastX = ex
          en.lastY = ey
          en.el.style.transform = `translate3d(${ex}px, ${ey}px, 0) translate(-50%, -50%)`
        }
        if (Math.abs(angDeg - en.lastAng) >= 2) {
          en.lastAng = angDeg
          en.arrowEl.style.transform = `rotate(${angDeg}deg)`
        }
      }
    }
    for (const id of [...this.edgeActive.keys()]) {
      if (!offscreenIds.has(id)) this.hideEdge(id)
    }

    // 2. Sort by targeting priority: locked > candidate > BOSS > mid-progress > closest distance.
    this.queue.sort((a, b) => {
      if (a.locked !== b.locked) return a.locked ? -1 : 1
      if (a.candidate !== b.candidate) return a.candidate ? -1 : 1
      if ((a.kind === 'BOSS') !== (b.kind === 'BOSS')) return a.kind === 'BOSS' ? -1 : 1
      if ((a.ti > 0) !== (b.ti > 0)) return a.ti > 0 ? -1 : 1
      return a.dist - b.dist
    })

    // 3. Crowd simplification & exact cached box sizing (zero per-frame layout reads).
    const crowdLimit = compactScreen ? 4 : 6
    const maxVisible = compactScreen ? 8 : 11
    let visRank = 0
    for (let i = 0; i < this.queue.length; i++) {
      const q = this.queue[i]!
      if (!q.visible) continue
      const mustFull = q.locked || q.candidate || q.kind === 'BOSS' || q.ti > 0
      if (!mustFull && visRank >= maxVisible) {
        q.visible = false
        continue
      }
      q.compact = !mustFull && visRank >= crowdLimit
      visRank++

      const node = this.active.get(q.id)
      if (node) {
        if (!node.lastVis) {
          node.el.style.display = 'flex'
          node.lastVis = true
        }
        const stateKey = `${q.seq}|${q.ti}|${q.locked ? 1 : 0}|${q.candidate ? 1 : 0}|${q.compact ? 1 : 0}|${q.kind === 'BOSS' ? 1 : 0}`
        if (stateKey !== node.key) {
          node.key = stateKey
          node.el.className = `enemy-label${q.locked ? ' locked' : q.candidate ? ' cand' : ' inactive'}${q.compact ? ' compact' : ''}${q.kind === 'BOSS' ? ' boss' : ''}`
          this.renderWord(node.wordEl, q.seq, q.ti)
          const pct = q.seq.length > 0 ? Math.round((q.ti / q.seq.length) * 100) : 0
          node.progFill.style.width = `${pct}%`
          node.w = node.el.offsetWidth || Math.max(70, q.seq.length * 15 + 28)
          node.h = node.el.offsetHeight || (q.compact ? 24 : 38)
        }
        q.w = node.w
        q.h = node.h
      }
      this.clampToSafe(q, vw, vh, safeLeft, safeRight, safeTop, safeBot)
    }

    // 4. Priority-ordered non-overlapping placement inside HUD safe bounds.
    const padX = 8
    const padY = 6
    const placed: ProjectedItem[] = []
    const hitsPlaced = (cx: number, cy: number, w: number, h: number): boolean => {
      for (const p of placed) {
        if (Math.abs(cx - p.sx) < (w + p.w) * 0.5 + padX && Math.abs(cy - p.sy) < (h + p.h) * 0.5 + padY) {
          return true
        }
      }
      return false
    }
    for (const q of this.queue) {
      if (!q.visible) continue
      const ox = q.sx
      const oy = q.sy
      if (!hitsPlaced(ox, oy, q.w, q.h)) {
        placed.push(q)
        continue
      }
      let bestX = ox
      let bestY = oy
      let bestDist2 = Infinity
      let found = false
      const stepY = q.h + padY
      const stepX = Math.max(48, q.w * 0.65)
      for (let ry = -4; ry <= 4; ry++) {
        for (let rx = -3; rx <= 3; rx++) {
          if (rx === 0 && ry === 0) continue
          q.sx = ox + rx * stepX
          q.sy = oy + ry * stepY
          this.clampToSafe(q, vw, vh, safeLeft, safeRight, safeTop, safeBot)
          if (!hitsPlaced(q.sx, q.sy, q.w, q.h)) {
            const d2 = (q.sx - ox) ** 2 + (q.sy - oy) ** 2
            if (d2 < bestDist2) {
              bestDist2 = d2
              bestX = q.sx
              bestY = q.sy
              found = true
            }
          }
        }
      }
      if (found || placed.length === 0) {
        q.sx = bestX
        q.sy = bestY
        placed.push(q)
      } else {
        q.visible = false
      }
    }

    // 5. Commit hardware-accelerated translate3d positions (and hide culled labels).
    for (const q of this.queue) {
      const node = this.active.get(q.id)
      if (!node) continue
      if (!q.visible) {
        if (node.lastVis) {
          node.el.style.display = 'none'
          node.lastVis = false
        }
        continue
      }
      const rx = Math.round(q.sx)
      const ry = Math.round(q.sy)
      if (rx !== node.lastX || ry !== node.lastY) {
        node.lastX = rx
        node.lastY = ry
        node.el.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%)`
      }
    }
  }

  private clampToSafe(q: ProjectedItem, vw: number, vh: number, left: number, right: number, top: number, bot: number): void {
    const hw = q.w * 0.5
    const hh = q.h * 0.5
    const minX = Math.min(vw * 0.5, left + hw)
    const maxX = Math.max(minX, vw - right - hw)
    const minY = Math.min(vh * 0.5, top + hh)
    const maxY = Math.max(minY, vh - bot - hh)
    q.sx = Math.max(minX, Math.min(maxX, q.sx))
    q.sy = Math.max(minY, Math.min(maxY, q.sy))
  }

  private renderWord(wordEl: HTMLElement, seq: string, ti: number): void {
    wordEl.textContent = ''
    for (let i = 0; i < seq.length; i++) {
      const sp = document.createElement('span')
      sp.textContent = seq[i] === ' ' ? '␣' : seq[i]!
      if (i < ti) sp.className = 'ch-done'
      else if (i === ti) sp.className = 'ch-cur'
      else sp.className = 'ch-todo'
      wordEl.appendChild(sp)
    }
  }

  remove(id: number): void {
    this.hideEdge(id)
    const node = this.active.get(id)
    if (!node) return
    node.el.style.display = 'none'
    node.lastVis = false
    node.key = ''
    this.active.delete(id)
    this.pool.push(node)
  }

  clear(): void {
    for (const id of [...this.active.keys()]) this.remove(id)
    for (const id of [...this.edgeActive.keys()]) this.hideEdge(id)
    this.queue.length = 0
  }
}
