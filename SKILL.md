---
name: diorama
description: Turn a software system into a detailed, interactive isometric figure: a standalone HTML page with SVG solids, animated flows, hover tracing, a live readout, both themes, and a geometry audit, for docs and READMEs. Use when asked for an architecture diagram, system or infrastructure diagram, isometric illustration, exploded view, or an interactive figure of a stack, including one described by a docker-compose file. Not for sequence diagrams, ER diagrams, UML, or Mermaid-style flowcharts: diorama renders systems and machines as isometric scenes.
---

# Diorama

Turn a software system into a living isometric figure: one self-contained HTML page that
renders as a full-bleed animated world — a plinth on procedural land under a glass HUD, with
`?ground=0` restoring the historic floating slab in an atmospheric void — draws the real stack
as SVG solids, threads animated flows through it, and passes a mechanical geometry audit
before it ships.

## Workflow

1. **Gather facts first.** Read the actual config — docker-compose, Kubernetes manifests,
   Terraform, or the repository — or ask the user. List the real services, replicas, ports,
   stores and traffic paths. **The scene is invented; the facts are not.** Never invent a
   service or a number. Real numbers belong in the readout, never on the boxes.
2. **Plan the scene.** Aim for 12–30 solids, one ground plate, exactly one accent part, 2–4
   flows (speed 8–16 loops/min), and a readout of 2–3 real numbers. Keep labels to short
   nouns. Choose the theme per destination: light by default, dark for dark pages.
3. **Write `scene.json`** against the Scene JSON v1 schema (see the schema and color tokens in
   `KIT.md`). To skip hand-placing coordinates, write a draft of parts and links instead and run
   `node scripts/layout.mjs draft.json --out scene.json`, which emits an audit-clean scene (see
   `references/compose.md`). Minimal working shape:

   ```json
   {
     "version": 1,
     "title": "Three-tier web app",
     "subtitle": "nginx to Node API to Postgres",
     "theme": "light",
     "size": [1200, 800],
     "parts": [
       { "id": "web", "kind": "box", "label": "nginx", "at": [0, 0, 0], "size": [3, 3, 2.4], "color": "blue", "accent": true },
       { "id": "api", "kind": "box", "label": "API", "at": [6, 0, 0], "size": [3, 3, 2.8], "color": "steel" },
       { "id": "db", "kind": "cylinder", "label": "Postgres", "at": [12, 0, 0], "radius": 1.6, "h": 3, "axis": "z", "color": "amber" }
     ],
     "links": [
       { "from": "web", "to": "api", "kind": "tube", "color": "slate" },
       { "from": "api", "to": "db", "kind": "cable", "color": "copper" }
     ],
     "flows": [
       { "path": ["web", "api", "db"], "kind": "request", "color": "blue", "speed": 12, "count": 3 }
     ],
     "readout": [
       { "label": "Replicas", "value": "3" },
       { "label": "p95", "value": "84 ms" }
     ]
   }
   ```

4. **Build and audit.** Run `node build.mjs <scene.json> --audit` and iterate until it reports
   zero violations. This step is not optional. Fix codes: `LINK_OFF_ANCHOR`,
   `TUBE_THROUGH_SOLID`, `DEPTH_INVERSION` (details in `references/verify.md`).
5. **Verify visually.** Capture the page with
   `node scripts/capture.mjs <page.html> preview.png --t 2.5 --w 1280 --h 960` and **read the
   PNG like a critic**: the plinth should sit convincingly on its land (or float in the void
   under `?ground=0`) with atmosphere on all four sides — check overlaps, floating ends,
   unreadable labels, busy flows, crowding. Fix and repeat. A figure ships only after you have
   looked at it.
6. **Deliver.** GitHub and READMEs cannot render the standalone HTML, so the default artifact is a
   captured PNG: run the step-5 `scripts/capture.mjs` at the destination size and ship that image,
   with the built HTML as the interactive extra and a link next to it (hover traces links;
   `?t=<seconds>` freezes a frame, `?frame=1` gives a framed embed). The build still emits the
   standalone HTML — `--webgl` adds `world.html`, the same scene as a three.js WebGL world beside
   the SVG `index.html` (land by default, `?ground=0` for the void, with first-person walking and
   a radar/GPS), and `--svg out.svg` writes a lone static SVG — and produce both themes
   when asked.

## Quickstart from docker-compose

```sh
node scripts/from-compose.mjs docker-compose.yml --out scene.json
```

That writes a best-effort first draft. Refine it by hand (see `references/compose.md`), then
build and audit as above.

## Commands

```sh
node build.mjs <scene.json> [--theme light|dark] [--svg out.svg] [--webgl] [--audit] [-o out.html]
node scripts/layout.mjs <draft.json> --out <scene.json> [--theme light|dark]
node scripts/capture.mjs <page.html> <out.png> [--t seconds] [--w cssW] [--h cssH] [--zoom 2]
node kit/audit.mjs <scene.json>
node scripts/build-examples.mjs [--svg] [--webgl] [--audit] [--theme light|dark]
```

## Requirements

- **Node 20.10+.** Built-ins only: nothing to `npm install`.
- **Chrome or Chromium** for the capture check (found automatically, or set `CHROME_PATH`).
- **No three.js install.** `world.html` inlines three.js r169, so both pages stay standalone and offline.

## Limits

- Draws systems and machines, not people or maps.
- The WebGL `world.html` needs a WebGL-capable browser; the SVG `index.html` does not.
- Slow on purpose: a real figure is a real session — name the parts, lay out the world, build,
  audit, and look.
- React/framework output is roadmap; the deliverable today is standalone HTML.

## House rules

- Zero runtime dependencies; `node:` builtins only; never reach the network.
- Kit sources ship without comments because they are inlined into the HTML; world sources may
  document non-obvious rendering behavior. English everywhere; no emojis.
- Deterministic output: no `Date.now`, no `Math.random` in render paths; byte-identical
  rebuilds.

## Gallery

`examples/` holds five worked scenes — a light three-tier web stack, a dark Kafka pipeline, a
light Kubernetes CI stack, a dark reverse-engineering provider set and a light modding pipeline —
each with its `scene.json`, built page and screenshot.
