/**
 * Idle scene behind the main menu: the arena with a slowly orbiting camera,
 * breathing player, pulsing barrier. Sells the game before a single click.
 *
 * Boots instantly with the procedural actor, then hot-swaps to the HD GLB
 * actor the moment the asset pack finishes downloading.
 */
import { World } from '../render/world'
import { createPlayerActor } from '../render/actorfactory'
import type { ActorView } from '../render/actor'
import { assets } from '../render/assets'
import type { GameRenderer } from '../render/renderer'

export class IdleScene {
  private readonly world: World
  private player: ActorView
  private t = 0
  private disposed = false
  private readonly offReady: () => void

  constructor(private readonly renderer: GameRenderer) {
    this.renderer.scene.clear()
    this.world = new World(this.renderer.scene)
    this.player = createPlayerActor(true)
    this.player.root.position.set(0, 0, 0)
    this.renderer.scene.add(this.player.root)

    // Hot-swap to the HD model when the pack lands.
    this.offReady = assets.onReady(() => {
      if (this.disposed || !assets.hdActive()) return
      const hd = createPlayerActor(true)
      this.player.root.removeFromParent()
      this.player = hd
      this.player.root.position.set(0, 0, 0)
      this.renderer.scene.add(this.player.root)
    })
  }

  update(dt: number): void {
    if (this.disposed) return
    this.t += dt
    this.player.update(dt, { moving: false, aiming: false, speed: 10, air: false })
    const a = this.t * 0.12
    const r = 46
    this.renderer.camera.position.set(Math.sin(a) * r, 16 + Math.sin(this.t * 0.3) * 4, Math.cos(a) * r)
    this.renderer.camera.lookAt(0, 6, 0)
    this.renderer.camera.fov = 50
    this.renderer.camera.updateProjectionMatrix()
    this.world.update(dt, 0, 0, this.renderer.camera.position)
    this.renderer.render()
  }

  dispose(): void {
    this.disposed = true
    this.offReady()
    this.world.dispose()
  }
}
