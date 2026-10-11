# KIT — diorama isometric core

The rendering core. Zero runtime dependencies, ESM only, Node >= 20.
`renderSVG(scene)` turns a scene object into one self-contained `<svg>` string.

## Files

- `kit/iso.mjs` — projection, geometry builders, materials, gradients, `renderSVG`.
- `kit/iso.css` — card chrome and both themes.
- `kit/iso.test.mjs` — `node --test kit/iso.test.mjs`.
- `kit/scene.mjs`, `kit/motion.mjs` — validation/flow sampling and browser runtime (separate owners).

`kit/scene.mjs` shares the cable curve with the renderer through `linkPoints` so flow packets ride exactly the drawn cable.

## Minimal working scene

```json
{
  "version": 1, "title": "Request path", "theme": "dark",
  "parts": [
    { "id": "web", "kind": "box", "label": "Web", "at": [0, 0, 0], "size": [3, 3, 2], "color": "blue", "accent": true },
    { "id": "api", "kind": "box", "label": "API", "at": [5, 0, 0], "size": [3, 3, 2.5], "color": "steel" },
    { "id": "db", "kind": "cylinder", "label": "DB", "at": [9, 5, 0], "radius": 1.6, "h": 2.6, "axis": "z", "color": "amber" }
  ],
  "links": [
    { "from": "web", "to": "api", "kind": "tube", "color": "blue" },
    { "from": "api", "to": "db", "kind": "cable", "color": "copper" }
  ]
}
```

## API

```js
project(x, y, z) -> [sx, sy]                 // 2:1 isometric base: sx=(x-y)*0.866, sy=(x+y)*0.5-z
anchors(part) -> { top, bottom, north, south, east, west }   // world coords (vec3)
box(opts) / plate(opts) -> Solid             // opts: { id?, at:[x,y,z], size:[w,d,h], color, accent?, detail?, vents?, leds?, cls?, theme? }
cylinder(opts) -> Solid                      // opts: { id?, at:[cx,cy,cz], radius, h, axis:'x'|'y'|'z', color, accent?, cls?, theme? }
tube({ points, radius, color, kind, scale? }) -> Solid   // points: vec3[]; kind: 'tube'|'cable'; radius = half-width (default 0.05 tube / 0.03 cable)
linkPoints(points, kind) -> vec3[]           // shared cable curve used by scene.mjs sampling
renderSVG(scene) -> string
TOKENS = { light: { <token>: {top,left,right,edge} }, dark: { ... } }
```

### Optional decorative part fields

These are supersets of schema v1; existing scenes remain valid; the material and lighting pass also improves their default rendering.

| field | type | effect |
|-------|------|--------|
| `detail` | `rack`, `tray`, `tower`, `switch`, `tank`, `crate`, `pallet`, `coil`, `concrete`, `none` | Optional projected hardware or surface treatment; choose the underlying shape and dimensions explicitly |
| `panels` | boolean | Double inset seams on both visible prism faces, four top screws |
| `hazard` | boolean | Restrained amber/ink base stripe band on visible prism faces |
| `sublabel` | string | Muted 9px second line in the label chip |
| `vents` | boolean | four to six inset slits on the left face |
| `leds` | integer `0..6` | status LEDs on the right face, cycling green, amber, blue, plum, each with a glow |

`validateScene` rejects unknown details, non-boolean `vents`, `panels` or `hazard`, non-string `sublabel`, and `leds` outside `0..6`, with the exact JSON field path.

`Solid = { id?, cls?, depthKey, polygons:[{ points, fill, stroke?, cls?, opacity? }], paths:[{ points, d, stroke, width, dash?, opacity?, cls? }], attrs? }`.

`anchors` ports use the convention: `north = -y`, `south = +y`, `east = +x`, `west = -x`, `top/bottom` along z. Boxes use `at` as the min corner; cylinders use `at` as the axis origin (base center for `z`). Every part exposes all six ports.

## Tokens

Each token resolves to a 4-tone material: `top = lighten(base, 24%)`, `left = base`, `right = darken(base, 20%)`, `edge = darken(base, 36%)`. Face gradients are built from the same base.

| token | light base | dark base | intent |
|-------|-----------|-----------|--------|
| ink | `#32363d` | `#b9c3cf` | outlines and label text |
| paper | `#ece5d6` | `#3e444c` | neutral surfaces, label chips |
| steel | `#8796a4` | `#6f7c8a` | neutral services |
| slate | `#4d5b6c` | `#424d5a` | infrastructure |
| amber | `#d7a442` | `#c99b43` | data stores |
| copper | `#b87950` | `#b0744b` | queues and logs |
| blue | `#46799f` | `#456f96` | clients and APIs |
| green | `#608968` | `#567e60` | compute and workers |
| brick | `#b55a4b` | `#a85449` | errors and external calls |
| plum | `#795780` | `#745282` | async and messaging |
| sand | `#cebb92` | `#b8a37d` | caches and disks |
| cloud | `#c1c9d2` | `#4d5661` | networks |

`accent: true` pushes the top face to the bright `rim` gradient and adds a translucent footprint glow under the part.

## Visual system

The renderer aims at a machined miniature, not a flat diagram.

- **Face gradients** — a `<defs>` block defines deterministic per-token `linearGradient`s for the active theme (`top`, `left`, `right`, `rim`). Every solid face fills with `url(#iso-g-<token>-<face>)`; there is no flat face fill. `top` runs base-light to base-lighter, `left` light to base, `right` base to dark, `rim` the lightest bevel tone.
- **Bevels** — every box/plate is a chamfered prism: chamfer `c = min(0.16, min(w,d,h)/6)`. The top face is an octagon (four corners cut), visible chamfer quads join top to the left/right faces, a 0.6px highlight strokes the top rim and a faint ink seam marks the shoulder joint.
- **Shadows** — a ground pass paints after low ground plates and before raised solids, depth-sorted the same way: a soft radial ellipse (~1.34x footprint, offset down-right for a top-left light) plus a smaller contact ellipse. No SVG filters, only radial gradients.
- **Cylinders** — read as stacked disk stores: outer cap, an inset inner cap, two ring seams (highlight above, shadow below), and a stroked base ring.
- **Decor** — `detail`, `vents` and `leds` add 3D geometry, projected like everything else.
- **Links** — a three-pass stroke drawn in world units so a tube reads as a solid, traceable line at any zoom: a token-edge outline at 0.85 opacity and 2x the base width, an opaque token-base core, then a specular highlight at 0.25x the base width offset ~0.35 screen px up-left (converted to world units via `1/scale`). `radius` is the half-width: tubes default 0.05 (a 0.10 base stroke), cables 0.03 with a 0.62 ribbon factor and a dash pattern. Unlike the part hairlines, link strokes carry no `non-scaling-stroke`, so they scale with the fit transform. Tubes are straight; cables are quadratic sagging curves whose sampling `kit/scene.mjs` reproduces via `linkPoints`.
- **Labels** — museum chips: a paper `rect` (`.label-chip`, 1px ink border at 40%, tiny drop shadow) behind `.label` text, sized from an approximate glyph width.
- **Floor** — a faint isometric dot grid (every 2 world units) is clipped to the content bbox and drawn under the shadows.

## How renderSVG fits and sorts

1. Build every part into a `Solid`; links resolve to the nearest port (or an explicit `fromPort`/`toPort`) and become `tube`/`cable` paths.
2. Sort solids ascending by `depthKey` (anchor `x+y+z`; cylinders use the axis center, links the endpoint average) and paint back-to-front (painter's algorithm).
3. Compute the projected bounds of every polygon and path point, then fit: `scale = min(availW/contentW, availH/contentH)` inside `scene.size` with a 32px margin and 38px reserved on top when `title` exists. The fit is centered and the root `<svg>` carries `data-fill`, the fraction of the usable stage the drawing occupies.
4. Emit one `<g transform="translate(tx,ty) scale(s)">` containing the default ground, low floor plates, depth-sorted shadows, masked reflections, depth-sorted raised solids and links, then the label chips. Labels are drawn in group space with `font-size = 12/s`, a paper chip and centered `.label` text.

Parts render as `<g class="part" data-id="...">`; links as `<g class="link" data-from data-to>`. Flow packets are never rendered statically: `kit/motion.mjs` mounts them into `g.packets` at runtime, each circle carrying a 0.6px ink-edge ring (`stroke-width` with `non-scaling-stroke`) so the dots pop against both light and dark grounds.

## Determinism and validation

- Deterministic: no `Date`, no `Math.random`, no locale formatting; identical scene -> byte-identical SVG. All coordinates are rounded to 3 decimals.
- Throws `Error` for: unknown color token, unknown part kind, unknown cylinder axis, missing/duplicate part id, links referencing unknown parts, unknown port, non-positive size/radius/h, and non-finite coordinates.

## Inlining rule

`build.mjs` concatenates `iso.mjs` + `scene.mjs` + `motion.mjs` into one `<script type="module">`, stripping only relative `import` lines. Never define a module-level name another kit file might use; prefix private helpers with `iso_` / `scene_` / `motion_`. Exported names are the shared contract.

## CSS classes

`iso.css` styles the page: `.card`, `.card-head` (+ `h1`, `.subtitle`), `.stage` (+ `svg`), `.card-foot`, `.readout` (`.readout-item`, `.readout-label`, `.readout-value`), `.hint`. Themes come from `body.theme-light` / `body.theme-dark`; the stage uses a soft vertical gradient with a faint vignette and the card a warmer paper gradient. Inside the SVG it styles `svg .label`, `svg .label-chip`, `.part`, `.link`, `.link.active`, `.packet`, `.part.active` (toggled by `motion.mjs`) and `.part .glow`. Self-contained: system font stack, no external assets. Honors `prefers-reduced-motion` and collapses the card to full width below 680px.

## Capture and layout guidance

Recommended gallery capture: a CSS viewport of `1280x960` at device scale factor 2 (PNG `2560x1920`):

```
node scripts/capture.mjs <page.html> <out.png> --w 1280 --h 960 --zoom 2
```

The card is fluid and grows up to `1160px` (`max-width: min(1160px, 94vw)`), so at the 1280px capture it spans about 90% of the frame and the figure dominates. Capture both themes (`--theme dark` on `build.mjs`) plus a `?t=<s>` freeze for deterministic motion.

- Scenes of roughly 12-30 parts read best: populated enough to look like a real system, sparse enough that labels stay legible.
- Add a ground plate under the stack. A `plate` at `z: 0` anchors the drawing and improves depth sorting.
- Prefer 2-4 flows at calm speeds (8-16 loops/min) and a `readout` of 2-3 real numbers.
- Check `data-fill` on the root `<svg>`: it reports the fraction of the usable stage the drawing occupies (1.0 is a perfect fit). Use it to confirm a scene is neither cramped nor floating in whitespace.

## Detail and lighting pass

Constraints: determinism, no filters, zero deps, no comments, no emojis, world-unit link strokes, API stable.

Concrete uses 4-unit expansion joints, a dashed center lane, an inner wear line and low-opacity mottling derived solely from integer coordinate hashes. Procedural cells are capped at 1200. A floorless scene receives the same treatment inside its fitted bounds. Contact grime and narrow occlusion ellipses ground every object; all softness comes from radial gradients.

Racks have six to eight slots, front rails, a power strip and top cable stub. Unit labels appear only when a slot affords at least 4 screen pixels. Towers add vertical vents, two drive recesses and a badge. Switch details add sixteen ports and eight green/amber LEDs: author a low `box` to make a switch slab. Crates have X-braced faces; pallets have top slats and fork pockets. Use a short cylinder for a coil. Tank cylinders add two top rails, an axis-aware ladder, a level window and valve handle.

All solids receive crisp rim lighting. Blue, green, plum and amber surfaces receive a faint diagonal sheen. The farther half of raised objects receives a 4–9% paper veil based on sorted depth rank. Color families remain cool metals, restrained saturated plastics, warm data materials and neutral paper/sand/cloud.

Reflections reuse solid faces mirrored around the projected base center at vertical scale -0.35, with 5.5% light / 8% dark opacity and a radial mask falling off over the outer 60%. Only objects fully supported by a plate at or below ground level qualify. Reflection geometry is emitted without an additional transform, preserving the single fit group.

Link hardware follows the existing painter ordering: endpoint-token collars or plugs, flange rims for tubes longer than three units, and cable ties at one-third and two-thirds. Connector stroke widths remain world units. Sublabel chips grow to fit the second line; a 1px leader appears when the existing chip lift exceeds 1.5 world units.

The runtime owns packet positions and trails in `kit/motion.mjs`. This renderer never emits static packets. The stylesheet suppresses `.packet-trail` under reduced motion and uses opacity for interaction highlights, without CSS filters.
