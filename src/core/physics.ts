/**
 * Combat physics 2.0 — deterministic impulse dynamics.
 *
 * A bespoke 2.5D dynamics core (circles + AABBs + impulses + parabolic
 * ballistics) instead of a general-purpose rigid body engine: the gameplay
 * plane is XZ with a jump/launch height, so this covers every body in the
 * game at a fraction of the cost, keeps the golden-test determinism, and
 * adds zero bundle weight. The concepts follow the physics-tuning
 * discipline (fixed-step integration, tunnelling speed caps, mass ratios
 * within 1:10, per-kind friction/restitution, sleeping bodies).
 *
 * Rules of the house (same as sim.ts):
 *  - NO Math.random. Any randomness is passed in by the caller's seeded RNG.
 *  - NO DOM / three.js / network imports. Pure logic + data.
 *  - Everything integrates with the fixed 1/60 dt only.
 *
 * Collision layer matrix (named, what scans what):
 *   PLAYER  → WORLD, PROP      (pushed out of props; shoves light props)
 *   ENEMY   → WORLD, PROP      (paths around props; shoved by them)
 *   BULLET  → WORLD, PROP, PLAYER   (crates stop rounds; barrels detonate)
 *   MORTAR  → WORLD            (ground/roof impact → blast)
 *   PROP    → WORLD, PROP, PLAYER   (impulse exchange, mass-weighted)
 *
 * Mass table (ratios within 1:10):
 *   player 1.0 · crate 0.55 · barrel 1.6 · shell 0.2
 */
import type { Obstacle } from './constants'
import type { PhysProp } from './types'
import {
  GRAVITY, PROP_BOUNCE, PROP_FRICTION, PROP_MAX_SPEED, PROP_SLEEP_T, PROP_SLEEP_V,
} from './constants'
export const PROP_MASS: Record<PhysProp['kind'], number> = { BARREL: 1.6, CRATE: 0.55 }

/** Circle-vs-AABB: returns the push-out vector, or null when clear. */
function circleVsAABB(x: number, z: number, r: number, o: Obstacle): [number, number] | null {
  const cx = Math.max(o.x - o.hw, Math.min(x, o.x + o.hw))
  const cz = Math.max(o.z - o.hd, Math.min(z, o.z + o.hd))
  const dx = x - cx
  const dz = z - cz
  const d2 = dx * dx + dz * dz
  if (d2 >= r * r) return null
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2)
    return [(dx / d) * (r - d), (dz / d) * (r - d)]
  }
  // Center inside the box: eject along the shallowest axis.
  const ex = o.hw - Math.abs(x - o.x)
  const ez = o.hd - Math.abs(z - o.z)
  return ex < ez
    ? [Math.sign(x - o.x || 1) * (ex + r), 0]
    : [0, Math.sign(z - o.z || 1) * (ez + r)]
}

/** Clamp a velocity magnitude (tunnelling guard). */
export function capSpeed(p: { vx: number; vz: number }, max: number): void {
  const s = Math.hypot(p.vx, p.vz)
  if (s > max) {
    p.vx = (p.vx / s) * max
    p.vz = (p.vz / s) * max
  }
}

export function wakeProp(p: PhysProp): void {
  p.sleepT = 0
}

/**
 * Integrate one fixed step over every alive prop: fuse countdown, ground
 * friction, gravity + landing bounce, wall/obstacle reflection with
 * restitution, rolling, and prop-prop impulse exchange. Returns the ids of
 * props whose fuse expired (the caller turns those into blasts — deferred,
 * so chain reactions never recurse).
 */
export function stepProps(
  props: PhysProp[],
  dt: number,
  obstacles: readonly Obstacle[],
  arena: number,
): number[] {
  const detonated: number[] = []

  for (const p of props) {
    if (!p.alive) continue
    if (p.fuse > 0) {
      p.fuse -= dt
      if (p.fuse <= 0) detonated.push(p.id)
    }
    const speed = Math.hypot(p.vx, p.vz)
    if (p.fuse <= 0 && speed < PROP_SLEEP_V && p.y <= 0.01 && p.vy === 0) {
      p.sleepT += dt
    } else {
      p.sleepT = 0
    }
    if (p.sleepT >= PROP_SLEEP_T) continue // sleeping: state frozen, deterministic

    // Ground drag (frame-rate irrelevant: fixed dt), softer in the air.
    const drag = p.y > 0.02 ? PROP_FRICTION * 0.25 : PROP_FRICTION
    p.vx -= p.vx * Math.min(1, drag * dt)
    p.vz -= p.vz * Math.min(1, drag * dt)

    // Gravity + landing bounce (restitution scrubbed by impact friction).
    if (p.y > 0 || p.vy !== 0) {
      p.vy -= GRAVITY * dt
      p.y += p.vy * dt
      if (p.y <= 0) {
        p.y = 0
        if (p.vy < -14) {
          p.vy = -p.vy * PROP_BOUNCE
          p.vx *= 0.72
          p.vz *= 0.72
          p.rot += p.rot >= 0 ? 0.35 : -0.35 // tumble kick on hard landings
        } else {
          p.vy = 0
        }
      }
    }

    p.x += p.vx * dt
    p.z += p.vz * dt
    capSpeed(p, PROP_MAX_SPEED)

    // Arena bounds: reflect with restitution.
    const lim = arena - 2 - p.r
    if (p.x < -lim) { p.x = -lim; p.vx = Math.abs(p.vx) * PROP_BOUNCE }
    else if (p.x > lim) { p.x = lim; p.vx = -Math.abs(p.vx) * PROP_BOUNCE }
    if (p.z < -lim) { p.z = -lim; p.vz = Math.abs(p.vz) * PROP_BOUNCE }
    else if (p.z > lim) { p.z = lim; p.vz = -Math.abs(p.vz) * PROP_BOUNCE }

    // Static obstacles: positional correction + velocity reflection.
    for (const o of obstacles) {
      const push = circleVsAABB(p.x, p.z, p.r, o)
      if (!push) continue
      p.x += push[0]
      p.z += push[1]
      const len = Math.hypot(push[0], push[1]) || 1
      const nx = push[0] / len
      const nz = push[1] / len
      const vn = p.vx * nx + p.vz * nz
      if (vn < 0) {
        p.vx -= (1 + PROP_BOUNCE) * vn * nx
        p.vz -= (1 + PROP_BOUNCE) * vn * nz
        // Spin-up from the glancing component.
        p.rot += (p.vx * -nz + p.vz * nx) * dt / p.r * 0.5
      }
    }

    // Rolling / tumbling: barrels roll with travel, crates tumble in the air.
    const sp = Math.hypot(p.vx, p.vz)
    if (p.y > 0.05) p.rot += (sp / p.r) * dt * 2.4
    else if (sp > 0.2) p.rot += (sp / p.r) * dt
  }

  // Prop-prop impulse exchange (n is small — pairwise is fine at 60 Hz).
  for (let i = 0; i < props.length; i++) {
    const a = props[i]!
    if (!a.alive) continue
    for (let j = i + 1; j < props.length; j++) {
      const b = props[j]!
      if (!b.alive) continue
      const dx = b.x - a.x
      const dz = b.z - a.z
      const min = a.r + b.r
      const d2 = dx * dx + dz * dz
      if (d2 >= min * min || d2 < 1e-6) continue
      const d = Math.sqrt(d2)
      const nx = dx / d
      const nz = dz / d
      const overlap = min - d
      const ma = PROP_MASS[a.kind]
      const mb = PROP_MASS[b.kind]
      const total = ma + mb
      // Mass-weighted positional separation.
      a.x -= nx * overlap * (mb / total)
      a.z -= nz * overlap * (mb / total)
      b.x += nx * overlap * (ma / total)
      b.z += nz * overlap * (ma / total)
      // Impulse along the normal (inelastic-ish, 0.6 restitution).
      const rvn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz
      if (rvn < 0) {
        const imp = -(1 + 0.6) * rvn / (1 / ma + 1 / mb)
        a.vx -= (imp / ma) * nx
        a.vz -= (imp / ma) * nz
        b.vx += (imp / mb) * nx
        b.vz += (imp / mb) * nz
        a.rot += 0.12 * (imp / ma)
        b.rot += 0.12 * (imp / mb)
      }
      // Vertical transfer when one is falling on the other.
      if (a.y > b.y + b.r * 0.6 && a.vy < -4) {
        b.vy = Math.max(b.vy, a.vy * 0.4)
        a.vy = -a.vy * 0.35
      } else if (b.y > a.y + a.r * 0.6 && b.vy < -4) {
        a.vy = Math.max(a.vy, b.vy * 0.4)
        b.vy = -b.vy * 0.35
      }
      wakeProp(a)
      wakeProp(b)
    }
  }

  return detonated
}

/**
 * Pure blast math: impulse + falloff for a body at (tx, tz) from an
 * epicenter (cx, cz). Returns null outside the radius.
 */
export function blastImpulse(
  tx: number, tz: number, cx: number, cz: number, radius: number, power: number, launch: number,
): { ix: number; iz: number; lift: number; falloff: number } | null {
  const dx = tx - cx
  const dz = tz - cz
  const d = Math.hypot(dx, dz)
  if (d > radius) return null
  const falloff = 1 - d / radius // linear falloff, 1 at epicenter
  const inv = d > 0.001 ? 1 / d : 0
  return {
    ix: dx * inv * power * (0.35 + falloff),
    iz: dz * inv * power * (0.35 + falloff),
    lift: launch * falloff,
    falloff,
  }
}
