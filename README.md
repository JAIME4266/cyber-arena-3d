# CYBER ARENA 3D — ELITE

A typing-combat arena shooter. Enemies close in — you kill them by typing the
letters above their heads while running, jumping and dashing around a neon
cyberpunk grid. Built as a fully static site: **no backend, no accounts, no
API keys** — deployed on GitHub Pages with serverless P2P co-op.

**Play:** `https://jaime4266.github.io/cyber-arena-3d/`

---

## Modes

| Mode | What it is |
|---|---|
| **Solo Run** | Endless arena. New seed every run. |
| **Daily Challenge** | Everyone gets the same seed per date — compare score, WPM, accuracy. |
| **Seed Link** | `?seed=XYZ` — challenge a friend on an identical run layout. |
| **Co-op (P2P)** | Create a room, share the 6-char code, play the same arena together over a direct browser-to-browser WebRTC connection. No server involved. |

## Controls

- **Move** — Arrow keys
- **Shoot** — Type home-row keys: `A S D F G H J K L ; ' ,`
- **Jump** — Space (dodge low bullets and shockwaves)
- **Dash** — Shift (short burst with brief invulnerability)
- **Pause** — Esc (solo only; co-op runs stay live)

## Rules

- Correct keys build **COMBO**. A miss or getting hit breaks it.
- Combo **overclocks you**: faster movement, multiplied score.
- **THREAT** ramps with kills — the arena gets meaner.
- Wave 2 at 50 kills: Elites with lasers (jump them — they fly low).
- Wave 3 at 100 kills: the **Overlord Core** boss with 3 phases —
  shockwaves, bullet rings, aimed volleys and grunt reinforcements.
- Green EMP domes halve your speed. Yellow cells restore shields.

## Architecture

```
src/
  core/     Pure, deterministic simulation (NO DOM / three.js / network)
    sim.ts        Fixed-timestep (60 Hz) authoritative sim: waves, boss
                  phases, combat, pickups — seeded RNG, golden-testable
    protocol.ts   Versioned co-op message codec (unit-tested)
    rng.ts        mulberry32 seeded RNG with serializable state
    stats.ts      WPM / accuracy / ranks / daily seeds
  render/   three.js presentation
    renderer.ts   sRGB + ACES + bloom pipeline, SwiftShader-safe quality
    world.ts      Arena, GLSL energy barrier, merged-geometry city (~3 draws)
    actor.ts      Procedural 11-bone rigged characters w/ hand-written skin
                  weights — always animated, zero asset downloads
    labels.ts     Letter labels with LRU texture cache
    vfx.ts        Spark/ring pools, tracer beam, camera juice
    audio.ts      WebAudio SFX + layered procedural soundtrack (intensity
                  scales with combo — no audio files, ever)
    hud.ts        Dirty-checked DOM HUD
  ui/       Menu, overlays, settings (plain DOM, keyboard accessible)
  net/      Serverless co-op (Trystero over public Nostr relays)
    host.ts       Host-authoritative: applies inputs, 10 Hz snapshots
    client.ts     Guest: input sender + local prediction + interpolation
  app/      Session orchestration, idle menu scene, persistence
```

### Netcode in one paragraph

The room creator becomes the **host** and runs the only authoritative `Sim`.
The guest sends inputs (typed keys immediately, movement at 10 Hz) and renders
interpolated snapshots ~120 ms behind live, predicting their own movement
locally with the same physics and blending toward authoritative positions.
Sim events (kills, waves, boss phases) are broadcast immediately for VFX and
audio. If both peers sit behind stubborn NATs, WebRTC may fail to connect —
that's the tradeoff of zero-infrastructure co-op; trying a different network
(hotspot) resolves it.

### Why procedural actors instead of the .glb models?

The original build shipped 65 MB of skinned models that contained **zero
animation clips** — everything T-posed and bobbed. The elite build defaults to
the procedural rig: fully animated, cohesive, and the entire game loads in
under 1 MB. The models remain in `assets/models/` for a future "HD" path:
add Mixamo clips (idle/walk/shoot/hit/die) to them, and the clip-matching
loader described in `legacy/index.html` can be revived on top of the new
engine.

## Development

```bash
bun install
bun run dev        # vite dev server
bun run typecheck  # tsc --noEmit (strict)
bun run lint       # eslint
bun run test       # vitest — 24 unit tests over the deterministic core
bun run build      # vite build → dist/
bun run e2e        # playwright smoke tests (headless Chromium + SwiftShader)
```

### CI/CD (`.github/workflows/ci.yml`)

On every push/PR:

1. **check** — typecheck, lint, unit tests, build, and a **size budget**
   (`scripts/size-budget.mjs` fails if `dist/` exceeds 4 MB — the site can
   never quietly regress to heavyweight).
2. **smoke** — Playwright boots the built site in headless Chromium
   (software WebGL), verifies the menu renders, a solo run starts, the run
   clock ticks, and typing doesn't throw.
3. **deploy** — on `main` only, after both jobs pass: the `dist/` artifact is
   deployed to GitHub Pages via the official Actions (no gh-pages branch).

## Testing philosophy

The deterministic core is the testable core: same seed + same scripted inputs
= identical state hash (verified over 20 simulated seconds in CI). Everything
hard to test (WebGL, WebRTC, audio) lives behind thin adapters and is covered
by the smoke suite's "does it boot and play" checks.

## Asset licensing

The source code is MIT (see `LICENSE`). The binary models under
`assets/models/` are third-party downloads with **unverified provenance**
(names like "Vampire_MAT1", "GLOCK" suggest marketplace assets). They are not
used by the deployed build, but resolve their licenses before redistributing
them. `legacy/index.html` is the original pre-elite build, kept for reference.

## Credits

- Original concept, first build, and the procedural rig DNA: **Jaime Sinclair**
- Elite rebuild: deterministic engine, P2P co-op, CI/CD, tests — 2026
