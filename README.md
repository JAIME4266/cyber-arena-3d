# CYBER ARENA 3D — ELITE

A typing-combat arena shooter. Enemies close in — you kill them by typing the 
letters above their heads while running, jumping and dashing around a neon
cyberpunk grid. Built as a fully static site: **no backend, no accounts, no
API keys** — deployed on GitHub Pages with serverless P2P co-op.

**Play:** `https://jaime-sinclair.github.io/cyber-arena-3d/`

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
    assets.ts     HD asset library: meshopt GLB pack, byte progress,
                  per-file fallback, onReady hot-swap hooks
    actor.ts      Procedural 11-bone rigged characters w/ hand-written skin
                  weights — the always-available fallback actor
    glbactor.ts   HD actors: Mixamo rigs driven by a procedural animation
                  layer (walk/aim/recoil/flinch/death + spring cloth/rope
                  physics) and data-driven auto-fitted weapons
    actorfactory.ts  HD when available + enabled, procedural otherwise
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

### HD models: the artist assets, alive

The original build shipped 74 MB of skinned models with **zero animation
clips** — everything T-posed and bobbed. The elite build now ships them as a
**3.6 MB meshopt-compressed pack** (`public/models/`, built by
`bun run assets:optimize` from `assets/models/`) and brings them to life with
a **procedural animation layer** instead of clips:

- **Universal Mixamo rig driver** — bone rest poses are snapshotted, swings
  are applied on precomputed parent-space axes, so one animator drives the
  vampire player, both enemy species and the boss.
- **Locomotion & combat** — walk/run cycles with knee bend and counter-rotated
  spine, aim poses blended per frame, recoil, hit flinches, backward deaths,
  breathing idles, air poses.
- **Secondary motion** — cloth, skirt, rope, chain and armour bones run
  critically-damped springs driven by velocity, so capes and chains trail
  and settle as characters move.
- **Auto-fitted weapons** — each gun's long axis, muzzle end (thin end) and
  grip (thickest cross-section) are measured from the geometry, then the
  weapon is mounted on the right hand and locked while the arm holds the
  aim pose — so barrels point exactly down the line of fire, and hang
  naturally at rest.
- **Resilience** — any file that fails to load falls back to the procedural
  actor for that role; software renderers (CI, weak iGPUs) automatically run
  the procedural path for speed (`?hd=1` forces HD for testing).

The pack streams in the background (progress shown on the menu); runs started
mid-download show a brief loading gate. HD MODELS can be toggled in SETTINGS.

## Development

```bash
bun install
bun run dev             # vite dev server
bun run typecheck       # tsc --noEmit (strict)
bun run lint            # eslint
bun run test            # vitest — 24 unit tests over the deterministic core
bun run build           # vite build → dist/
bun run assets:optimize # rebuild public/models from assets/models (74 MB → ~3.6 MB)
bun run e2e             # playwright smoke tests (headless Chromium + SwiftShader)
```

### CI/CD (`.github/workflows/ci.yml`)

On every push/PR:

1. **check** — typecheck, lint, unit tests, build, and a **size budget**
   (`scripts/size-budget.mjs` fails if `dist/` exceeds 25 MB or any file
   exceeds 4 MB — the site can never quietly regress to heavyweight).
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
`assets/models/` (and their compressed derivatives in `public/models/`) are
third-party downloads with **unverified provenance** (names like
"Vampire_MAT1", "GLOCK" suggest marketplace assets). Resolve their licenses
before redistributing them. `legacy/index.html` is the original pre-elite
build, kept for reference.

## Credits

- Original concept, first build, and the artist models: **Jaime Sinclair**
- Elite rebuild: deterministic engine, HD asset pipeline + procedural Mixamo
  animation, P2P co-op, CI/CD, tests — 2026
