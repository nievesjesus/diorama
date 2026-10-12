# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 - unreleased

### Added

- Scene spec v1: a deterministic JSON format for parts, links, flows and readouts.
- Isometric kit: a 2:1 isometric camera, four-tone materials, and a back-to-front SVG renderer.
- Animated flows: request, job and packet motion with a seek mode (`?t=<seconds>`) for frozen frames.
- Geometry audit: a check that proves nothing overlaps or floats before a figure ships.
- Headless capture: scripted screenshots of the built pages.
- `from-compose` CLI: reads a docker-compose file and writes a first-draft scene spec (`node scripts/from-compose.mjs docker-compose.yml --out scene.json`).
- Three example scenes, committed as scene plus built page: a three-tier web stack, a Kafka pipeline and a Kubernetes CI deployment.
- Capture zoom semantics: `--w`/`--h` set the CSS viewport and `--zoom` the device scale factor, so the PNG is W*zoom by H*zoom with the same 1x layout.
- Full-bleed world presentation: floating slab, atmospheric void, glass HUD, `?frame=1` embed mode, subtle parallax.
- Evals: test prompts and the properties a good answer must have.
- Concrete environments: a plate with `detail: "concrete"` renders joints, deterministic mottling and wear lanes so figures sit on a real ground.
- Surface detail: inset panels and screws, hazard striping and a hardware vocabulary (rack, tower, switch, tank, crate, pallet, coil) in `kit/iso.mjs`.
- Lighting: rim light, top sheen, contact ambient occlusion and depth fog layered over the four-tone materials.
- Grounding: masked floor reflections and soft/contact shadows tie every raised part to its plate.
- Links: connectors, collars, plugs and cable ties terminate tubes and cables.
- Flows: tapered motion trails follow each runtime packet, fading from the packet color, and are omitted under `prefers-reduced-motion`.
- Labels: sublabel chips add a second caption line under a part label.
- WebGL world renderer: `--webgl` also writes `world.html`, the same scene as a three.js world (three.js r169 vendored inline, so the page stays standalone and offline).
- Industrial environments, `warehouse` and `city`, picked by an auto heuristic — city when parts `>= 18`, total footprint `>= 260 u²` or spread `>= 46 u`, warehouse otherwise — and overridable with `?env=warehouse|city|auto`.
- Procedural road network with deterministic termini: edge gates, cul-de-sacs, loading bays and driveways, plus a `validateNetwork` layout check for orphaned corridors and unclassified ends.
- Camera modes: orbit (drag to orbit, scroll to zoom), top-down (`?cam=top`) and first person (`?cam=fp` or `V`), with `?focus=<id>&fill=<n>` to frame one part.
- `--webgl` build flag on `build.mjs` and `scripts/build-examples.mjs`.
- Land by default: the world stands on a procedural terrain apron (`?ground=1` seats the plinth on the ground, `?ground=2` buries it flush to the deck) with fog that adapts to the scene size, while `?ground=0` keeps the historic floating slab in the void.
- Building detail pass: every structure big enough earns a roof (parapets, HVAC units, hatch, skylights, one antenna), a facade (window row, lit door, downpipe, conduit) and weathering streaks.
- Physical part signs: each label is a post-mounted framed paper board with engraved text, batched into one atlas, that crossfades against the HUD chip by on-screen size.
- First-person walking: `V` (or the HUD button) toggles the mode, `WASD` walks, `Shift` runs, the mouse looks, with collision, a 0.7-unit step-up, head-bob and a run FOV shift.
- GTA-style radar: a live top-down render of the slab (`M` toggles, `?map=1|0` pins it), a near-part info line, and a destination GPS — double-click a part to plan an A* route drawn on the radar and as a ground ribbon, with a distance chip.
- First-person capture aids: `?yaw=`, `?dest=` and `?fx`/`?fz=` place the walker and its look for a frozen shot.
- Deterministic isometric layout solver: `node scripts/layout.mjs draft.json --out scene.json` turns a draft of parts and links into an audit-clean scene.

### Changed

- SVG packet sparks and hot trails are now sine-wave based: a smooth traveling wave with a pulsing alpha, no hash jitter.
- `capture.mjs` supports WebGL pages: SwiftShader GL flags plus a `--budget` (default 10000) so `world.html` paints before the shot.
- `from-compose` orders services locale-independently, so a generated draft no longer depends on the host's collation.
