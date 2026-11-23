# RANGE HOT — LIVE-FIRE TYPING RANGE

A real-world typing arena shooter. Hostiles close in — you put them down by
typing the letters stenciled on the plates above their heads while running,
jumping and sprinting around a live-fire training compound at golden hour.
Built as a fully static site: **no backend, no accounts, no API keys** —
deployed on GitHub Pages with serverless P2P squad co-op.

**Play:** `https://jaime-sinclair.github.io/cyber-arena-3d/`

> Visual design system: see [`DESIGN.md`](./DESIGN.md) — stenciled steel
> placards, safety orange, hazard tape on danger only. No neon, no cyberpunk.

---

## Modes

| Mode | What it is |
|---|---|
| **Solo Drill** | Free range, endless. New seed every run. |
| **Daily Drill** | Everyone gets the same seed per date — compare score, WPM, accuracy. |
| **Seed Link** | `?seed=XYZ` — challenge a friend on an identical run layout. |
| **Squad (P2P)** | Host a room, share the 6-char code, fight the same range together over a direct browser-to-browser WebRTC connection. No server involved. |

## Controls

- **Move** — Arrow keys
- **Shoot** — Type home-row keys: `A S D F G H J K L ; ' ,`
- **Jump** — Space (dodge low rounds and blast waves)
- **Sprint** — Shift (short burst with brief invulnerability)
- **Pause** — Esc (solo only; squad runs stay live)

## Rules

- Correct keys build a **STREAK**. A miss or getting hit breaks it.
- The streak feeds **ADRENALINE**: faster movement, multiplied score.
- **THREAT** ramps with kills — the range gets meaner.
- Wave 2 at 50 kills: Gunners firing low rounds (jump them) that need 2-key
  sequences.
- Wave 3 at 100 kills: the **JUGGERNAUT** with 3 phases — blast waves,
  bullet rings, aimed volleys and grunt reinforcements.
- Yellow-green GAS domes halve your speed. White MED KITS restore armor plates.

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
    world.ts      Training compound: asphalt range, helipad, chain-link fence,
                  CONEX containers, base backdrop, treeline + hills (~few draws)
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
  ui/       Menu (range board), overlays, settings (plain DOM, a11y, DESIGN.md tokens)
  net/      Serverless squad co-op — connection hub with racing transports
    hub.ts        Races 3 signaling networks, deterministic pinning, failover
    strategies.ts Nostr relays + WebTorrent trackers + MQTT brokers (curated)
    room.ts       One Trystero strategy wrapped as a routed transport
    direct.ts     DIRECT LINK fallback: paste-code invite, zero infrastructure
    ice.ts        STUN + free TURN (UDP/TCP) — survives symmetric NAT/CGNAT
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
audio.

**How two players actually find each other (no server, ever):** the connection
hub joins the same room code on *three independent public networks at once* —
Nostr relays, WebTorrent trackers and MQTT brokers. Whichever network both
players can reach wins; the others stay connected as hot spares. ICE runs
multiple STUN servers plus a free TURN relay over UDP *and* TCP, so peers
behind symmetric NAT / CGNAT (mobile data, strict routers) still connect. If
no partner appears, the hub re-announces on fresh connections every ~14 s —
no infinite "connecting…" limbo — and the lobby shows a live signal matrix
(`NOSTR 4/5 · TORRENT 1/1 · MQTT 1/1`) instead of a spinner.

If every network is blocked (school/office firewalls), the lobby's **DIRECT
LINK** removes the middleman entirely: the host generates a ~1 KB invite code
to send over any messenger; the friend pastes it, sends back a reply code,
and the two browsers connect WebRTC directly. Zero relays, zero accounts,
works anywhere two people can exchange text.

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
- Elite rebuild (2026) and the RANGE HOT real-world redesign: deterministic
  engine, HD asset pipeline + procedural Mixamo animation, P2P co-op, CI/CD,
  tests
