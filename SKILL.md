---
name: diorama
description: Turn a software system into a detailed, interactive isometric figure — a standalone HTML page with SVG solids, animated flows, hover tracing, a live readout, light and dark themes, and a geometry audit — for docs, READMEs, blog posts and landing pages. Use when asked for an architecture diagram, system or infrastructure diagram, isometric illustration, exploded view, or an interactive figure of a stack described by a docker-compose file, kubernetes manifests, terraform, or plain text.
---

# Diorama

Turn a software system into a living isometric figure: one self-contained HTML page that
renders as a full-bleed animated world — a floating slab in an atmospheric void under a glass
HUD — draws the real stack as SVG solids, threads animated flows through it, and passes a
mechanical geometry audit before it ships.

## Workflow

1. **Gather facts first.** Read the actual config — docker-compose, Kubernetes manifests,
   Terraform, or the repository — or ask the user. List the real services, replicas, ports,
   stores and traffic paths. **The scene is invented; the facts are not.** Never invent a
   service or a number. Real numbers belong in the readout, never on the boxes.
2. **Plan the scene.** Aim for 12–30 solids, one ground plate, exactly one accent part, 2–4
   flows (speed 8–16 loops/min), and a readout of 2–3 real numbers. Keep labels to short
   nouns. Choose the theme per destination: light by default, dark for dark pages.
3. **Write `scene.json`** against the Scene JSON v1 schema (see the schema and color tokens in
   `KIT.md`). Minimal working shape:

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
   PNG like a critic**: the slab should float with atmosphere on all four sides — check overlaps,
   floating ends, unreadable labels, busy flows, crowding. Fix and repeat. A figure ships only
   after you have looked at it.
6. **Deliver.** The build emits a standalone HTML file that works from a double-click, with no
   network and no external assets: it renders as a full-bleed animated world — a floating slab in
   an atmospheric void under a glass HUD. Hover to trace links; append `?t=<seconds>` to freeze a
   frame and `?frame=1` for a framed embed. Add `--webgl` and the build also writes `world.html`,
   the same scene as a three.js WebGL world beside the SVG `index.html`. Add `--svg out.svg` for a
   lone static SVG, or capture a PNG. Produce both themes when asked.

## Quickstart from docker-compose

```sh
node scripts/from-compose.mjs docker-compose.yml --out scene.json
```

That writes a best-effort first draft. Refine it by hand (see `references/compose.md`), then
build and audit as above.

## Commands

```sh
node build.mjs <scene.json> [--theme light|dark] [--svg out.svg] [--webgl] [--audit] [-o out.html]
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
- No comments in code; English everywhere; no emojis.
- Deterministic output: no `Date.now`, no `Math.random` in render paths; byte-identical
  rebuilds.

## Gallery

`examples/` holds three worked scenes — a light three-tier web stack, a dark Kafka pipeline and
a light Kubernetes CI stack — each with its `scene.json`, built page and screenshot.
