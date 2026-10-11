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

### Codes and fixes

**`LINK_OFF_ANCHOR`** — a link does not meet a part. Three causes: `from`/`to` names a part that
does not exist; an explicit `fromPort`/`toPort` is not one of the six ports; or a resolved
endpoint drifted off every anchor. Fix by **snapping ports**: use the real part id, and pick a
named port (`top`, `bottom`, `north`, `south`, `east`, `west`) that actually faces the other part.
When you leave a port unspecified, the nearest port is chosen automatically — the fix is usually
to give the parts enough air that the auto-picked port faces the right way, or to set it explicitly.

**`TUBE_THROUGH_SOLID`** — a link's segment crosses a part between its two endpoints. Fix by
**routing around or moving parts**: raise the flow over the obstacle by attaching it to a `top`
port, drop it under via `bottom`, or move the parts so the straight path clears every other solid's
box. Links are straight port-to-port segments, so an endpoint change is often the whole fix.

**`DEPTH_INVERSION`** — two solids overlap on screen and share the same depth key, so the painter's
order is ambiguous and one may paint over the other incorrectly. Fix by **separating the equal
depth keys**: nudge one part in `x`, `y` or `z` so its `x + y + z` differs, or increase the gap
until their projected footprints no longer overlap. Equal depth is fine as long as the footprints
do not overlap.

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

Flags:

- `--w` / `--h` — the **CSS viewport** (default 1280×960). This is the layout size, not the image size.
- `--zoom` — the **device scale factor** (default 2). The PNG is `W*zoom × H*zoom`, i.e. Retina-sharp,
  with the **same CSS layout** as a 1× run.
- `--t` — freezes the runtime at that many seconds, appended as `?t=<value>`. Use it to capture a
  clean frame instead of whatever instant the shot lands on.
- `?frame=1` — use it in the URL when capturing an embed-style framed shot (body padding + rounded
  border); default is full-bleed otherwise.

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

`cmp` printing nothing means a pass. Any difference is a determinism bug: look for a stray
`Date.now`, `Math.random`, or unordered iteration in a render path.
