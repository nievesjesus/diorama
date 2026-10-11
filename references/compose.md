# Compose — draft a scene from docker-compose

`scripts/from-compose.mjs` reads a docker-compose file and writes a first-draft `scene.json`. It
is a starting point, not a finished figure: the draft is heuristic, and a gallery-grade scene is
almost always refined by hand.

## Usage

```sh
node scripts/from-compose.mjs <docker-compose.yml> --out scene.json [--theme light|dark] [--title "My stack"]
```

Flags:

- `--out <file>` — where to write the scene JSON.
- `--theme <light|dark>` — the scene theme (defaults to light if omitted).
- `--title <string>` — the scene title (defaults to a title derived from the file).

The generated file validates against Scene JSON v1, so it can be fed straight to
`node build.mjs scene.json --audit`.

## Supported subset

Only the structural facts that matter for a diagram are read. Everything else in the compose file
is ignored:

| key | used for |
|-----|----------|
| `services` | the parts of the scene |
| `image` (per service) | the color token of the part |
| `ports` | readout numbers |
| `depends_on` | links and the flow path |
| `deploy.replicas` | replica counts in the readout |
| `networks` | grouping / labels |

Ignored: volumes, environment, command, healthcheck, build, secrets, configs, profiles, and any
other key. If a fact is not in the table above, it does not reach the draft.

## What the draft does

The heuristic is deliberately simple:

- **Tiers by dependency depth** — services with no `depends_on` sit near the front; each further
  hop of dependencies moves a tier back.
- **Color by image keyword** — the image name picks the token (a database/`postgres`/`mysql` image
  reads as `amber`, a queue/`kafka`/`redis` image as `copper` or `plum`, app images as `blue` or
  `steel`).
- **One ground plate** under the whole world.
- **One flow** along the longest dependency path.
- **Readout counts** — replica totals and port counts from the service list.

## Limits

- It is **best-effort**: a compose file describes containers, not traffic. Names, tiers and colors
  are guesses from keywords, and it cannot know which services talk to each other beyond
  `depends_on`.
- The single flow follows one path; real systems branch, and the draft will not show that.
- Scaling and placement are mechanical; spacing is unlikely to be gallery-grade.

## Refining the draft by hand

Turn the draft into a figure:

1. **Rename and label** parts with the real service names; delete compose noise.
2. **Fix the color roles** using `references/craft.md` — one accent on the subject, materials by role.
3. **Rework the layout**: space solids by at least 2.5 grid air, space tiers along the data-flow
   direction, and give every part room to sit on the plate.
4. **Replace the single flow** with the real traffic: 2–4 flows at calm speeds (8–16), and add the
   links they follow.
5. **Make the readout honest**: real replica counts, ports, latencies pulled from the config or the
   user. Never invent a number.
6. **Bump the size** so the title and all parts fit with margin.
7. **Audit and look**: `node build.mjs scene.json --audit`, then capture and read the PNG
   (`references/verify.md`).
