// world/runtime.mjs — the WebGL diorama runtime.
//
// Consumes the pure model from world/scene3d.mjs and builds a real-time
// miniature: slab, procedural materials, overhead power infrastructure,
// travelling pulses, orbit navigation and a first-person walk mode.
//
// The build concatenates this file after three.js and its addons, so three's
// exports (Scene, Mesh, ...) are in scope and relative imports are stripped.
// Every top-level name here is prefixed world_ / WORLD_ to stay clear of
// three's own module scope.

import {
  WORLD_TEXEL,
  avenueRect,
  buildWorld,
  cylinderUvScale,
  hashToken,
  remapBoxUv,
  textureDescriptor,
  tokenHex,
} from './scene3d.mjs';

// The hero pose mirrors the SVG isometric framing: 45 degrees round, ~34
// degrees up, and a long narrow lens so the diorama reads as an orthographic
// model rather than a photograph of one.
const WORLD_HOME = { azimuth: -Math.PI * 0.25, polar: Math.PI * 0.3111, fill: 0.8 };
const WORLD_HERO_FOV = 20;
const WORLD_FP_FOV = 62;
const WORLD_FP_HEIGHT = 1.3;
const WORLD_FP_SPEED = 6.2;
const WORLD_FP_SPRINT = 2.1;
const WORLD_FP_RADIUS = 0.45;
const WORLD_FOCUS_FILL = 0.6;
const WORLD_FLY_MS = 720;
const WORLD_PULSE_REACH = 2.4;
const WORLD_TEX = 256;
const WORLD_FREEZE_REPAINTS = 24;

// ---------------------------------------------------------------- utilities

// One hash for the whole runtime, borrowed from the pure layer so a part's
// texture variant and its lightness can never disagree.
function world_hash(text) {
  return hashToken(text);
}

// Deterministic replacement for Math.random inside texture painting: the same
// token+theme always paints the same pixels, which is what `?t=` needs.
function world_rng(seed) {
  let state = (world_hash(seed) || 1) >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

function world_clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

function world_lerp(a, b, t) {
  return a + (b - a) * t;
}

function world_easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

// The SVG renders each token as a lit top face (base lightened 24%); a raw
// MeshStandardMaterial fed the base hex comes back visibly duller once the
// lighting has had its way with it. Lift the base back towards the SVG tone
// and push a little saturation into the plastics.
function world_tokenColor(hex, finish) {
  const color = new Color(hex);
  const lift = finish === 'metal' ? 0.12 : finish === 'neutral' ? 0.14 : 0.2;
  color.lerp(new Color(0xffffff), lift);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  const boost = finish === 'plastic' ? 1.15 : finish === 'warm' ? 1.1 : 1.04;
  color.setHSL(hsl.h, world_clamp(hsl.s * boost, 0, 1), hsl.l);
  return color;
}

// Fully desaturated, slightly lifted: the slab is concrete, not soil.
function world_concreteTone(hex, dark) {
  const color = new Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  // A hair of blue, not zero saturation: the key light is warm, and a truly
  // neutral pour comes back out of it looking like sand.
  color.setHSL(0.58, 0.05, world_clamp(dark ? hsl.l * 0.7 + 0.08 : hsl.l * 0.45 + 0.34, 0, 1));
  return `#${color.getHexString()}`;
}

function world_shade(hex, amount) {
  const color = new Color(hex);
  const target = amount >= 0 ? new Color(0xffffff) : new Color(0x000000);
  return `#${color.lerp(target, Math.abs(amount)).getHexString()}`;
}

function world_query() {
  const params = new URLSearchParams(
    typeof location === 'undefined' ? '' : location.search || '',
  );
  const raw = params.get('t');
  const frozen = raw === null || raw === '' ? null : Number(raw);
  const debug = params.get('debug');
  // How much of the frame a ?focus= part should fill. The default reads as a
  // product shot; a capture that has to prove the surface detail asks for more.
  const rawFill = params.get('fill');
  const fill = rawFill === null || rawFill === '' ? null : Number(rawFill);
  // Which environment to generate, overriding whatever the scene asked for.
  // Only for demos and captures: a scene normally decides this itself.
  const env = params.get('env');
  return {
    env: env === 'warehouse' || env === 'city' || env === 'auto' ? env : null,
    frozen: frozen !== null && Number.isFinite(frozen) ? frozen : null,
    cam: params.get('cam') || null,
    focus: params.get('focus') || null,
    fill: fill !== null && Number.isFinite(fill) ? world_clamp(fill, 0.1, 4) : null,
    // The parts/links/draw-calls readout is a development aid, so it is off
    // unless ?debug=1 asks for it.
    debug: debug === '1' || debug === 'true',
  };
}

// ----------------------------------------------------------- canvas textures

const world_textureCache = new Map();

// GPU memory is not reclaimed by dropping references: every canvas texture
// stays resident until it is told to go. Teardown walks the cache once.
world_textureCache.dispose = function world_textureCacheDispose() {
  for (const texture of world_textureCache.values()) {
    if (texture && typeof texture.dispose === 'function') texture.dispose();
  }
  world_textureCache.clear();
};

function world_canvas(size = WORLD_TEX) {
  return world_canvasOf(size, size);
}

// Everything else here paints a WORLD_TEX tile; the ground overlay is clamped
// over the whole slab and sizes itself, so it needs a canvas of its own size.
function world_canvasOf(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// Albedo tiles are painted as near-white greys and tinted by material.color,
// so one 256px tile serves every token in its family. That is what keeps the
// texture budget flat while every part still gets a different paint job.
const WORLD_ALBEDO_LEVEL = 241;
// The tile is an sRGB map, so the brightness it costs has to be put back in
// linear light: 241/255 sRGB decodes to 0.88 linear, not 0.945. Compensating
// with the sRGB ratio leaves every part a visible 7% dark and, after tone
// mapping, noticeably washed out.
const WORLD_ALBEDO_COMPENSATE = 1 / (((WORLD_ALBEDO_LEVEL / 255 + 0.055) / 1.055) ** 2.4);
const WORLD_ANISOTROPY = 4;

function world_grainTone(delta) {
  const level = world_clamp(Math.round(WORLD_ALBEDO_LEVEL + delta), 0, 255);
  return `rgb(${level},${level},${level})`;
}

function world_grainRGBA(delta, alpha) {
  const level = world_clamp(Math.round(WORLD_ALBEDO_LEVEL + delta), 0, 255);
  return `rgba(${level},${level},${level},${alpha})`;
}

/**
 * Cache a canvas-painted texture under `key`. Everything that shows up on a
 * part goes through here, so the scene's whole texture budget is the size of
 * this one map and `?t=` captures stay byte-identical.
 */
function world_finishTexture(cache, key, paint, {
  repeat = 1, srgb = false, clamp = false, width = 0, height = 0,
} = {}) {
  if (cache.has(key)) return cache.get(key);
  const canvas = width && height ? world_canvasOf(width, height) : world_canvas();
  paint(canvas.getContext('2d'), canvas.width, canvas.height, world_rng(key));
  const texture = new CanvasTexture(canvas);
  const wrap = clamp ? ClampToEdgeWrapping : RepeatWrapping;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.repeat.set(repeat, repeat);
  // Mipmaps plus a little anisotropy: at the hero angle a 1px panel seam runs
  // away from the camera almost edge-on, and without either it aliases into a
  // crawling dotted line.
  texture.generateMipmaps = true;
  texture.anisotropy = WORLD_ANISOTROPY;
  if (srgb) texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

// --------------------------------------------------------- albedo ingredients

// Brushed grain: crisp single-pixel horizontal streaks at +/-3% of the base
// level. Solid tones rather than stacked alpha, so the contrast is exactly
// what the descriptor asks for however many lines happen to overlap.
function world_paintBrushGrain(ctx, width, height, rand, reach) {
  for (let index = 0; index < 1300; index += 1) {
    const y = Math.floor(rand() * height) + 0.5;
    const x = Math.floor(rand() * width);
    const length = 12 + rand() * 96;
    const sign = rand() < 0.5 ? 1 : -1;
    ctx.strokeStyle = world_grainTone(sign * (0.35 + rand() * 0.65) * reach);
    ctx.lineWidth = rand() < 0.26 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y);
    ctx.stroke();
  }
}

// Cross-hatch for copper and sand: the horizontal brush plus a lighter pass at
// a shallow angle, which is how a scotch-brite finish catches a key light.
function world_paintCrossGrain(ctx, width, height, rand, reach) {
  world_paintBrushGrain(ctx, width, height, rand, reach * 0.8);
  for (let index = 0; index < 420; index += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const length = 18 + rand() * 70;
    const lift = rand() < 0.5 ? 1 : -1;
    ctx.strokeStyle = world_grainRGBA(lift * reach, 0.5);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y + length * (rand() < 0.5 ? 0.22 : -0.22));
    ctx.stroke();
  }
}

// Matte plastic: fine speckle for the albedo, plus wider soft dimples that
// give the bump channel something low-frequency to catch. Without the dimples
// a moulded case reads as printed paper.
function world_paintSpeckleGrain(ctx, width, height, rand, reach) {
  for (let index = 0; index < 4400; index += 1) {
    const x = rand() * width;
    const y = rand() * height;
    ctx.fillStyle = world_grainTone((rand() - 0.5) * 2 * reach);
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + rand() * 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let index = 0; index < 240; index += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const radius = 3 + rand() * 8;
    const dimple = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const delta = (rand() - 0.5) * 1.4 * reach;
    dimple.addColorStop(0, world_grainRGBA(delta, 0.55));
    dimple.addColorStop(1, world_grainRGBA(delta, 0));
    ctx.fillStyle = dimple;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Inset panel grid: a one-pixel darker seam along the top and left of every
// cell with a lit lip just inside it. Two pixels of contrast is all it takes
// to turn a painted face into bolted sheet metal.
function world_paintPanelGrid(ctx, width, height, step) {
  if (!step || step < 8) return;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      ctx.fillStyle = world_grainTone(-34);
      ctx.fillRect(x, y, step, 1);
      ctx.fillRect(x, y, 1, step);
      ctx.fillStyle = world_grainTone(10);
      ctx.fillRect(x + 1, y + 1, step - 2, 1);
      ctx.fillStyle = world_grainTone(-7);
      ctx.fillRect(x, y + step - 1, step, 1);
    }
  }
}

// Canvas row 0 is the top of the texture (CanvasTexture flips Y), so the wear
// band belongs at row 0 and the grime at the last row.
function world_paintWearBand(ctx, width, height, amount) {
  const reach = Math.max(3, Math.round(height * 0.07));
  const lift = Math.round(amount * 255);
  const gradient = ctx.createLinearGradient(0, 0, 0, reach);
  gradient.addColorStop(0, world_grainRGBA(lift, 1));
  gradient.addColorStop(1, world_grainRGBA(lift, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, reach);
}

function world_paintGrime(ctx, width, height, amount, streaks, rand) {
  const reach = Math.round(height * 0.32);
  const drop = -Math.round(amount * 255);
  const gradient = ctx.createLinearGradient(0, height - reach, 0, height);
  gradient.addColorStop(0, world_grainRGBA(drop, 0));
  gradient.addColorStop(1, world_grainRGBA(drop, 1));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, height - reach, width, reach);
  // Streaks hang from the vents, so they start a third of the way down and
  // fade out before the base grime, not into it.
  for (let index = 0; index < streaks; index += 1) {
    const x = Math.floor(rand() * width);
    const top = Math.round(height * (0.2 + rand() * 0.2));
    const run = Math.round(height * (0.18 + rand() * 0.28));
    const streak = ctx.createLinearGradient(0, top, 0, top + run);
    streak.addColorStop(0, world_grainRGBA(drop, 0));
    streak.addColorStop(0.3, world_grainRGBA(drop, 0.8));
    streak.addColorStop(1, world_grainRGBA(drop, 0));
    ctx.fillStyle = streak;
    ctx.fillRect(x, top, 2 + Math.floor(rand() * 3), run);
  }
}

/**
 * One family skin: grain, panel grid, top-edge wear, base grime and (on the
 * detail variant) grime streaks. Driven entirely by the pure descriptor, so
 * the picture is a function of (family, variant) and nothing else.
 */
function world_paintFamily(ctx, width, height, rand, descriptor) {
  ctx.fillStyle = world_grainTone(0);
  ctx.fillRect(0, 0, width, height);
  // +/-13 of 241 is about +/-5%. The spec asks for 3%, but at the hero
  // distance a 3% grain is below the dither floor of a software-rasterised
  // frame and the part comes back looking exactly as flat as before.
  const reach = 13;
  if (descriptor.grain === 'speckle') world_paintSpeckleGrain(ctx, width, height, rand, 10);
  else if (descriptor.grain === 'crosshatch') world_paintCrossGrain(ctx, width, height, rand, reach);
  else world_paintBrushGrain(ctx, width, height, rand, reach);
  world_paintPanelGrid(ctx, width, height, descriptor.panelStep);
  world_paintWearBand(ctx, width, height, descriptor.wear);
  world_paintGrime(ctx, width, height, descriptor.grime, descriptor.streaks, rand);
}

// Drum wall: the family brush plus two welded ring seams, each a shadow line
// with a highlight sitting on top of it. Matches the banded tanks in the SVG.
function world_paintCylinderSide(ctx, width, height, rand) {
  ctx.fillStyle = world_grainTone(0);
  ctx.fillRect(0, 0, width, height);
  world_paintBrushGrain(ctx, width, height, rand, 8);
  for (const at of [0.3, 0.72]) {
    const y = Math.round(height * at);
    ctx.fillStyle = world_grainTone(10);
    ctx.fillRect(0, y - 2, width, 2);
    ctx.fillStyle = world_grainTone(-22);
    ctx.fillRect(0, y, width, 2);
    ctx.fillStyle = world_grainTone(-8);
    ctx.fillRect(0, y + 2, width, 2);
  }
  world_paintWearBand(ctx, width, height, 0.04);
  world_paintGrime(ctx, width, height, 0.05, 0, rand);
}

// Drum lid: a radial brushed sheen with an inset rim ring at 0.88r, which is
// the detail that reads as a bolted-down tank top from the hero angle.
function world_paintCylinderCap(ctx, width, height, rand) {
  const cx = width / 2;
  const cy = height / 2;
  ctx.fillStyle = world_grainTone(0);
  ctx.fillRect(0, 0, width, height);
  for (let index = 0; index < 900; index += 1) {
    const angle = rand() * Math.PI * 2;
    const from = rand() * cx;
    const span = 6 + rand() * 40;
    ctx.strokeStyle = world_grainRGBA((rand() < 0.5 ? 1 : -1) * 7, 0.7);
    ctx.lineWidth = rand() < 0.3 ? 1.6 : 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, from, angle, angle + span / Math.max(6, from));
    ctx.stroke();
  }
  const sheen = ctx.createRadialGradient(cx * 0.72, cy * 0.72, 0, cx, cy, cx);
  sheen.addColorStop(0, world_grainRGBA(11, 1));
  sheen.addColorStop(0.55, world_grainRGBA(0, 0));
  sheen.addColorStop(1, world_grainRGBA(-13, 1));
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = world_grainTone(-24);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, cx * 0.88, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = world_grainTone(10);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, cx * 0.88 - 2, 0, Math.PI * 2);
  ctx.stroke();
}

// ------------------------------------------------------------ overlay decals

// Vent grille: six recessed slits with a shadowed sill under each. Drawn once
// and stretched across a strip plane, which is one draw call instead of the
// three inset boxes it replaces.
//
// The sill used to be near-white (126,133,143). Under the dark theme's key
// light that read as if the slits were lit from inside, so the whole grille
// glowed instead of recessing. It is a mid-grey now, and every tone in the
// tile is taken down a further 20% so the grille sits under the body colour
// in both themes rather than punching through it.
const WORLD_VENT_DARKEN = 0.8;

function world_ventTone(r, g, b) {
  const k = WORLD_VENT_DARKEN;
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}

function world_paintVents(ctx, width, height) {
  // The whole tile is the recess, so the plane has no pale border fighting the
  // body colour: a grille is a hole in the case, not a sticker on it.
  ctx.fillStyle = world_ventTone(44, 47, 53);
  ctx.fillRect(0, 0, width, height);
  const slits = 6;
  const pitch = height / slits;
  const slit = pitch * 0.5;
  for (let index = 0; index < slits; index += 1) {
    const y = index * pitch + (pitch - slit) / 2;
    ctx.fillStyle = world_ventTone(16, 17, 20);
    ctx.fillRect(width * 0.03, y, width * 0.94, slit);
    // The sill under each slit is what gives the strip its depth. Mid-grey,
    // not near-white: it has to read as a lip catching a little light, not as
    // a filament behind the grille.
    ctx.fillStyle = world_ventTone(92, 97, 105);
    ctx.fillRect(width * 0.03, y + slit, width * 0.94, Math.max(1, pitch * 0.09));
  }
}

// Rack front: eight 1U slots, each with a handle notch and a couple of abstract
// unit marks. No live text: at hero distance glyphs turn to mush, and the marks
// carry the same "this is a populated rack" read for a fraction of the pixels.
function world_paintRack(ctx, width, height) {
  ctx.fillStyle = 'rgb(58,62,69)';
  ctx.fillRect(0, 0, width, height);
  const units = 8;
  const pitch = height / units;
  for (let index = 0; index < units; index += 1) {
    const y = index * pitch;
    ctx.fillStyle = index % 3 === 2 ? 'rgb(84,91,101)' : 'rgb(112,120,132)';
    ctx.fillRect(width * 0.05, y + pitch * 0.12, width * 0.9, pitch * 0.72);
    ctx.fillStyle = 'rgb(30,32,37)';
    ctx.fillRect(width * 0.05, y + pitch * 0.84, width * 0.9, pitch * 0.1);
    // Handle notch plus two unit marks, the abstract stand-in for U1..U8.
    ctx.fillStyle = 'rgb(196,203,213)';
    ctx.fillRect(width * 0.09, y + pitch * 0.36, width * 0.1, pitch * 0.2);
    ctx.fillStyle = 'rgb(150,158,169)';
    ctx.fillRect(width * 0.74, y + pitch * 0.38, width * 0.05, pitch * 0.16);
    ctx.fillRect(width * 0.82, y + pitch * 0.38, width * 0.09, pitch * 0.16);
  }
}

// Equipment plate: a pale label with two rule lines, the 3D answer to the SVG's
// label chip.
function world_paintPlate(ctx, width, height) {
  ctx.fillStyle = 'rgb(236,231,220)';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgb(206,199,185)';
  ctx.fillRect(0, 0, width, 3);
  ctx.fillRect(0, height - 3, width, 3);
  ctx.fillStyle = 'rgb(74,79,88)';
  ctx.fillRect(width * 0.1, height * 0.3, width * 0.62, height * 0.1);
  ctx.fillStyle = 'rgb(126,133,143)';
  ctx.fillRect(width * 0.1, height * 0.56, width * 0.4, height * 0.07);
}

// Concrete deck: a neutral pour with faint slurry and clean expansion joints.
// The mottle is deliberately weak (a quarter of what reads as "interesting"
// close up) because at hero distance any more of it turns the slab into mud.
const WORLD_CONCRETE_MOTTLE = 0.25;
const WORLD_CONCRETE_JOINT = 0.12;

function world_paintConcrete(ctx, width, height, rand, base, options = {}) {
  const joint = options.joint === undefined ? WORLD_CONCRETE_JOINT : options.joint;
  // How many expansion bays the tile is cut into, per axis. The slab tiles a
  // square texture so both are four; a dais clamps one texture over its whole
  // top, so it asks for however many ~4-unit bays actually fit on each side.
  const baysX = options.baysX === undefined ? 4 : options.baysX;
  const baysY = options.baysY === undefined ? 4 : options.baysY;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  for (let index = 0; index < 2600; index += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const radius = 2 + rand() * 11;
    const alpha = (0.012 + rand() * 0.03) * WORLD_CONCRETE_MOTTLE;
    // Grey on grey only: a warm or green cast here reads as dirt, not concrete.
    ctx.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  // Expansion joints every quarter tile. The tile is sized to WORLD_CONCRETE_TILE
  // world units by the caller's repeat, so a quarter is a ~4-unit bay: the same
  // pour pattern whatever footprint the scene happens to have.
  ctx.strokeStyle = `rgba(22,26,32,${joint})`;
  ctx.lineWidth = 1.6;
  for (let step = 1; step < baysX; step += 1) {
    const at = (width / baysX) * step;
    ctx.beginPath();
    ctx.moveTo(at, 0);
    ctx.lineTo(at, height);
    ctx.stroke();
  }
  for (let step = 1; step < baysY; step += 1) {
    const at = (height / baysY) * step;
    ctx.beginPath();
    ctx.moveTo(0, at);
    ctx.lineTo(width, at);
    ctx.stroke();
  }
  // Two or three hairline cracks: short dark polylines that wander off a joint.
  // At 8% they are invisible from the hero pose and are the first thing you see
  // when the camera drops to deck level, which is the point of them.
  ctx.strokeStyle = 'rgba(18,20,24,0.08)';
  ctx.lineWidth = 1;
  const cracks = 2 + Math.floor(rand() * 2);
  for (let index = 0; index < cracks; index += 1) {
    let x = rand() * width;
    let y = rand() * height;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let step = 0; step < 5; step += 1) {
      x += (rand() - 0.5) * 46;
      y += (rand() - 0.3) * 46;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// The concrete tile stands for this many world units, so the joints land on a
// real ~4-unit bay instead of stretching with the slab.
const WORLD_CONCRETE_TILE = 16;

// --------------------------------------------------------------------- dais

// A dais is a raised tier standing on the slab: the kafka partition rack, the
// web tier, the k8s cluster and CI strips. Painted with the body family skin
// it came out the same value as the deck below it and the two merged into one
// flat sheet. It gets the slab's own concrete pour instead, pulled off the
// steel token and a step darker, with the joints pushed up and a darkening
// strip run round the top border so the platform has an edge and a weight.
const WORLD_DAIS_DARKEN = 0.08;   // a step under the slab's concrete tone
const WORLD_DAIS_JOINT = 0.15;    // joint ink, up from the slab's 0.12
const WORLD_DAIS_AO = 0.1;        // border ink, inside the 8-12% the look asks for
const WORLD_DAIS_AO_WIDTH = 0.25; // world units of border strip
// Below this footprint a plate is a tray or a label pad, not a platform
// anybody could stand on.
const WORLD_DAIS_MIN_AREA = 12;
const WORLD_DAIS_MAX_HEIGHT = 2;

function world_isDais(part) {
  if (part.kind !== 'plate') return false;
  const [w, h, d] = part.size;
  return w * d >= WORLD_DAIS_MIN_AREA && h <= WORLD_DAIS_MAX_HEIGHT;
}

// A soft inward falloff along each border, not a hard ruled line: the strip
// has to read as contact shadow gathering at the lip, and a crisp band at 10%
// ink just looks like somebody drew a rectangle on the platform.
function world_paintEdgeAO(ctx, width, height, insetX, insetY, ink) {
  const edges = [
    [0, 0, width, insetY, 0, insetY, 0, 0],            // top, fading down
    [0, height - insetY, width, insetY, 0, height - insetY, 0, height],
    [0, 0, insetX, height, 0, 0, insetX, 0],           // left, fading right
    [width - insetX, 0, insetX, height, width, 0, width - insetX, 0],
  ];
  for (const [x, y, w, h, x0, y0, x1, y1] of edges) {
    if (w <= 0 || h <= 0) continue;
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, `rgba(14,17,22,${ink})`);
    gradient.addColorStop(1, 'rgba(14,17,22,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, w, h);
  }
}

// Number of ~4-unit expansion bays that fit along an edge of this many world
// units, so a dais is cut by the same pour pattern as the slab it stands on.
function world_daisBays(span) {
  return world_clamp(Math.round(span / (WORLD_CONCRETE_TILE / 4)), 1, 8);
}

// Slab sides: three strata bands over a darker base course, plus a bright
// sheen line along the top edge. Fixed band stops (not a random walk) are what
// make the strata legible from the hero angle instead of reading as noise.
// Canvas row 0 is the top of the face, so paint downwards from the deck.
const WORLD_STRATA_BANDS = [
  { to: 0.26, tone: 0.12 },  // top course, lightest
  { to: 0.5, tone: -0.06 },
  { to: 0.74, tone: -0.18 },
  { to: 1, tone: -0.36 },    // darker base band
];

function world_paintStrata(ctx, width, height, rand, base) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  let from = 0;
  for (const band of WORLD_STRATA_BANDS) {
    const to = band.to * height;
    ctx.fillStyle = band.tone >= 0
      ? `rgba(255,255,255,${band.tone})`
      : `rgba(0,0,0,${-band.tone})`;
    ctx.fillRect(0, from, width, to - from);
    // A hairline shadow under each course so the bands have an edge.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, to - 1.5, width, 1.5);
    from = to;
  }
  // Aggregate speckle, kept faint so the bands stay the loudest thing here.
  for (let index = 0; index < 700; index += 1) {
    const x = rand() * width;
    const spot = rand() * height;
    ctx.fillStyle = `rgba(0,0,0,${0.02 + rand() * 0.05})`;
    ctx.fillRect(x, spot, 1 + rand() * 3, 1 + rand() * 2);
  }
  // Rim sheen: the lit lip where the deck meets the side.
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.fillRect(0, 0, width, 2.5);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(0, 2.5, width, 2);
}

// Hazard band: 45-degree warning stripes, used on hazard:true parts.
function world_paintHazard(ctx, width, height) {
  ctx.fillStyle = '#1b1b1b';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#d7a442';
  ctx.lineWidth = width / 9;
  for (let index = -height; index < width + height; index += width / 4.5) {
    ctx.beginPath();
    ctx.moveTo(index, 0);
    ctx.lineTo(index + height, height);
    ctx.stroke();
  }
}

// Theme gradient behind the scene. Built as a DataTexture rather than a
// CanvasTexture: a 2D canvas uploaded as a full-screen background picks up
// stale glyph memory under software GL (SwiftShader), which shows up as ghost
// text across the sky. Raw bytes are also trivially deterministic.
function world_skyTexture(theme) {
  // Four stops, not three: the extra one sits just behind the slab so the dark
  // theme gets a faint horizon glow instead of a flat black void.
  const stops = theme === 'dark'
    ? [[0x07, 0x0b, 0x12], [0x0d, 0x14, 0x20], [0x1c, 0x2a, 0x3c], [0x06, 0x09, 0x0f]]
    : [[0xfd, 0xf9, 0xf1], [0xf7, 0xef, 0xdf], [0xec, 0xe0, 0xc9], [0xdc, 0xcf, 0xb6]];
  const height = 256;
  const data = new Uint8Array(height * 4);
  const sections = stops.length - 1;
  for (let row = 0; row < height; row += 1) {
    // Texture row 0 is the bottom of the screen, so walk the stops backwards.
    const t = 1 - row / (height - 1);
    const scaled = world_clamp(t * sections, 0, sections - 1e-6);
    const section = Math.floor(scaled);
    const local = scaled - section;
    const from = stops[section];
    const to = stops[section + 1];
    for (let channel = 0; channel < 3; channel += 1) {
      data[row * 4 + channel] = Math.round(world_lerp(from[channel], to[channel], local));
    }
    data[row * 4 + 3] = 255;
  }
  const texture = new DataTexture(data, 1, height, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// Radial falloff used by the fake-void shadow under the slab and by pulse glow.
function world_radialTexture(inner, outer, power) {
  const canvas = world_canvas(256);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (let step = 0; step <= 8; step += 1) {
    const t = step / 8;
    gradient.addColorStop(t, `rgba(255,255,255,${world_lerp(inner, outer, t ** power)})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// --------------------------------------------------------------- materials

const WORLD_FINISH_PARAMS = {
  metal: { roughness: 0.52, metalness: 0.46 },
  plastic: { roughness: 0.72, metalness: 0.05 },
  warm: { roughness: 0.54, metalness: 0.4 },
  neutral: { roughness: 0.68, metalness: 0.08 },
};

// The family skin does triple duty: albedo, bump and roughness. One tile means
// one upload and one cache slot, and because the tile *is* the height field,
// every panel seam and brush line it draws also catches the light. The smooth
// wear and grime gradients contribute almost nothing to bump (a bump map reads
// gradients, and theirs are tiny), which is exactly what we want from them.
function world_familySkin(finish, variant) {
  const descriptor = textureDescriptor('', finish, 'light', variant);
  return {
    descriptor,
    texture: world_finishTexture(
      world_textureCache,
      descriptor.key,
      (ctx, width, height, rand) => world_paintFamily(ctx, width, height, rand, descriptor),
      { repeat: 1, srgb: true },
    ),
  };
}

function world_materials(theme) {
  const made = new Map();
  return function world_material(hex, finish, variant = 'plain', lightness = 1) {
    const key = `${hex}|${finish}|${variant}|${theme}|${lightness}`;
    if (made.has(key)) return made.get(key);
    const tuning = WORLD_FINISH_PARAMS[finish] || WORLD_FINISH_PARAMS.plastic;
    const skin = world_familySkin(finish, variant);
    const color = world_tokenColor(hex, finish);
    // The tile is painted below white so its highlights have somewhere to go;
    // put that headroom back into the colour or every part comes out 6% dark.
    // The per-part lightness rides along here: a +/-3% wobble per unit costs a
    // material descriptor and no texture at all.
    color.multiplyScalar(WORLD_ALBEDO_COMPENSATE * lightness);
    const material = new MeshStandardMaterial({
      color,
      roughness: tuning.roughness,
      metalness: tuning.metalness,
      map: skin.texture,
      bumpMap: skin.texture,
      bumpScale: skin.descriptor.bumpScale,
      roughnessMap: skin.texture,
    });
    made.set(key, material);
    return material;
  };
}

// Drum skins are finish-independent on purpose: the ring seams and lid sheen
// are geometry, not paint, and the token tint arrives through material.color.
function world_cylinderMaterials(theme) {
  const made = new Map();
  return function world_cylinderMaterial(hex, finish, radius, height, lightness = 1) {
    const repeat = cylinderUvScale(radius, height, WORLD_TEXEL);
    const key = `${hex}|${finish}|${theme}|${repeat.u}|${repeat.v}|${lightness}`;
    if (made.has(key)) return made.get(key);
    const tuning = WORLD_FINISH_PARAMS[finish] || WORLD_FINISH_PARAMS.plastic;
    const color = world_tokenColor(hex, finish);
    color.multiplyScalar(WORLD_ALBEDO_COMPENSATE * lightness);
    const side = world_finishTexture(world_textureCache, 'cylinder:side', world_paintCylinderSide, { repeat: 1, srgb: true });
    const cap = world_finishTexture(world_textureCache, 'cylinder:cap', world_paintCylinderCap, { repeat: 1, srgb: true, clamp: true });
    // One shared tile, one clone per distinct repeat: a texture clone shares
    // the GPU upload, so this costs a descriptor and not a megabyte.
    const wall = side.clone();
    wall.wrapS = RepeatWrapping;
    wall.wrapT = RepeatWrapping;
    wall.repeat.set(repeat.u, repeat.v);
    wall.needsUpdate = true;
    const sideMaterial = new MeshStandardMaterial({
      color,
      roughness: tuning.roughness,
      metalness: tuning.metalness,
      map: wall,
      bumpMap: wall,
      bumpScale: 0.03,
      roughnessMap: wall,
    });
    const capMaterial = new MeshStandardMaterial({
      color,
      roughness: Math.max(0.3, tuning.roughness - 0.1),
      metalness: tuning.metalness,
      map: cap,
      bumpMap: cap,
      bumpScale: 0.02,
      roughnessMap: cap,
    });
    // CylinderGeometry material order: side, top cap, bottom cap.
    const materials = [sideMaterial, capMaterial, capMaterial];
    made.set(key, materials);
    return materials;
  };
}

// ----------------------------------------------------------------- geometry

function world_catenary(a, b, sag) {
  const start = new Vector3(a[0], a[1], a[2]);
  const end = new Vector3(b[0], b[1], b[2]);
  if (sag <= 1e-6) return new LineCurve3(start, end);
  const control = start.clone().add(end).multiplyScalar(0.5);
  control.y -= sag * 2;
  return new QuadraticBezierCurve3(start, control, end);
}

function world_curveFromSegments(segments) {
  const path = new CurvePath();
  for (const segment of segments) {
    if (segment.length <= 1e-6) continue;
    path.add(world_catenary(segment.a, segment.b, segment.sag));
  }
  return path;
}

function world_label(text, hex, theme) {
  const canvas = document.createElement('canvas');
  const scale = 2;
  const font = `600 ${22 * scale}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  const probe = canvas.getContext('2d');
  probe.font = font;
  const width = Math.ceil(probe.measureText(text).width) + 28 * scale;
  canvas.width = Math.max(32, width);
  canvas.height = 40 * scale;
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme === 'dark' ? 'rgba(18,22,28,0.82)' : 'rgba(253,251,246,0.86)';
  const radius = 10 * scale;
  ctx.beginPath();
  ctx.roundRect(1, 1, canvas.width - 2, canvas.height - 2, radius);
  ctx.fill();
  ctx.strokeStyle = theme === 'dark' ? 'rgba(232,237,244,0.26)' : 'rgba(34,38,44,0.22)';
  ctx.lineWidth = 1.5 * scale;
  ctx.stroke();
  ctx.fillStyle = theme === 'dark' ? '#e8edf4' : '#22262c';
  ctx.fillText(text, 14 * scale, canvas.height / 2 + 1);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set((canvas.width / canvas.height) * 0.62, 0.62, 1);
  sprite.renderOrder = 10;
  sprite.userData.world_hex = hex;
  return sprite;
}

// ------------------------------------------------------------------ builder

// The SVG cycles indicator colours across a panel; the world does the same.
const WORLD_LED_TOKENS = ['green', 'amber', 'blue', 'plum'];

function world_ledMaterials(theme) {
  const made = new Map();
  return function world_ledMaterial(token, accent) {
    const key = `${token}|${accent ? 'accent' : 'plain'}`;
    if (made.has(key)) return made.get(key);
    // Lift the token clear of its body tone, but only a little: past about a
    // 15% white mix the emissive clips through tone mapping and bloom, and
    // every indicator comes out of the renderer as the same white dot.
    const tone = new Color(tokenHex(token, theme)).lerp(new Color(0xffffff), 0.15);
    const material = new MeshStandardMaterial({
      color: tone,
      emissive: tone,
      emissiveIntensity: accent ? 2.4 : 1.25,
      roughness: 0.28,
      metalness: 0,
    });
    made.set(key, material);
    return material;
  };
}

// Stretch a box's face UVs to the shared texel density. BoxGeometry hands us a
// 0..1 square per face, which means a 14-unit slab and a 1-unit crate would
// each wrap exactly one tile; scaling per face from the part's real size is
// what makes a seam the same physical size everywhere in the diorama.
function world_remapBox(geometry, size) {
  const attribute = geometry.attributes.uv;
  if (!attribute) return geometry;
  const scaled = remapBoxUv(attribute.array, size, WORLD_TEXEL);
  for (let index = 0; index < scaled.length; index += 1) attribute.array[index] = scaled[index];
  attribute.needsUpdate = true;
  return geometry;
}

// A face has to be wide enough to carry a plate before one is worth sticking
// on it; below about 1.2 units the plate is bigger than the panel.
const WORLD_DECAL_MIN_FACE = 1.2;
const WORLD_DECAL_SIZE = [0.9, 0.5];

function world_overlayMaterial(cache, key, paint, {
  clamp = true, repeat = 1, roughness = 0.78, metalness = 0.06,
} = {}) {
  return new MeshStandardMaterial({
    map: world_finishTexture(cache, key, paint, { srgb: true, clamp, repeat }),
    roughness,
    metalness,
  });
}

// A grille is bare stamped sheet deep in a recess: fully rough and not at all
// metallic, so the key light cannot lay a specular sheen across the slits.
const WORLD_VENT_SURFACE = { roughness: 0.92, metalness: 0 };

/**
 * A dais body: the slab's own concrete pour on top, the slab's strata on the
 * sides, a dark underside. One clamped top texture per footprint, so the
 * border strip lands in world units instead of stretching with the plate, and
 * the strata map is the very one the slab already painted.
 */
function world_buildDais(part, model, dark) {
  const [w, h, d] = part.size;
  const slabTone = world_concreteTone(model.slab.hex, dark);
  // Steel family, a step darker than the deck: the platform has to sit under
  // the slab in value or the eye reads the two as one surface.
  const tone = world_shade(world_concreteTone(tokenHex('steel', model.theme), dark), -WORLD_DAIS_DARKEN);
  const baysX = world_daisBays(w);
  const baysY = world_daisBays(d);
  // The border is WORLD_DAIS_AO_WIDTH world units on both axes, which is a
  // different fraction of the texture on a 23x4 strip than on a 7x7 pad.
  const insetX = world_clamp((WORLD_DAIS_AO_WIDTH / w) * WORLD_TEX, 2, WORLD_TEX * 0.3);
  const insetY = world_clamp((WORLD_DAIS_AO_WIDTH / d) * WORLD_TEX, 2, WORLD_TEX * 0.3);
  const key = `dais:${tone}:${baysX}x${baysY}:${Math.round(insetX)}x${Math.round(insetY)}`;
  const top = world_finishTexture(
    world_textureCache,
    key,
    (ctx, width, height, rand) => {
      world_paintConcrete(ctx, width, height, rand, tone, {
        joint: WORLD_DAIS_JOINT, baysX, baysY,
      });
      world_paintEdgeAO(ctx, width, height, insetX, insetY, WORLD_DAIS_AO);
    },
    { repeat: 1, srgb: true, clamp: true },
  );
  const side = world_finishTexture(
    world_textureCache,
    `strata:${slabTone}`,
    (ctx, width, height, rand) => world_paintStrata(ctx, width, height, rand, world_shade(slabTone, -0.24)),
    { repeat: 1, srgb: true },
  );
  const topMaterial = new MeshStandardMaterial({ map: top, roughness: 0.9, metalness: 0.02 });
  const sideMaterial = new MeshStandardMaterial({ map: side, roughness: 0.9, metalness: 0.03 });
  const bottom = new MeshStandardMaterial({ color: new Color(world_shade(tone, -0.66)), roughness: 0.96 });
  const geometry = new BoxGeometry(w, h, d);
  // Same UV treatment as the slab: sides tiled in u only, top left as the
  // 0..1 square its clamped texture expects.
  const uv = geometry.attributes.uv;
  const faceU = [d, d, 1, 1, w, w];
  for (let face = 0; face < 6; face += 1) {
    const span = face === 2 || face === 3 ? 1 : Math.max(1, Math.round(faceU[face] / WORLD_SLAB_TILE));
    for (let vertex = 0; vertex < 4; vertex += 1) uv.array[(face * 4 + vertex) * 2] *= span;
  }
  uv.needsUpdate = true;
  return new Mesh(geometry, [
    sideMaterial, sideMaterial, topMaterial, bottom, sideMaterial, sideMaterial,
  ]);
}

function world_buildParts(root, model, material, cylinderMaterial, glowTexture) {
  const picks = [];
  const boxes = [];
  const labels = [];
  const dark = model.theme === 'dark';
  const ledMaterial = world_ledMaterials(model.theme);
  // Overlay skins are shared across every part that asks for one, so a scene
  // full of vented boxes still only pays for one vent texture.
  const overlays = new Map();
  const overlay = (key, paint, options) => {
    if (!overlays.has(key)) overlays.set(key, world_overlayMaterial(world_textureCache, key, paint, options));
    return overlays.get(key);
  };

  for (const part of model.parts) {
    const group = new Group();
    group.position.set(part.pos[0], part.pos[1], part.pos[2]);
    group.name = `part:${part.id}`;
    group.userData.world_part = part;

    const [w, h, d] = part.size;

    const body = part.kind === 'cylinder'
      ? new Mesh(
        new CylinderGeometry(part.radius, part.radius, part.height, 48, 1),
        cylinderMaterial(part.hex, part.finish, part.radius, part.height, part.lightness),
      )
      : world_isDais(part)
        ? world_buildDais(part, model, dark)
        : new Mesh(
          world_remapBox(new BoxGeometry(w, h, d), part.size),
          material(part.hex, part.finish, part.variant, part.lightness),
        );
    if (part.kind === 'cylinder') {
      if (part.axis === 'x') body.rotation.z = Math.PI / 2;
      if (part.axis === 'z') body.rotation.x = Math.PI / 2;
    }
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Vents: one strip of six recessed slits on the front face. The camera's
    // home pose looks at -x and +z, so every applied detail lives on one of
    // those two faces or it is pixels nobody ever sees.
    if (part.vents && part.kind !== 'cylinder') {
      const grille = new Mesh(
        new PlaneGeometry(Math.min(w * 0.68, 2.4), h * 0.4),
        overlay('vents', world_paintVents, WORLD_VENT_SURFACE),
      );
      grille.position.set(0, h * 0.08, d / 2 + 0.012);
      group.add(grille);
    }

    // Rack front: eight 1U slots. A rack is a populated cabinet, so it takes
    // the whole face and the label plate moves to the side.
    if (part.detail === 'rack' && part.kind !== 'cylinder') {
      const front = new Mesh(
        new PlaneGeometry(w * 0.82, h * 0.78),
        overlay('rack', world_paintRack),
      );
      front.position.set(0, 0, d / 2 + 0.012);
      group.add(front);
    }

    // LEDs: emissive dots cycling the SVG's indicator tokens, so a panel reads
    // green/amber/blue/plum instead of a row of white pinpricks. The accent
    // part burns brighter so bloom catches it.
    if (part.leds > 0) {
      for (let index = 0; index < part.leds; index += 1) {
        const token = WORLD_LED_TOKENS[index % WORLD_LED_TOKENS.length];
        const led = new Mesh(new SphereGeometry(0.078, 12, 8), ledMaterial(token, part.accent));
        const spread = (index - (part.leds - 1) / 2) * 0.26;
        led.position.set(spread, h * (part.vents ? 0.4 : 0.34), d / 2 + 0.05);
        group.add(led);
      }
    }

    // Equipment plate: the 3D answer to the SVG's label chip, on the west face
    // so it never fights the vents or the rack for the front panel.
    if (part.label && part.kind !== 'cylinder'
      && Math.min(d, h) >= WORLD_DECAL_MIN_FACE) {
      const plate = new Mesh(
        new PlaneGeometry(Math.min(WORLD_DECAL_SIZE[0], d * 0.7), Math.min(WORLD_DECAL_SIZE[1], h * 0.4)),
        overlay('plate', world_paintPlate),
      );
      plate.rotation.y = -Math.PI / 2;
      plate.position.set(-w / 2 - 0.012, h * 0.12, 0);
      group.add(plate);
    }

    // Hazard band: a thin striped wrap at the base. The stripes repeat with the
    // part's width so a wide unit gets more of them instead of wider ones.
    if (part.hazard) {
      const band = new Mesh(
        new BoxGeometry(w * 1.012, h * 0.1, d * 1.012),
        overlay('hazard', world_paintHazard, { clamp: false, repeat: 1 }),
      );
      band.material.map = band.material.map.clone();
      band.material.map.wrapS = RepeatWrapping;
      band.material.map.wrapT = RepeatWrapping;
      band.material.map.repeat.set(Math.max(1, Math.round(w / 1.2)), 1);
      band.material.map.needsUpdate = true;
      band.position.y = -h * 0.34;
      band.castShadow = true;
      group.add(band);
    }

    // Accent parts get a bloom-feeding halo so the eye lands on them.
    if (part.accent) {
      const halo = new Sprite(new SpriteMaterial({
        map: glowTexture,
        color: new Color(part.hex),
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: dark ? 0.28 : 0.16,
      }));
      const reach = Math.max(w, d) * 1.3;
      halo.scale.set(reach, reach, 1);
      group.add(halo);
    }

    if (part.label) {
      const sprite = world_label(part.label, part.hex, model.theme);
      sprite.position.set(0, h / 2 + 0.46, 0);
      group.add(sprite);
      labels.push({
        sprite,
        // The scale the chip was authored at. Every frame's clamp is applied
        // against this, never against last frame's result, so the sizing
        // cannot drift as the camera moves.
        base: sprite.scale.clone(),
      });
    }

    root.add(group);
    picks.push(body);
    body.userData.world_part = part;
    body.userData.world_group = group;
    boxes.push({
      id: part.id,
      min: [part.pos[0] - w / 2, part.pos[1] - h / 2, part.pos[2] - d / 2],
      max: [part.pos[0] + w / 2, part.pos[1] + h / 2, part.pos[2] + d / 2],
    });
  }
  return { picks, boxes, labels };
}

// One strata tile per this many units of slab edge: enough repeats that the
// aggregate speckle keeps its grain, few enough that the courses stay legible.
const WORLD_SLAB_TILE = 9;

function world_buildSlab(root, model, material) {
  const dark = model.theme === 'dark';
  const [w, h, d] = model.slab.size;
  const concrete = world_concreteTone(model.slab.hex, dark);
  const top = world_finishTexture(
    world_textureCache,
    `concrete:${concrete}`,
    (ctx, width, height, rand) => world_paintConcrete(ctx, width, height, rand, concrete),
    // One tile per WORLD_CONCRETE_TILE units puts an expansion joint on a
    // ~4-unit bay whatever size the slab happens to be.
    { repeat: Math.max(1, Math.round((w / WORLD_CONCRETE_TILE) * 4) / 4), srgb: true },
  );
  const side = world_finishTexture(
    world_textureCache,
    `strata:${concrete}`,
    (ctx, width, height, rand) => world_paintStrata(ctx, width, height, rand, world_shade(concrete, -0.24)),
    { repeat: 1, srgb: true },
  );
  const bottom = new MeshStandardMaterial({ color: new Color(world_shade(concrete, -0.66)), roughness: 0.96 });
  const topMaterial = new MeshStandardMaterial({ map: top, roughness: 0.9, metalness: 0.02 });
  const sideMaterial = new MeshStandardMaterial({ map: side, roughness: 0.9, metalness: 0.03 });
  // BoxGeometry material order: +x, -x, +y, -y, +z, -z
  const geometry = new BoxGeometry(w, h, d);
  // The strata bands have to span the full thickness exactly once, so the side
  // faces are tiled in u only. The top face keeps its 0..1 square and lets the
  // concrete texture's own repeat do the tiling.
  const slabUv = geometry.attributes.uv;
  const faceU = [d, d, 1, 1, w, w];
  for (let face = 0; face < 6; face += 1) {
    const span = face === 2 || face === 3 ? 1 : Math.max(1, Math.round(faceU[face] / WORLD_SLAB_TILE));
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const at = (face * 4 + vertex) * 2;
      slabUv.array[at] *= span;
    }
  }
  slabUv.needsUpdate = true;
  const slab = new Mesh(geometry, [
    sideMaterial, sideMaterial, topMaterial, bottom, sideMaterial, sideMaterial,
  ]);
  slab.position.set(model.slab.pos[0], model.slab.pos[1], model.slab.pos[2]);
  slab.receiveShadow = true;
  slab.castShadow = true;
  slab.name = 'slab';
  root.add(slab);

  // Fake void: a big soft radial shadow hanging under the slab.
  const under = new Mesh(
    new PlaneGeometry(w * 2.1, d * 2.1),
    new MeshBasicMaterial({
      map: world_radialTexture(dark ? 0.5 : 0.32, 0, 1.5),
      color: new Color(dark ? '#01040a' : '#4a3f2c'),
      transparent: true,
      depthWrite: false,
      opacity: dark ? 0.7 : 0.4,
    }),
  );
  under.rotation.x = -Math.PI / 2;
  under.position.y = -model.slab.thickness - 2.6;
  root.add(under);

  return slab;
}

// Overhead cable trays for short spans, utility poles for long ones. The
// catenary curve is shared with the pulses so a travelling light stays glued
// to the wire.
function world_buildLinks(root, model, material, glowTexture) {
  const dark = model.theme === 'dark';
  const radius = model.tuning.cableRadius;
  const ink = dark ? '#10141b' : '#23272f';
  // One material per flow colour, but barely tinted: the run has to read as
  // black rubber that happens to carry that colour, not as a coloured hose.
  const cableMaterials = new Map();
  const cableMaterial = (hex) => {
    const key = hex || 'plain';
    if (cableMaterials.has(key)) return cableMaterials.get(key);
    const tone = new Color(ink);
    if (hex) tone.lerp(new Color(hex), 0.16);
    const material = new MeshStandardMaterial({
      color: tone,
      // A low roughness with a touch of metalness is what gives rubber its
      // single tight highlight along the top of the run.
      roughness: 0.42,
      metalness: 0.12,
    });
    cableMaterials.set(key, material);
    return material;
  };
  const poleMaterial = new MeshStandardMaterial({
    color: new Color(dark ? '#5a6472' : '#9aa3ad'),
    roughness: 0.78,
    metalness: 0.22,
  });
  const insulatorMaterial = new MeshStandardMaterial({
    color: new Color(dark ? '#9fc6d2' : '#e3f0f4'),
    roughness: 0.28,
    metalness: 0.08,
  });
  const collarMaterial = new MeshStandardMaterial({
    color: new Color(dark ? '#6b7784' : '#a7b1bc'),
    roughness: 0.5,
    metalness: 0.45,
  });

  const overlays = [];

  for (const link of model.links) {
    const group = new Group();
    group.name = `link:${link.from}->${link.to}`;
    const curve = world_curveFromSegments(link.segments);
    if (!curve.curves.length) continue;
    const tubular = world_clamp(Math.round(link.span * 7) + 24, 32, 220);

    // The wire itself. Cables never cast shadows: at this height every run
    // would smear a hard black line across the deck and bury the strata.
    const cable = new Mesh(new TubeGeometry(curve, tubular, radius, 8, false), cableMaterial(link.hex));
    cable.castShadow = false;
    cable.receiveShadow = false;
    group.add(cable);

    // A collar where the run leaves each part, so the cable plugs in rather
    // than sprouting.
    for (const end of [0, 1]) {
      const at = curve.getPointAt(end);
      const near = curve.getPointAt(end === 0 ? 0.015 : 0.985);
      const collar = new Mesh(new CylinderGeometry(radius * 1.9, radius * 2.3, 0.16, 10, 1), collarMaterial);
      collar.position.copy(at);
      collar.lookAt(near);
      collar.rotateX(Math.PI / 2);
      group.add(collar);
    }

    // Slim poles, only where the model asked for one. They never cast
    // shadows either -- a mast shadow at this scale is just a smear.
    for (const pole of link.poles) {
      const mast = new Mesh(new CylinderGeometry(0.055, 0.075, pole.height, 8, 1), poleMaterial);
      mast.position.set(pole.pos[0], pole.height / 2, pole.pos[2]);
      mast.castShadow = false;
      group.add(mast);
      // Two insulator caps at the attachment point, one either side.
      for (const side of [-1, 1]) {
        const cap = new Mesh(new CylinderGeometry(0.062, 0.078, 0.13, 8, 1), insulatorMaterial);
        cap.position.set(pole.pos[0] + side * 0.1, pole.height - 0.08, pole.pos[2]);
        group.add(cap);
      }
    }

    // Additive overlay: same curve, slightly fatter, lit per frame from pulse
    // positions through vertex colours. Robust and shader-free.
    const overlayGeometry = new TubeGeometry(curve, tubular, radius * 1.18, 6, false);
    const vertexCount = overlayGeometry.attributes.position.count;
    overlayGeometry.setAttribute('color', new BufferAttribute(new Float32Array(vertexCount * 3), 3));
    const overlay = new Mesh(
      overlayGeometry,
      new MeshBasicMaterial({
        vertexColors: true,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        color: new Color(0xffffff),
      }),
    );
    group.add(overlay);

    // Ring centres: one sample per tubular segment, reused every frame.
    const rings = tubular + 1;
    const perRing = vertexCount / rings;
    const centres = new Float32Array(rings * 3);
    for (let ring = 0; ring < rings; ring += 1) {
      const point = curve.getPointAt(world_clamp(ring / tubular, 0, 1));
      centres[ring * 3] = point.x;
      centres[ring * 3 + 1] = point.y;
      centres[ring * 3 + 2] = point.z;
    }
    // The travelling highlight is the link's own colour, not white. White
    // blew straight through the light theme's exposure and the runs came out
    // reading as bare cream scaffolding.
    const tint = dark
      ? new Color(link.hex).lerp(new Color(0xffffff), 0.3)
      : new Color(link.hex).multiplyScalar(0.3);
    overlays.push({ link, overlay, centres, rings, perRing, tint });

    root.add(group);
  }
  return overlays;
}

function world_buildFlows(root, model, glowTexture) {
  const dark = model.theme === 'dark';
  const flows = [];
  for (const flow of model.flows) {
    const curve = world_curveFromSegments(flow.segments);
    if (!curve.curves.length) continue;
    const core = new MeshStandardMaterial({
      color: new Color(dark ? flow.hex : '#ffffff'),
      emissive: new Color(flow.hex),
      emissiveIntensity: dark ? 3.2 : 2.2,
      roughness: 0.25,
    });
    const pulses = [];
    for (let index = 0; index < flow.count; index += 1) {
      const group = new Group();
      const bead = new Mesh(new SphereGeometry(0.13, 16, 12), core);
      group.add(bead);
      const glow = new Sprite(new SpriteMaterial({
        map: glowTexture,
        color: new Color(flow.hex),
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: dark ? 0.8 : 0.34,
      }));
      glow.scale.set(1.05, 1.05, 1);
      group.add(glow);
      root.add(group);
      pulses.push({ group, offset: index / flow.count, position: new Vector3() });
    }
    flows.push({ flow, curve, pulses });
  }
  return flows;
}

// Shadow strength, not shadow presence, is what was wrong: the darkest point
// of a shadow should still sit around 55% grey in the light theme and 72% in
// the dark one, so parts under a cable stay readable.
const WORLD_SHADOW_INTENSITY = { light: 0.45, dark: 0.28 };

function world_lighting(root, model) {
  const dark = model.theme === 'dark';
  const span = Math.max(model.slab.size[0], model.slab.size[2]);

  const hemisphere = new HemisphereLight(
    new Color(dark ? '#3c4f66' : '#dfe9f5'),
    new Color(dark ? '#151a22' : '#8c8070'),
    dark ? 1.05 : 0.78,
  );
  root.add(hemisphere);

  const key = new DirectionalLight(new Color(dark ? '#ffeccb' : '#fff3da'), dark ? 2.85 : 2.35);
  key.position.set(-span * 0.55, span * 0.95, span * 0.42);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = span * 3.2;
  const half = span * 0.78;
  key.shadow.camera.left = -half;
  key.shadow.camera.right = half;
  key.shadow.camera.top = half;
  key.shadow.camera.bottom = -half;
  key.shadow.bias = -0.0012;
  key.shadow.normalBias = 0.022;
  key.shadow.radius = 3.4;
  key.shadow.intensity = WORLD_SHADOW_INTENSITY[dark ? 'dark' : 'light'];
  root.add(key);

  const fill = new DirectionalLight(new Color(dark ? '#8fb7d8' : '#cfe0f2'), dark ? 0.38 : 0.2);
  fill.position.set(span * 0.6, -span * 0.3, -span * 0.5);
  root.add(fill);

  if (dark) {
    // Cool rim from behind and above so every silhouette gets an edge against
    // the void. A directional light rather than a spot: the rim has to reach
    // the far parts as evenly as the near ones.
    const rim = new DirectionalLight(new Color('#86cdff'), 1.15);
    rim.position.set(span * 0.35, span * 0.55, -span * 0.9);
    root.add(rim);
  }

  // Off by default; first person turns it up so the walls a metre from the
  // camera are not pitch black.
  const ambient = new AmbientLight(new Color(dark ? '#6f8aa8' : '#fff6e6'), 0);
  root.add(ambient);
  return { key, ambient };
}

// ------------------------------------------------------- the ground overlay
//
// Everything painted on the ground — aprons, asphalt, markings, stains,
// manholes, grates, tire paths, and whichever mode's floor language — goes
// into ONE texture clamped over the slab footprint, drawn by ONE mesh. That
// keeps the whole environment's paint at a single draw call and a single
// texture however many streets and bays it ends up describing, and it is
// painted from the pure plan, so a `?t=` capture is byte-identical.

// Target resolution of the ground overlay, in pixels per world unit, and the
// ceiling on its long side. 30px/u puts a 0.1-unit road marking on 3 pixels.
const WORLD_GROUND_PX = 30;
const WORLD_GROUND_MAX = 1024;

const WORLD_GROUND_INK = {
  light: {
    asphalt: 'rgba(72,73,78,0.93)',
    asphaltEdge: 'rgba(52,53,58,0.95)',
    sidewalk: 'rgba(196,189,174,0.6)',
    sidewalkJoint: 'rgba(90,86,78,0.4)',
    apron: 'rgba(214,207,192,0.34)',
    apronEdge: 'rgba(96,92,84,0.3)',
    marking: 'rgba(242,239,229,0.86)',
    safety: 'rgba(213,164,66,0.9)',
    hazardInk: 'rgba(32,31,29,0.72)',
    hazardWarn: 'rgba(213,164,66,0.85)',
    stain: 'rgba(24,24,27,0.3)',
    manhole: 'rgba(58,58,62,0.85)',
    manholeRim: 'rgba(34,34,38,0.9)',
    grate: 'rgba(44,45,49,0.88)',
    tire: 'rgba(0,0,0,0.08)',
    stencil: 'rgba(224,219,206,0.78)',
    zone: 'rgba(213,164,66,0.34)',
  },
  dark: {
    asphalt: 'rgba(28,30,34,0.94)',
    asphaltEdge: 'rgba(18,20,23,0.96)',
    sidewalk: 'rgba(88,93,101,0.5)',
    sidewalkJoint: 'rgba(16,18,22,0.45)',
    apron: 'rgba(104,110,119,0.26)',
    apronEdge: 'rgba(10,12,16,0.34)',
    // Markings read as retroreflective at night: brighter than the daylight
    // paint, and the overlay's own roughness drops to catch the lamps.
    marking: 'rgba(236,240,246,0.92)',
    safety: 'rgba(222,176,76,0.92)',
    hazardInk: 'rgba(16,16,18,0.78)',
    hazardWarn: 'rgba(214,168,72,0.88)',
    stain: 'rgba(4,5,7,0.36)',
    manhole: 'rgba(30,32,36,0.88)',
    manholeRim: 'rgba(12,13,16,0.92)',
    grate: 'rgba(16,18,21,0.9)',
    tire: 'rgba(0,0,0,0.08)',
    stencil: 'rgba(206,214,224,0.7)',
    zone: 'rgba(214,168,72,0.3)',
  },
};

// Seven-segment digits, drawn as rectangles rather than canvas text: a floor
// stencil has to look the same on every machine, and a font does not.
// Segments are a,b,c,d,e,f,g (top, top-right, bottom-right, bottom, bottom-
// left, top-left, middle).
const WORLD_SEGMENTS = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg',
  5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};

function world_paintDigit(ctx, digit, x, y, w, h, thickness) {
  const on = WORLD_SEGMENTS[digit] || '';
  const t = thickness;
  const bars = {
    a: [x, y, w, t],
    b: [x + w - t, y, t, h / 2],
    c: [x + w - t, y + h / 2, t, h / 2],
    d: [x, y + h - t, w, t],
    e: [x, y + h / 2, t, h / 2],
    f: [x, y, t, h / 2],
    g: [x, y + h / 2 - t / 2, w, t],
  };
  for (const segment of on) {
    const [bx, by, bw, bh] = bars[segment];
    ctx.fillRect(bx, by, bw, bh);
  }
}

/**
 * Paint the whole ground overlay.
 *
 * `to` maps world units to pixels on each axis; the plan is already in
 * slab-local world coordinates, so every shape below is a direct transcription
 * of a number the pure layer decided.
 */
function world_paintGround(ctx, width, height, rand, model) {
  const env = model.env;
  const fp = model.slab.footprint;
  const spanX = fp.maxX - fp.minX;
  const spanZ = fp.maxZ - fp.minZ;
  const ink = WORLD_GROUND_INK[model.theme === 'dark' ? 'dark' : 'light'];
  const px = (x) => ((x - fp.minX) / spanX) * width;
  const py = (z) => ((z - fp.minZ) / spanZ) * height;
  const ux = width / spanX;   // pixels per world unit, x
  const uz = height / spanZ;  // pixels per world unit, z
  const unit = (ux + uz) / 2;
  const rect = (r, style) => {
    ctx.fillStyle = style;
    ctx.fillRect(px(r.minX), py(r.minZ), (r.maxX - r.minX) * ux, (r.maxZ - r.minZ) * uz);
  };

  ctx.clearRect(0, 0, width, height);

  // 1. Concrete aprons: a pad poured under each machine, a shade off the deck.
  for (const apron of env.ground.aprons) {
    rect(apron, ink.apron);
    ctx.strokeStyle = ink.apronEdge;
    ctx.lineWidth = Math.max(1, unit * 0.06);
    ctx.strokeRect(px(apron.minX), py(apron.minZ), (apron.maxX - apron.minX) * ux, (apron.maxZ - apron.minZ) * uz);
  }

  // 2. The streets: asphalt, then the pavements beside them.
  const city = env.city;
  if (city) {
    for (const avenue of city.avenues) {
      const road = avenueRect(avenue);
      rect(road, ink.asphalt);
      // A darker lick along both kerb lines, where the surface always goes.
      ctx.fillStyle = ink.asphaltEdge;
      if (avenue.along === 'z') {
        const w = Math.max(1, unit * 0.22);
        ctx.fillRect(px(road.minX), py(road.minZ), w, (road.maxZ - road.minZ) * uz);
        ctx.fillRect(px(road.maxX) - w, py(road.minZ), w, (road.maxZ - road.minZ) * uz);
      } else {
        const h = Math.max(1, unit * 0.22);
        ctx.fillRect(px(road.minX), py(road.minZ), (road.maxX - road.minX) * ux, h);
        ctx.fillRect(px(road.minX), py(road.maxZ) - h, (road.maxX - road.minX) * ux, h);
      }
    }
    // Terminus surfacing, laid with the road it belongs to: the run-out to a
    // gate, the apron of a loading bay, the bulb of a turning circle and the
    // spur to a building. Together with the avenues these are every piece of
    // asphalt the district has, and all of it goes somewhere.
    for (const stub of city.stubs) rect(stub, ink.asphalt);
    for (const spur of city.driveways) rect(spur.rect, ink.asphalt);
    // The overlay's two axes are rounded to powers of two independently, so
    // pixels per unit differ between them on a slab that is not square. A
    // turning circle has to be round in world units, so it is drawn as an
    // ellipse in pixels — on a square slab that is the same circle.
    for (const circle of city.culdesacs) {
      ctx.fillStyle = ink.asphalt;
      ctx.beginPath();
      ctx.ellipse(px(circle.x), py(circle.z), circle.radius * ux, circle.radius * uz, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ink.asphaltEdge;
      ctx.lineWidth = Math.max(1, unit * 0.22);
      ctx.stroke();
    }
    for (const walk of city.sidewalks) {
      rect(walk, ink.sidewalk);
      // Slab joints every couple of units, across the walking direction.
      ctx.strokeStyle = ink.sidewalkJoint;
      ctx.lineWidth = Math.max(1, unit * 0.04);
      const step = env.tuning.sidewalkJoint;
      if (walk.along === 'z') {
        for (let z = Math.ceil(walk.minZ / step) * step; z < walk.maxZ; z += step) {
          ctx.beginPath();
          ctx.moveTo(px(walk.minX), py(z));
          ctx.lineTo(px(walk.maxX), py(z));
          ctx.stroke();
        }
      } else {
        for (let x = Math.ceil(walk.minX / step) * step; x < walk.maxX; x += step) {
          ctx.beginPath();
          ctx.moveTo(px(x), py(walk.minZ));
          ctx.lineTo(px(x), py(walk.maxZ));
          ctx.stroke();
        }
      }
    }
  }

  // 3. Worn tire paths: a faint double line where the traffic actually runs.
  ctx.strokeStyle = ink.tire;
  for (const path of env.ground.tirePaths) {
    ctx.lineWidth = Math.max(1.5, unit * 0.34);
    for (const side of [-1, 1]) {
      const offset = (side * path.gauge) / 2;
      ctx.beginPath();
      if (path.along === 'z') {
        ctx.moveTo(px(path.center + offset), py(path.from));
        ctx.lineTo(px(path.center + offset), py(path.to));
      } else {
        ctx.moveTo(px(path.from), py(path.center + offset));
        ctx.lineTo(px(path.to), py(path.center + offset));
      }
      ctx.stroke();
    }
  }

  // 4. Road markings, drawn over the tire wear the way fresh paint is.
  if (city) {
    const junctions = city.crossings.map((cross) => ({
      minX: cross.x - cross.w / 2 - 0.2,
      maxX: cross.x + cross.w / 2 + 0.2,
      minZ: cross.z - cross.d / 2 - 0.2,
      maxZ: cross.z + cross.d / 2 + 0.2,
    }));
    const inJunction = (x, z) => junctions.some((j) => x > j.minX && x < j.maxX && z > j.minZ && z < j.maxZ);
    ctx.fillStyle = ink.marking;
    for (const avenue of city.avenues) {
      const half = avenue.width / 2;
      // Solid edge lines, set in off the kerb.
      for (const side of [-1, 1]) {
        const at = avenue.center + side * (half - 0.3);
        if (avenue.along === 'z') {
          ctx.fillRect(px(at) - Math.max(1, unit * 0.05), py(avenue.from), Math.max(1.5, unit * 0.1), (avenue.to - avenue.from) * uz);
        } else {
          ctx.fillRect(px(avenue.from), py(at) - Math.max(1, unit * 0.05), (avenue.to - avenue.from) * ux, Math.max(1.5, unit * 0.1));
        }
      }
      // Dashed centre line, 1.2 on and 1.2 off, interrupted at a junction.
      const dash = 1.2;
      for (let at = avenue.from + dash / 2; at < avenue.to - dash / 2; at += dash * 2) {
        const x = avenue.along === 'z' ? avenue.center : at;
        const z = avenue.along === 'z' ? at : avenue.center;
        if (inJunction(x, z)) continue;
        if (avenue.along === 'z') {
          ctx.fillRect(px(avenue.center) - Math.max(1, unit * 0.06), py(at), Math.max(1.5, unit * 0.12), dash * uz);
        } else {
          ctx.fillRect(px(at), py(avenue.center) - Math.max(1, unit * 0.06), dash * ux, Math.max(1.5, unit * 0.12));
        }
      }
    }
    // An exit chevron on the asphalt at every gate, pointing out through it,
    // so the end of the road reads as a way out rather than a stop.
    for (const gate of city.gates) {
      const [dx, dz] = gate.chevron.dir;
      const half = gate.chevron.width / 2;
      ctx.strokeStyle = ink.marking;
      ctx.lineWidth = Math.max(2, unit * 0.16);
      ctx.lineCap = 'butt';
      for (const step of [0, 0.62]) {
        const tipX = gate.chevron.x + dx * (0.5 - step);
        const tipZ = gate.chevron.z + dz * (0.5 - step);
        const backX = tipX - dx * 0.62;
        const backZ = tipZ - dz * 0.62;
        // The wings splay across the road, whichever way the road runs.
        const wx = dz === 0 ? 0 : half;
        const wz = dx === 0 ? 0 : half;
        ctx.beginPath();
        ctx.moveTo(px(backX - wx), py(backZ - wz));
        ctx.lineTo(px(tipX), py(tipZ));
        ctx.lineTo(px(backX + wx), py(backZ + wz));
        ctx.stroke();
      }
    }

    // A turning circle: a painted ring round the kerb line and a hatched
    // island in the middle of it. The island is what says "turn", not "park".
    for (const circle of city.culdesacs) {
      ctx.strokeStyle = ink.marking;
      ctx.lineWidth = Math.max(1.5, unit * 0.1);
      ctx.beginPath();
      ctx.ellipse(px(circle.x), py(circle.z), (circle.radius - 0.3) * ux, (circle.radius - 0.3) * uz, 0, 0, Math.PI * 2);
      ctx.stroke();
      const reach = circle.island * unit;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(px(circle.x), py(circle.z), circle.island * ux, circle.island * uz, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = ink.safety;
      ctx.lineWidth = Math.max(1.5, unit * 0.12);
      for (let offset = -reach * 2; offset < reach * 2; offset += Math.max(3, unit * 0.34)) {
        ctx.beginPath();
        ctx.moveTo(px(circle.x) + offset, py(circle.z) - reach);
        ctx.lineTo(px(circle.x) + offset + reach * 2, py(circle.z) + reach);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = ink.safety;
      ctx.lineWidth = Math.max(1, unit * 0.08);
      ctx.beginPath();
      ctx.ellipse(px(circle.x), py(circle.z), circle.island * ux, circle.island * uz, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // A hatched rectangle on every loading bay: the apron a lorry backs onto.
    for (const bay of city.bays) {
      const h = bay.hatch;
      const x0 = px(h.minX);
      const z0 = py(h.minZ);
      const w = (h.maxX - h.minX) * ux;
      const d = (h.maxZ - h.minZ) * uz;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, z0, w, d);
      ctx.clip();
      ctx.strokeStyle = ink.safety;
      ctx.lineWidth = Math.max(1.5, unit * 0.1);
      for (let offset = -d; offset < w + d; offset += Math.max(4, unit * 0.46)) {
        ctx.beginPath();
        ctx.moveTo(x0 + offset, z0);
        ctx.lineTo(x0 + offset + d, z0 + d);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = ink.marking;
      ctx.lineWidth = Math.max(1.5, unit * 0.1);
      ctx.strokeRect(x0, z0, w, d);
    }

    // A threshold line where a driveway leaves the pavement: a footway being
    // crossed, not a second road starting.
    ctx.fillStyle = ink.marking;
    for (const spur of city.driveways) {
      const half = spur.threshold.length / 2;
      const thin = Math.max(1.5, unit * 0.1);
      if (spur.threshold.along === 'z') {
        ctx.fillRect(px(spur.threshold.x) - thin / 2, py(spur.threshold.z - half), thin, spur.threshold.length * uz);
      } else {
        ctx.fillRect(px(spur.threshold.x - half), py(spur.threshold.z) - thin / 2, spur.threshold.length * ux, thin);
      }
    }

    // Zebras on the approaches to every junction.
    for (const walk of city.crosswalks) {
      const bar = 0.34;
      const gap = 0.26;
      if (walk.along === 'z') {
        // Bars run across a street that runs down z: stripes stacked in z.
        for (let z = walk.z - walk.d / 2 + gap; z < walk.z + walk.d / 2 - bar; z += bar + gap) {
          ctx.fillRect(px(walk.x - walk.w / 2 + 0.18), py(z), (walk.w - 0.36) * ux, bar * uz);
        }
      } else {
        for (let x = walk.x - walk.w / 2 + gap; x < walk.x + walk.w / 2 - bar; x += bar + gap) {
          ctx.fillRect(px(x), py(walk.z - walk.d / 2 + 0.18), bar * ux, (walk.d - 0.36) * uz);
        }
      }
    }
  }

  // 5. The warehouse floor's painted safety language.
  const yard = env.warehouse;
  if (yard) {
    // Keep-clear cross-hatching round the standing tanks, under the line work.
    // One save/restore per zone, with the stroke set inside it: a restore
    // rolls the style back too, so a style set before the loop would only
    // survive the first ring.
    for (const zone of yard.zones) {
      const reach = zone.radius * unit;
      ctx.save();
      ctx.beginPath();
      ctx.arc(px(zone.x), py(zone.z), reach, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = ink.zone;
      ctx.lineWidth = Math.max(1, unit * 0.07);
      for (let offset = -reach * 2; offset < reach * 2; offset += Math.max(3, unit * 0.5)) {
        ctx.beginPath();
        ctx.moveTo(px(zone.x) + offset, py(zone.z) - reach);
        ctx.lineTo(px(zone.x) + offset + reach * 2, py(zone.z) + reach);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Hatched hazard corners.
    for (const corner of yard.corners) {
      const size = corner.size;
      const x0 = px(corner.x - size / 2);
      const z0 = py(corner.z - size / 2);
      const w = size * ux;
      const h = size * uz;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, z0, w, h);
      ctx.clip();
      ctx.fillStyle = ink.hazardInk;
      ctx.fillRect(x0, z0, w, h);
      ctx.strokeStyle = ink.hazardWarn;
      ctx.lineWidth = Math.max(2, unit * 0.26);
      for (let offset = -h; offset < w + h; offset += Math.max(5, unit * 0.62)) {
        ctx.beginPath();
        ctx.moveTo(x0 + offset, z0);
        ctx.lineTo(x0 + offset + h, z0 + h);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Circulation: the marked walkway from the gate to the spine, and the stub
    // off every machine onto it. A pair of 0.12 lines half a unit apart, the
    // same safety yellow as the perimeter — the floor's one route, so nothing
    // on the slab is somewhere you cannot walk to from the gate.
    const flow = yard.circulation;
    if (flow) {
      ctx.strokeStyle = ink.safety;
      ctx.lineWidth = Math.max(1.5, flow.lineWidth * unit);
      for (const walk of flow.walkways) {
        const acrossX = Math.abs(walk.to[1] - walk.from[1]) >= Math.abs(walk.to[0] - walk.from[0]);
        for (const side of [-1, 1]) {
          const ox = acrossX ? (side * flow.gap) / 2 : 0;
          const oz = acrossX ? 0 : (side * flow.gap) / 2;
          ctx.beginPath();
          ctx.moveTo(px(walk.from[0] + ox), py(walk.from[1] + oz));
          ctx.lineTo(px(walk.to[0] + ox), py(walk.to[1] + oz));
          ctx.stroke();
        }
      }
    }

    // The yellow perimeter line: two pixels of paint, 1.2 units in.
    ctx.strokeStyle = ink.safety;
    ctx.lineWidth = Math.max(2, unit * 0.1);
    ctx.strokeRect(
      px(yard.line.minX), py(yard.line.minZ),
      (yard.line.maxX - yard.line.minX) * ux, (yard.line.maxZ - yard.line.minZ) * uz,
    );

    // A stencilled bay number on the floor in front of each machine.
    ctx.fillStyle = ink.stencil;
    for (const bay of yard.bays) {
      const digits = String(bay.number);
      const h = 0.78 * uz;
      const w = 0.42 * ux;
      const gap = 0.12 * ux;
      const total = digits.length * w + (digits.length - 1) * gap;
      let x = px(bay.x) - total / 2;
      const y = py(bay.z) - h / 2;
      for (const digit of digits) {
        world_paintDigit(ctx, digit, x, y, w, h, Math.max(1.5, unit * 0.09));
        x += w + gap;
      }
    }
  }

  // 6. Oil stains, hashed into the same places every time.
  for (const stain of env.ground.stains) {
    const radius = stain.radius * unit;
    const gradient = ctx.createRadialGradient(px(stain.x), py(stain.z), 0, px(stain.x), py(stain.z), radius);
    gradient.addColorStop(0, ink.stain);
    gradient.addColorStop(0.6, ink.stain.replace(/[\d.]+\)$/, '0.14)'));
    gradient.addColorStop(1, ink.stain.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(px(stain.x), py(stain.z), radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 7. Manhole lids: a ring, a disc and a couple of pick holes.
  for (const hole of env.ground.manholes) {
    const radius = hole.radius * unit;
    ctx.fillStyle = ink.manholeRim;
    ctx.beginPath();
    ctx.arc(px(hole.x), py(hole.z), radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink.manhole;
    ctx.beginPath();
    ctx.arc(px(hole.x), py(hole.z), radius * 0.82, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ink.manholeRim;
    ctx.lineWidth = Math.max(1, unit * 0.04);
    ctx.beginPath();
    ctx.arc(px(hole.x), py(hole.z), radius * 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 8. Drainage grates: a recessed frame with slats across it.
  for (const grate of env.ground.grates) {
    const x0 = px(grate.x - grate.w / 2);
    const z0 = py(grate.z - grate.d / 2);
    const w = grate.w * ux;
    const h = grate.d * uz;
    ctx.fillStyle = ink.grate;
    ctx.fillRect(x0, z0, w, h);
    ctx.strokeStyle = ink.marking.replace(/[\d.]+\)$/, '0.22)');
    ctx.lineWidth = Math.max(1, unit * 0.04);
    const across = grate.w > grate.d;
    const slats = 5;
    for (let index = 1; index < slats; index += 1) {
      const t = index / slats;
      ctx.beginPath();
      if (across) {
        ctx.moveTo(x0 + w * t, z0);
        ctx.lineTo(x0 + w * t, z0 + h);
      } else {
        ctx.moveTo(x0, z0 + h * t);
        ctx.lineTo(x0 + w, z0 + h * t);
      }
      ctx.stroke();
    }
  }

  void rand;
}

/**
 * The one mesh that carries all of the above: a plane clamped over the slab
 * footprint, floating a hair above the deck so it never z-fights the concrete.
 */
// Round up to a power of two, capped. A canvas of an arbitrary size uploads
// fine as a texture but a non-power-of-two one with mipmaps is where software
// GL gives up: at 1020x900 the whole frame came back empty, at 1024x1024 it
// does not. Cheap insurance, and the painter already works at any size.
function world_pot(value) {
  const size = 2 ** Math.ceil(Math.log2(Math.max(128, value)));
  return world_clamp(size, 128, WORLD_GROUND_MAX);
}

function world_buildGround(root, model) {
  const dark = model.theme === 'dark';
  const fp = model.slab.footprint;
  const spanX = fp.maxX - fp.minX;
  const spanZ = fp.maxZ - fp.minZ;
  if (spanX <= 0 || spanZ <= 0) return null;
  const scale = Math.min(WORLD_GROUND_PX, WORLD_GROUND_MAX / Math.max(spanX, spanZ));
  const width = world_pot(spanX * scale);
  const height = world_pot(spanZ * scale);
  const texture = world_finishTexture(
    world_textureCache,
    `ground:${model.env.mode}:${model.theme}:${width}x${height}:${model.env.metrics.parts}`,
    (ctx, w, h, rand) => world_paintGround(ctx, w, h, rand, model),
    { repeat: 1, srgb: true, clamp: true, width, height },
  );
  const mesh = new Mesh(
    new PlaneGeometry(spanX, spanZ),
    new MeshStandardMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      // At night the markings have to catch the lamps; by day the surface is
      // dry concrete and asphalt.
      roughness: dark ? 0.56 : 0.86,
      metalness: dark ? 0.12 : 0.04,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((fp.minX + fp.maxX) / 2, 0.012, (fp.minZ + fp.maxZ) / 2);
  mesh.receiveShadow = true;
  // After the slab, before the parts: paint, not a surface of its own.
  mesh.renderOrder = 1;
  mesh.name = 'ground-paint';
  root.add(mesh);
  return mesh;
}

// --------------------------------------------------- environment in the round
//
// Curbs, fences, lamp posts, containers, a water tower. All of it is repeated
// boxes and cylinders, so all of it goes through InstancedMesh: one draw call
// per (geometry, material) pair however many pieces the plan asks for, with
// the per-piece tint riding along in instanceColor. That is what keeps a whole
// industrial district inside the same draw-call budget the bare slab had.

// Corrugated steel sheet: vertical ribs with a lit edge, for containers and
// dumpsters. The only texture the environment adds beyond its ground overlay —
// everything else borrows a family skin that is already in the cache.
function world_paintCorrugation(ctx, width, height) {
  ctx.fillStyle = world_grainTone(0);
  ctx.fillRect(0, 0, width, height);
  const ribs = 16;
  const step = width / ribs;
  for (let index = 0; index < ribs; index += 1) {
    const x = index * step;
    // Each rib is a lit face, a shadowed face and a hard crease between them.
    ctx.fillStyle = world_grainRGBA(10, 1);
    ctx.fillRect(x, 0, step * 0.42, height);
    ctx.fillStyle = world_grainRGBA(-14, 1);
    ctx.fillRect(x + step * 0.42, 0, step * 0.46, height);
    ctx.fillStyle = world_grainRGBA(-30, 1);
    ctx.fillRect(x + step * 0.88, 0, Math.max(1, step * 0.12), height);
  }
  // Top and bottom rails, the way a container is framed.
  ctx.fillStyle = world_grainRGBA(16, 1);
  ctx.fillRect(0, 0, width, Math.max(2, height * 0.07));
  ctx.fillStyle = world_grainRGBA(-8, 1);
  ctx.fillRect(0, height - Math.max(2, height * 0.07), width, Math.max(2, height * 0.07));
}

// A material that takes its colour from the instance, not from the token
// palette: the map is a near-white tile, so instanceColor does the painting.
function world_instanceMaterial(skin, { roughness, metalness }) {
  return new MeshStandardMaterial({
    color: new Color(0xffffff).multiplyScalar(WORLD_ALBEDO_COMPENSATE),
    roughness,
    metalness,
    map: skin,
    bumpMap: skin,
    bumpScale: 0.035,
    roughnessMap: skin,
  });
}

/**
 * One InstancedMesh from a list of {pos, scale, rotY, hex} pieces.
 *
 * Returns null for an empty list so a mode that asks for nothing costs
 * nothing, not an empty draw call.
 */
function world_instances(name, geometry, material, pieces) {
  if (!pieces.length) return null;
  const mesh = new InstancedMesh(geometry, material, pieces.length);
  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const scale = new Vector3();
  const color = new Color();
  let tinted = false;
  pieces.forEach((piece, index) => {
    position.set(piece.pos[0], piece.pos[1], piece.pos[2]);
    quaternion.setFromAxisAngle(axis, piece.rotY || 0);
    scale.set(piece.scale[0], piece.scale[1], piece.scale[2]);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
    if (piece.hex) {
      color.set(piece.hex);
      mesh.setColorAt(index, color);
      tinted = true;
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (tinted && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `env:${name}`;
  return mesh;
}

// The steel the street furniture is made of, by theme.
const WORLD_ENV_STEEL = { light: '#9aa3ad', dark: '#6b7480' };
const WORLD_ENV_CURB = { light: '#b4ad9f', dark: '#5f656d' };
const WORLD_ENV_DARK_STEEL = { light: '#6d747d', dark: '#4a5058' };
// Dock bumpers: black rubber, the same in both themes because rubber is.
const WORLD_ENV_RUBBER = '#2a2b2e';
// A barrier arm's two hazard bands. Tinted instances of the shared steel skin,
// so the stripes cost no texture and no draw call of their own.
const WORLD_ENV_HAZARD = ['#e8e4dc', '#c0472f'];

/**
 * Build everything in the environment plan that stands up off the deck.
 *
 * Collects pieces into a handful of buckets — boxes in a steel skin, boxes in
 * a warm skin, corrugated boxes, cylinders, cones, lamp heads — and emits one
 * instanced mesh per bucket.
 */
function world_buildEnvironment(root, model) {
  const dark = model.theme === 'dark';
  const env = model.env;
  const steel = WORLD_ENV_STEEL[dark ? 'dark' : 'light'];
  const darkSteel = WORLD_ENV_DARK_STEEL[dark ? 'dark' : 'light'];
  const curbHex = WORLD_ENV_CURB[dark ? 'dark' : 'light'];

  const boxes = [];      // steel-skinned boxes: curbs, rails, carts, arms
  const timber = [];     // warm-skinned boxes: crates, pallet planks
  const ribbed = [];     // corrugated boxes: containers, dumpsters
  const drums = [];      // cylinders: posts, poles, bollards, barrels, tanks
  const cones = [];      // the water tower's roof
  const heads = [];      // lamp heads, emissive
  const sprites = [];    // lamp glow, dark theme only

  // ---------------------------------------------------------------- the city
  const city = env.city;
  if (city) {
    // Curbs: a raised lip along both edges of every street.
    for (const curb of city.curbs) {
      boxes.push({ pos: curb.pos, scale: curb.size, hex: curbHex });
    }

    // Lamp posts: a mast, an arm out over the road, and a head on the end.
    for (const lamp of city.lamps) {
      const [x, , z] = lamp.pos;
      drums.push({
        pos: [x, lamp.height / 2, z],
        scale: [0.07, lamp.height, 0.07],
        hex: darkSteel,
      });
      const armX = lamp.armDir[0] * lamp.arm;
      const armZ = lamp.armDir[1] * lamp.arm;
      boxes.push({
        pos: [x + armX / 2, lamp.height - 0.06, z + armZ / 2],
        scale: [Math.abs(armX) || 0.08, 0.08, Math.abs(armZ) || 0.08],
        hex: darkSteel,
      });
      heads.push({
        pos: [x + armX, lamp.height - 0.16, z + armZ],
        scale: [lamp.head, lamp.head * 0.6, lamp.head],
      });
      // Every second head gets a soft halo, and only after dark.
      if (lamp.glow && dark) sprites.push([x + armX, lamp.height - 0.2, z + armZ]);
    }

    // Exit gates. Two striped arms swinging in from the kerbs, a post under
    // each pivot, and a guard booth on the shoulder: the end of the road made
    // into a reason for the road to end.
    for (const gate of city.gates) {
      for (const arm of gate.arms) {
        for (const stripe of arm.stripes) {
          boxes.push({
            pos: stripe.pos,
            scale: stripe.size,
            hex: stripe.band ? WORLD_ENV_HAZARD[1] : WORLD_ENV_HAZARD[0],
          });
        }
        drums.push({
          pos: [arm.pivot[0], gate.height / 2, arm.pivot[2]],
          scale: [0.15, gate.height, 0.15],
          hex: darkSteel,
        });
      }
      // A gate with no shoulder to stand a booth on is still a gate.
      const booth = gate.booth;
      if (!booth) continue;
      boxes.push({ pos: booth.pos, scale: booth.size, hex: steel });
      // A dark band at eye height reads as the window the guard looks out of.
      boxes.push({
        pos: [booth.pos[0], booth.pos[1] + booth.size[1] * 0.2, booth.pos[2]],
        scale: [booth.size[0] * 1.02, booth.size[1] * 0.3, booth.size[2] * 1.02],
        hex: darkSteel,
      });
      // ... and a lip round the roof, so a booth is not a plain cube either.
      boxes.push({
        pos: [booth.pos[0], booth.pos[1] + booth.size[1] / 2 + 0.03, booth.pos[2]],
        scale: [booth.size[0] * 1.12, 0.07, booth.size[2] * 1.12],
        hex: darkSteel,
      });
    }

    // A rubber dock bumper across the building face at every loading bay.
    for (const bay of city.bays) {
      boxes.push({ pos: bay.bumper.pos, scale: bay.bumper.size, hex: WORLD_ENV_RUBBER });
    }

    // Bollards at the junction corners and round the turning circles.
    for (const bollard of city.bollards) {
      drums.push({
        pos: bollard.pos,
        scale: [bollard.radius * 2, bollard.height, bollard.radius * 2],
        hex: darkSteel,
      });
    }
  }

  // ----------------------------------------------------------- the warehouse
  const yard = env.warehouse;
  if (yard) {
    const fence = yard.fence;
    for (const [x, z] of fence.posts) {
      drums.push({
        pos: [x, fence.height / 2, z],
        scale: [fence.radius * 2, fence.height, fence.radius * 2],
        hex: steel,
      });
    }
    // Two thin rails per run, threaded through the posts.
    for (const rail of fence.rails) {
      for (const at of fence.railHeights) {
        boxes.push({
          pos: [rail.pos[0], at, rail.pos[2]],
          scale: rail.along === 'x'
            ? [rail.length, fence.railThickness, fence.railThickness]
            : [fence.railThickness, fence.railThickness, rail.length],
          hex: steel,
        });
      }
    }
    // A frame round the gate: a taller post each side and a lintel across.
    if (fence.gate) {
      const { a, b, height } = fence.gate;
      for (const post of [a, b]) {
        drums.push({ pos: [post[0], height / 2, post[2]], scale: [0.17, height, 0.17], hex: darkSteel });
      }
      const alongX = Math.abs(b[0] - a[0]) > Math.abs(b[2] - a[2]);
      boxes.push({
        pos: [(a[0] + b[0]) / 2, height - 0.08, (a[2] + b[2]) / 2],
        scale: alongX ? [Math.abs(b[0] - a[0]), 0.14, 0.14] : [0.14, 0.14, Math.abs(b[2] - a[2])],
        hex: darkSteel,
      });
    }
  }

  // ---------------------------------------------------------------- the props
  const props = (city ? city.props : []).concat(yard ? yard.props : []);
  for (const prop of props) {
    const [x, , z] = prop.pos;
    const rotY = prop.rot || 0;
    if (prop.type === 'crate') {
      timber.push({ pos: prop.pos, scale: prop.size, rotY, hex: prop.hex });
      // A batten round the lid, so a crate is not a plain cube.
      timber.push({
        pos: [x, prop.pos[1] + prop.size[1] / 2 - 0.04, z],
        scale: [prop.size[0] * 1.04, 0.07, prop.size[2] * 1.04],
        rotY,
        hex: world_shade(prop.hex, -0.2),
      });
    } else if (prop.type === 'pallets') {
      // A stack of planks: the pallet reads as the gap between them.
      const layer = prop.size[1] / prop.layers;
      for (let index = 0; index < prop.layers; index += 1) {
        timber.push({
          pos: [x, layer * (index + 0.5) * 0.82, z],
          scale: [prop.size[0], layer * 0.6, prop.size[2]],
          rotY,
          hex: index % 2 === 0 ? prop.hex : world_shade(prop.hex, -0.12),
        });
      }
    } else if (prop.type === 'barrels') {
      // A tight cluster, laid out on a fixed ring so it never overlaps itself.
      const ring = [[0, 0], [0.62, 0.1], [0.28, 0.58], [-0.34, 0.5]];
      for (let index = 0; index < prop.count; index += 1) {
        const [dx, dz] = ring[index % ring.length];
        drums.push({
          pos: [x + dx, prop.height / 2, z + dz],
          scale: [prop.radius * 2, prop.height, prop.radius * 2],
          hex: index % 2 === 0 ? prop.hex : world_shade(prop.hex, -0.14),
        });
      }
    } else if (prop.type === 'cart') {
      boxes.push({ pos: prop.pos, scale: prop.size, rotY, hex: prop.hex });
      // A handle sticking up off one end, which is what makes it a cart.
      boxes.push({
        pos: [x + Math.cos(rotY) * prop.size[0] * 0.44, 0.42, z + Math.sin(rotY) * prop.size[0] * 0.44],
        scale: [0.07, 0.72, 0.07],
        rotY,
        hex: world_shade(prop.hex, -0.2),
      });
    } else if (prop.type === 'container') {
      const [w, h, d] = prop.size;
      for (let level = 0; level < prop.stack; level += 1) {
        ribbed.push({
          pos: [x, h * (level + 0.5), z],
          scale: [w, h, d],
          rotY,
          // The upper box a shade off the lower one: two containers, not a
          // single tall one.
          hex: level === 0 ? prop.hex : world_shade(prop.hex, -0.1),
        });
      }
    } else if (prop.type === 'dumpster') {
      const [w, h, d] = prop.size;
      ribbed.push({ pos: prop.pos, scale: [w, h, d], rotY, hex: prop.hex });
      boxes.push({
        pos: [x, h + 0.04, z],
        scale: [w * 1.04, 0.09, d * 1.04],
        rotY,
        hex: world_shade(prop.hex, -0.3),
      });
    } else if (prop.type === 'tower') {
      // Four legs, a tank and a cone: the whole silhouette of a water tower.
      const half = prop.legSpan / 2;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          drums.push({
            pos: [x + sx * half, prop.legHeight / 2, z + sz * half],
            scale: [0.14, prop.legHeight, 0.14],
            hex: prop.hex,
          });
        }
      }
      // A bracing ring half way up the legs.
      for (const sx of [-1, 1]) {
        boxes.push({
          pos: [x + sx * half, prop.legHeight * 0.52, z],
          scale: [0.07, 0.07, prop.legSpan],
          hex: world_shade(prop.hex, -0.15),
        });
        boxes.push({
          pos: [x, prop.legHeight * 0.52, z + sx * half],
          scale: [prop.legSpan, 0.07, 0.07],
          hex: world_shade(prop.hex, -0.15),
        });
      }
      drums.push({
        pos: [x, prop.legHeight + prop.tankHeight / 2, z],
        scale: [prop.tankRadius * 2, prop.tankHeight, prop.tankRadius * 2],
        hex: prop.hex,
      });
      cones.push({
        pos: [x, prop.legHeight + prop.tankHeight + prop.roofHeight / 2, z],
        scale: [prop.tankRadius * 2.1, prop.roofHeight, prop.tankRadius * 2.1],
        hex: world_shade(prop.hex, -0.18),
      });
    }
  }

  // ------------------------------------------------------------- emit meshes
  const metalSkin = world_familySkin('metal', 'plain').texture;
  const warmSkin = timber.length ? world_familySkin('warm', 'plain').texture : null;
  const ribSkin = ribbed.length
    ? world_finishTexture(world_textureCache, 'env:corrugation', world_paintCorrugation, { repeat: 1, srgb: true })
    : null;

  const emitted = [];
  const add = (mesh) => { if (mesh) { root.add(mesh); emitted.push(mesh); } };
  add(world_instances('boxes', new BoxGeometry(1, 1, 1), world_instanceMaterial(metalSkin, { roughness: 0.6, metalness: 0.34 }), boxes));
  if (warmSkin) add(world_instances('timber', new BoxGeometry(1, 1, 1), world_instanceMaterial(warmSkin, { roughness: 0.78, metalness: 0.06 }), timber));
  if (ribSkin) add(world_instances('ribbed', new BoxGeometry(1, 1, 1), world_instanceMaterial(ribSkin, { roughness: 0.66, metalness: 0.22 }), ribbed));
  add(world_instances('drums', new CylinderGeometry(0.5, 0.5, 1, 14), world_instanceMaterial(metalSkin, { roughness: 0.56, metalness: 0.4 }), drums));
  add(world_instances('cones', new ConeGeometry(0.5, 1, 16), world_instanceMaterial(metalSkin, { roughness: 0.56, metalness: 0.4 }), cones));


  // Lamp heads: the one thing here that emits. Warm and bright after dark,
  // off-white and dull by day, and no extra dynamic light either way — the
  // glow is emissive plus a sprite, which the bloom pass does the rest of.
  if (heads.length) {
    const lampMaterial = new MeshStandardMaterial({
      color: new Color(dark ? '#3a3326' : '#e8e4d8'),
      emissive: new Color(dark ? '#ffd79a' : '#f6f1e2'),
      emissiveIntensity: dark ? 2.6 : 0.35,
      roughness: 0.42,
      metalness: 0.1,
    });
    add(world_instances('lamp-heads', new BoxGeometry(1, 1, 1), lampMaterial, heads));
  }

  return { meshes: emitted, sprites };
}

/** The halo round every second lamp head. Dark theme only; one shared map. */
function world_buildLampGlow(root, spots, glowTexture) {
  if (!spots.length) return [];
  const material = new SpriteMaterial({
    map: glowTexture,
    color: new Color('#ffcf8a'),
    transparent: true,
    depthWrite: false,
    opacity: 0.5,
    blending: AdditiveBlending,
  });
  const made = [];
  for (const [x, y, z] of spots) {
    const sprite = new Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(1.5);
    sprite.name = 'env:lamp-glow';
    root.add(sprite);
    made.push(sprite);
  }
  return made;
}

// ------------------------------------------------------------------- camera

// Eight corners of the box the hero shot has to contain: the slab plus
// everything standing on it.
function world_heroCorners(model) {
  const minX = Math.min(model.slab.footprint.minX, model.content.min[0]);
  const maxX = Math.max(model.slab.footprint.maxX, model.content.max[0]);
  const minZ = Math.min(model.slab.footprint.minZ, model.content.min[2]);
  const maxZ = Math.max(model.slab.footprint.maxZ, model.content.max[2]);
  const minY = -model.slab.thickness;
  const maxY = Math.max(0.5, model.content.max[1]);
  const corners = [];
  for (const x of [minX, maxX]) {
    for (const y of [minY, maxY]) {
      for (const z of [minZ, maxZ]) corners.push([x, y, z]);
    }
  }
  return { corners, center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2] };
}

/**
 * Fit the hero shot: how far back to stand, and what to look at.
 *
 * Distance alone is not enough. A slab seen from 34 degrees up projects to a
 * lopsided silhouette, so pinning the worst corner at `fill` of the half-frame
 * leaves slack on the opposite side and the diorama sits small and low. Each
 * pass therefore re-centres the target on the projected bounding box and
 * refits; three passes are far more than this converges in.
 */
function world_fitHero(corners, start, direction, tanX, tanY, fill) {
  const forward = direction.clone().negate(); // camera -> target
  const up = new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(forward, up).normalize();
  const camUp = new Vector3().crossVectors(right, forward).normalize();
  const target = start.clone();
  let distance = 1;
  for (let pass = 0; pass < 3; pass += 1) {
    const local = corners.map((corner) => {
      const offset = new Vector3(corner[0] - target.x, corner[1] - target.y, corner[2] - target.z);
      // `forward` runs away from the camera, so negate to get a depth that is
      // positive on the near side of the target.
      return { x: offset.dot(right), y: offset.dot(camUp), depth: -offset.dot(forward) };
    });
    // Solve |x| / ((distance - depth) * tanX) = fill for every corner and keep
    // the worst one.
    distance = 1;
    for (const point of local) {
      distance = Math.max(
        distance,
        Math.abs(point.x) / (tanX * fill) + point.depth,
        Math.abs(point.y) / (tanY * fill) + point.depth,
      );
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of local) {
      const throwLength = Math.max(0.2, distance - point.depth);
      const sx = point.x / throwLength;
      const sy = point.y / throwLength;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    // A world shift of s along `right` moves the silhouette by about s/distance
    // in these units, so this walks the off-centre straight out.
    target.addScaledVector(right, ((minX + maxX) / 2) * distance);
    target.addScaledVector(camUp, ((minY + maxY) / 2) * distance);
  }
  return { target, distance };
}

function world_homeFraming(model, aspect, fov = WORLD_HERO_FOV) {
  // Frame the slab and everything on it: the hero shot is a photograph of a
  // model on a plinth, and the plinth is part of the subject.
  const hero = world_heroCorners(model);
  const target = new Vector3(hero.center[0], Math.max(0.4, hero.center[1]), hero.center[2]);
  const direction = new Vector3(
    Math.sin(WORLD_HOME.polar) * Math.sin(WORLD_HOME.azimuth),
    Math.cos(WORLD_HOME.polar),
    Math.sin(WORLD_HOME.polar) * Math.cos(WORLD_HOME.azimuth),
  ).normalize();
  const tanY = Math.tan((fov * Math.PI) / 360);
  const tanX = tanY * Math.max(0.5, aspect);
  const fit = world_fitHero(hero.corners, target, direction, tanX, tanY, WORLD_HOME.fill);
  const position = fit.target.clone().add(direction.multiplyScalar(fit.distance));
  return { position, target: fit.target, radius: model.content.radius, distance: fit.distance };
}

function world_focusFraming(part, camera, fill = WORLD_FOCUS_FILL) {
  const reach = Math.max(part.size[0], part.size[1], part.size[2]);
  const fov = (camera.fov * Math.PI) / 180;
  const distance = (reach / fill) / (2 * Math.tan(fov / 2)) + reach * 0.8;
  const target = new Vector3(part.pos[0], part.pos[1], part.pos[2]);
  // Approach from the same hemisphere as the hero pose (-x, +z): that is the
  // side every applied detail is mounted on, so a focus shot shows the vents,
  // the plate and the panel seams rather than two blank faces.
  const direction = new Vector3(-0.62, 0.52, 0.58).normalize();
  return { position: target.clone().add(direction.multiplyScalar(distance)), target };
}

// --------------------------------------------------------------------- HUD

function world_hud(model, stats, debug) {
  const hud = document.querySelector('.hud');
  if (!hud) return null;
  const hint = hud.querySelector('.hint');
  const controls = 'drag to orbit · scroll to zoom · double-click a part to focus · V first person';
  if (hint) hint.textContent = controls;
  // The counters are a development aid. They are not part of the picture, so
  // nothing is appended at all unless ?debug=1 asked for them.
  if (!debug) return { hint, badge: null };
  const badge = document.createElement('div');
  badge.className = 'world-stats';
  badge.textContent = `${stats.parts} parts · ${stats.links} links · ${stats.pulses} pulses`;
  hud.appendChild(badge);
  return { hint, badge };
}

// ------------------------------------------------------------ label clamp

// A label is a world-space sprite, so by default it grows with the inverse of
// camera distance and a close-up fills the frame with one chip. These bound
// the chip's share of the frame to [0.80, 1.30] of the size it has in the
// hero shot: far labels stay readable, near ones stop shouting.
const WORLD_LABEL_MIN = 0.8;
const WORLD_LABEL_MAX = 1.3;
// Inside this many units a chip that still wants to be bigger than the clamp
// is sitting on the lens, so it fades out of the way of the surface detail
// the close-up was taken for.
const WORLD_LABEL_FADE_NEAR = 3.5;
const WORLD_LABEL_FADE_MIN = 0.25;
// First person walks right up to the machinery, where even a clamped chip
// covers the part it names.
const WORLD_LABEL_FP_NEAR = 2.5;
const WORLD_LABEL_FP_OPACITY = 0.1;

/**
 * Resize and fade one label for a camera standing `distance` away.
 *
 * `reach` is the hero shot's distance times its half-angle tangent: the
 * product that decides how many pixels a world unit is worth. Dividing it by
 * the same product for the current camera gives how much bigger the chip
 * would draw than it does in the hero shot, which is the number being
 * clamped. Pure, so the clamp a frozen `?t=` capture applies is a function of
 * the camera alone and two runs agree to the byte.
 */
function world_labelClamp(distance, tan, reach, fp) {
  const safe = Math.max(1e-4, distance * Math.max(1e-4, tan));
  const raw = reach / safe;
  const clamped = world_clamp(raw, WORLD_LABEL_MIN, WORLD_LABEL_MAX);
  let opacity = 1;
  if (fp && distance < WORLD_LABEL_FP_NEAR) {
    opacity = WORLD_LABEL_FP_OPACITY;
  } else if (raw > WORLD_LABEL_MAX && distance < WORLD_LABEL_FADE_NEAR) {
    // Ramp rather than a step: an orbit that drifts past the threshold should
    // not pop the chip out of the frame.
    const t = world_clamp((WORLD_LABEL_FADE_NEAR - distance) / WORLD_LABEL_FADE_NEAR, 0, 1);
    opacity = world_lerp(1, WORLD_LABEL_FADE_MIN, t);
  }
  // The chip is drawn at `base * scale` world units and read at `raw` times
  // hero size, so undoing `raw` and reapplying the clamped factor is what
  // pins the on-screen size inside the band.
  return { scale: clamped / raw, opacity };
}

// ----------------------------------------------------------------- fallback

// The name a screen reader (or a fallback screenshot) hears for the picture:
// the scene's own words, subtitle included only when the scene gave one.
function world_sceneLabel(scene) {
  const title = String(scene && scene.title != null ? scene.title : '').trim();
  const subtitle = String(scene && scene.subtitle != null ? scene.subtitle : '').trim();
  return subtitle ? `${title} — ${subtitle}` : title;
}

// Machines without WebGL — and frames whose context the driver revoked — get
// the static SVG the SVG page uses, cloned out of the template build.mjs
// inlined. A world page then degrades to a readable picture, never a blank
// canvas. Returns false when no template was inlined, so the caller can tell
// "fallback shown" from "nothing to show".
function world_showFallback(host) {
  if (!host) return false;
  const template = document.getElementById('world-fallback');
  if (!template) return false;
  if (!host.querySelector('.world-fallback')) {
    const wrap = document.createElement('div');
    wrap.className = 'world-fallback';
    wrap.appendChild(template.content.cloneNode(true));
    host.appendChild(wrap);
  }
  const canvas = host.querySelector('canvas');
  if (canvas) canvas.remove();
  document.documentElement.setAttribute('data-world-ready', 'fallback');
  return true;
}

// ------------------------------------------------------------------- mount

export function world_mount(options = {}) {
  const host = options.host || document.querySelector('.stage');
  const dataNode = document.getElementById('world-scene');
  if (!host || !dataNode) return null;
  const scene = JSON.parse(dataNode.textContent);
  const query = world_query();
  const model = buildWorld(scene, query.env ? { env: query.env } : {});
  const dark = model.theme === 'dark';
  const frozen = query.frozen !== null;

  // Reduced motion renders one still frame instead of an animation loop; a
  // small viewport or a data-saver client spends less on pixels and skips the
  // bloom pass. The desktop look is untouched.
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const saveData = !!(nav && nav.connection && nav.connection.saveData);
  const small = Math.min(window.innerWidth || Infinity, window.innerHeight || Infinity) < 700;
  const reduceMotion = !!(window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const lite = saveData || small;

  // No WebGL is a normal machine, not a crash: catch the constructor's throw
  // and show the inlined SVG instead of leaving an empty canvas.
  let renderer;
  try {
    renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      // A frozen frame is rendered once and never again, so the drawing buffer
      // has to survive until the screenshot tool reads it back.
      preserveDrawingBuffer: frozen,
    });
  } catch (error) {
    world_showFallback(host);
    return null;
  }
  renderer.info.autoReset = false;
  renderer.setPixelRatio(Math.min(lite ? 1.5 : 2, window.devicePixelRatio || 1));
  renderer.setSize(host.clientWidth || window.innerWidth, host.clientHeight || window.innerHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = dark ? 1.38 : 0.98;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  renderer.domElement.classList.add('world-canvas');
  // The canvas is a picture, so announce it as one.
  renderer.domElement.setAttribute('role', 'img');
  const canvasLabel = world_sceneLabel(scene);
  if (canvasLabel) renderer.domElement.setAttribute('aria-label', canvasLabel);

  const stage = new Scene();
  stage.background = world_skyTexture(model.theme);
  // Half the haze in the light theme: at 0.0075 the far side of the slab lost
  // all its contrast and the cables read as scaffolding floating in milk.
  stage.fog = new FogExp2(new Color(dark ? '#0a1018' : '#e6dcc6'), dark ? 0.0062 : 0.0037);

  const camera = new PerspectiveCamera(WORLD_HERO_FOV, (host.clientWidth || 1) / (host.clientHeight || 1), 0.1, 2000);
  const home = world_homeFraming(model, camera.aspect);
  camera.position.copy(home.position);
  camera.lookAt(home.target);

  const root = new Group();
  stage.add(root);

  const material = world_materials(model.theme);
  const cylinderMaterial = world_cylinderMaterials(model.theme);
  const glowTexture = world_radialTexture(1, 0, 2.2);
  const lights = world_lighting(stage, model);
  if (lite) {
    // Cheaper and softer on small or data-saving clients. Set before the first
    // render, while there is no shadow map to rebuild.
    lights.key.shadow.mapSize.set(1024, 1024);
    lights.key.shadow.radius = 5.2;
  }
  world_buildSlab(root, model, material);
  // The place, before the machines: its paint lies on the deck and its
  // furniture has already been planned around the parts.
  world_buildGround(root, model);
  const environment = world_buildEnvironment(root, model);
  world_buildLampGlow(root, environment.sprites, glowTexture);
  const built = world_buildParts(root, model, material, cylinderMaterial, glowTexture);
  const overlays = world_buildLinks(root, model, material, glowTexture);
  const flows = world_buildFlows(root, model, glowTexture);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.target.copy(home.target);
  controls.minDistance = 2;
  controls.maxDistance = home.distance * 4;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.update();

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(stage, camera));
  if (!lite) {
    const bloom = new UnrealBloomPass(
      new Vector2(host.clientWidth || 1, host.clientHeight || 1),
      dark ? 0.38 : 0.16,
      0.68,
      dark ? 0.85 : 0.92,
    );
    composer.addPass(bloom);
  }
  composer.addPass(new OutputPass());

  const hud = world_hud(model, model.stats, query.debug);

  // ------------------------------------------------------------ navigation
  // First person spawns on the near edge of the slab, facing the machinery.
  const fpStart = new Vector3(
    world_clamp(model.content.center[0], model.slab.footprint.minX + 1.5, model.slab.footprint.maxX - 1.5),
    WORLD_FP_HEIGHT,
    world_clamp(model.content.max[2] + 3.5, model.slab.footprint.minZ + 1.5, model.slab.footprint.maxZ - 1.5),
  );
  const fpYaw = Math.atan2(fpStart.x - model.content.center[0], fpStart.z - model.content.center[2]);

  const state = {
    mode: 'orbit',
    fly: null,
    focused: null,
    keys: new Set(),
    yaw: fpYaw,
    pitch: -0.08,
    fp: fpStart,
    saved: null,
  };

  const flyTo = (framing) => {
    state.fly = {
      fromPosition: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPosition: framing.position.clone(),
      toTarget: framing.target.clone(),
      started: null,
    };
  };

  const resetView = () => {
    state.focused = null;
    flyTo(world_homeFraming(model, camera.aspect));
  };

  const raycaster = new Raycaster();
  const pointer = new Vector2();

  renderer.domElement.addEventListener('dblclick', (event) => {
    if (state.mode === 'fp') return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(built.picks, false);
    if (hits.length) {
      const part = hits[0].object.userData.world_part;
      if (state.focused === part.id) {
        resetView();
        return;
      }
      state.focused = part.id;
      flyTo(world_focusFraming(part, camera));
    } else {
      resetView();
    }
  });

  // Walking around inside the diorama, the nearest wall fills the frame and
  // the key light never reaches it. A small ambient lift (and a normal lens)
  // is the difference between a room and a black rectangle.
  const setFirstPersonLook = (on) => {
    lights.ambient.intensity = on ? (dark ? 0.55 : 0.4) : 0;
    camera.fov = on ? WORLD_FP_FOV : WORLD_HERO_FOV;
    camera.updateProjectionMatrix();
  };

  const enterFirstPerson = () => {
    state.saved = { position: camera.position.clone(), target: controls.target.clone() };
    state.mode = 'fp';
    controls.enabled = false;
    setFirstPersonLook(true);
    state.fly = null;
    resolveCollisions(clampToSlab(state.fp));
    camera.position.copy(state.fp);
    if (renderer.domElement.requestPointerLock) {
      try {
        renderer.domElement.requestPointerLock();
      } catch {
        /* pointer lock is a nicety; walking still works without it */
      }
    }
    if (hud && hud.badge) hud.badge.textContent = 'first person · WASD move · shift sprint · Esc exit';
  };

  const exitFirstPerson = () => {
    state.mode = 'orbit';
    controls.enabled = true;
    setFirstPersonLook(false);
    if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();
    if (state.saved) {
      camera.position.copy(state.saved.position);
      controls.target.copy(state.saved.target);
      controls.update();
    }
    if (hud && hud.badge) {
      hud.badge.textContent = `${model.stats.parts} parts · ${model.stats.links} links · ${model.stats.pulses} pulses`;
    }
  };

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    state.keys.add(key);
    if (key === 'v') {
      if (state.mode === 'fp') exitFirstPerson();
      else enterFirstPerson();
      event.preventDefault();
    } else if (key === 'escape' && state.mode === 'fp') {
      exitFirstPerson();
    } else if (key === 'r' && state.mode !== 'fp') {
      resetView();
    } else if (key === 'e' && state.mode !== 'fp') {
      resetView();
    } else if ((key === '+' || key === '=') && state.mode !== 'fp') {
      camera.position.lerp(controls.target, 0.12);
    } else if ((key === '-' || key === '_') && state.mode !== 'fp') {
      camera.position.lerp(controls.target, -0.12);
    }
  });
  window.addEventListener('keyup', (event) => state.keys.delete(event.key.toLowerCase()));

  window.addEventListener('mousemove', (event) => {
    if (state.mode !== 'fp' || !document.pointerLockElement) return;
    state.yaw -= event.movementX * 0.0022;
    state.pitch = world_clamp(state.pitch - event.movementY * 0.0022, -1.2, 1.2);
  });

  const panStep = () => Math.max(0.4, camera.position.distanceTo(controls.target) * 0.04);
  const pan = (dx, dz) => {
    const forward = new Vector3().subVectors(controls.target, camera.position).setY(0).normalize();
    const right = new Vector3(forward.z, 0, -forward.x);
    const shift = right.multiplyScalar(dx).add(forward.multiplyScalar(dz));
    camera.position.add(shift);
    controls.target.add(shift);
  };

  // ------------------------------------------------------------ simulation
  const clampToSlab = (position) => {
    const pad = 0.4;
    position.x = world_clamp(position.x, model.slab.footprint.minX + pad, model.slab.footprint.maxX - pad);
    position.z = world_clamp(position.z, model.slab.footprint.minZ + pad, model.slab.footprint.maxZ - pad);
    return position;
  };

  // Soft AABB collision: push the walker out along the shallowest axis so you
  // bump into boxes instead of walking through them.
  const resolveCollisions = (position) => {
    for (const box of built.boxes) {
      if (position.y < box.min[1] - WORLD_FP_HEIGHT || position.y > box.max[1] + WORLD_FP_HEIGHT) continue;
      const minX = box.min[0] - WORLD_FP_RADIUS;
      const maxX = box.max[0] + WORLD_FP_RADIUS;
      const minZ = box.min[2] - WORLD_FP_RADIUS;
      const maxZ = box.max[2] + WORLD_FP_RADIUS;
      if (position.x <= minX || position.x >= maxX || position.z <= minZ || position.z >= maxZ) continue;
      const pushes = [
        { axis: 'x', amount: minX - position.x },
        { axis: 'x', amount: maxX - position.x },
        { axis: 'z', amount: minZ - position.z },
        { axis: 'z', amount: maxZ - position.z },
      ];
      let best = pushes[0];
      for (const push of pushes) if (Math.abs(push.amount) < Math.abs(best.amount)) best = push;
      position[best.axis] += best.amount;
    }
    return position;
  };

  const stepFirstPerson = (delta) => {
    const speed = WORLD_FP_SPEED * (state.keys.has('shift') ? WORLD_FP_SPRINT : 1) * delta;
    const forward = new Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    const right = new Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
    const move = new Vector3();
    if (state.keys.has('w') || state.keys.has('arrowup')) move.add(forward);
    if (state.keys.has('s') || state.keys.has('arrowdown')) move.sub(forward);
    if (state.keys.has('d') || state.keys.has('arrowright')) move.add(right);
    if (state.keys.has('a') || state.keys.has('arrowleft')) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      state.fp.add(move);
      resolveCollisions(clampToSlab(state.fp));
    }
    state.fp.y = WORLD_FP_HEIGHT;
    camera.position.copy(state.fp);
    const look = new Vector3(
      -Math.sin(state.yaw) * Math.cos(state.pitch),
      Math.sin(state.pitch),
      -Math.cos(state.yaw) * Math.cos(state.pitch),
    );
    camera.lookAt(state.fp.clone().add(look));
  };

  const stepOrbitKeys = (delta) => {
    if (state.mode === 'fp') return;
    const step = panStep() * delta * 14;
    if (state.keys.has('arrowleft')) pan(-step, 0);
    if (state.keys.has('arrowright')) pan(step, 0);
    if (state.keys.has('arrowup')) pan(0, step);
    if (state.keys.has('arrowdown')) pan(0, -step);
  };

  const stepFly = (now) => {
    if (!state.fly) return;
    if (state.fly.started === null) state.fly.started = now;
    const t = world_clamp((now - state.fly.started) / WORLD_FLY_MS, 0, 1);
    const eased = world_easeInOut(t);
    camera.position.lerpVectors(state.fly.fromPosition, state.fly.toPosition, eased);
    controls.target.lerpVectors(state.fly.fromTarget, state.fly.toTarget, eased);
    if (t >= 1) state.fly = null;
  };

  const pulseScratch = [];
  const stepFlows = (time) => {
    pulseScratch.length = 0;
    for (const entry of flows) {
      for (const pulse of entry.pulses) {
        const u = ((time / entry.flow.period + pulse.offset) % 1 + 1) % 1;
        const point = entry.curve.getPointAt(u);
        pulse.position.copy(point);
        pulse.group.position.copy(point);
        pulseScratch.push({ position: point, cables: entry.flow.cables, hex: entry.flow.hex });
      }
    }
    // Light the wire near each pulse by writing ring intensities into the
    // overlay tube's vertex colours.
    for (const overlay of overlays) {
      const colors = overlay.overlay.geometry.attributes.color;
      const array = colors.array;
      let touched = false;
      for (let ring = 0; ring < overlay.rings; ring += 1) {
        const x = overlay.centres[ring * 3];
        const y = overlay.centres[ring * 3 + 1];
        const z = overlay.centres[ring * 3 + 2];
        let intensity = 0;
        for (const pulse of pulseScratch) {
          if (!pulse.cables.includes(overlay.link.index)) continue;
          const distance = Math.hypot(x - pulse.position.x, y - pulse.position.y, z - pulse.position.z);
          if (distance > WORLD_PULSE_REACH) continue;
          const fall = 1 - distance / WORLD_PULSE_REACH;
          intensity = Math.max(intensity, fall * fall);
        }
        if (intensity > 0) touched = true;
        const r = overlay.tint.r * intensity;
        const g = overlay.tint.g * intensity;
        const b = overlay.tint.b * intensity;
        const start = ring * overlay.perRing;
        for (let index = 0; index < overlay.perRing; index += 1) {
          const at = (start + index) * 3;
          array[at] = r;
          array[at + 1] = g;
          array[at + 2] = b;
        }
      }
      overlay.overlay.visible = touched;
      colors.needsUpdate = true;
    }
  };

  // ------------------------------------------------------------ labels

  // The hero shot is the reference the clamp is measured against, so the
  // chips in a capture of the home pose come out exactly the size they were
  // authored at and every other pose is bounded around it.
  const labelReach = home.distance * Math.tan((WORLD_HERO_FOV * Math.PI) / 360);
  const labelAnchor = new Vector3();
  const stepLabels = () => {
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const fp = state.mode === 'fp';
    for (const label of built.labels) {
      label.sprite.getWorldPosition(labelAnchor);
      const distance = labelAnchor.distanceTo(camera.position);
      const fit = world_labelClamp(distance, tan, labelReach, fp);
      label.sprite.scale.set(label.base.x * fit.scale, label.base.y * fit.scale, 1);
      label.sprite.material.opacity = fit.opacity;
      label.sprite.visible = fit.opacity > 0.02;
    }
  };

  const resize = () => {
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    composer.setSize(width, height);
  };
  window.addEventListener('resize', resize);

  // -------------------------------------------------------- camera presets
  if (query.cam === 'top') {
    const framing = world_homeFraming(model, camera.aspect);
    camera.position.set(0.001, framing.distance * 1.08, 0.001);
    controls.target.set(0, 0, 0);
    controls.update();
  } else if (query.cam === 'fp') {
    state.mode = 'fp';
    controls.enabled = false;
    setFirstPersonLook(true);
    resolveCollisions(clampToSlab(state.fp));
    camera.position.copy(state.fp);
    stepFirstPerson(0);
  }
  if (query.focus) {
    const part = model.parts.find((candidate) => candidate.id === query.focus);
    if (part && query.cam !== 'top' && query.cam !== 'fp') {
      const framing = world_focusFraming(part, camera, query.fill || WORLD_FOCUS_FILL);
      camera.position.copy(framing.position);
      controls.target.copy(framing.target);
      controls.update();
      state.focused = part.id;
    }
  }

  const api = { renderer, composer, stage, camera, controls, model, state, overlays, flows };
  if (typeof window !== 'undefined') window.diorama = api;

  // Stop the loop and give GPU resources back: render targets, the renderer and
  // every cached texture. Safe to call more than once, and called on context
  // loss so a revoked context does not leak.
  let frameHandle = 0;
  let running = false;
  const stop = () => {
    running = false;
    if (frameHandle) cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  };
  const dispose = () => {
    stop();
    if (typeof composer.dispose === 'function') composer.dispose();
    renderer.dispose();
    world_textureCache.dispose();
  };
  api.stop = stop;
  api.dispose = dispose;

  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    // Without preventDefault the context never comes back; either way the
    // picture is gone, so stop, release and drop the SVG in.
    event.preventDefault();
    dispose();
    world_showFallback(host);
  }, false);

  // One deterministic update and render — the frozen `?t=` frame, reused for
  // prefers-reduced-motion.
  const renderStatic = (at) => {
    stepFlows(at);
    if (state.mode === 'fp') stepFirstPerson(0);
    stepLabels();
    renderer.info.reset();
    composer.render();
    api.drawCalls = renderer.info.render.calls;
    api.triangles = renderer.info.render.triangles;
    api.textures = world_textureCache.size;
  };

  if (frozen) {
    // Frozen capture: one deterministic update, one render, no rAF loop.
    renderStatic(query.frozen);
    document.documentElement.setAttribute('data-world-ready', 'static');
    if (hud && hud.badge) {
      hud.badge.textContent = `${model.stats.parts} parts · ${model.stats.links} links · ${model.stats.env} · ${api.drawCalls} draw calls · ${world_textureCache.size} textures · net ${model.stats.network} ${model.stats.segments}seg`;
    }

    // A single render during module evaluation is not enough: the compositor
    // only picks the canvas up once it has been marked dirty after layout, so
    // headless screenshots come back showing the page background. Redraw the
    // identical frozen frame a few more times and then stop — state never
    // advances, so the capture stays deterministic, and a bounded loop keeps
    // Chrome's virtual-time budget from burning on software rasterisation.
    running = true;
    let repaints = WORLD_FREEZE_REPAINTS;
    const repaint = () => {
      if (!running) return;
      composer.render();
      repaints -= 1;
      if (repaints > 0) frameHandle = requestAnimationFrame(repaint);
      else document.documentElement.setAttribute('data-world-ready', 'painted');
    };
    frameHandle = requestAnimationFrame(repaint);
    return api;
  }

  if (reduceMotion) {
    // One still frame, no animation loop and no travelling pulses. An orbit or
    // zoom re-renders it on demand, so the controls stay usable without
    // autoplay motion.
    renderStatic(0);
    document.documentElement.setAttribute('data-world-ready', 'static');
    if (hud && hud.badge) {
      hud.badge.textContent = `${model.stats.parts} parts · ${model.stats.links} links · ${api.drawCalls} draw calls · ${world_textureCache.size} textures`;
    }
    controls.addEventListener('change', () => renderStatic(0));
    return api;
  }

  let last = performance.now();
  let live = false;
  running = true;
  const loop = (now) => {
    if (!running) return;
    const delta = world_clamp((now - last) / 1000, 0, 0.1);
    last = now;
    stepFly(now);
    stepOrbitKeys(delta);
    if (state.mode === 'fp') stepFirstPerson(delta);
    else controls.update();
    stepFlows(now / 1000);
    stepLabels();
    renderer.info.reset();
    composer.render();
    api.drawCalls = renderer.info.render.calls;
    if (!live) {
      // Only claim the live state once a frame has actually reached the screen.
      live = true;
      document.documentElement.setAttribute('data-world-ready', 'live');
    }
    frameHandle = requestAnimationFrame(loop);
  };
  frameHandle = requestAnimationFrame(loop);
  return api;
}

export default world_mount;
