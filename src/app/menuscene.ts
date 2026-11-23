/**
 * Idle scene behind the main menu: the arena with a slowly orbiting camera,
 * breathing player, pulsing barrier. Sells the game before a single click.
 */
import { World } from '../render/world'
import { Actor, PLAYER_PALETTE } from '../render/actor'
import type { GameRenderer } from '../render/renderer'

export class IdleScene {
  private readonly world: World
  private readonly player: Actor
  private t = 0
  private disposed = false

  constructor(private readonly renderer: GameRenderer) {
    this.renderer.scene.clear()
    this.world = new World(this.renderer.scene)
    this.player = new Actor(PLAYER_PALETTE)
    this.player.root.position.set(0, 0, 0)
    this.renderer.scene.add(this.player.root)
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
    this.world.dispose()
  }
}
