# Craft — composing the scene

The scene is invented; the facts are not. This file is how to lay out a figure that reads at a
glance and holds up in a README.

## Grounding

- Every part sits **on the ground plate** (`z` starts at the plate's top face) or **on a mount** —
  another part it is built on. Nothing floats in mid-air.
- Use exactly one **ground plate** as the base of the world. Give it a neutral token (`paper` or
  `slate`) and make it a little wider than the footprint of the parts, so nothing hangs off an edge.
- A part that rests on another should share the same `x`/`y` footprint region and start at the
  lower part's `z + h`. Stacked tiers read as a building, not a scatter.

## Spacing

- Keep **at least 2.5 grid units of air** between solids. Under that, side faces merge and the
  silhouette turns to mush.
- No **silhouettes colliding**: in the 2:1 isometric projection, two parts can overlap on screen
  even when they are far apart in world space. Space them until their projected footprints are
  clearly separated.
- Leave a margin inside `scene.size` for the title (the renderer already reserves room), and do
  not fill the whole canvas with parts — dead space at the edges is fine, crowded edges are not.

## Tiering

- Order parts by **data-flow direction** and place them along that direction: clients at one end,
  stores at the other, services in the middle.
- Put a whole tier on a shared line so the eye can scan it. Replicas of one service are the same
  kind, same size, same color, spaced evenly.
- Increase height (`h`/`size[2]`) with tier importance or depth, not at random; the eye reads a
  taller box as "bigger role".

## Color discipline

- **One accent, only.** Set `accent: true` on the single part the figure is about; everything
  else is unaccented. Two accents compete and the figure loses its subject.
- Match material to role:

  | role | token |
  |------|-------|
  | neutral services / edges | `steel` |
  | clients and APIs | `blue` |
  | data stores | `amber` |
  | queues and logs | `copper` |
  | async and messaging | `plum` |
  | compute and workers | `green` |
  | infrastructure | `slate` |
  | caches and disks | `sand` |
  | networks | `cloud` |
  | errors and external calls | `brick` |

- Links take the token of what flows through them (a `blue` request link, a `copper` data link).
  Do not introduce a token that no part uses.

## Labels

- Short **nouns**: `API`, `Postgres`, `nginx`, `S3`. Not sentences, not a version, not a metric.
- **No duplicates.** Two parts must not share a label; if they do, one is really the other's replica
  (number them) or they are different things (rename).
- Labels must stay **readable at 12px**, the rendered size. If a word only fits when shortened to an
  initialism, use the initialism.

## Motion restraint

- **2–4 flows.** More than that and the figure shimmers instead of explaining.
- **Calm speeds**: 8–16 loops/min. Reserve the top of the 6–24 range for the one primary path.
- **Count 2–4** packets per flow. A busy river of dots hides the path.
- Only animate paths the reader should follow; a decorative flow is noise.

## Readout

- **Real numbers only.** Pull them from the config or the user: replica counts, port numbers, p95,
  consumer lag, queue depth. Never fabricate a number to fill the strip.
- 2–3 entries. Each entry is a `label` (what it is) and a `value` (the real figure, with its unit).

## Theme

- **Light is the default** — it drops cleanly into READMEs and docs built on white.
- Choose **dark** for a destination that is already a dark page, and keep the whole scene on one
  theme. Do not mix. Set it from the destination, and override with `--theme` only to compare.

## Common mistakes and fixes

| Mistake | Fix |
|---------|-----|
| A part floats above the plate | Drop its `z` to the plate top, or rest it on the part below |
| Two solids read as one blob | Add at least 2.5 grid air between them |
| Traffic looks busy and noisy | Cut to 2–4 flows, lower `speed` into 8–16, set `count` to 2–3 |
| Two parts shout equally | Keep `accent: true` on one; clear it on the rest |
| A number appears on a box | Move it into `readout`, and make sure it is real |
| Label too long to read | Shorten to the noun or initialism |
| Figure cropped at the edges | Grow `size` or move parts inward; leave margin |
| Flow points at empty space | Connect it along parts that actually link |

## Material storytelling

Constraints: determinism, no filters, zero deps, no comments, no emojis, world-unit link strokes, API stable.

Use `detail: "concrete"` on the main ground and on broad industrial platforms. Its seams, wear, mottling and quiet lane marking should establish scale without competing with links. Keep supporting plate tops exactly aligned with object bases so contact shadows and restrained reflections read correctly.

Choose hardware by role: `rack` for dense service units, a tall box with `tower` for workstations, a low slab with `switch` for networking, a cylinder with `tank` for a registry or store. Details decorate the authored geometry; they never silently change its footprint, anchors or dimensions. Existing `tray`, vents and LEDs remain useful and may be combined sparingly.

Use `panels: true` on one or two manufactured enclosures. Reserve `hazard: true` for an exceptional destination such as a dead-letter queue; do not stripe every service. Small unlabeled crates, pallets and coils provide scale and evidence of use. Prefer one or two props per scene, place them outside the traffic corridors, and keep them subordinate to the system parts.

Use a `sublabel` only for verified context. It adds a muted second line, not permission to invent replica counts. Check both chip lines visually because the geometry audit approximates labels. Review deterministic captures at `?t=2.5`, 1240×1120, zoom 1 in both themes. The floor should remain muted; reflections, sheen and fog are supporting cues rather than neon effects.
