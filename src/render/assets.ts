/**
 * HD asset library: loads the optimized GLB pack (characters, weapons, skyline)
 * with meshopt decoding, byte-accurate progress, per-file fallback, and
 * onReady hooks so the menu, idle scene and sessions can upgrade live.
 *
 * Files live in public/models (produced by `bun run assets:optimize`,
 * ~3.6 MB total). A failed file never breaks the game — that template is
 * simply reported unavailable and callers fall back to procedural actors.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

export type TemplateKey =
  | 'player' | 'runner' | 'grunt' | 'boss'
  | 'gunRifle' | 'gunSmg' | 'gunPistol'
  | 'building'

interface FileSpec {
  key: TemplateKey
  url: string
  /** Weight of this file in the overall progress bar (approx bytes). */
  weight: number
}

const SPECS: FileSpec[] = [
  { key: 'player', url: 'models/player.glb', weight: 706_676 },
  { key: 'runner', url: 'models/enemy.glb', weight: 1_245_172 },
  { key: 'grunt', url: 'models/enemy2.glb', weight: 591_488 },
  { key: 'boss', url: 'models/boss.glb', weight: 661_886 },
  { key: 'gunRifle', url: 'models/gun_w3.glb', weight: 280_978 },
  { key: 'gunSmg', url: 'models/gun_w2.glb', weight: 180_873 },
  { key: 'gunPistol', url: 'models/gun_w1.glb', weight: 47_002 },
  { key: 'building', url: 'models/building.glb', weight: 74_651 },
]

export interface Template {
  scene: THREE.Group
  /** Height of the raw model in its own units (bbox max.y - min.y). */
  height: number
  /** Lowest point of the raw model (usually ~0, feet). */
  minY: number
  skinned: boolean
}

export type AssetsState = 'idle' | 'loading' | 'ready' | 'failed'

type ReadyListener = () => void

class AssetLibrary {
  state: AssetsState = 'idle'
  progress = 0
  /** True while a load pass is running or done — gates session starts. */
  private started = false
  private hdWanted = true
  private readonly templates = new Map<TemplateKey, Template>()
  private readonly failed = new Set<TemplateKey>()
  private readonly readyListeners = new Set<ReadyListener>()
  private readyPromise: Promise<void> | null = null
  private readyResolve: (() => void) | null = null
  private loader: GLTFLoader | null = null

  /** Whether HD actors should be instantiated right now. */
  hdActive(): boolean {
    return this.hdWanted && this.state === 'ready'
  }

  setHdWanted(wanted: boolean): void {
    this.hdWanted = wanted
    if (wanted && !this.started) void this.load()
  }

  has(key: TemplateKey): boolean {
    return this.templates.has(key)
  }

  get(key: TemplateKey): Template | null {
    return this.templates.get(key) ?? null
  }

  /** True when a load pass is in flight (sessions show the progress gate). */
  pending(): boolean {
    return this.state === 'loading'
  }

  /** Resolves when the current load attempt finishes (ready or failed). */
  whenReady(): Promise<void> {
    return this.readyPromise ?? Promise.resolve()
  }

  /**
   * Subscribe to load completion. If loading already finished, fires
   * immediately. Returns an unsubscribe function (World uses this to add
   * hero buildings whether they arrive before or after construction).
   */
  onReady(cb: ReadyListener): () => void {
    if (this.state === 'ready' || this.state === 'failed') {
      cb()
      return () => undefined
    }
    this.readyListeners.add(cb)
    return () => this.readyListeners.delete(cb)
  }

  load(): Promise<void> {
    if (this.started) return this.readyPromise ?? Promise.resolve()
    this.started = true
    this.state = 'loading'
    this.readyPromise = new Promise(resolve => {
      this.readyResolve = resolve
    })

    const loader = (this.loader ??= (() => {
      const l = new GLTFLoader()
      l.setMeshoptDecoder(MeshoptDecoder)
      return l
    })())

    const base = import.meta.env.BASE_URL ?? './'
    const totalWeight = SPECS.reduce((s, f) => s + f.weight, 0)
    const loaded = new Map<TemplateKey, number>()
    const tick = (): void => {
      let done = 0
      for (const f of SPECS) done += (loaded.get(f.key) ?? 0) * f.weight
      this.progress = Math.min(1, done / totalWeight)
    }
    tick()

    void Promise.all(
      SPECS.map(spec =>
        loader.loadAsync(base + spec.url, ev => {
          if (ev.total > 0) {
            loaded.set(spec.key, Math.min(1, ev.loaded / ev.total))
            tick()
          }
        }).then(
          gltf => {
            loaded.set(spec.key, 1)
            tick()
            this.templates.set(spec.key, prepareTemplate(gltf.scene, spec.key))
          },
          () => {
            // Single-file failure: keep going, that template falls back.
            loaded.set(spec.key, 1)
            tick()
            this.failed.add(spec.key)
            console.warn(`[assets] ${spec.url} unavailable — using procedural fallback`)
          },
        ),
      ),
    ).then(() => {
      // Character pack ready if at least the four bodies + one gun survived.
      const bodies = (['player', 'runner', 'grunt', 'boss'] as TemplateKey[]).filter(k => this.templates.has(k))
      this.state = bodies.length >= 3 ? 'ready' : 'failed'
      this.progress = 1
      this.readyResolve?.()
      for (const cb of [...this.readyListeners]) cb()
      this.readyListeners.clear()
    })

    return this.readyPromise
  }

  dispose(): void {
    for (const t of this.templates.values()) {
      t.scene.traverse(o => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) {
          mesh.geometry.dispose()
          const m = mesh.material
          if (Array.isArray(m)) m.forEach(x => x.dispose())
          else m.dispose()
        }
      })
    }
    this.templates.clear()
  }
}

/** Normalize a loaded GLTF scene into a template: shadows, culling, bbox. */
function prepareTemplate(gltfScene: THREE.Object3D, key: TemplateKey): Template {
  const group = new THREE.Group()
  group.name = `tpl:${key}`
  gltfScene.position.set(0, 0, 0)
  gltfScene.rotation.set(0, 0, 0)
  gltfScene.scale.set(1, 1, 1)
  group.add(gltfScene)

  let skinned = false
  gltfScene.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = false
    const sm = o as THREE.SkinnedMesh
    if (sm.isSkinnedMesh) {
      skinned = true
      sm.frustumCulled = false
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial
      if (std.isMeshStandardMaterial) std.envMapIntensity = 1.1
    }
  })

  gltfScene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(gltfScene)
  const height = Math.max(1e-6, box.max.y - box.min.y)
  return { scene: group, height, minY: box.min.y, skinned }
}

export const assets = new AssetLibrary()
