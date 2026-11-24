# RANGE HOT — Design System

> Source of truth for all visual and interaction design. If code and this file
> disagree, this file wins. Produced with the `frontend-design-deslop` skill
> (strategy → tokens → craft → audit), replacing the neon-cyberpunk build.

## Changelog

| Version | Change |
| --- | --- |
| 2.1.0 | Full de-slop: cyberpunk → real-world live-fire training range ("RANGE HOT"). |
| 2.2.0 | Combat physics 2.0: dynamic ordnance (explosive barrels, crates), chain reactions, mortar ballistics, ragdoll deaths, momentum movement — same deterministic 60 Hz core. |

## 1. Discovery

- **Artifact**: browser arcade game — a 3D live-fire *typing* arena. Composite
  artifact: title menu + in-game HUD + co-op lobby + overlay screens, all
  rendered over a live 3D scene. Desktop-first (keyboard combat), responsive
  down to phones.
- **Audience / positioning**: friends playing serverless P2P co-op plus solo
  daily-run players. The game must feel like a *real place* with real
  equipment, real signage, real terminology — not a neon cyber-fantasy.
- **Brand adjectives**: grounded · disciplined · tactile · legible · honest.
- **Aesthetic essence**: *"a real training range."*
- **Avoid** (user's words): "bullshit of cyberpunk" — neon cyan/magenta, glow,
  scanlines, hacker chips, cyber jargon, purple night skies.

## 2. Aesthetic commitment

**Industrial / utilitarian, originated as the bespoke theme "RANGE HOT"** — a
military live-fire training compound at golden hour. Field-gray steel placards,
khaki canvas, stencil paint, safety orange, hazard tape used like real ranges
use it: sparingly, and only to mark danger. Typography is stenciled signage;
numerals are equipment readouts; the 3D world is asphalt, chain-link, CONEX
containers, floodlight masts, barracks and a hazy treeline — lit by a low warm
sun.

**Signature move — the range placard.** Every UI panel is a stenciled steel
placard: stencil header, 1px machined edge, four corner rivets (CSS
radial-gradient dots). Hazard tape (45° yellow/black) appears *only* on danger
elements: the boss bar, the operator-down screen.

## 3. Typography

| Role | Face | Weights | Notes |
| --- | --- | --- | --- |
| Display / headers / big letters | Big Shoulders Stencil Display | 400 700 900 | condensed industrial stencil — signage DNA |
| UI body / paragraphs | Barlow | 400 500 600 | DIN/signage lineage, real-world roads & equipment |
| Buttons / compact labels | Barlow Condensed | 500 600 700 | same family DNA, denser |
| Data / numerals / codes | IBM Plex Mono | 400 600 | tabular equipment readouts |

- Modular scale ratio **1.25**, base 16px; display sizes clamp with viewport.
- 2–3 families max (stencil + Barlow pair + mono). No Inter/Roboto/system.
- All fonts self-hosted via Fontsource (no external requests on GitHub Pages).

## 4. Color (OKLCH)

| Token | Value | Role |
| --- | --- | --- |
| `--bg-deep` | `oklch(21% 0.010 155)` | page edge / wells |
| `--bg` | `oklch(25% 0.012 152)` | placard steel |
| `--bg-raise` | `oklch(29% 0.014 150)` | raised placard |
| `--bg-inset` | `oklch(19% 0.010 155)` | input wells |
| `--line` | `oklch(42% 0.020 140)` | placard edge |
| `--ink` | `oklch(90% 0.012 100)` | bone stencil paint |
| `--ink-muted` | `oklch(66% 0.022 115)` | khaki |
| `--ink-faint` | `oklch(52% 0.018 120)` | secondary text |
| `--accent` | `oklch(68% 0.190 48)` | **safety orange** — focus, active, primary action |
| `--accent-ink` | `oklch(24% 0.060 48)` | charcoal text on orange |
| `--hazard` | `oklch(80% 0.150 95)` | ammo yellow — streak, connecting states, tape |
| `--danger` | `oklch(58% 0.200 27)` | signal red — boss, damage, errors |
| `--ok` | `oklch(60% 0.100 145)` | OD green — connected, med kits, hit confirmations |

Distribution **60/30/10**: field-gray neutrals / khaki + bone / safety orange +
ammo yellow. Orange is the only loud voice and it earns its placement.

## 5. Tokens

- **Spacing base**: 4px. Tight inside groups (4–8), generous between sections
  (24–48).
- **Radius**: `0` everywhere; `2px` is the single exception for large overlay
  cards. Sharp = machined.
- **Shadow**: none. Definition comes from 1px borders and a 1px inset top
  edge-light. No blur, no glow, ever.
- **Motion**: 120ms ease-out standard, 180ms overlays. Transform/opacity only.
  Mechanical — no bounce, no elastic, no float. `prefers-reduced-motion`
  honored.
- **Focus**: 2px solid safety orange outline, 2px offset. High-vis, like range
  marking paint.

## 6. Terminology (real world, no cyber jargon)

| Was | Now |
| --- | --- |
| CYBER ARENA 3D · ELITE | **RANGE HOT** — live-fire typing range |
| SHIELDS | ARMOR (plates) |
| DASH | SPRINT |
| COMBO / OVERCLOCK | STREAK / ADRENALINE |
| OVERLORD CORE | JUGGERNAUT |
| ELITE | GUNNER |
| EMP bubbles / yellow cells | GAS / MED KITS |
| SYSTEM SECURED / CRITICAL OVERLOAD | RANGE CLEAR / OPERATOR DOWN |
| CYBER ARENA ONLINE | RANGE HOT |
| Ranks S–E (cyber names) | JUGGERNAUT SLAYER / RANGE ACE / SOLID OPERATOR / REGULAR / CADET / RECRUIT |
| CO-OP | SQUAD LINK |

## 7. Craft layer

- **Layout**: the menu is a left-anchored *range board* over the live 3D
  compound (the scene is the hero on the right); on small screens it becomes a
  full-width scrim. HUD keeps combat-proven positions, restyled as placards.
- **Components**: full state matrices; buttons ranked by importance (primary =
  orange fill, others = plain placard, hover = khaki inversion — a mechanical
  toggle, not a glow). Toasts carry a small square status marker, not a colored
  border-accent.
- **Imagery**: everything in-world is procedural but *photoreal-motivated*:
  asphalt with painted firing lines, a helipad "H", chain-link fence on steel
  posts, corrugated CONEX containers with stencil markings, floodlight masts,
  barracks, hangar, water tower, watchtowers, treeline, hazy hills.
- **Accessibility**: WCAG 2.2 AA contrast, visible focus, keyboard operable,
  24px+ targets, color never the only signal, reduced-motion respected.
- **Dark mode**: the game UI is a single dark mode by design (placards over a
  golden-hour scene); no theming layer.

## 8. 3D scene direction

Golden-hour overcast-break: warm low sun (long soft shadows), steel-gray sky
with a warm horizon, light haze. Asphalt floor with white painted range lines
and a central helipad decal. Chain-link perimeter with concrete curb.
Floodlight masts (subtly lit — it's dusk-adjacent). CONEX obstacles in olive
and rust with stencil text. Base backdrop: barracks + hangar + water tower +
watchtowers + artist building models, treeline, distant hazy hills. Warm dust
motes. Tracers are warm white-orange; impact sparks are real sparks; gas
domes are yellow-green haze; med kits are white boxes with red crosses.

## 9. Slop audit (self-check against the deslop checklist)

- [x] No purple/indigo/violet, no neon cyan/magenta anywhere
- [x] No text-shadow glow, no glassmorphism, no scanlines, no skew chips
- [x] No Inter/Roboto/system as primary face; stencil + Barlow + Plex Mono
- [x] No icon-tile feature cards, no left-accent-border buttons
- [x] Buttons ranked by importance, not colored by meaning
- [x] No bounce/elastic easing; motion is mechanical and communicative
- [x] Radius ≤ 2px, zero blur shadows
- [x] Color never the only signal; focus visible; targets ≥ 24px
- [x] Terminology is domain-authentic (real range language), not theme-park
- [x] Density fits an action game HUD: tight, ordered, readable at a glance

## 10. Combat physics direction

Combat physics must read as real-world ordnance handling, never as sci-fi
magic. Barrels are painted rust with FLAMMABLE stencils; crates are stenciled
5.56 BALL; no energy fields anywhere. Explosions are dust, smoke and debris —
a warm orange fireball, a brown dust ring, dark smoke — not neon. The camera
is a handheld observer: trauma shake on impacts, a dip on hard landings. It
is never a drone — no smooth glide, no artificial stabilization.
