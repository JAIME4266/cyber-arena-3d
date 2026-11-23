/**
 * Actor factory: HD GLB actors when the asset pack is loaded and the HD
 * setting is on, procedural rigged actors otherwise. A malformed template
 * can never take the game down — construction falls through to procedural.
 */
import type { EnemyKind } from '../core/types'
import type { ActorView } from './actor'
import { Actor, ENEMY_PALETTES, PLAYER2_PALETTE, PLAYER_PALETTE } from './actor'
import { GlbActor, type GlbRole } from './glbactor'
import { assets } from './assets'

export type PlayerRole = 'PLAYER' | 'PLAYER2'

function procedural(role: GlbRole): ActorView {
  switch (role) {
    case 'PLAYER': return new Actor(PLAYER_PALETTE)
    case 'PLAYER2': return new Actor(PLAYER2_PALETTE)
    default: return new Actor(ENEMY_PALETTES[role as EnemyKind])
  }
}

export function createActor(role: GlbRole): ActorView {
  if (assets.hdActive()) {
    try {
      return new GlbActor(role)
    } catch (err) {
      console.warn(`[actors] GLB role ${role} failed, using procedural`, err)
    }
  }
  return procedural(role)
}

export function createPlayerActor(local: boolean): ActorView {
  return createActor(local ? 'PLAYER' : 'PLAYER2')
}
