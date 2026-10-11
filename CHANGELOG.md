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
- Figure-dominant card: the card hugs the figure at `max-width: min(1160px, 94vw)` and fits the frame, so the diagram leads instead of floating in whitespace.
- Evals: test prompts and the properties a good answer must have.
- Concrete environments: a plate with `detail: "concrete"` renders joints, deterministic mottling and wear lanes so figures sit on a real ground.
- Surface detail: inset panels and screws, hazard striping and a hardware vocabulary (rack, tower, switch, tank, crate, pallet, coil) in `kit/iso.mjs`.
- Lighting: rim light, top sheen, contact ambient occlusion and depth fog layered over the four-tone materials.
- Grounding: masked floor reflections and soft/contact shadows tie every raised part to its plate.
- Links: connectors, collars, plugs and cable ties terminate tubes and cables.
- Flows: tapered motion trails follow each runtime packet, fading from the packet color, and are omitted under `prefers-reduced-motion`.
- Labels: sublabel chips add a second caption line under a part label.
