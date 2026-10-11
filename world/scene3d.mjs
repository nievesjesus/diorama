// world/scene3d.mjs — pure scene JSON v1 -> 3D world model.
//
// No DOM, no three.js, no clock, no randomness: the same scene always maps to
// the same model, which is what makes `?t=` captures reproducible. The runtime
// (world/runtime.mjs) turns this plain model into meshes.
//
// Coordinate change: scene JSON is z-up isometric grid space; the 3D world is
// y-up (three.js). A scene point [x, y, z] becomes [x - cx, z, y - cz] so the
// slab sits centred on the origin with its top near y = 0.

const WORLD_PORTS = ['top', 'bottom', 'north', 'south', 'east', 'west'];

// Side ports only: auto-routing never plugs into a lid, because the riser
// down to the run height would have to pass through the part itself.
const WORLD_SIDE_PORTS = ['north', 'south', 'east', 'west'];

// Outward normal of each port in world space. Scene y maps to world z, so the
// scene's north face (minimum y) points at -z.
const WORLD_PORT_NORMAL = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
  top: [0, 0],
  bottom: [0, 0],
};

const WORLD_FAMILY = {
  steel: 'metal',
  slate: 'metal',
  cloud: 'metal',
  blue: 'plastic',
  green: 'plastic',
  plum: 'plastic',
  amber: 'plastic',
  brick: 'plastic',
  copper: 'warm',
  sand: 'warm',
  ink: 'neutral',
  paper: 'neutral',
};

const WORLD_BASE = {
  light: {
    ink: '#32363d',
    paper: '#ece5d6',
    steel: '#8796a4',
    slate: '#4d5b6c',
    amber: '#d7a442',
    copper: '#b87950',
    blue: '#46799f',
    green: '#608968',
    brick: '#b55a4b',
    plum: '#795780',
    sand: '#cebb92',
    cloud: '#c1c9d2',
  },
  dark: {
    ink: '#b9c3cf',
    paper: '#3e444c',
    steel: '#6f7c8a',
    slate: '#424d5a',
    amber: '#c99b43',
    copper: '#b0744b',
    blue: '#456f96',
    green: '#567e60',
    brick: '#a85449',
    plum: '#745282',
    sand: '#b8a37d',
    cloud: '#4d5661',
  },
};

// Tuning constants. Every one of these is a plain number so the mapping stays
// a pure function of (scene, theme).
export const WORLD_TUNING = {
  slabThickness: 1.2,
  slabPad: 0.6,
  // Cables are ground infrastructure, not a canopy: every run holds a single
  // low height, below the tops of the machines it serves.
  cableRun: 1.45,
  cableRadius: 0.082,
  // Cables leave a port along its outward normal before turning, which keeps
  // the riser off the face it is plugged into and gives the collar somewhere
  // to sit.
  portOffset: 0.34,
  // Half-width a run must keep from any solid it is not connected to.
  clearMargin: 0.45,
  // Poles appear at elbows and on long straight runs, nowhere else.
  poleSpan: 12,
  poleSlide: 1.5,
  poleLift: 0.5,
  poleClear: 0.6,
  sagRatio: 0.08,
  sagMax: 0.55,
};

// ------------------------------------------------------- texture pure helpers

// One texture tile per this many world units. Every part is UV-remapped to
// this density so a 2-unit crate and a 14-unit slab show seams and grain at
// the same physical scale instead of each stretching one tile over its face.
export const WORLD_TEXEL = 2.4;

// FNV-1a over the id string. Shared with the runtime so a part's texture
// variation is decided once, in a pure function, and never by Math.random.
export function hashToken(text) {
  let hash = 2166136261;
  const value = String(text);
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Per-part albedo lightness multiplier in [0.97, 1.03], from the part id.
 * Twelve tokens over twenty parts reads as a paint-by-numbers diagram; a
 * sub-percent wobble per unit breaks that up without inventing new colours.
 */
export function partLightness(id) {
  const steps = hashToken(id) % 601; // 0 .. 600
  return world_round(0.97 + steps / 10000);
}

/**
 * Per-face UV scale for a BoxGeometry of world size [w, h, d].
 * Returned in three's material/face order: +x, -x, +y, -y, +z, -z. Each face
 * reports [su, sv] = (face width / texel, face height / texel).
 */
export function uvScaleForBox(size, texel = WORLD_TEXEL) {
  const w = Math.abs(Number(size[0]) || 0);
  const h = Math.abs(Number(size[1]) || 0);
  const d = Math.abs(Number(size[2]) || 0);
  const unit = texel > 0 ? texel : WORLD_TEXEL;
  const x = [world_round(d / unit), world_round(h / unit)]; // +x / -x span depth x height
  const y = [world_round(w / unit), world_round(d / unit)]; // +y / -y span width x depth
  const z = [world_round(w / unit), world_round(h / unit)]; // +z / -z span width x height
  return [x, x.slice(), y, y.slice(), z, z.slice()];
}

/**
 * Scale a BoxGeometry uv buffer in place-free fashion: BoxGeometry lays out
 * six four-vertex faces in material order, so vertices 0..3 belong to face 0
 * and so on. Returns a new flat array; the input is never mutated, which is
 * what makes this testable without three.js.
 */
export function remapBoxUv(uv, size, texel = WORLD_TEXEL) {
  const scales = uvScaleForBox(size, texel);
  const out = Array.from(uv, Number);
  const verticesPerFace = out.length / 2 / scales.length;
  for (let face = 0; face < scales.length; face += 1) {
    const [su, sv] = scales[face];
    for (let vertex = 0; vertex < verticesPerFace; vertex += 1) {
      const at = (face * verticesPerFace + vertex) * 2;
      if (at + 1 >= out.length) break;
      out[at] = world_round(out[at] * su);
      out[at + 1] = world_round(out[at + 1] * sv);
    }
  }
  return out;
}

/**
 * UV repeat for a cylinder side wall: u wraps the circumference, v climbs the
 * height, both at the shared texel density, so a tall drum gets more ring
 * seams than a squat one instead of a stretched single tile.
 */
export function cylinderUvScale(radius, height, texel = WORLD_TEXEL) {
  const unit = texel > 0 ? texel : WORLD_TEXEL;
  return {
    u: world_round(Math.max(1, (2 * Math.PI * Math.abs(Number(radius) || 0)) / unit)),
    v: world_round(Math.max(1, Math.abs(Number(height) || 0) / unit)),
  };
}

// Which albedo variant a part gets. Grime streaks only make sense where a unit
// actually vents or racks hot air, so a plain crate keeps a clean skin and the
// two variants stay visibly different instead of repeating one pattern.
export function textureVariant(part) {
  const decor = part || {};
  return decor.vents === true || decor.detail === 'rack' ? 'detail' : 'plain';
}

/**
 * The cache key + paint parameters for one shared surface texture. Pure and
 * stable: the same (token, finish, theme, variant) always produces the same
 * descriptor, which is what lets the runtime cache by key and what makes a
 * `?t=` capture byte-identical across runs.
 */
export function textureDescriptor(token, finish, theme, variant = 'plain') {
  const family = finish === 'metal' || finish === 'warm' || finish === 'plastic' ? finish : 'plastic';
  const mode = variant === 'detail' ? 'detail' : 'plain';
  const lit = theme === 'dark' ? 'dark' : 'light';
  return {
    key: `albedo:${family}:${mode}`,
    family,
    variant: mode,
    theme: lit,
    token: String(token),
    size: 256,
    // Panel seams every 96px of a 256px tile: 0.9 world units at the shared
    // texel density, which is about the size of a real equipment panel.
    panelStep: 96,
    grain: family === 'plastic' ? 'speckle' : family === 'warm' ? 'crosshatch' : 'brushed',
    wear: 0.04,
    grime: 0.05,
    streaks: mode === 'detail' ? 4 : 0,
    bumpScale: family === 'plastic' ? 0.03 : 0.05,
  };
}

function world_isFinite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function world_vec3(value, fallback = [0, 0, 0]) {
  if (!Array.isArray(value) || value.length < 3) return fallback.slice();
  return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
}

export function themeOf(scene) {
  return scene && scene.theme === 'dark' ? 'dark' : 'light';
}

export function tokenHex(token, theme) {
  const table = WORLD_BASE[theme === 'dark' ? 'dark' : 'light'];
  return table[token] || table.steel;
}

export function finishOf(token) {
  return WORLD_FAMILY[token] || 'plastic';
}

function world_prismSize(part) {
  const size = Array.isArray(part.size) ? part.size : [];
  const w = size.length > 0 ? Number(size[0]) : 1;
  const d = size.length > 1 ? Number(size[1]) : 1;
  const fallback = part.kind === 'plate' ? 0.2 : 1;
  const h = size.length > 2 ? Number(size[2]) : fallback;
  return [w, d, h];
}

// Port anchors in scene space. Mirrors kit/iso.mjs anchors() so links land on
// the same spots as the SVG renderer; kept local so the bundle does not need
// the whole SVG kit.
export function sceneAnchors(part) {
  if (!part || !Array.isArray(part.at)) throw new Error('sceneAnchors requires a part with "at"');
  const [x, y, z] = world_vec3(part.at);
  if (part.kind === 'box' || part.kind === 'plate') {
    const [w, d, h] = world_prismSize(part);
    return {
      top: [x + w / 2, y + d / 2, z + h],
      bottom: [x + w / 2, y + d / 2, z],
      north: [x + w / 2, y, z + h / 2],
      south: [x + w / 2, y + d, z + h / 2],
      east: [x + w, y + d / 2, z + h / 2],
      west: [x, y + d / 2, z + h / 2],
    };
  }
  if (part.kind === 'cylinder') {
    const r = Number(part.radius);
    const h = Number(part.h);
    const axis = part.axis == null ? 'z' : part.axis;
    if (axis === 'z') {
      return {
        top: [x, y, z + h],
        bottom: [x, y, z],
        north: [x, y - r, z + h / 2],
        south: [x, y + r, z + h / 2],
        east: [x + r, y, z + h / 2],
        west: [x - r, y, z + h / 2],
      };
    }
    if (axis === 'x') {
      return {
        top: [x + h / 2, y, z + r],
        bottom: [x + h / 2, y, z - r],
        north: [x + h / 2, y - r, z],
        south: [x + h / 2, y + r, z],
        east: [x + h, y, z],
        west: [x, y, z],
      };
    }
    return {
      top: [x, y + h / 2, z + r],
      bottom: [x, y + h / 2, z - r],
      north: [x, y, z],
      south: [x, y + h, z],
      east: [x + r, y + h / 2, z],
      west: [x - r, y + h / 2, z],
    };
  }
  throw new Error('unknown part kind: ' + String(part && part.kind));
}

// Scene-space axis-aligned footprint + height of a part.
export function sceneExtent(part) {
  const [x, y, z] = world_vec3(part.at);
  if (part.kind === 'cylinder') {
    const r = Number(part.radius);
    const h = Number(part.h);
    const axis = part.axis == null ? 'z' : part.axis;
    if (axis === 'z') return { min: [x - r, y - r, z], max: [x + r, y + r, z + h] };
    if (axis === 'x') return { min: [x, y - r, z - r], max: [x + h, y + r, z + r] };
    return { min: [x - r, y, z - r], max: [x + r, y + h, z + r] };
  }
  const [w, d, h] = world_prismSize(part);
  return { min: [x, y, z], max: [x + w, y + d, z + h] };
}

function world_center(extent) {
  return [
    (extent.min[0] + extent.max[0]) / 2,
    (extent.min[1] + extent.max[1]) / 2,
    (extent.min[2] + extent.max[2]) / 2,
  ];
}

function world_footprintArea(extent) {
  return (extent.max[0] - extent.min[0]) * (extent.max[1] - extent.min[1]);
}

// The slab is the ground plate the diorama floats on. A scene usually marks it
// with detail:"concrete"; otherwise the widest flat plate wins, and a scene
// with no plate at all gets a synthetic slab around everything.
export function pickSlab(parts) {
  const plates = parts.filter((part) => part.kind === 'plate');
  const concrete = plates.filter((part) => part.detail === 'concrete');
  const pool = concrete.length ? concrete : plates;
  let best = null;
  let bestArea = 0;
  for (const part of pool) {
    const area = world_footprintArea(sceneExtent(part));
    if (area > bestArea + 1e-9) {
      bestArea = area;
      best = part;
    }
  }
  if (!best) return null;
  // A slab must actually be a floor: at least as wide as half the scene.
  const all = parts.reduce(
    (acc, part) => {
      const extent = sceneExtent(part);
      acc.min[0] = Math.min(acc.min[0], extent.min[0]);
      acc.min[1] = Math.min(acc.min[1], extent.min[1]);
      acc.max[0] = Math.max(acc.max[0], extent.max[0]);
      acc.max[1] = Math.max(acc.max[1], extent.max[1]);
      return acc;
    },
    { min: [Infinity, Infinity], max: [-Infinity, -Infinity] },
  );
  const sceneArea = (all.max[0] - all.min[0]) * (all.max[1] - all.min[1]);
  if (sceneArea > 0 && bestArea < sceneArea * 0.35) return null;
  return best;
}

function world_decor(part) {
  return {
    vents: part.vents === true,
    leds: Number.isInteger(part.leds) ? Math.max(0, Math.min(6, part.leds)) : 0,
    hazard: part.hazard === true,
    panels: part.panels === true,
    detail: typeof part.detail === 'string' ? part.detail : 'none',
  };
}

function world_round(value) {
  // Six decimals is well under float32 precision and keeps the inlined JSON
  // byte-stable across platforms.
  return Math.round(value * 1e6) / 1e6;
}

function world_point(point) {
  return [world_round(point[0]), world_round(point[1]), world_round(point[2])];
}

function world_portCenter(ports, pool = WORLD_PORTS) {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let count = 0;
  for (const name of pool) {
    const point = ports[name];
    if (!point) continue;
    cx += point[0];
    cy += point[1];
    cz += point[2];
    count += 1;
  }
  if (!count) return [0, 0, 0];
  return [cx / count, cy / count, cz / count];
}

function world_nearestPort(ports, target, pool = WORLD_PORTS) {
  let best = pool[0];
  let bestDistance = Infinity;
  for (const name of pool) {
    const point = ports[name];
    if (!point) continue;
    const dx = point[0] - target[0];
    const dy = point[1] - target[1];
    const dz = point[2] - target[2];
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < bestDistance - 1e-12) {
      bestDistance = distance;
      best = name;
    }
  }
  return best;
}

// Plan-view route from a to b: run straight along the dominant axis, then a
// single 45-degree diagonal into the target. Reads like real cable tray runs
// and never produces the floating straight line of a naive tube.
export function routePlan(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const adx = Math.abs(dx);
  const adz = Math.abs(dz);
  const sx = dx < 0 ? -1 : 1;
  const sz = dz < 0 ? -1 : 1;
  const nodes = [[ax, az]];
  if (adx < 1e-6 && adz < 1e-6) return nodes;
  if (adx >= adz) {
    const run = adx - adz;
    if (run > 1e-6) nodes.push([ax + sx * run, az]);
  } else {
    const run = adz - adx;
    if (run > 1e-6) nodes.push([ax, az + sz * run]);
  }
  nodes.push([bx, bz]);
  return nodes;
}

function world_segmentsFrom(points, sagRatio, sagMax) {
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    // Risers (near vertical) and the short stub out of a port must not sag,
    // or the cable bows back into the face it is plugged into.
    const horizontal = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const sag = horizontal < 0.25 || length < 1 ? 0 : Math.min(sagMax, sagRatio * length);
    segments.push({ a: world_point(a), b: world_point(b), length: world_round(length), sag: world_round(sag) });
  }
  return segments;
}

/**
 * Does the plan-view segment a->b stay out of an axis-aligned rect, once the
 * rect is grown by `margin`? Liang-Barsky clip: no overlap means clear.
 */
export function segmentClears(ax, az, bx, bz, rect, margin) {
  const minX = rect.minX - margin;
  const maxX = rect.maxX + margin;
  const minZ = rect.minZ - margin;
  const maxZ = rect.maxZ + margin;
  const dx = bx - ax;
  const dz = bz - az;
  const edges = [
    [-dx, ax - minX],
    [dx, maxX - ax],
    [-dz, az - minZ],
    [dz, maxZ - az],
  ];
  let enter = 0;
  let exit = 1;
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return true; // parallel and outside this slab
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > exit) return true;
      if (r > enter) enter = r;
    } else {
      if (r < enter) return true;
      if (r < exit) exit = r;
    }
  }
  return false;
}

function world_pathClears(nodes, obstacles, margin) {
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const [ax, az] = nodes[index];
    const [bx, bz] = nodes[index + 1];
    for (const rect of obstacles) {
      if (!segmentClears(ax, az, bx, bz, rect, margin)) return false;
    }
  }
  return true;
}

/**
 * Candidate plan-view routes from a to b, best first: straight, then the two
 * run-plus-diagonal elbows, then the two square corners, then a handful of
 * sideways detours. Every candidate has at most one interior waypoint.
 */
export function routeCandidates(ax, az, bx, bz) {
  const candidates = [[[ax, az], [bx, bz]]];
  const push = (node) => {
    if (!Number.isFinite(node[0]) || !Number.isFinite(node[1])) return;
    if (Math.hypot(node[0] - ax, node[1] - az) < 1e-6) return;
    if (Math.hypot(node[0] - bx, node[1] - bz) < 1e-6) return;
    candidates.push([[ax, az], [node[0], node[1]], [bx, bz]]);
  };
  const plan = routePlan(ax, az, bx, bz);
  if (plan.length === 3) push(plan[1]);
  const mirrored = routePlan(bx, bz, ax, az);
  if (mirrored.length === 3) push(mirrored[1]);
  push([ax, bz]);
  push([bx, az]);
  const dx = bx - ax;
  const dz = bz - az;
  const span = Math.hypot(dx, dz) || 1;
  const nx = -dz / span;
  const nz = dx / span;
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  for (const reach of [1.8, -1.8, 3.4, -3.4, 5.2, -5.2]) {
    push([mx + nx * reach, mz + nz * reach]);
  }
  return candidates;
}

/** Pick the first candidate route that clears every obstacle. */
export function planRoute(ax, az, bx, bz, obstacles, margin) {
  const candidates = routeCandidates(ax, az, bx, bz);
  for (const nodes of candidates) {
    if (world_pathClears(nodes, obstacles, margin)) return nodes;
  }
  // Nothing clears: a straight run is the least chaotic way to be wrong.
  return candidates[0];
}

function world_polylineLength(points) {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return total;
}

/**
 * Map a validated scene JSON v1 object to a plain 3D world model.
 * Pure: same input, same output, no DOM and no clock.
 */
// --------------------------------------------------- environment: the place
//
// A diorama has to read as somewhere, not as parts on a tray. Two generated
// environments do that, and the scene's own size picks between them:
//
//   warehouse — a factory floor: painted safety language, a perimeter fence,
//               crates and pallets in the corners. Right for a compact scene.
//   city      — an industrial district: asphalt avenues through the free
//               corridors, curbs, sidewalks, lamp posts, shipping containers.
//               Right for a scene big enough to have streets between things.
//
// Everything below is pure: a plan is plain numbers, so the runtime only ever
// places what was already decided and a `?t=` capture stays byte-identical.

export const WORLD_ENV_MODES = ['auto', 'warehouse', 'city'];

export const WORLD_ENV_TUNING = {
  // --- auto-mode thresholds. A scene goes city when ANY of these trips: it
  // has enough machines to need streets between them, covers enough ground to
  // have lots, or is spread wide enough that the gaps read as blocks.
  cityParts: 18,      // parts >= this many
  cityArea: 260,      // total part footprint in u^2
  citySpread: 46,     // max pairwise |dx| + |dz| between part centres, in u

  // --- corridors (city). The slab is sampled on this grid; a free band has to
  // be at least corridorMin wide before it can carry a road.
  gridStep: 1,
  roadMargin: 1,      // keep-out around a part footprint
  corridorMin: 3.5,
  // ... and this long. A 4-unit slot between two machines is a gap, not a
  // street; below this the corridor is left as plain ground.
  corridorRun: 9,
  avenueMin: 3,       // asphalt width is clamped into [min, max]
  avenueMax: 4,
  avenuesPerAxis: 2,

  // --- street section (city)
  curbHeight: 0.09,
  curbWidth: 0.22,
  sidewalkWidth: 0.9,
  sidewalkJoint: 2,   // joint line every this many units
  crosswalkDepth: 1.6,
  lampSpacing: 7,     // inside the 6-8 the look asks for
  lampHeight: 2.6,
  lampArm: 0.5,
  lampHead: 0.22,
  bollardRadius: 0.1,
  bollardHeight: 0.5,
  bollardGap: 1.1,

  // --- warehouse floor
  safetyInset: 1.2,   // yellow perimeter line, in from the slab edge
  hazardCorner: 2.6,  // side of a hatched corner patch
  fencePostRadius: 0.12,
  fenceHeight: 1.2,
  fencePostGap: 3.2,
  fenceGate: 4,       // units of perimeter left open for the gate
  fenceInset: 0.45,

  // --- termini (city). Every avenue end is given a destination; these are the
  // reaches that decide which one. A gate wins over a bay, a bay over a
  // turning circle, and turnRadius >= gateReach is what makes the set total.
  gateReach: 2.2,     // an end this near the slab edge runs out and is gated
  bayReach: 2.2,      // ... or this near a part face docks against it
  turnRadius: 2.2,    // turning circle at a cul-de-sac
  turnClear: 2.5,     // open ground a turning circle needs ahead of it
  turnBollardSplay: 0.62,   // radians either side of the approach
  repairReach: 7,     // how far an orphaned end may be run out to the edge
  joinReach: 10,      // ... or run out to meet a street crossing ahead
  bayWidth: 2.4,
  gateSetback: 0.35,  // the gate line sits this far back from the lip
  gateArmHeight: 0.95,
  gateArmThickness: 0.14,
  gateArmBands: 6,    // alternating blocks per arm: real stripes, not a tile
  boothSize: [1.2, 1, 1.6],
  chevronBack: 1.4,   // the exit chevron, back from the gate line
  bumperHeight: 0.55,
  bumperThickness: 0.18,
  bumperDepth: 0.12,
  drivewayWidth: 1.4,
  drivewayMax: 3,     // how many building spurs the district gets
  drivewayReach: 7,   // a part further than this from the kerb gets none

  // --- warehouse circulation. No roads: one marked spine, and painted
  // walkways joining the gate and every machine to it.
  spineMin: 2,        // a corridor this wide can carry the spine
  spineRun: 6,        // ... and this long
  spineWalkWidth: 0.12,
  spineWalkGap: 0.5,

  // --- props (both modes)
  propClear: 0.6,     // clearance a prop keeps from anything solid
  propEdge: 0.9,      // and from the slab edge
};

// Deterministic 0..1 draw from a token: the environment's "random" choices are
// a pure function of the scene, so the same scene always builds the same place.
function envRand(token, index) {
  return (hashToken(`${token}#${index}`) % 100000) / 100000;
}

// Pick an integer in [lo, hi] from the same stream.
function envPick(token, index, lo, hi) {
  return lo + Math.floor(envRand(token, index) * (hi - lo + 1));
}

/** Plan-view footprint of a world part, as a rect. */
export function partRect(part, grow = 0) {
  return {
    id: part.id,
    minX: part.pos[0] - part.size[0] / 2 - grow,
    maxX: part.pos[0] + part.size[0] / 2 + grow,
    minZ: part.pos[2] - part.size[2] / 2 - grow,
    maxZ: part.pos[2] + part.size[2] / 2 + grow,
  };
}

function envOverlaps(a, b, margin = 0) {
  return a.minX - margin < b.maxX
    && a.maxX + margin > b.minX
    && a.minZ - margin < b.maxZ
    && a.maxZ + margin > b.minZ;
}

/** True when `rect` clears every rect in `others` by at least `margin`. */
export function rectClears(rect, others, margin = 0) {
  return others.every((other) => !envOverlaps(rect, other, margin));
}

function envRect(x, z, w, d) {
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
}

/**
 * The size numbers the auto heuristic reads. Spread is the widest pairwise
 * Manhattan gap between part centres: a tall stack of parts in one spot is a
 * machine, the same parts strung out across the slab is a district.
 */
export function envMetrics(parts) {
  let area = 0;
  let spread = 0;
  for (const part of parts) area += part.size[0] * part.size[2];
  for (let index = 0; index < parts.length; index += 1) {
    for (let other = index + 1; other < parts.length; other += 1) {
      const gap = Math.abs(parts[index].pos[0] - parts[other].pos[0])
        + Math.abs(parts[index].pos[2] - parts[other].pos[2]);
      if (gap > spread) spread = gap;
    }
  }
  return { parts: parts.length, area: world_round(area), spread: world_round(spread) };
}

/**
 * warehouse or city. An explicit request wins; "auto" trips to city as soon as
 * any one of the three size thresholds is met (>=, so the boundary itself is
 * already a city).
 */
export function pickEnvMode(requested, metrics, tuning = WORLD_ENV_TUNING) {
  if (requested === 'warehouse' || requested === 'city') return requested;
  if (metrics.parts >= tuning.cityParts) return 'city';
  if (metrics.area >= tuning.cityArea) return 'city';
  if (metrics.spread >= tuning.citySpread) return 'city';
  return 'warehouse';
}

/**
 * The slab's free ground, as a boolean grid sampled at `step`.
 *
 * A cell is free when it clears every part footprint by `margin`. This is the
 * one place the "where is there room" question is answered, so the corridors,
 * the furniture and the props all agree about what counts as empty.
 */
export function freeCells(footprint, rects, { step, margin }) {
  const cols = Math.max(0, Math.floor((footprint.maxX - footprint.minX) / step));
  const rows = Math.max(0, Math.floor((footprint.maxZ - footprint.minZ) / step));
  const free = new Uint8Array(cols * rows);
  for (let col = 0; col < cols; col += 1) {
    const x0 = footprint.minX + col * step;
    const x1 = x0 + step;
    for (let row = 0; row < rows; row += 1) {
      const z0 = footprint.minZ + row * step;
      const z1 = z0 + step;
      const cell = { minX: x0, maxX: x1, minZ: z0, maxZ: z1 };
      free[col * rows + row] = rects.some((rect) => envOverlaps(cell, rect, margin)) ? 0 : 1;
    }
  }
  return { step, cols, rows, minX: footprint.minX, minZ: footprint.minZ, free };
}

// The longest contiguous run of 1s in `mask`, as [fromIndex, toIndexExclusive].
function envLongestRun(mask, length) {
  let best = [0, 0];
  let from = -1;
  for (let index = 0; index <= length; index += 1) {
    const on = index < length && mask[index];
    if (on && from < 0) from = index;
    if (!on && from >= 0) {
      if (index - from > best[1] - best[0]) best = [from, index];
      from = -1;
    }
  }
  return best;
}

/**
 * Free corridors wide enough to carry a street.
 *
 * `along` is the axis the street runs down: 'z' means the band varies in x.
 * A corridor is grown one lane at a time while the ground that is still free
 * across the whole band keeps a run of at least `minRun` — so the street is
 * trimmed to the clear ground it actually has, and terminates at a building
 * instead of being dropped when the site has no edge-to-edge gap. Where a
 * full-span corridor does exist the run is the full span, unchanged.
 */
export function freeCorridors(grid, along, { minWidth, minRun }) {
  const lanes = along === 'z' ? grid.cols : grid.rows;
  const depth = along === 'z' ? grid.rows : grid.cols;
  const at = along === 'z'
    ? (lane, step) => grid.free[lane * grid.rows + step]
    : (lane, step) => grid.free[step * grid.rows + lane];
  const laneOrigin = along === 'z' ? grid.minX : grid.minZ;
  const stepOrigin = along === 'z' ? grid.minZ : grid.minX;
  const minLanes = Math.ceil(minWidth / grid.step - 1e-9);
  const minSteps = Math.ceil(minRun / grid.step - 1e-9);

  const corridors = [];
  let lane = 0;
  while (lane < lanes) {
    // Grow the band from `lane` while the ground common to every lane in it
    // still holds a long enough run.
    const common = new Uint8Array(depth);
    for (let step = 0; step < depth; step += 1) common[step] = 1;
    let end = lane;
    let bestRun = [0, 0];
    while (end < lanes) {
      let any = false;
      for (let step = 0; step < depth; step += 1) {
        if (common[step] && !at(end, step)) common[step] = 0;
        if (common[step]) any = true;
      }
      const run = any ? envLongestRun(common, depth) : [0, 0];
      if (run[1] - run[0] < minSteps) break;
      bestRun = run;
      end += 1;
    }
    const width = end - lane;
    if (width >= minLanes) {
      corridors.push({
        from: world_round(laneOrigin + lane * grid.step),
        to: world_round(laneOrigin + end * grid.step),
        width: world_round(width * grid.step),
        center: world_round(laneOrigin + ((lane + end) / 2) * grid.step),
        runFrom: world_round(stepOrigin + bestRun[0] * grid.step),
        runTo: world_round(stepOrigin + bestRun[1] * grid.step),
        run: world_round((bestRun[1] - bestRun[0]) * grid.step),
      });
      lane = end;
    } else {
      lane += 1;
    }
  }
  return corridors;
}

// Widest first; on a tie the one nearest the slab centre, then the lower edge.
// A total order, so the choice never depends on array order.
function envBandOrder(a, b) {
  if (b.width !== a.width) return b.width - a.width;
  if (b.run !== a.run) return b.run - a.run;
  const ca = Math.abs(a.center);
  const cb = Math.abs(b.center);
  if (ca !== cb) return ca - cb;
  return a.from - b.from;
}

/** The rect of asphalt an avenue covers. */
export function avenueRect(avenue) {
  const half = avenue.width / 2;
  if (avenue.along === 'z') {
    return { minX: avenue.center - half, maxX: avenue.center + half, minZ: avenue.from, maxZ: avenue.to };
  }
  return { minX: avenue.from, maxX: avenue.to, minZ: avenue.center - half, maxZ: avenue.center + half };
}

/** The rect of asphalt plus its curbs and sidewalks: the whole street section. */
export function streetRect(avenue, tuning = WORLD_ENV_TUNING) {
  const half = avenue.width / 2 + tuning.curbWidth + tuning.sidewalkWidth;
  if (avenue.along === 'z') {
    return { minX: avenue.center - half, maxX: avenue.center + half, minZ: avenue.from, maxZ: avenue.to };
  }
  return { minX: avenue.from, maxX: avenue.to, minZ: avenue.center - half, maxZ: avenue.center + half };
}

/**
 * Up to `avenuesPerAxis` avenues per axis, cut through the widest free
 * corridors. One avenue per band: two roads down the same corridor would
 * overlap, and a corridor only ever wants one street.
 */
export function planAvenues(footprint, blockers, tuning = WORLD_ENV_TUNING) {
  const grid = freeCells(footprint, blockers, { step: tuning.gridStep, margin: tuning.roadMargin });
  const options = { minWidth: tuning.corridorMin, minRun: tuning.corridorRun };
  const avenues = [];
  for (const along of ['z', 'x']) {
    const picked = freeCorridors(grid, along, options)
      .slice()
      .sort(envBandOrder)
      .slice(0, tuning.avenuesPerAxis);
    // Back into position order so the plan reads along the slab, not by score.
    picked.sort((a, b) => a.from - b.from);
    for (const band of picked) {
      // Asphalt plus its curbs stays inside the corridor, which is what keeps
      // a street off every part footprint. The sidewalks are paint and are
      // allowed to run out into the keep-out margin: that margin is exactly
      // the room a pavement needs to abut a building.
      const width = world_round(Math.min(
        tuning.avenueMax,
        Math.max(tuning.avenueMin, band.width - 2 * tuning.curbWidth),
      ));
      avenues.push({
        along,
        center: band.center,
        width,
        from: band.runFrom,
        to: band.runTo,
        band: { from: band.from, to: band.to, width: band.width, run: band.run },
      });
    }
  }
  return avenues;
}

/** Where two avenues cross: no center line, no joints, zebras on the approaches. */
export function planIntersections(avenues) {
  const crossings = [];
  for (const down of avenues.filter((avenue) => avenue.along === 'z')) {
    for (const across of avenues.filter((avenue) => avenue.along === 'x')) {
      // Both streets are trimmed to their clear run, so two of them only meet
      // if each one actually reaches the other's line.
      if (across.center < down.from || across.center > down.to) continue;
      if (down.center < across.from || down.center > across.to) continue;
      crossings.push({ x: down.center, z: across.center, w: down.width, d: across.width });
    }
  }
  return crossings;
}

// Curb and sidewalk strips flanking one avenue. The curb is a raised solid;
// the sidewalk is paint, clipped to the slab so it never hangs off the edge.
function envStreetEdges(avenue, footprint, tuning) {
  const half = avenue.width / 2;
  const curbs = [];
  const walks = [];
  const length = avenue.to - avenue.from;
  const mid = (avenue.from + avenue.to) / 2;
  for (const side of [-1, 1]) {
    const curbAt = avenue.center + side * (half + tuning.curbWidth / 2);
    const walkFrom = avenue.center + side * (half + tuning.curbWidth);
    const walkTo = walkFrom + side * tuning.sidewalkWidth;
    const lo = Math.min(walkFrom, walkTo);
    const hi = Math.max(walkFrom, walkTo);
    if (avenue.along === 'z') {
      curbs.push({
        pos: world_point([world_round(curbAt), tuning.curbHeight / 2, world_round(mid)]),
        size: world_point([tuning.curbWidth, tuning.curbHeight, world_round(length)]),
      });
      const clipLo = Math.max(lo, footprint.minX);
      const clipHi = Math.min(hi, footprint.maxX);
      if (clipHi - clipLo > 0.1) {
        walks.push({
          along: 'z',
          minX: world_round(clipLo),
          maxX: world_round(clipHi),
          minZ: world_round(avenue.from),
          maxZ: world_round(avenue.to),
        });
      }
    } else {
      curbs.push({
        pos: world_point([world_round(mid), tuning.curbHeight / 2, world_round(curbAt)]),
        size: world_point([world_round(length), tuning.curbHeight, tuning.curbWidth]),
      });
      const clipLo = Math.max(lo, footprint.minZ);
      const clipHi = Math.min(hi, footprint.maxZ);
      if (clipHi - clipLo > 0.1) {
        walks.push({
          along: 'x',
          minX: world_round(avenue.from),
          maxX: world_round(avenue.to),
          minZ: world_round(clipLo),
          maxZ: world_round(clipHi),
        });
      }
    }
  }
  return { curbs, walks };
}

// Lamp posts march down both sidewalks at a fixed pitch, the two sides
// staggered by half a pitch the way a real street is lit. Anything that would
// land in a junction or off the slab is skipped. Every second lamp carries a
// glow sprite, which only the dark theme ever shows.
function envLamps(avenues, crossings, footprint, tuning) {
  const lamps = [];
  const blocked = crossings.map((cross) => envRect(cross.x, cross.z, cross.w + 2.4, cross.d + 2.4));
  let ordinal = 0;
  for (const avenue of avenues) {
    const offset = avenue.width / 2 + tuning.curbWidth + tuning.sidewalkWidth * 0.55;
    const length = avenue.to - avenue.from;
    const count = Math.max(1, Math.floor(length / tuning.lampSpacing));
    for (const side of [-1, 1]) {
      // Half a pitch of stagger between the two pavements.
      const slack = length - (count - 1) * tuning.lampSpacing;
      const base = avenue.from + slack / 2 + (side < 0 ? 0 : tuning.lampSpacing / 2);
      for (let step = 0; step < count; step += 1) {
        const along = base + step * tuning.lampSpacing;
        if (along < avenue.from - 1e-9 || along > avenue.to + 1e-9) continue;
        const x = avenue.along === 'z' ? avenue.center + side * offset : along;
        const z = avenue.along === 'z' ? along : avenue.center + side * offset;
        if (x < footprint.minX + 0.3 || x > footprint.maxX - 0.3) continue;
        if (z < footprint.minZ + 0.3 || z > footprint.maxZ - 0.3) continue;
        if (blocked.some((rect) => envOverlaps(envRect(x, z, 0.4, 0.4), rect))) continue;
        lamps.push({
          pos: world_point([world_round(x), 0, world_round(z)]),
          height: tuning.lampHeight,
          arm: tuning.lampArm,
          head: tuning.lampHead,
          // The arm reaches out over the asphalt, so it points back at the road.
          armDir: avenue.along === 'z' ? [-side, 0] : [0, -side],
          glow: ordinal % 2 === 0,
        });
        ordinal += 1;
      }
    }
  }
  // Position order, so the plan does not depend on which side was walked first
  // and the glow alternation reads along the street.
  lamps.sort((a, b) => (a.pos[0] - b.pos[0]) || (a.pos[2] - b.pos[2]));
  lamps.forEach((lamp, index) => { lamp.glow = index % 2 === 0; });
  return lamps;
}

// Bollards guard the sidewalk corners at each crossing.
function envBollards(crossings, tuning) {
  const bollards = [];
  for (const cross of crossings) {
    const offX = cross.w / 2 + tuning.curbWidth + tuning.bollardGap;
    const offZ = cross.d / 2 + tuning.curbWidth + tuning.bollardGap;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        bollards.push({
          pos: world_point([world_round(cross.x + sx * offX), tuning.bollardHeight / 2, world_round(cross.z + sz * offZ)]),
          radius: tuning.bollardRadius,
          height: tuning.bollardHeight,
        });
      }
    }
  }
  return bollards;
}

/**
 * Candidate prop spots on the slab, periphery first.
 *
 * An empty lot is where a prop belongs, and the emptiest ground is at the
 * edges, so candidates are ordered by Manhattan distance from the slab centre,
 * descending. Ties break on x then z: a total order, so the same scene always
 * fills the same corners.
 */
export function propCandidates(footprint, tuning = WORLD_ENV_TUNING) {
  const step = tuning.gridStep;
  const spots = [];
  for (let x = footprint.minX + tuning.propEdge; x <= footprint.maxX - tuning.propEdge + 1e-9; x += step) {
    for (let z = footprint.minZ + tuning.propEdge; z <= footprint.maxZ - tuning.propEdge + 1e-9; z += step) {
      spots.push([world_round(x), world_round(z)]);
    }
  }
  spots.sort((a, b) => {
    const da = Math.abs(a[0]) + Math.abs(a[1]);
    const db = Math.abs(b[0]) + Math.abs(b[1]);
    if (db !== da) return db - da;
    if (a[0] !== b[0]) return a[0] - b[0];
    return a[1] - b[1];
  });
  return spots;
}

/**
 * Place `count` props of one kind on the first candidate spots that clear
 * everything already standing. Mutates `taken` so later kinds see earlier
 * props; returns the placed entries.
 */
export function placeProps(spots, taken, count, make, footprint, tuning = WORLD_ENV_TUNING) {
  const placed = [];
  if (count <= 0) return placed;
  for (const [x, z] of spots) {
    if (placed.length >= count) break;
    const prop = make(x, z, placed.length);
    if (!prop) continue;
    // A rotated prop sweeps its longer side on both axes.
    const turned = Math.abs(Math.abs(prop.rot || 0) - Math.PI / 2) < 1e-6;
    const w = turned ? prop.size[2] : prop.size[0];
    const d = turned ? prop.size[0] : prop.size[2];
    const rect = envRect(x, z, w, d);
    // The whole footprint has to land on the slab, not just the centre: the
    // candidate grid is inset by one prop-edge, and a water tower is wider.
    if (rect.minX < footprint.minX || rect.maxX > footprint.maxX) continue;
    if (rect.minZ < footprint.minZ || rect.maxZ > footprint.maxZ) continue;
    if (!rectClears(rect, taken, tuning.propClear)) continue;
    taken.push(rect);
    // The axis-aligned ground the prop actually occupies once turned, so every
    // later clearance test — and the runtime — reads one number, not a rotation.
    prop.foot = [world_round(w), world_round(d)];
    placed.push(prop);
  }
  return placed;
}

// Muted industrial container liveries. Not the token palette: a container is
// painted steel, and the scene's own colours belong to the machines.
const WORLD_CONTAINER_HUES = ['#8d4a3f', '#3f5f7d', '#436b4f', '#8a6a34'];
const WORLD_CRATE_HUE = '#9a7a4e';
const WORLD_BARREL_HUES = ['#6e7883', '#8a5a3c'];

/**
 * The warehouse floor: painted safety language, a perimeter fence with one
 * gate, and crates, pallets and barrels in whatever corners are free.
 */
export function planWarehouse(footprint, blockers, parts, tuning = WORLD_ENV_TUNING, token = 'warehouse') {
  const inset = tuning.safetyInset;
  const line = {
    minX: world_round(footprint.minX + inset),
    maxX: world_round(footprint.maxX - inset),
    minZ: world_round(footprint.minZ + inset),
    maxZ: world_round(footprint.maxZ - inset),
  };

  // Hazard hatching in the corners the safety line turns through.
  const corners = [];
  const cornerCount = envPick(token, 1, 3, 4);
  const spots = [
    [line.minX, line.minZ], [line.maxX, line.minZ],
    [line.maxX, line.maxZ], [line.minX, line.maxZ],
  ];
  for (let index = 0; index < cornerCount; index += 1) {
    const [x, z] = spots[index];
    corners.push({
      x: world_round(x + (x < 0 ? 1 : -1) * tuning.hazardCorner / 2),
      z: world_round(z + (z < 0 ? 1 : -1) * tuning.hazardCorner / 2),
      size: tuning.hazardCorner,
    });
  }

  // A stencilled bay number on the floor in front of every machine, numbered
  // in part order so the floor plan matches the scene's own listing.
  const bays = parts.map((part, index) => ({
    id: part.id,
    number: index + 1,
    x: world_round(part.pos[0]),
    z: world_round(part.pos[2] + part.size[2] / 2 + 0.8),
  }));

  // Cross-hatched keep-clear zones ringing the tanks.
  const zones = parts
    .filter((part) => part.kind === 'cylinder' && part.axis === 'y')
    .map((part) => ({
      x: world_round(part.pos[0]),
      z: world_round(part.pos[2]),
      radius: world_round(Math.max(part.size[0], part.size[2]) / 2 + 0.9),
    }));

  // Fence: slim posts with two rails, all the way round bar one gate run.
  const fence = planFence(footprint, tuning, token);

  // Circulation: the one marked route in, and the stubs that join every
  // machine to it. The gate is the single entrance, so everything on the
  // floor connects back to it through the spine.
  const circulation = planCirculation(footprint, blockers, parts, fence.gate, tuning);

  // Props. Counts come off the scene token so two scenes do not get the same
  // yard, and each one is clearance-tested before it lands.
  const taken = blockers.slice();
  for (const post of fence.posts) taken.push(envRect(post[0], post[1], 0.6, 0.6));
  // A crate standing on the only marked route through the floor is the same
  // mistake as a street that stops in a field: the route has to stay walkable.
  if (circulation) {
    for (const walk of circulation.walkways) {
      const pad = circulation.gap / 2 + 0.3;
      taken.push({
        minX: Math.min(walk.from[0], walk.to[0]) - pad,
        maxX: Math.max(walk.from[0], walk.to[0]) + pad,
        minZ: Math.min(walk.from[1], walk.to[1]) - pad,
        maxZ: Math.max(walk.from[1], walk.to[1]) + pad,
      });
    }
  }
  const spotsList = propCandidates(footprint, tuning);
  const props = [];
  props.push(...placeProps(spotsList, taken, envPick(token, 2, 2, 5), (x, z, index) => ({
    type: 'crate',
    pos: world_point([x, 0.45, z]),
    size: world_point([0.9, 0.9, 0.9]),
    rot: world_round(envRand(token, 20 + index) * 0.5 - 0.25),
    hex: WORLD_CRATE_HUE,
    finish: 'warm',
  }), footprint, tuning));
  props.push(...placeProps(spotsList, taken, envPick(token, 3, 1, 2), (x, z, index) => ({
    type: 'pallets',
    pos: world_point([x, 0.3, z]),
    size: world_point([1.2, 0.6, 1]),
    rot: world_round(envRand(token, 30 + index) * 0.4 - 0.2),
    layers: envPick(token, 31 + index, 3, 4),
    hex: WORLD_CRATE_HUE,
    finish: 'warm',
  }), footprint, tuning));
  props.push(...placeProps(spotsList, taken, 1, (x, z) => ({
    type: 'barrels',
    pos: world_point([x, 0, z]),
    size: world_point([1.5, 0.9, 1.5]),
    rot: 0,
    count: envPick(token, 4, 3, 4),
    radius: 0.3,
    height: 0.9,
    hex: WORLD_BARREL_HUES[envPick(token, 5, 0, 1)],
    finish: 'metal',
  }), footprint, tuning));
  props.push(...placeProps(spotsList, taken, envPick(token, 6, 1, 2), (x, z, index) => ({
    type: 'cart',
    pos: world_point([x, 0.06, z]),
    size: world_point([1.1, 0.12, 0.7]),
    rot: world_round(envRand(token, 40 + index) * 1.2 - 0.6),
    hex: '#6e7883',
    finish: 'metal',
  }), footprint, tuning));

  return { line, corners, bays, zones, fence, circulation, props };
}

/**
 * Perimeter fence: posts at a fixed pitch round the inset rectangle, two
 * rails, and one gate run left open with a frame on either side.
 */
export function planFence(footprint, tuning = WORLD_ENV_TUNING, token = 'fence') {
  const inset = tuning.fenceInset;
  const minX = world_round(footprint.minX + inset);
  const maxX = world_round(footprint.maxX - inset);
  const minZ = world_round(footprint.minZ + inset);
  const maxZ = world_round(footprint.maxZ - inset);
  const sides = [
    { from: [minX, minZ], to: [maxX, minZ] },
    { from: [maxX, minZ], to: [maxX, maxZ] },
    { from: [maxX, maxZ], to: [minX, maxZ] },
    { from: [minX, maxZ], to: [minX, minZ] },
  ];
  // The gate sits mid-way along one side, picked off the scene token.
  const gateSide = envPick(token, 7, 0, 3);
  const posts = [];
  const rails = [];
  let gate = null;
  sides.forEach((side, index) => {
    const dx = side.to[0] - side.from[0];
    const dz = side.to[1] - side.from[1];
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) return;
    const ux = dx / length;
    const uz = dz / length;
    const open = index === gateSide
      ? [(length - tuning.fenceGate) / 2, (length + tuning.fenceGate) / 2]
      : null;
    if (open) {
      gate = {
        a: world_point([world_round(side.from[0] + ux * open[0]), 0, world_round(side.from[1] + uz * open[0])]),
        b: world_point([world_round(side.from[0] + ux * open[1]), 0, world_round(side.from[1] + uz * open[1])]),
        height: world_round(tuning.fenceHeight + 0.35),
      };
    }
    const steps = Math.max(1, Math.round(length / tuning.fencePostGap));
    for (let step = 0; step <= steps; step += 1) {
      const at = (length * step) / steps;
      if (open && at > open[0] - 1e-9 && at < open[1] + 1e-9) continue;
      posts.push([world_round(side.from[0] + ux * at), world_round(side.from[1] + uz * at)]);
    }
    // Rails run the side in one or two pieces, skipping the gate.
    const runs = open ? [[0, open[0]], [open[1], length]] : [[0, length]];
    for (const [a, b] of runs) {
      if (b - a < 0.4) continue;
      const mid = (a + b) / 2;
      rails.push({
        pos: world_point([world_round(side.from[0] + ux * mid), 0, world_round(side.from[1] + uz * mid)]),
        length: world_round(b - a),
        along: Math.abs(ux) > Math.abs(uz) ? 'x' : 'z',
      });
    }
  });
  return {
    posts,
    rails,
    gate,
    height: tuning.fenceHeight,
    radius: tuning.fencePostRadius,
    // Two rails: a low one and one just under the cap.
    railHeights: [world_round(tuning.fenceHeight * 0.4), world_round(tuning.fenceHeight * 0.86)],
    railThickness: 0.055,
  };
}

// ----------------------------------------------------- termini: where a road ends
//
// A street that stops in the middle of open ground is the one thing that makes
// a generated district read as generated. So every avenue end is classified,
// and the classification is also what gets built there:
//
//   intersection — it hands off to another street. Nothing to add.
//   gate         — the end is at the slab edge: the asphalt runs out to the
//                  edge and an exit gate closes it. Beyond is the void, which
//                  is the world boundary, which is a reason to stop.
//   bay          — a part's side face is just ahead: the end narrows into a
//                  loading driveway that finishes flush at the building.
//   cul-de-sac   — open ground all round: a turning circle caps it.
//
// The order above is the priority, and the last two cases are exhaustive by
// construction, so `classifyTerminus` always returns a destination.

/** Outward distance from (x, z) to the slab edge the direction points at. */
export function envEdgeGap(footprint, x, z, dir) {
  if (dir[0] > 0) return footprint.maxX - x;
  if (dir[0] < 0) return x - footprint.minX;
  if (dir[1] > 0) return footprint.maxZ - z;
  return z - footprint.minZ;
}

/**
 * The nearest rect straight ahead of (x, z), inside a band `band` either side
 * of the line of travel. Ties break on id, so the answer never depends on the
 * order the blockers were collected in.
 */
export function envFacing(rects, x, z, dir, band) {
  let best = null;
  const alongX = dir[0] !== 0;
  for (const rect of rects) {
    let gap;
    if (alongX) {
      if (rect.maxZ <= z - band || rect.minZ >= z + band) continue;
      gap = dir[0] > 0 ? rect.minX - x : x - rect.maxX;
    } else {
      if (rect.maxX <= x - band || rect.minX >= x + band) continue;
      gap = dir[1] > 0 ? rect.minZ - z : z - rect.maxZ;
    }
    if (gap < 0) continue;
    const better = !best
      || gap < best.gap - 1e-9
      || (Math.abs(gap - best.gap) < 1e-9 && String(rect.id) < String(best.rect.id));
    if (better) best = { gap: world_round(gap), rect };
  }
  return best;
}

/**
 * Classify one end of one avenue. `end` is 'from' or 'to'; the returned
 * terminus carries the point, the outward direction and whatever the builder
 * needs to put something there.
 */
export function classifyTerminus(avenue, end, context) {
  const { footprint, blockers = [], crossings = [], tuning = WORLD_ENV_TUNING } = context;
  const sign = end === 'from' ? -1 : 1;
  const at = end === 'from' ? avenue.from : avenue.to;
  const dir = avenue.along === 'z' ? [0, sign] : [sign, 0];
  const x = world_round(avenue.along === 'z' ? avenue.center : at);
  const z = world_round(avenue.along === 'z' ? at : avenue.center);
  const base = { along: avenue.along, end, x, z, dir, width: avenue.width };

  // 1. A junction sitting on this end: the street already leads into another.
  for (const cross of crossings) {
    const offAt = avenue.along === 'z' ? cross.x : cross.z;
    if (Math.abs(offAt - avenue.center) > 1e-6) continue;
    const alongAt = avenue.along === 'z' ? cross.z : cross.x;
    const span = avenue.along === 'z' ? cross.d : cross.w;
    if (Math.abs(alongAt - at) <= span / 2 + 0.6) {
      return { ...base, kind: 'intersection', extend: 0 };
    }
  }

  const edgeGap = world_round(Math.max(0, envEdgeGap(footprint, x, z, dir)));
  // Two sight lines ahead: one the width of the road, for "is there a wall to
  // dock against", and one the width of a turning circle, for "is there room
  // to turn round". The wide one is what a cul-de-sac has to clear.
  const narrow = envFacing(blockers, x, z, dir, avenue.width / 2);
  const wide = envFacing(blockers, x, z, dir, tuning.turnRadius);

  // 2. The slab edge is in reach: run out to it and gate it.
  if (edgeGap <= tuning.gateReach) {
    return { ...base, kind: 'gate', extend: edgeGap };
  }
  // 3. A building face is in reach: dock against it.
  if (narrow && narrow.gap <= tuning.bayReach) {
    return { ...base, kind: 'bay', extend: narrow.gap, part: narrow.rect.id };
  }
  // 4. Open ground, with room to turn round in.
  const ahead = wide ? wide.gap : Infinity;
  if (ahead > tuning.turnClear) {
    const radius = world_round(Math.min(
      tuning.turnRadius,
      edgeGap,
      Number.isFinite(ahead) ? ahead - 0.3 : tuning.turnRadius,
    ));
    return { ...base, kind: 'cul-de-sac', extend: 0, radius };
  }
  // 5. Something is ahead but too close to turn in front of: dock against it.
  const target = narrow || wide;
  if (target) return { ...base, kind: 'bay', extend: target.gap, part: target.rect.id };
  // Unreachable while turnRadius >= gateReach, but a terminus is never left
  // unclassified: the edge is always somewhere to go.
  return { ...base, kind: 'gate', extend: edgeGap };
}

/** Both ends of every avenue, in plan order. */
export function planTermini(avenues, context) {
  const termini = [];
  avenues.forEach((avenue, index) => {
    for (const end of ['from', 'to']) {
      termini.push({ avenue: index, ...classifyTerminus(avenue, end, context) });
    }
  });
  return termini;
}

// ------------------------------------------------------- the network as a graph
//
// Everything drivable is reduced to segments between classified nodes, and the
// whole thing is then checked the way a road network has to check out: no end
// left unclassified, and nothing floating free of a way in or out.

const WORLD_TERMINUS_KINDS = [
  'intersection', 'gate', 'cul-de-sac', 'bay', 'driveway-merge', 'spine-merge',
];

/** A node key that two coincident endpoints share. */
function envNodeKey(x, z) {
  return `${world_round(x).toFixed(3)}:${world_round(z).toFixed(3)}`;
}

/**
 * Flatten a planned environment into segments. Each segment is a run of
 * surface with a classified node at each end; a city avenue carries its two
 * termini, a spur carries the thing it merges into and the thing it serves.
 */
export function networkSegments(env) {
  const segments = [];
  const city = env.city;
  if (city) {
    city.avenues.forEach((avenue, index) => {
      const ends = city.termini.filter((terminus) => terminus.avenue === index);
      const a = ends.find((terminus) => terminus.end === 'from');
      const b = ends.find((terminus) => terminus.end === 'to');
      segments.push({
        id: `avenue-${index}`,
        kind: 'avenue',
        a: { x: a.x, z: a.z, kind: a.kind },
        b: { x: b.x, z: b.z, kind: b.kind },
      });
    });
    // A junction welds the two streets through it into one component.
    city.crossings.forEach((cross, index) => {
      segments.push({
        id: `crossing-${index}`,
        kind: 'crossing',
        a: { x: cross.x, z: cross.z, kind: 'intersection' },
        b: { x: cross.x, z: cross.z, kind: 'intersection' },
      });
    });
    city.driveways.forEach((spur, index) => {
      segments.push({
        id: `driveway-${index}`,
        kind: 'driveway',
        a: { x: spur.merge[0], z: spur.merge[1], kind: 'driveway-merge' },
        b: { x: spur.to[0], z: spur.to[1], kind: 'bay' },
      });
    });
  }
  const yard = env.warehouse;
  if (yard && yard.circulation) {
    const flow = yard.circulation;
    flow.walkways.forEach((walk) => {
      segments.push({
        id: walk.id,
        kind: walk.role,
        a: { x: walk.from[0], z: walk.from[1], kind: walk.fromKind },
        b: { x: walk.to[0], z: walk.to[1], kind: walk.toKind },
      });
    });
  }
  return segments;
}

// True when `point` lies on the segment a-b, ends included. Everything here is
// axis-aligned and already rounded, so the tolerance only has to absorb the
// rounding itself.
function world_onSegment(point, a, b, tol = 1e-3) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < tol * tol) return Math.abs(point.x - a.x) <= tol && Math.abs(point.z - a.z) <= tol;
  const t = ((point.x - a.x) * dx + (point.z - a.z) * dz) / len2;
  if (t < -tol || t > 1 + tol) return false;
  return Math.hypot(point.x - (a.x + t * dx), point.z - (a.z + t * dz)) <= tol;
}

/**
 * Check a flattened network. Returns the components it found, the segments
 * whose component has no way in, and any endpoint left unclassified.
 *
 * Union-find over node keys: two endpoints at the same point are the same
 * node, which is exactly how a spur joins the thing it was aimed at.
 */
export function validateNetwork(segments) {
  const parent = new Map();
  const find = (key) => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    let walk = key;
    while (parent.get(walk) !== root) {
      const next = parent.get(walk);
      parent.set(walk, root);
      walk = next;
    }
    return root;
  };
  const note = (key) => { if (!parent.has(key)) parent.set(key, key); };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };

  const unclassified = [];
  const places = new Map();
  const keyed = segments.map((segment) => {
    const ak = envNodeKey(segment.a.x, segment.a.z);
    const bk = envNodeKey(segment.b.x, segment.b.z);
    note(ak);
    note(bk);
    places.set(ak, { x: segment.a.x, z: segment.a.z });
    places.set(bk, { x: segment.b.x, z: segment.b.z });
    for (const side of ['a', 'b']) {
      if (!WORLD_TERMINUS_KINDS.includes(segment[side].kind)) {
        unclassified.push({ segment: segment.id, side, kind: segment[side].kind });
      }
    }
    return { ...segment, ak, bk };
  });
  for (const segment of keyed) union(segment.ak, segment.bk);
  // A T-junction is a node that lands part-way along a segment, not on its
  // end: a crossing sits mid-street, a spur merges mid-block, a walkway stub
  // joins the middle of the spine. Those are connections, so a node anywhere
  // on a segment joins that segment's component.
  for (const segment of keyed) {
    const a = places.get(segment.ak);
    const b = places.get(segment.bk);
    for (const [key, point] of places) {
      if (key === segment.ak || key === segment.bk) continue;
      if (world_onSegment(point, a, b)) union(key, segment.ak);
    }
  }

  // A component is a way in when any node on it is a gate or a junction.
  const entries = new Set();
  for (const segment of keyed) {
    for (const [key, side] of [[segment.ak, segment.a], [segment.bk, segment.b]]) {
      if (side.kind === 'gate' || side.kind === 'intersection') entries.add(find(key));
    }
  }
  const components = new Map();
  for (const segment of keyed) {
    const root = find(segment.ak);
    if (!components.has(root)) components.set(root, { root, segments: [], entry: entries.has(root) });
    components.get(root).segments.push(segment.id);
  }
  const orphans = keyed
    .filter((segment) => !entries.has(find(segment.ak)))
    .map((segment) => segment.id);

  const counts = {};
  for (const kind of WORLD_TERMINUS_KINDS) counts[kind] = 0;
  for (const segment of keyed) {
    for (const side of [segment.a, segment.b]) {
      if (counts[side.kind] !== undefined) counts[side.kind] += 1;
    }
  }
  return {
    ok: orphans.length === 0 && unclassified.length === 0,
    segments: keyed.length,
    components: [...components.values()].sort((a, b) => (a.root < b.root ? -1 : 1)),
    orphans,
    unclassified,
    counts,
  };
}

/**
 * A perpendicular avenue this end could be run out to meet.
 *
 * The best repair for a street with no way in is a junction, not a gate: if
 * another street crosses the ground just ahead, extending to it turns two
 * stranded roads into one network. Only clear ground qualifies — an extension
 * through a building is not a road.
 */
export function envReachToAvenue(avenue, terminus, avenues, blockers, tuning = WORLD_ENV_TUNING) {
  const at = terminus.end === 'from' ? avenue.from : avenue.to;
  const sign = terminus.end === 'from' ? -1 : 1;
  const half = avenue.width / 2;
  let best = null;
  for (const other of avenues) {
    if (other.along === avenue.along) continue;
    // The other street has to actually reach this one's line, or the junction
    // would be with a road that is not there.
    if (avenue.center < other.from - 1e-9 || avenue.center > other.to + 1e-9) continue;
    const gap = world_round((other.center - at) * sign);
    if (gap <= 0.4 || gap > tuning.joinReach) continue;
    const lo = Math.min(at, other.center);
    const hi = Math.max(at, other.center);
    const span = avenue.along === 'z'
      ? { minX: avenue.center - half, maxX: avenue.center + half, minZ: lo, maxZ: hi }
      : { minX: lo, maxX: hi, minZ: avenue.center - half, maxZ: avenue.center + half };
    if (!rectClears(span, blockers)) continue;
    const better = !best
      || gap < best.gap - 1e-9
      || (Math.abs(gap - best.gap) < 1e-9 && other.center < best.center);
    if (better) best = { gap, center: other.center };
  }
  return best;
}

/**
 * Repair the network until no component is cut off, and report what it took.
 *
 * Three moves, in the order a real site would reach for them:
 *
 *   1. run the end out to meet a street crossing just ahead — a junction, and
 *      the only repair that makes the network better rather than merely legal;
 *   2. run the end out to the slab edge and gate it, when the edge is close
 *      enough that the run-out still reads as a street reaching the boundary;
 *   3. drop the street. A road with no way in is worse than no road, and this
 *      is the case the owner was looking at.
 *
 * Each pass either resolves one component or removes one street, so the loop
 * is bounded by the number of streets. Avenues are returned alongside the
 * termini because move 1 lengthens one.
 */
export function repairTermini(avenues, termini, context) {
  const { footprint, blockers = [], tuning = WORLD_ENV_TUNING } = context;
  const lanes = avenues.map((avenue) => ({ ...avenue }));
  const fixed = termini.map((terminus) => ({ ...terminus }));
  const dropped = new Set();
  let joined = false;

  for (let pass = 0; pass <= avenues.length; pass += 1) {
    const live = lanes
      .map((avenue, index) => ({ avenue, index }))
      .filter(({ index }) => !dropped.has(index));
    const segments = live.map(({ index }) => {
      const a = fixed.find((t) => t.avenue === index && t.end === 'from');
      const b = fixed.find((t) => t.avenue === index && t.end === 'to');
      return {
        id: `avenue-${index}`,
        a: { x: a.x, z: a.z, kind: a.kind },
        b: { x: b.x, z: b.z, kind: b.kind },
      };
    });
    const crossings = (context.crossings || []).map((cross, index) => ({
      id: `crossing-${index}`,
      a: { x: cross.x, z: cross.z, kind: 'intersection' },
      b: { x: cross.x, z: cross.z, kind: 'intersection' },
    }));
    const report = validateNetwork(segments.concat(crossings));
    if (report.ok) break;

    const stranded = report.orphans
      .filter((id) => id.startsWith('avenue-'))
      .map((id) => Number(id.slice('avenue-'.length)));
    if (!stranded.length) break;

    // Candidate ends, ordered so the choice is a property of the geometry:
    // nearest the edge first, then by street, then 'from' before 'to'.
    const options = [];
    for (const index of stranded) {
      for (const terminus of fixed.filter((t) => t.avenue === index)) {
        if (terminus.kind === 'gate' || terminus.kind === 'intersection') continue;
        options.push({
          terminus,
          gap: world_round(Math.max(0, envEdgeGap(footprint, terminus.x, terminus.z, terminus.dir))),
        });
      }
    }
    options.sort((a, b) => (a.gap - b.gap)
      || (a.terminus.avenue - b.terminus.avenue)
      || (a.terminus.end < b.terminus.end ? -1 : 1));
    if (!options.length) break;

    // 1. A junction within reach beats everything else.
    const reach = options
      .map((option) => ({
        option,
        meet: envReachToAvenue(
          lanes[option.terminus.avenue],
          option.terminus,
          lanes.filter((_, index) => !dropped.has(index) && index !== option.terminus.avenue),
          blockers,
          tuning,
        ),
      }))
      .filter((candidate) => candidate.meet)
      .sort((a, b) => (a.meet.gap - b.meet.gap)
        || (a.option.terminus.avenue - b.option.terminus.avenue)
        || (a.option.terminus.end < b.option.terminus.end ? -1 : 1))[0];
    if (reach) {
      const lane = lanes[reach.option.terminus.avenue];
      if (reach.option.terminus.end === 'from') lane.from = reach.meet.center;
      else lane.to = reach.meet.center;
      joined = true;
      break;
    }

    // 2. Gate it, if the boundary is close enough to run out to.
    const best = options[0];
    if (best.gap <= tuning.repairReach) {
      best.terminus.kind = 'gate';
      best.terminus.extend = best.gap;
      delete best.terminus.radius;
      delete best.terminus.part;
      best.terminus.repaired = true;
      continue;
    }
    // 3. Out it goes.
    dropped.add(best.terminus.avenue);
  }

  return {
    avenues: lanes.filter((_, index) => !dropped.has(index)),
    termini: fixed,
    dropped: [...dropped].sort((a, b) => a - b),
    // A join lengthened a street, so the caller has to re-cross and
    // re-classify before the plan is consistent again.
    joined,
  };
}

// --------------------------------------------- what gets built at a terminus

/** The rect of asphalt a terminus adds beyond the avenue's own run. */
export function terminusStub(terminus, tuning = WORLD_ENV_TUNING) {
  if (!terminus.extend || terminus.extend <= 1e-6) return null;
  const half = (terminus.kind === 'bay' ? tuning.bayWidth : terminus.width) / 2;
  const reach = terminus.extend;
  if (terminus.along === 'z') {
    const z0 = terminus.dir[1] > 0 ? terminus.z : terminus.z - reach;
    return {
      kind: terminus.kind,
      minX: world_round(terminus.x - half),
      maxX: world_round(terminus.x + half),
      minZ: world_round(z0),
      maxZ: world_round(z0 + reach),
    };
  }
  const x0 = terminus.dir[0] > 0 ? terminus.x : terminus.x - reach;
  return {
    kind: terminus.kind,
    minX: world_round(x0),
    maxX: world_round(x0 + reach),
    minZ: world_round(terminus.z - half),
    maxZ: world_round(terminus.z + half),
  };
}

/**
 * An exit gate: two striped barrier arms meeting over the road, a guard booth
 * on the shoulder with room to stand, and a chevron on the asphalt pointing
 * the way out. Set in off the lip so none of it hangs over the void.
 */
export function planGate(terminus, footprint, blockers = [], tuning = WORLD_ENV_TUNING) {
  const [dx, dz] = terminus.dir;
  const reach = Math.max(0, terminus.extend - tuning.gateSetback);
  const gx = world_round(terminus.x + dx * reach);
  const gz = world_round(terminus.z + dz * reach);
  const half = terminus.width / 2;
  // Arms swing in from both kerbs and stop just short of each other. Each one
  // is built as a row of alternating blocks rather than one bar wearing a
  // striped texture: an arm is 0.14 thick and over a unit long, so a tile
  // stretched down it smears into bands instead of reading as hazard
  // stripes — and the blocks cost nothing, being instances of the same cube.
  const span = world_round(half * 0.92);
  const bands = tuning.gateArmBands;
  const step = span / bands;
  const thickness = tuning.gateArmThickness;
  const arms = [-1, 1].map((side) => {
    const base = side * (half - span / 2);
    const stripes = [];
    for (let index = 0; index < bands; index += 1) {
      // Walk from the kerb inwards, so the band nearest the pivot is always
      // the same colour whichever side the arm hangs off.
      const at = base - side * (span / 2 - step / 2 - index * step);
      stripes.push({
        pos: terminus.along === 'z'
          ? world_point([world_round(gx + at), tuning.gateArmHeight, gz])
          : world_point([gx, tuning.gateArmHeight, world_round(gz + at)]),
        size: terminus.along === 'z'
          ? world_point([world_round(step), thickness, thickness])
          : world_point([thickness, thickness, world_round(step)]),
        band: index % 2,
      });
    }
    return {
      pos: terminus.along === 'z'
        ? world_point([world_round(gx + base), tuning.gateArmHeight, gz])
        : world_point([gx, tuning.gateArmHeight, world_round(gz + base)]),
      size: terminus.along === 'z'
        ? world_point([span, thickness, thickness])
        : world_point([thickness, thickness, span]),
      pivot: terminus.along === 'z'
        ? world_point([world_round(gx + side * half), 0, gz])
        : world_point([gx, 0, world_round(gz + side * half)]),
      stripes,
      side,
    };
  });
  // The booth goes on whichever shoulder has room for it: slab underneath and
  // no building already standing there. It is laid long-side-along the road
  // either way, so the cross-axis extent it clears the kerb by is its width.
  const [bw, bh, bd] = tuning.boothSize;
  const offset = half + tuning.curbWidth + bw / 2 + 0.2;
  const size = terminus.along === 'z' ? [bw, bh, bd] : [bd, bh, bw];
  const sides = [-1, 1].map((side) => {
    // Across the road the offset is fixed: that is what keeps the booth off
    // the asphalt. Along the road it can slide, and it has to — the gate line
    // sits a third of a unit from the lip, so a booth centred on it would
    // hang its back half over the void.
    const slide = (at, half, lo, hi) => world_round(Math.min(Math.max(at, lo + half), hi - half));
    const x = terminus.along === 'z'
      ? world_round(gx + side * offset)
      : slide(gx, size[0] / 2, footprint.minX, footprint.maxX);
    const z = terminus.along === 'z'
      ? slide(gz, size[2] / 2, footprint.minZ, footprint.maxZ)
      : world_round(gz + side * offset);
    const footing = envRect(x, z, size[0], size[2]);
    return {
      side,
      x,
      z,
      // How far the whole footing sits inside the slab. Negative means the
      // slab is too small for a booth on this shoulder at all.
      inset: Math.min(
        footing.minX - footprint.minX, footprint.maxX - footing.maxX,
        footing.minZ - footprint.minZ, footprint.maxZ - footing.maxZ,
      ),
      clear: rectClears(footing, blockers),
    };
  });
  // A shoulder that is clear of buildings beats one that is not; then the one
  // with the most slab under it; then the low side. A total order.
  sides.sort((a, b) => (Number(b.clear) - Number(a.clear))
    || (b.inset - a.inset)
    || (a.side - b.side));
  const seat = sides[0];
  // No shoulder works, so there is no booth: the arms and the chevron are
  // still a gate, and a booth buried in a wall is worse than none.
  const booth = seat.clear && seat.inset >= 0
    ? {
      pos: world_point([seat.x, bh / 2, seat.z]),
      size: world_point(size),
      along: terminus.along,
    }
    : null;
  // Chevrons sit back on the asphalt, pointing out through the gate.
  const chevron = {
    x: world_round(terminus.x + dx * Math.max(0, reach - tuning.chevronBack)),
    z: world_round(terminus.z + dz * Math.max(0, reach - tuning.chevronBack)),
    dir: terminus.dir,
    width: world_round(terminus.width * 0.62),
    along: terminus.along,
  };
  return {
    x: gx,
    z: gz,
    along: terminus.along,
    dir: terminus.dir,
    width: terminus.width,
    height: world_round(tuning.gateArmHeight + 0.18),
    arms,
    booth,
    chevron,
    repaired: Boolean(terminus.repaired),
  };
}

/** A turning circle: a disc, a painted ring, a hatched island, two bollards. */
export function planCulDeSac(terminus, tuning = WORLD_ENV_TUNING) {
  const radius = terminus.radius || tuning.turnRadius;
  const [dx, dz] = terminus.dir;
  // Both bollards on the far arc, splayed either side of the line of travel,
  // so they face the driver and never stand in the road.
  const bollards = [-1, 1].map((side) => {
    const angle = Math.atan2(dx, dz) + side * tuning.turnBollardSplay;
    const reach = radius - 0.4;
    return {
      pos: world_point([
        world_round(terminus.x + Math.sin(angle) * reach),
        tuning.bollardHeight / 2,
        world_round(terminus.z + Math.cos(angle) * reach),
      ]),
      radius: tuning.bollardRadius,
      height: tuning.bollardHeight,
    };
  });
  return {
    x: terminus.x,
    z: terminus.z,
    radius,
    island: world_round(radius * 0.42),
    dir: [dx, dz],
    bollards,
  };
}

/**
 * A loading bay: the hatched rectangle the stub ends in, and a rubber dock
 * bumper laid across the building face at buffer height.
 */
export function planBay(terminus, tuning = WORLD_ENV_TUNING) {
  const [dx, dz] = terminus.dir;
  const reach = terminus.extend;
  const fx = world_round(terminus.x + dx * reach);
  const fz = world_round(terminus.z + dz * reach);
  const half = tuning.bayWidth / 2;
  const hatch = terminus.along === 'z'
    ? {
      minX: world_round(terminus.x - half),
      maxX: world_round(terminus.x + half),
      minZ: world_round(Math.min(terminus.z, fz)),
      maxZ: world_round(Math.max(terminus.z, fz)),
    }
    : {
      minX: world_round(Math.min(terminus.x, fx)),
      maxX: world_round(Math.max(terminus.x, fx)),
      minZ: world_round(terminus.z - half),
      maxZ: world_round(terminus.z + half),
    };
  const bumperSpan = world_round(tuning.bayWidth * 0.84);
  return {
    x: terminus.x,
    z: terminus.z,
    face: [fx, fz],
    along: terminus.along,
    dir: [dx, dz],
    part: terminus.part || null,
    width: tuning.bayWidth,
    hatch,
    bumper: {
      pos: world_point([
        world_round(fx - dx * tuning.bumperDepth / 2),
        tuning.bumperHeight,
        world_round(fz - dz * tuning.bumperDepth / 2),
      ]),
      size: world_point(terminus.along === 'z'
        ? [bumperSpan, tuning.bumperThickness, tuning.bumperDepth]
        : [tuning.bumperDepth, tuning.bumperThickness, bumperSpan]),
    },
  };
}

/**
 * Driveways: a spur off the pavement to a building face, so the blocks are
 * joined to the grid and not merely next to it.
 *
 * One candidate per avenue side — the part nearest that pavement, inside the
 * street's own run — and the closest few of those get built. Everything is
 * ordered before it is cut, so the same scene always gets the same driveways.
 */
export function planDriveways(avenues, blockers, served, tuning = WORLD_ENV_TUNING) {
  const shoulder = tuning.curbWidth + tuning.sidewalkWidth;
  const candidates = [];
  avenues.forEach((avenue, index) => {
    const half = avenue.width / 2;
    for (const side of [-1, 1]) {
      const edge = avenue.center + side * (half + shoulder);
      let best = null;
      for (const rect of blockers) {
        if (served.has(rect.id)) continue;
        // The part has to sit beside this stretch of street, not past its end.
        const lo = avenue.along === 'z' ? rect.minZ : rect.minX;
        const hi = avenue.along === 'z' ? rect.maxZ : rect.maxX;
        if (hi <= avenue.from + 0.4 || lo >= avenue.to - 0.4) continue;
        const near = avenue.along === 'z'
          ? (side > 0 ? rect.minX : rect.maxX)
          : (side > 0 ? rect.minZ : rect.maxZ);
        const gap = world_round(side > 0 ? near - edge : edge - near);
        if (gap < 0.2 || gap > tuning.drivewayReach) continue;
        // Meet the face at the middle of the stretch that faces the street.
        const at = world_round((Math.max(lo, avenue.from) + Math.min(hi, avenue.to)) / 2);
        const better = !best
          || gap < best.gap - 1e-9
          || (Math.abs(gap - best.gap) < 1e-9 && String(rect.id) < String(best.id));
        if (better) best = { gap, at, near, id: rect.id };
      }
      if (best) candidates.push({ avenue: index, side, edge, ...best });
    }
  });
  candidates.sort((a, b) => (a.gap - b.gap)
    || (a.avenue - b.avenue)
    || (a.side - b.side)
    || (String(a.id) < String(b.id) ? -1 : 1));

  const spurs = [];
  const taken = new Set();
  for (const pick of candidates) {
    if (spurs.length >= tuning.drivewayMax) break;
    if (taken.has(pick.id)) continue;
    taken.add(pick.id);
    const avenue = avenues[pick.avenue];
    const from = avenue.along === 'z' ? [pick.edge, pick.at] : [pick.at, pick.edge];
    const to = avenue.along === 'z' ? [pick.near, pick.at] : [pick.at, pick.near];
    const half = tuning.drivewayWidth / 2;
    const lo = Math.min(from[0], to[0]);
    const hi = Math.max(from[0], to[0]);
    const loZ = Math.min(from[1], to[1]);
    const hiZ = Math.max(from[1], to[1]);
    spurs.push({
      avenue: pick.avenue,
      part: pick.id,
      side: pick.side,
      along: avenue.along === 'z' ? 'x' : 'z',
      from: [world_round(from[0]), world_round(from[1])],
      to: [world_round(to[0]), world_round(to[1])],
      // Where the spur meets the road as a graph: the centre line, not the
      // kerb the paint starts at. A spur joins a street, not its pavement.
      merge: avenue.along === 'z'
        ? [world_round(avenue.center), world_round(pick.at)]
        : [world_round(pick.at), world_round(avenue.center)],
      width: tuning.drivewayWidth,
      rect: avenue.along === 'z'
        ? {
          minX: world_round(lo), maxX: world_round(hi),
          minZ: world_round(pick.at - half), maxZ: world_round(pick.at + half),
        }
        : {
          minX: world_round(pick.at - half), maxX: world_round(pick.at + half),
          minZ: world_round(loZ), maxZ: world_round(hiZ),
        },
      // A painted threshold where the spur leaves the pavement: the line that
      // says this is a crossing of the footway, not a second road.
      threshold: avenue.along === 'z'
        ? {
          x: world_round(pick.edge), z: world_round(pick.at),
          along: 'z', length: tuning.drivewayWidth,
        }
        : {
          x: world_round(pick.at), z: world_round(pick.edge),
          along: 'x', length: tuning.drivewayWidth,
        },
    });
  }
  return spurs;
}

/**
 * Warehouse circulation. A factory floor has no streets; it has one marked
 * route, and everything on the floor is reachable from the one gate.
 *
 * The spine is the longest free corridor on the slab. A walkway runs from the
 * perimeter gate to it, and a short stub joins every machine's nearest face to
 * it. All of it is paint, 0.12-wide safety yellow in pairs — the same visual
 * rule as a loading bay, and no extra geometry.
 */
export function planCirculation(footprint, blockers, parts, gate, tuning = WORLD_ENV_TUNING) {
  const grid = freeCells(footprint, blockers, { step: tuning.gridStep, margin: 0.4 });
  let spineBand = null;
  for (const along of ['z', 'x']) {
    for (const band of freeCorridors(grid, along, { minWidth: tuning.spineMin, minRun: tuning.spineRun })) {
      // Longest run wins, then widest, then nearest the middle: a total order,
      // so the spine is a property of the layout and not of the search.
      const better = !spineBand
        || band.run > spineBand.band.run + 1e-9
        || (Math.abs(band.run - spineBand.band.run) < 1e-9 && band.width > spineBand.band.width + 1e-9)
        || (Math.abs(band.run - spineBand.band.run) < 1e-9
          && Math.abs(band.width - spineBand.band.width) < 1e-9
          && Math.abs(band.center) < Math.abs(spineBand.band.center));
      if (better) spineBand = { along, band };
    }
  }
  if (!spineBand) return null;

  const { along, band } = spineBand;
  const spine = {
    id: 'spine',
    role: 'spine',
    along,
    center: band.center,
    from: along === 'z' ? [band.center, band.runFrom] : [band.runFrom, band.center],
    to: along === 'z' ? [band.center, band.runTo] : [band.runTo, band.center],
    fromKind: 'spine-merge',
    toKind: 'spine-merge',
  };
  // Where a point joins the spine: square onto the centre line, clamped to the
  // run, so a stub always lands on paint that exists.
  const onSpine = (x, z) => (along === 'z'
    ? [band.center, world_round(world_clampTo(z, band.runFrom, band.runTo))]
    : [world_round(world_clampTo(x, band.runFrom, band.runTo)), band.center]);

  const walkways = [spine];
  // The gate is the single way in, so its walkway is the one that must land.
  if (gate) {
    const gx = world_round((gate.a[0] + gate.b[0]) / 2);
    const gz = world_round((gate.a[2] + gate.b[2]) / 2);
    const join = onSpine(gx, gz);
    // An L in two legs. Two corners are available; take the one whose legs
    // both clear every machine, and the first one when both do.
    const corners = [[join[0], gz], [gx, join[1]]];
    const clear = corners.find((corner) => world_legClears(gx, gz, corner, blockers)
      && world_legClears(corner[0], corner[1], join, blockers));
    const corner = clear || corners[0];
    walkways.push({
      id: 'gate-leg',
      role: 'gate-link',
      from: [gx, gz],
      to: [world_round(corner[0]), world_round(corner[1])],
      fromKind: 'gate',
      toKind: 'spine-merge',
      along: Math.abs(corner[0] - gx) > Math.abs(corner[1] - gz) ? 'x' : 'z',
    });
    walkways.push({
      id: 'gate-join',
      role: 'gate-link',
      from: [world_round(corner[0]), world_round(corner[1])],
      to: join,
      fromKind: 'spine-merge',
      toKind: 'spine-merge',
      along: Math.abs(join[0] - corner[0]) > Math.abs(join[1] - corner[1]) ? 'x' : 'z',
    });
  }
  // One stub per machine, square off its nearest face onto the spine.
  parts.forEach((part, index) => {
    const rect = partRect(part);
    const px = world_round(part.pos[0]);
    const pz = world_round(part.pos[2]);
    const join = onSpine(px, pz);
    const face = along === 'z'
      ? [world_round(band.center < px ? rect.minX : rect.maxX), world_round(world_clampTo(join[1], rect.minZ, rect.maxZ))]
      : [world_round(world_clampTo(join[0], rect.minX, rect.maxX)), world_round(band.center < pz ? rect.minZ : rect.maxZ)];
    const stubFrom = along === 'z' ? [face[0], join[1]] : [join[0], face[1]];
    if (Math.hypot(stubFrom[0] - join[0], stubFrom[1] - join[1]) < 0.3) return;
    walkways.push({
      id: `stub-${index}`,
      role: 'stub',
      part: part.id,
      from: [world_round(stubFrom[0]), world_round(stubFrom[1])],
      to: join,
      fromKind: 'spine-merge',
      toKind: 'spine-merge',
      along: along === 'z' ? 'x' : 'z',
    });
  });

  return {
    spine,
    walkways,
    lineWidth: tuning.spineWalkWidth,
    gap: tuning.spineWalkGap,
  };
}

function world_clampTo(value, lo, hi) {
  return Math.min(Math.max(value, Math.min(lo, hi)), Math.max(lo, hi));
}

// True when the straight leg from (ax, az) to `to` misses every rect.
function world_legClears(ax, az, to, rects) {
  const leg = {
    minX: Math.min(ax, to[0]) - 0.2,
    maxX: Math.max(ax, to[0]) + 0.2,
    minZ: Math.min(az, to[1]) - 0.2,
    maxZ: Math.max(az, to[1]) + 0.2,
  };
  return rects.every((rect) => !envOverlaps(leg, rect));
}

/**
 * The industrial district: avenues through the free corridors, their curbs,
 * sidewalks and crossings, street furniture along them, and containers, a
 * water tower and dumpsters in the leftover lots.
 */
export function planCity(footprint, blockers, parts, tuning = WORLD_ENV_TUNING, token = 'city') {
  // Classify both ends of every street, then make sure nothing is cut off.
  //
  // A repair changes the street layout — a join lengthens one, a drop removes
  // one — and that moves the junctions, which changes the classification. So
  // this runs to a fixed point instead of once: classify, repair, and if the
  // repair touched the layout, go round again on what is left. Every pass
  // either settles or shrinks the plan, so it always converges, and the plan
  // that gets built is the one that was last checked.
  let avenues = planAvenues(footprint, blockers, tuning);
  let crossings = planIntersections(avenues);
  let termini = planTermini(avenues, { footprint, blockers, crossings, tuning });
  let dropped = 0;
  for (let pass = 0; pass <= avenues.length + 1; pass += 1) {
    const repair = repairTermini(avenues, termini, { footprint, blockers, crossings, tuning });
    termini = repair.termini;
    if (!repair.joined && !repair.dropped.length) break;
    dropped += repair.dropped.length;
    avenues = repair.avenues;
    crossings = planIntersections(avenues);
    termini = planTermini(avenues, { footprint, blockers, crossings, tuning });
  }

  const gates = [];
  const culdesacs = [];
  const bays = [];
  const stubs = [];
  const served = new Set();
  for (const terminus of termini) {
    const stub = terminusStub(terminus, tuning);
    if (stub) stubs.push(stub);
    if (terminus.kind === 'gate') gates.push(planGate(terminus, footprint, blockers, tuning));
    else if (terminus.kind === 'cul-de-sac') culdesacs.push(planCulDeSac(terminus, tuning));
    else if (terminus.kind === 'bay') {
      const bay = planBay(terminus, tuning);
      bays.push(bay);
      if (bay.part !== null) served.add(bay.part);
    }
  }
  // Spurs join the blocks to the grid, skipping anything a bay already serves.
  const driveways = planDriveways(avenues, blockers, served, tuning);

  // How far traffic actually runs down each street: its own length plus any
  // run-out its ends grew. The wear has to reach the gate, or the tyre marks
  // stop in the middle of the asphalt and give the whole thing away.
  const wear = avenues.map((avenue, index) => {
    let from = avenue.from;
    let to = avenue.to;
    for (const terminus of termini) {
      if (terminus.avenue !== index || !terminus.extend) continue;
      if (terminus.end === 'from') from = world_round(from - terminus.extend);
      else to = world_round(to + terminus.extend);
    }
    return { along: avenue.along, center: avenue.center, width: avenue.width, from, to };
  });

  const curbs = [];
  const sidewalks = [];
  for (const avenue of avenues) {
    const edges = envStreetEdges(avenue, footprint, tuning);
    curbs.push(...edges.curbs);
    sidewalks.push(...edges.walks);
  }

  // A zebra on each arm of each crossing, set back off the junction box.
  const crosswalks = [];
  for (const cross of crossings) {
    const depth = tuning.crosswalkDepth;
    for (const side of [-1, 1]) {
      crosswalks.push({
        x: cross.x,
        z: world_round(cross.z + side * (cross.d / 2 + depth / 2)),
        w: world_round(cross.w),
        d: world_round(depth),
        along: 'z',
      });
      crosswalks.push({
        x: world_round(cross.x + side * (cross.w / 2 + depth / 2)),
        z: cross.z,
        w: world_round(depth),
        d: world_round(cross.d),
        along: 'x',
      });
    }
  }

  // Lamps light the street but stay out of the gate zones: a gate is already
  // the busiest two metres of the road, and a mast in it reads as clutter.
  const gateZones = gates.map((gate) => envRect(gate.x, gate.z, gate.width + 2.2, gate.width + 2.2));
  const lamps = envLamps(avenues, crossings, footprint, tuning)
    .filter((lamp) => !gateZones.some((zone) => envOverlaps(envRect(lamp.pos[0], lamp.pos[2], 0.4, 0.4), zone)));
  lamps.forEach((lamp, index) => { lamp.glow = index % 2 === 0; });
  const bollards = envBollards(crossings, tuning)
    .concat(...culdesacs.map((circle) => circle.bollards));

  // Everything a prop has to stay off: parts, the whole street section
  // (asphalt + curb + sidewalk), every terminus the streets grew, and the
  // furniture already standing on all of it. Nothing lands on asphalt but the
  // gate's own kit, which is placed from the plan and never from a candidate.
  const taken = blockers.slice();
  for (const avenue of avenues) taken.push(streetRect(avenue, tuning));
  for (const stub of stubs) taken.push(stub);
  for (const circle of culdesacs) {
    taken.push(envRect(circle.x, circle.z, circle.radius * 2, circle.radius * 2));
  }
  for (const spur of driveways) taken.push(spur.rect);
  for (const gate of gates) {
    if (!gate.booth) continue;
    taken.push(envRect(gate.booth.pos[0], gate.booth.pos[2], gate.booth.size[0] + 0.5, gate.booth.size[2] + 0.5));
  }
  for (const lamp of lamps) taken.push(envRect(lamp.pos[0], lamp.pos[2], 0.6, 0.6));
  for (const bollard of bollards) taken.push(envRect(bollard.pos[0], bollard.pos[2], 0.5, 0.5));

  const spots = propCandidates(footprint, tuning);
  const props = [];
  // The water tower claims the emptiest far corner before anything else does.
  props.push(...placeProps(spots, taken, 1, (x, z) => ({
    type: 'tower',
    pos: world_point([x, 0, z]),
    size: world_point([2.6, 5.6, 2.6]),
    rot: 0,
    legSpan: 1.8,
    legHeight: 3.1,
    tankRadius: 1.15,
    tankHeight: 1.7,
    roofHeight: 0.8,
    hex: '#78828e',
    finish: 'metal',
  }), footprint, tuning));
  props.push(...placeProps(spots, taken, envPick(token, 8, 2, 4), (x, z, index) => ({
    type: 'container',
    pos: world_point([x, 0, z]),
    size: world_point([2.4, 1.1, 1]),
    rot: envRand(token, 50 + index) < 0.5 ? 0 : world_round(Math.PI / 2),
    stack: envPick(token, 60 + index, 1, 2),
    hex: WORLD_CONTAINER_HUES[envPick(token, 70 + index, 0, 3)],
    finish: 'plastic',
  }), footprint, tuning));
  props.push(...placeProps(spots, taken, envPick(token, 9, 1, 2), (x, z, index) => ({
    type: 'dumpster',
    pos: world_point([x, 0.4, z]),
    size: world_point([1.5, 0.8, 0.9]),
    rot: world_round(envRand(token, 80 + index) * 0.6 - 0.3),
    hex: '#4f6a52',
    finish: 'plastic',
  }), footprint, tuning));
  void parts;

  return {
    avenues,
    crossings,
    curbs,
    sidewalks,
    crosswalks,
    lamps,
    bollards,
    props,
    termini,
    stubs,
    gates,
    culdesacs,
    bays,
    driveways,
    wear,
    // How many streets the repair had to remove outright: a plan that needs
    // this is a plan whose corridors were not really streets.
    dropped,
  };
}

/**
 * The ground language both modes share: concrete aprons under the machines,
 * oil stains, manholes, drainage grates by the roads and worn tire paths
 * following them. Painted into the one deterministic ground overlay.
 */
export function planGround(footprint, parts, roads, tuning = WORLD_ENV_TUNING, token = 'ground') {
  const aprons = parts.map((part) => ({
    minX: world_round(part.pos[0] - part.size[0] / 2 - 0.7),
    maxX: world_round(part.pos[0] + part.size[0] / 2 + 0.7),
    minZ: world_round(part.pos[2] - part.size[2] / 2 - 0.7),
    maxZ: world_round(part.pos[2] + part.size[2] / 2 + 0.7),
  }));

  const spanX = footprint.maxX - footprint.minX;
  const spanZ = footprint.maxZ - footprint.minZ;
  const inside = (x, z, pad) => x > footprint.minX + pad && x < footprint.maxX - pad
    && z > footprint.minZ + pad && z < footprint.maxZ - pad;

  // Oil stains: soft dark blots, hashed so they fall in the same places every
  // time but never on a grid.
  const stains = [];
  const stainCount = envPick(token, 100, 5, 8);
  for (let index = 0; index < stainCount; index += 1) {
    const x = world_round(footprint.minX + envRand(token, 110 + index * 3) * spanX);
    const z = world_round(footprint.minZ + envRand(token, 111 + index * 3) * spanZ);
    if (!inside(x, z, 1)) continue;
    stains.push({ x, z, radius: world_round(0.5 + envRand(token, 112 + index * 3) * 1.1) });
  }

  // Manholes, clear of the machines so the lid is actually visible.
  const manholes = [];
  const manholeCount = envPick(token, 200, 2, 4);
  const blockers = parts.map((part) => partRect(part, 0.4));
  for (let index = 0; index < manholeCount * 6 && manholes.length < manholeCount; index += 1) {
    const x = world_round(footprint.minX + envRand(token, 210 + index * 2) * spanX);
    const z = world_round(footprint.minZ + envRand(token, 211 + index * 2) * spanZ);
    if (!inside(x, z, 1.4)) continue;
    const rect = envRect(x, z, 0.9, 0.9);
    if (!rectClears(rect, blockers, 0.2)) continue;
    if (manholes.some((hole) => Math.hypot(hole.x - x, hole.z - z) < 4)) continue;
    manholes.push({ x, z, radius: 0.34 });
  }

  // Drainage grates hug the roads; with no roads they sit along the long edges,
  // which is where a factory floor drains anyway.
  const grates = [];
  if (roads.length) {
    roads.forEach((road, index) => {
      const along = road.along;
      const at = along === 'z'
        ? [road.center + road.width / 2 + 0.3, road.from + (road.to - road.from) * (0.3 + 0.4 * (index % 2))]
        : [road.from + (road.to - road.from) * (0.3 + 0.4 * (index % 2)), road.center + road.width / 2 + 0.3];
      grates.push({
        x: world_round(at[0]),
        z: world_round(at[1]),
        w: along === 'z' ? 0.5 : 1.2,
        d: along === 'z' ? 1.2 : 0.5,
      });
    });
  } else {
    for (const side of [-1, 1]) {
      grates.push({
        x: world_round(footprint.minX + spanX * 0.5 + side * spanX * 0.28),
        z: world_round(footprint.minZ + 1.9),
        w: 1.2,
        d: 0.5,
      });
    }
  }

  // Worn tire paths: a double line following the roads, or straight down the
  // middle of a warehouse floor where the traffic actually runs.
  const tirePaths = [];
  if (roads.length) {
    for (const road of roads) {
      tirePaths.push({
        along: road.along,
        center: road.center,
        from: road.from,
        to: road.to,
        gauge: world_round(Math.min(1.8, road.width * 0.5)),
      });
    }
  } else {
    tirePaths.push({
      along: 'x',
      center: world_round(footprint.minZ + spanZ * 0.5),
      from: world_round(footprint.minX + 1),
      to: world_round(footprint.maxX - 1),
      gauge: 1.6,
    });
  }

  void tuning;
  return { aprons, stains, manholes, grates, tirePaths };
}

/**
 * The whole environment plan for a scene: the mode, the numbers that chose it,
 * the shared ground language, and whichever mode's furniture.
 *
 * `roadRects` is the one thing the rest of buildWorld reads back: a pylon or a
 * lamp may not stand on asphalt, so cable routing tests against it.
 */
export function planEnvironment(requested, footprint, parts, tuning = WORLD_ENV_TUNING, token = 'env') {
  const metrics = envMetrics(parts);
  const mode = pickEnvMode(requested, metrics, tuning);
  // Every part's footprint blocks a road, thin pads included: a street across
  // a loading dais is a street through a building.
  const blockers = parts.map((part) => partRect(part));
  const city = mode === 'city' ? planCity(footprint, blockers, parts, tuning, token) : null;
  const warehouse = mode === 'warehouse' ? planWarehouse(footprint, blockers, parts, tuning, token) : null;
  const avenues = city ? city.avenues : [];
  // What the ground's wear follows. In the city that is every street out to
  // its terminus; on a factory floor it is the circulation spine, because
  // that is the one route the traffic has.
  let worn = city ? city.wear : [];
  if (!worn.length && warehouse && warehouse.circulation) {
    const spine = warehouse.circulation.spine;
    worn = [{
      along: spine.along,
      center: spine.center,
      width: 1.6,
      from: spine.along === 'z' ? spine.from[1] : spine.from[0],
      to: spine.along === 'z' ? spine.to[1] : spine.to[0],
    }];
  }
  const ground = planGround(footprint, parts, worn, tuning, token);
  // Everything a cable pylon has to stay off. Every piece of asphalt counts,
  // not just the avenues: a pylon planted in a turning circle or across a
  // loading bay is the same mistake as one planted in the road.
  const roadRects = city
    ? city.avenues.map(avenueRect)
      .concat(city.stubs)
      .concat(city.driveways.map((spur) => spur.rect))
      .concat(city.culdesacs.map((circle) => ({
        minX: circle.x - circle.radius,
        maxX: circle.x + circle.radius,
        minZ: circle.z - circle.radius,
        maxZ: circle.z + circle.radius,
      })))
      .map((rect) => ({
        minX: world_round(rect.minX),
        maxX: world_round(rect.maxX),
        minZ: world_round(rect.minZ),
        maxZ: world_round(rect.maxZ),
      }))
    : [];
  // The plan carries its own verdict: every segment classified at both ends,
  // and no component without a way in. A capture can read it off ?debug=1.
  const network = validateNetwork(networkSegments({ city, warehouse }));
  return { mode, requested, metrics, ground, city, warehouse, roadRects, network, tuning };
}

export function buildWorld(scene, options = {}) {
  if (!scene || typeof scene !== 'object') throw new Error('buildWorld requires a scene object');
  const tuning = { ...WORLD_TUNING, ...(options.tuning || {}) };
  const theme = options.theme ? (options.theme === 'dark' ? 'dark' : 'light') : themeOf(scene);
  // Which environment to generate. The scene may ask for one; a demo may
  // override it with ?env=. Anything else is a typo, not a third environment.
  const requestedEnv = options.env != null && options.env !== ''
    ? String(options.env)
    : (scene.env == null || scene.env === '' ? 'auto' : String(scene.env));
  if (!WORLD_ENV_MODES.includes(requestedEnv)) {
    throw new Error(`unknown env: ${requestedEnv} (expected ${WORLD_ENV_MODES.join(', ')})`);
  }
  const sceneParts = Array.isArray(scene.parts) ? scene.parts : [];

  const slabPart = pickSlab(sceneParts);
  const solids = sceneParts.filter((part) => part !== slabPart);

  // Slab footprint drives the recentring, so the camera home framing is stable.
  let footprint;
  if (slabPart) {
    const extent = sceneExtent(slabPart);
    footprint = { minX: extent.min[0], maxX: extent.max[0], minZ: extent.min[1], maxZ: extent.max[1], topZ: extent.max[2] };
  } else {
    const acc = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, topZ: 0 };
    for (const part of solids) {
      const extent = sceneExtent(part);
      acc.minX = Math.min(acc.minX, extent.min[0]);
      acc.maxX = Math.max(acc.maxX, extent.max[0]);
      acc.minZ = Math.min(acc.minZ, extent.min[1]);
      acc.maxZ = Math.max(acc.maxZ, extent.max[1]);
      acc.topZ = Math.min(acc.topZ, extent.min[2]);
    }
    if (!Number.isFinite(acc.minX)) {
      footprint = { minX: -8, maxX: 8, minZ: -8, maxZ: 8, topZ: 0 };
    } else {
      footprint = {
        minX: acc.minX - tuning.slabPad,
        maxX: acc.maxX + tuning.slabPad,
        minZ: acc.minZ - tuning.slabPad,
        maxZ: acc.maxZ + tuning.slabPad,
        topZ: Number.isFinite(acc.topZ) ? acc.topZ : 0,
      };
    }
  }

  const cx = (footprint.minX + footprint.maxX) / 2;
  const cz = (footprint.minZ + footprint.maxZ) / 2;
  const deck = footprint.topZ; // scene z of the slab's walkable top

  // scene [x, y, z] -> world [x, y, z] (y up, slab top at y = 0)
  const toWorld = (point) => [point[0] - cx, point[2] - deck, point[1] - cz];

  const parts = solids.map((part) => {
    const extent = sceneExtent(part);
    const center = world_center(extent);
    const worldCenter = toWorld(center);
    const common = {
      id: part.id,
      kind: part.kind,
      label: typeof part.label === 'string' ? part.label : null,
      sublabel: typeof part.sublabel === 'string' ? part.sublabel : null,
      color: part.color,
      hex: tokenHex(part.color, theme),
      finish: finishOf(part.color),
      accent: part.accent === true,
      pos: world_point(worldCenter),
      ...world_decor(part),
      // Surface variation is decided here, in the pure layer, so the runtime
      // only ever looks it up: same scene, same skin, same capture.
      lightness: partLightness(part.id),
      variant: textureVariant(part),
      texel: WORLD_TEXEL,
    };
    if (part.kind === 'cylinder') {
      const axis = part.axis == null ? 'z' : part.axis;
      return {
        ...common,
        radius: world_round(Number(part.radius)),
        height: world_round(Number(part.h)),
        // scene z-axis cylinders stand up in the world (world y).
        axis: axis === 'z' ? 'y' : axis === 'x' ? 'x' : 'z',
        size: world_point([
          extent.max[0] - extent.min[0],
          extent.max[2] - extent.min[2],
          extent.max[1] - extent.min[1],
        ]),
      };
    }
    return {
      ...common,
      size: world_point([
        extent.max[0] - extent.min[0],
        extent.max[2] - extent.min[2],
        extent.max[1] - extent.min[1],
      ]),
    };
  });

  const slabToken = slabPart ? slabPart.color : 'slate';
  const slab = {
    token: slabToken,
    hex: tokenHex(slabToken, theme),
    thickness: tuning.slabThickness,
    size: world_point([footprint.maxX - footprint.minX, tuning.slabThickness, footprint.maxZ - footprint.minZ]),
    // Centre of the slab box: its top face is at y = 0.
    pos: world_point([0, -tuning.slabThickness / 2, 0]),
    footprint: {
      minX: world_round(footprint.minX - cx),
      maxX: world_round(footprint.maxX - cx),
      minZ: world_round(footprint.minZ - cz),
      maxZ: world_round(footprint.maxZ - cz),
    },
    sourceId: slabPart ? slabPart.id : null,
  };

  // Cables run low, under the machines they serve: a fixed height off the
  // deck reads as infrastructure, where an overhead canopy read as scaffolding.
  const cableHeight = world_round(tuning.cableRun);

  // Plan-view footprints every run has to steer around. Thin plates are not
  // obstacles: a cable crossing a 0.2-unit pad looks right.
  const obstacles = parts
    .filter((part) => part.size[1] > tuning.cableRun * 0.45)
    .map((part) => ({
      id: part.id,
      minX: part.pos[0] - part.size[0] / 2,
      maxX: part.pos[0] + part.size[0] / 2,
      minZ: part.pos[2] - part.size[2] / 2,
      maxZ: part.pos[2] + part.size[2] / 2,
    }));
  const obstaclesExcept = (fromId, toId) => obstacles.filter((rect) => rect.id !== fromId && rect.id !== toId);

  // The place the diorama stands in. Planned here, before the cable runs, so
  // the roads it lays down can push the pylons off the asphalt.
  const env = planEnvironment(
    requestedEnv,
    slab.footprint,
    parts,
    { ...WORLD_ENV_TUNING, ...(options.envTuning || {}) },
    `${typeof scene.title === 'string' ? scene.title : ''}|${parts.length}`,
  );

  // A pole may not stand inside a part, and labels float above parts, so the
  // same footprints (grown a little) keep masts clear of both.
  // Cables may cross a road; a pylon standing in the middle of one may not.
  // The asphalt is treated exactly like a part footprint, clearance included.
  const poleBlockers = obstacles.concat(env.roadRects);
  const poleFits = (x, z) => poleBlockers.every((rect) => (
    x < rect.minX - tuning.poleClear
    || x > rect.maxX + tuning.poleClear
    || z < rect.minZ - tuning.poleClear
    || z > rect.maxZ + tuning.poleClear
  ));

  // Slide a pole along the run before giving up on it.
  const placePole = (x, z, dirX, dirZ) => {
    if (poleFits(x, z)) return [x, z];
    for (let step = 0.3; step <= tuning.poleSlide + 1e-9; step += 0.3) {
      for (const sign of [1, -1]) {
        const px = x + dirX * step * sign;
        const pz = z + dirZ * step * sign;
        if (poleFits(px, pz)) return [px, pz];
      }
    }
    return null;
  };

  const byId = new Map(sceneParts.map((part) => [part.id, part]));
  const sceneLinks = Array.isArray(scene.links) ? scene.links : [];
  const links = [];
  const linkIndex = new Map();

  const routeBetween = (fromPart, toPart, requestedFromPort, requestedToPort) => {
    const fromPorts = sceneAnchors(fromPart);
    const toPorts = sceneAnchors(toPart);
    const fromPort = requestedFromPort && fromPorts[requestedFromPort]
      ? requestedFromPort
      : world_nearestPort(fromPorts, world_portCenter(toPorts, WORLD_SIDE_PORTS), WORLD_SIDE_PORTS);
    const toPort = requestedToPort && toPorts[requestedToPort]
      ? requestedToPort
      : world_nearestPort(toPorts, world_portCenter(fromPorts, WORLD_SIDE_PORTS), WORLD_SIDE_PORTS);
    const a = toWorld(fromPorts[fromPort]);
    const b = toWorld(toPorts[toPort]);
    // Step out along the port normal first: the riser then hangs in free air
    // instead of scraping down the face it is plugged into.
    const fromNormal = WORLD_PORT_NORMAL[fromPort] || [0, 0];
    const toNormal = WORLD_PORT_NORMAL[toPort] || [0, 0];
    const lead = [a[0] + fromNormal[0] * tuning.portOffset, a[2] + fromNormal[1] * tuning.portOffset];
    const tail = [b[0] + toNormal[0] * tuning.portOffset, b[2] + toNormal[1] * tuning.portOffset];
    const plan = planRoute(
      lead[0], lead[1], tail[0], tail[1],
      obstaclesExcept(fromPart.id, toPart.id),
      tuning.clearMargin,
    );
    const span = world_polylineLength(plan.map((node) => [node[0], 0, node[1]]));
    const points = [a.slice()];
    for (let index = 0; index < plan.length; index += 1) {
      points.push([plan[index][0], cableHeight, plan[index][1]]);
    }
    points.push(b.slice());
    const segments = world_segmentsFrom(points, tuning.sagRatio, tuning.sagMax);
    return { fromPort, toPort, a: world_point(a), b: world_point(b), span: world_round(span), points: points.map(world_point), segments, plan };
  };

  // Poles stand at an elbow, or once in the middle of a long straight run.
  const polesFor = (plan, span) => {
    const height = world_round(cableHeight + tuning.poleLift);
    const spots = [];
    if (plan.length > 2) {
      for (let index = 1; index < plan.length - 1; index += 1) {
        const before = plan[index - 1];
        const after = plan[index + 1];
        const dx = after[0] - before[0];
        const dz = after[1] - before[1];
        const length = Math.hypot(dx, dz) || 1;
        spots.push([plan[index][0], plan[index][1], dx / length, dz / length]);
      }
    } else if (span > tuning.poleSpan) {
      const [ax, az] = plan[0];
      const [bx, bz] = plan[plan.length - 1];
      const dx = bx - ax;
      const dz = bz - az;
      const length = Math.hypot(dx, dz) || 1;
      spots.push([(ax + bx) / 2, (az + bz) / 2, dx / length, dz / length]);
    }
    const poles = [];
    for (const [x, z, dirX, dirZ] of spots) {
      const placed = placePole(x, z, dirX, dirZ);
      if (!placed) continue; // no room: the run simply goes pole-less
      poles.push({ pos: world_point([placed[0], 0, placed[1]]), height });
    }
    return poles;
  };

  sceneLinks.forEach((link) => {
    const fromPart = byId.get(link.from);
    const toPart = byId.get(link.to);
    if (!fromPart || !toPart) return;
    const route = routeBetween(fromPart, toPart, link.fromPort, link.toPort);
    const poles = polesFor(route.plan, route.span);
    const style = poles.length ? 'poles' : 'tray';
    const entry = {
      index: links.length,
      from: link.from,
      to: link.to,
      fromPort: route.fromPort,
      toPort: route.toPort,
      kind: link.kind === 'cable' ? 'cable' : 'tube',
      style,
      color: link.color,
      hex: tokenHex(link.color, theme),
      label: typeof link.label === 'string' ? link.label : null,
      span: route.span,
      height: cableHeight,
      points3D: route.points,
      segments: route.segments,
      poles,
    };
    links.push(entry);
    linkIndex.set(`${link.from}\u0000${link.to}`, entry);
  });

  const sceneFlows = Array.isArray(scene.flows) ? scene.flows : [];
  const flows = sceneFlows.map((flow, index) => {
    const path = Array.isArray(flow.path) ? flow.path : [];
    const segments = [];
    const points = [];
    const cables = [];
    for (let step = 0; step < path.length - 1; step += 1) {
      const fromId = path[step];
      const toId = path[step + 1];
      let hop = linkIndex.get(`${fromId}\u0000${toId}`);
      let reversed = false;
      if (!hop) {
        hop = linkIndex.get(`${toId}\u0000${fromId}`);
        reversed = Boolean(hop);
      }
      let hopSegments;
      if (hop) {
        cables.push(hop.index);
        hopSegments = reversed
          ? hop.segments.slice().reverse().map((segment) => ({ a: segment.b, b: segment.a, length: segment.length, sag: segment.sag }))
          : hop.segments;
      } else {
        const fromPart = byId.get(fromId);
        const toPart = byId.get(toId);
        if (!fromPart || !toPart) continue;
        hopSegments = routeBetween(fromPart, toPart).segments;
      }
      for (const segment of hopSegments) {
        const last = points[points.length - 1];
        if (!last || last[0] !== segment.a[0] || last[1] !== segment.a[1] || last[2] !== segment.a[2]) {
          points.push(segment.a);
        }
        points.push(segment.b);
        segments.push(segment);
      }
    }
    return {
      index,
      kind: flow.kind,
      color: flow.color,
      hex: tokenHex(flow.color, theme),
      // Scene speed is loops per minute; period in seconds keeps the runtime
      // free of unit guesswork.
      speed: flow.speed,
      period: world_round(60 / (Number(flow.speed) || 12)),
      count: flow.count,
      path,
      cables,
      points3D: points,
      segments,
    };
  });

  const bounds = parts.reduce(
    (acc, part) => {
      for (let axis = 0; axis < 3; axis += 1) {
        acc.min[axis] = Math.min(acc.min[axis], part.pos[axis] - part.size[axis] / 2);
        acc.max[axis] = Math.max(acc.max[axis], part.pos[axis] + part.size[axis] / 2);
      }
      return acc;
    },
    { min: [slab.footprint.minX, -slab.thickness, slab.footprint.minZ], max: [slab.footprint.maxX, 0, slab.footprint.maxZ] },
  );

  // Framing uses the solids, not the slab: a scene with a generous ground
  // plate should still fill the frame with its machinery.
  const content = parts.length
    ? parts.reduce(
      (acc, part) => {
        for (let axis = 0; axis < 3; axis += 1) {
          acc.min[axis] = Math.min(acc.min[axis], part.pos[axis] - part.size[axis] / 2);
          acc.max[axis] = Math.max(acc.max[axis], part.pos[axis] + part.size[axis] / 2);
        }
        return acc;
      },
      { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
    )
    : { min: [slab.footprint.minX, 0, slab.footprint.minZ], max: [slab.footprint.maxX, 0, slab.footprint.maxZ] };
  const contentCenter = [
    (content.min[0] + content.max[0]) / 2,
    (content.min[1] + content.max[1]) / 2,
    (content.min[2] + content.max[2]) / 2,
  ];

  const notes = (Array.isArray(scene.notes) ? scene.notes : [])
    .filter((note) => note && byId.has(note.at))
    .map((note) => ({ text: note.text, at: note.at }));

  return {
    version: 1,
    theme,
    title: typeof scene.title === 'string' ? scene.title : '',
    subtitle: typeof scene.subtitle === 'string' ? scene.subtitle : '',
    hint: typeof scene.hint === 'string' ? scene.hint : '',
    origin: world_point([cx, deck, cz]),
    cableHeight,
    slab,
    env,
    parts,
    links,
    flows,
    notes,
    readout: Array.isArray(scene.readout) ? scene.readout.map((entry) => ({ label: entry.label, value: entry.value })) : [],
    bounds: { min: world_point(bounds.min), max: world_point(bounds.max) },
    content: {
      min: world_point(content.min),
      max: world_point(content.max),
      center: world_point(contentCenter),
      radius: world_round(Math.max(
        Math.hypot(content.max[0] - content.min[0], content.max[2] - content.min[2]) / 2,
        (content.max[1] - content.min[1]) / 2,
        2,
      )),
    },
    stats: {
      parts: parts.length,
      links: links.length,
      flows: flows.length,
      pulses: flows.reduce((total, flow) => total + (Number(flow.count) || 0), 0),
      poles: links.reduce((total, link) => total + link.poles.length, 0),
      env: env.mode,
      roads: env.roadRects.length,
      props: (env.city ? env.city.props.length : 0) + (env.warehouse ? env.warehouse.props.length : 0),
      lamps: env.city ? env.city.lamps.length : 0,
      // The road network's own verdict, so a capture can prove the thing the
      // plan promises: every end classified, every component with a way in.
      segments: env.network.segments,
      termini: env.network.counts,
      orphans: env.network.orphans.length,
      network: env.network.ok ? 'ok' : 'orphaned',
    },
    tuning,
  };
}

export default buildWorld;
