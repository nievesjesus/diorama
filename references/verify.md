# Verify — audit, then look

A figure ships after two gates: the mechanical audit says the geometry is sound, and your own
eyes say the picture reads. Neither gate alone is enough.

## Gate 1 — the geometry audit

```sh
node build.mjs <scene.json> --audit
```

The build fails on any violation. You can also run the audit alone:

```sh
node kit/audit.mjs <scene.json>
```

It prints `OK` and exits 0, or one line per violation and exits 1. Exit 2 means the file could
not be read or parsed. Iterate until zero violations.

Warnings are advisory: they print to stderr (prefixed `WARNING:`) and the audit still exits 0.

### Codes and fixes

**`LINK_OFF_ANCHOR`** — a link does not meet a part. Three causes: `from`/`to` names a part that
does not exist; an explicit `fromPort`/`toPort` is not one of the six ports; or a resolved
endpoint drifted off every anchor. Fix by **snapping ports**: use the real part id, and pick a
named port (`top`, `bottom`, `north`, `south`, `east`, `west`) that actually faces the other part.
When you leave a port unspecified, the nearest port is chosen automatically — the fix is usually
to give the parts enough air that the auto-picked port faces the right way, or to set it explicitly.

**`TUBE_THROUGH_SOLID`** — a link's segment crosses a part between its two endpoints. Fix by
**routing around or moving parts**: raise the flow over the obstacle by attaching it to a `top`
port, drop it under via `bottom`, or move the parts so the path clears every other solid's box. A
tube runs straight between its ports; a cable sags below the straight line as a sampled polyline
(`linkPoints` in `kit/iso.mjs`), so raising a cable's endpoints is the usual fix.

**`SOLID_OVERLAP`** — two solids genuinely interpenetrate in world space (their axis-aligned boxes
overlap on all three axes by more than a small epsilon). Resting on a plate or on top of another
solid is **not** an overlap: shared faces and tangency are fine, and plates may not overlap other
plates. Fix with **air**: move the shorter part until the touching faces just meet, or shrink it so
it butts the other instead of crossing it.

**`FLOATING`** — a non-plate solid is not supported. Every solid must sit with its base at the top
of the ground plate, a raised plate, or another solid whose footprint overlaps its base footprint.
Fix by **dropping the part onto its support**: set its base `z` to the supporting surface's top
face, or move it so its footprint sits over that surface.

**`LABEL_OVERLAP`** — two projected label chips intersect on screen. Fix by **giving the labels
room**: move one part so its top face projects clear of the other, or shorten the labels (shorter
text is a narrower chip). The audit measures the same chip boxes the renderer draws.

**`DEPTH_INVERSION`** — two solids overlap on screen and share the same depth key, so the painter's
order is ambiguous and one may paint over the other incorrectly. Fix by **separating the equal
depth keys**: nudge one part in `x`, `y` or `z` so its `x + y + z` differs, or increase the gap
until their projected footprints no longer overlap. Equal depth is fine as long as the footprints
do not overlap.

### Warnings

- `MULTIPLE_ACCENTS` — more than one part sets `accent: true`. One accent per subject: replica sets
  and partition groups may share a single accent (Kafka's three partitions are one intended
  subject), but unrelated subjects must not compete. Clear the extra accents.

### Other codes

- `EMPTY_SCENE` — the scene is not an object, or it declares no parts. Add parts.
- `DUPLICATE_ID` — two parts share an `id`. Make every `id` unique.
- `UNKNOWN_REFERENCE` — a part has no usable `id`, or a flow `path` / note `at` names a part that
  does not exist. Point it at a real id.
- `AUDIT_PARTIAL` — `kit/iso.mjs` was unavailable, so only the structural checks ran. Repair the
  kit and re-run; do not ship on a partial audit.

## Gate 2 — capture and read the PNG

```sh
node scripts/capture.mjs <page.html> preview.png --t 2.5 --w 1280 --h 960
```

Capture works the same for `index.html` (the SVG page) and `world.html` (the three.js WebGL world).

Flags:

- `--w` / `--h` — the **CSS viewport** (default 1280×960). This is the layout size, not the image size.
- `--zoom` — the **device scale factor** (default 2). The PNG is `W*zoom × H*zoom`, i.e. Retina-sharp,
  with the **same CSS layout** as a 1× run.
- `--t` — freezes the runtime at that many seconds, appended as `?t=<value>`. Use it to capture a
  clean frame instead of whatever instant the shot lands on.
- `--budget` — the **virtual time budget** in milliseconds (default 10000), long enough for a WebGL
  page to paint before the compositor commits. Raise it if a heavy `world.html` capture returns before
  the canvas is drawn.
- `?frame=1` — use it in the URL when capturing an embed-style framed shot (body padding + rounded
  border); default is full-bleed otherwise. This is the SVG page's mode; `world.html` has no frame.

**Other query params need a full `file://` URL.** `capture.mjs` converts a plain path with
`pathToFileURL`, so a `?` inside a plain-path argument is percent-encoded to `%3F` and the params are
lost. Pass the whole URL instead, and `--t` is appended after it correctly:

```sh
node scripts/capture.mjs "file:///abs/path/world.html?cam=top&env=city" preview.png --t 2.5
```

`world.html` renders through SwiftShader software GL under headless Chrome (the
`--use-angle=swiftshader` flag default), so its canvas reads dimmer and softer than the live page on a
real GPU — judge composition and features from the capture, not exact color.

Chrome is found automatically (`$CHROME_PATH`, then platform paths, then the Playwright cache).
Exit 3 means no Chrome was found.

**Read the PNG like a critic.** Look for:

- **Overlaps** — two solids merging into one silhouette (add air).
- **Floating ends** — a tube or cable that stops short of a part (snap the port).
- **Unreadable labels** — text too small or clipped against a face (shorten the label).
- **Busy flows** — too many dots, too fast (cut count, slow the speed).
- **Slab framing** — the slab should float with visible atmosphere on all four sides, not touch the frame
  edges. Crowding means parts or labels colliding, not empty void (retune `size` or move parts).
- **Cropping** — anything cut off by the viewport.

Fix, rebuild, and capture again. Repeat until it reads.

## Deterministic rebuild

The render path is deterministic, so the same scene must produce byte-identical output. Prove it:

```sh
node build.mjs scene.json -o a.html && node build.mjs scene.json -o b.html && cmp a.html b.html
```

`world.html` rebuilds byte-identically too: `--webgl` concatenates three.js and the runtime into one
deterministic bundle, so it passes the same check. Build both and compare both:

```sh
node build.mjs scene.json -o a.html --webgl --webgl-out a-world.html \
  && node build.mjs scene.json -o b.html --webgl --webgl-out b-world.html \
  && cmp a.html b.html && cmp a-world.html b-world.html
```

`cmp` printing nothing means a pass. Any difference is a determinism bug: look for a stray
`Date.now`, `Math.random`, or unordered iteration in a render path.
