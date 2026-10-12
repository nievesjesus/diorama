import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WORLD_TEXEL,
  WORLD_TUNING,
  buildWorld,
  finishOf,
  pickSlab,
  planRoute,
  routeCandidates,
  routePlan,
  segmentClears,
  sceneAnchors,
  sceneExtent,
  themeOf,
  tokenHex,
  cylinderUvScale,
  hashToken,
  partLightness,
  remapBoxUv,
  textureDescriptor,
  WORLD_ENV_TUNING,
  avenueRect,
  freeCells,
  freeCorridors,
  partRect,
  pickEnvMode,
  rectClears,
  streetRect,
  textureVariant,
  uvScaleForBox,
  classifyTerminus,
  envEdgeGap,
  envFacing,
  envReachToAvenue,
  networkSegments,
  planBay,
  planCirculation,
  planCity,
  planCulDeSac,
  planDriveways,
  planEnvironment,
  planGate,
  planIntersections,
  planSigns,
  planTermini,
  planWalk,
  repairTermini,
  terminusStub,
  validateNetwork,
  walkGroundY,
  walkStep,
  walkBobOffset,
  walkBobPhase,
  WALK_BOB_CYCLE,
  WALK_BOB_RUN,
  WALK_BOB_WALK,
  WALK_EYE,
  WALK_FOOT_CLEAR,
  WALK_RADIUS,
  WALK_RUN,
  WALK_RUN_FOV,
  WALK_SPEED,
  WALK_STEP,
} from './scene3d.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function example(name) {
  return JSON.parse(readFileSync(join(root, 'examples', name, 'scene.json'), 'utf8'));
}

const minimal = {
  version: 1,
  title: 'Minimal',
  theme: 'light',
  parts: [
    { id: 'ground', kind: 'plate', at: [0, 0, 0], size: [20, 20, 0.3], color: 'slate', detail: 'concrete' },
    { id: 'a', kind: 'box', at: [2, 2, 0.3], size: [2, 2, 2], color: 'blue', label: 'A' },
    { id: 'b', kind: 'box', at: [16, 16, 0.3], size: [2, 2, 2], color: 'green' },
  ],
  links: [{ from: 'a', to: 'b', kind: 'tube', color: 'blue' }],
  flows: [{ path: ['a', 'b'], kind: 'request', color: 'blue', speed: 12, count: 3 }],
};

test('themeOf and tokenHex read the scene palette', () => {
  assert.equal(themeOf({ theme: 'dark' }), 'dark');
  assert.equal(themeOf({}), 'light');
  assert.equal(tokenHex('blue', 'light'), '#46799f');
  assert.equal(tokenHex('blue', 'dark'), '#456f96');
  assert.equal(tokenHex('nope', 'light'), tokenHex('steel', 'light'));
});

test('finishOf groups tokens into material families', () => {
  assert.equal(finishOf('steel'), 'metal');
  assert.equal(finishOf('slate'), 'metal');
  assert.equal(finishOf('blue'), 'plastic');
  assert.equal(finishOf('copper'), 'warm');
  assert.equal(finishOf('unknown-token'), 'plastic');
});

test('sceneAnchors matches the isometric kit port layout', () => {
  const box = { id: 'x', kind: 'box', at: [0, 0, 0], size: [2, 4, 6] };
  const ports = sceneAnchors(box);
  assert.deepEqual(ports.top, [1, 2, 6]);
  assert.deepEqual(ports.bottom, [1, 2, 0]);
  assert.deepEqual(ports.west, [0, 2, 3]);
  assert.deepEqual(ports.east, [2, 2, 3]);
  const cylinder = { id: 'c', kind: 'cylinder', at: [0, 0, 0], radius: 1, h: 3, axis: 'z' };
  assert.deepEqual(sceneAnchors(cylinder).top, [0, 0, 3]);
  assert.throws(() => sceneAnchors({ kind: 'blob', at: [0, 0, 0] }), /unknown part kind/);
});

test('sceneExtent covers boxes and every cylinder axis', () => {
  assert.deepEqual(sceneExtent({ kind: 'box', at: [1, 2, 3], size: [2, 2, 2] }), { min: [1, 2, 3], max: [3, 4, 5] });
  assert.deepEqual(sceneExtent({ kind: 'cylinder', at: [0, 0, 0], radius: 2, h: 5, axis: 'z' }), { min: [-2, -2, 0], max: [2, 2, 5] });
  assert.deepEqual(sceneExtent({ kind: 'cylinder', at: [0, 0, 0], radius: 2, h: 5, axis: 'x' }), { min: [0, -2, -2], max: [5, 2, 2] });
  assert.deepEqual(sceneExtent({ kind: 'cylinder', at: [0, 0, 0], radius: 2, h: 5, axis: 'y' }), { min: [-2, 0, -2], max: [2, 5, 2] });
});

test('pickSlab prefers the concrete plate and rejects small plates', () => {
  assert.equal(pickSlab(minimal.parts).id, 'ground');
  const noFloor = [
    { id: 'tiny', kind: 'plate', at: [0, 0, 0], size: [1, 1, 0.2], color: 'sand' },
    { id: 'big', kind: 'box', at: [0, 0, 0], size: [20, 20, 2], color: 'blue' },
  ];
  assert.equal(pickSlab(noFloor), null);
  assert.equal(pickSlab([{ id: 'b', kind: 'box', at: [0, 0, 0], size: [1, 1, 1], color: 'blue' }]), null);
});

test('routePlan produces a straight run plus a single 45-degree elbow', () => {
  assert.deepEqual(routePlan(0, 0, 10, 2), [[0, 0], [8, 0], [10, 2]]);
  assert.deepEqual(routePlan(0, 0, 2, 10), [[0, 0], [0, 8], [2, 10]]);
  // A pure diagonal needs no straight run at all.
  assert.deepEqual(routePlan(0, 0, 5, 5), [[0, 0], [5, 5]]);
  assert.deepEqual(routePlan(3, 3, 3, 3), [[3, 3]]);
});

test('buildWorld extracts the slab and drops it from the solids', () => {
  const world = buildWorld(minimal);
  assert.equal(world.parts.length, 2);
  assert.equal(world.parts.some((part) => part.id === 'ground'), false);
  assert.equal(world.slab.sourceId, 'ground');
  assert.equal(world.slab.thickness, WORLD_TUNING.slabThickness);
  // The slab is recentred on the origin with its top face at y = 0.
  assert.deepEqual(world.slab.pos, [0, -WORLD_TUNING.slabThickness / 2, 0]);
  assert.deepEqual(world.slab.footprint, { minX: -10, maxX: 10, minZ: -10, maxZ: 10 });
});

test('buildWorld converts z-up scene space to y-up world space', () => {
  const world = buildWorld(minimal);
  const a = world.parts.find((part) => part.id === 'a');
  // Scene centre [3, 3, 1.3] with origin [10, 0.3, 10] -> world [-7, 1, -7].
  assert.deepEqual(a.pos, [-7, 1, -7]);
  assert.deepEqual(a.size, [2, 2, 2]);
  // Parts rest on the deck: bottom of the box is exactly y = 0.
  assert.equal(a.pos[1] - a.size[1] / 2, 0);
});

test('buildWorld runs links low and poles only a long span', () => {
  const world = buildWorld(minimal);
  assert.equal(world.links.length, 1);
  const link = world.links[0];
  // The run holds the single low cable height, below the tops of the parts.
  assert.equal(world.cableHeight, WORLD_TUNING.cableRun);
  assert.equal(link.style, 'poles');
  assert.ok(link.span > WORLD_TUNING.poleSpan);
  // One pole in the middle of a long straight span, not one per node.
  assert.equal(link.poles.length, 1);
  assert.equal(link.poles[0].height, WORLD_TUNING.cableRun + WORLD_TUNING.poleLift);
  const heights = link.points3D.map((point) => point[1]);
  assert.equal(Math.max(...heights), world.cableHeight);
  assert.equal(link.points3D[0][1] < world.cableHeight, true);
  // Nothing sags out of a port stub or down a riser.
  assert.equal(link.segments[0].sag, 0);
  // A clear run between facing ports takes no elbow at all: port, lead, tail,
  // port.
  assert.equal(link.points3D.length, 4);
});

test('buildWorld leaves a short link pole-less', () => {
  const close = JSON.parse(JSON.stringify(minimal));
  close.parts[2].at = [6, 6, 0.3];
  const world = buildWorld(close);
  assert.ok(world.links[0].span <= WORLD_TUNING.poleSpan);
  assert.equal(world.links[0].style, 'tray');
  assert.deepEqual(world.links[0].poles, []);
});

test('segmentClears detects a crossing and ignores a near miss', () => {
  const rect = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  assert.equal(segmentClears(-4, 0, 4, 0, rect, 0), false);
  assert.equal(segmentClears(-4, 3, 4, 3, rect, 0), true);
  // The margin is what turns a graze into a collision.
  assert.equal(segmentClears(-4, 1.3, 4, 1.3, rect, 0.5), false);
});

test('planRoute goes straight when clear and takes one elbow when blocked', () => {
  const blocker = { id: 'mid', minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  assert.deepEqual(planRoute(-6, 0, 6, 0, [], 0.4), [[-6, 0], [6, 0]]);
  const detour = planRoute(-6, 0, 6, 0, [blocker], 0.4);
  assert.equal(detour.length, 3, 'exactly one waypoint');
  assert.deepEqual(detour[0], [-6, 0]);
  assert.deepEqual(detour[detour.length - 1], [6, 0]);
});

test('routeCandidates never offers more than one waypoint', () => {
  for (const nodes of routeCandidates(0, 0, 7, 3)) {
    assert.ok(nodes.length <= 3, 'at most one elbow per candidate');
  }
});

test('buildWorld chains flows onto the exact link segments', () => {
  const world = buildWorld(minimal);
  const flow = world.flows[0];
  assert.deepEqual(flow.cables, [0]);
  assert.deepEqual(flow.segments, world.links[0].segments);
  assert.equal(flow.period, 5); // 12 loops per minute
  assert.equal(flow.count, 3);
});

test('buildWorld reverses a flow that walks a link backwards', () => {
  const reversed = JSON.parse(JSON.stringify(minimal));
  reversed.flows[0].path = ['b', 'a'];
  const world = buildWorld(reversed);
  const flow = world.flows[0];
  assert.deepEqual(flow.cables, [0]);
  assert.deepEqual(flow.points3D[0], world.links[0].points3D[world.links[0].points3D.length - 1]);
});

test('buildWorld routes a flow hop that has no declared link', () => {
  const extra = JSON.parse(JSON.stringify(minimal));
  extra.parts.push({ id: 'c', kind: 'box', at: [18, 2, 0.3], size: [2, 2, 2], color: 'plum' });
  extra.flows[0].path = ['a', 'b', 'c'];
  const world = buildWorld(extra);
  assert.deepEqual(world.flows[0].cables, [0]);
  assert.ok(world.flows[0].segments.length > world.links[0].segments.length);
});

test('buildWorld synthesises a slab when the scene has no floor plate', () => {
  const floating = {
    version: 1,
    title: 'No floor',
    theme: 'dark',
    parts: [{ id: 'a', kind: 'box', at: [0, 0, 0], size: [4, 4, 2], color: 'blue' }],
  };
  const world = buildWorld(floating);
  assert.equal(world.slab.sourceId, null);
  assert.equal(world.parts.length, 1);
  assert.deepEqual(world.slab.footprint, { minX: -2.6, maxX: 2.6, minZ: -2.6, maxZ: 2.6 });
});

test('buildWorld honours an explicit theme override', () => {
  const world = buildWorld(minimal, { theme: 'dark' });
  assert.equal(world.theme, 'dark');
  assert.equal(world.parts.find((part) => part.id === 'a').hex, tokenHex('blue', 'dark'));
});

test('buildWorld is deterministic for every shipped example', () => {
  for (const name of ['kafka-pipeline', 'three-tier-web', 'k8s-ci']) {
    const scene = example(name);
    const first = buildWorld(scene);
    const second = buildWorld(JSON.parse(JSON.stringify(scene)));
    assert.deepEqual(second, first, `${name} must map deterministically`);
    assert.ok(first.parts.length > 0);
    assert.ok(first.stats.parts === first.parts.length);
  }
});

test('buildWorld counts the kafka example exactly', () => {
  const world = buildWorld(example('kafka-pipeline'));
  assert.equal(world.theme, 'dark');
  assert.equal(world.stats.parts, 14);
  assert.equal(world.stats.links, 10);
  assert.equal(world.stats.flows, 3);
  assert.equal(world.stats.pulses, 7);
  assert.equal(world.slab.sourceId, 'ground');
  assert.equal(world.notes.length, 2);
  assert.equal(world.readout.length, 3);
});

test('buildWorld rejects a non-object scene', () => {
  assert.throws(() => buildWorld(null), /requires a scene object/);
});

test('buildWorld grounds one physical sign on every labelled part, on the slab', () => {
  const world = buildWorld(example('kafka-pipeline'));
  const labelled = world.parts.filter((part) => part.label);
  assert.ok(labelled.length > 0);
  for (const part of labelled) {
    assert.ok(part.sign, `${part.id} needs a sign`);
    assert.ok(part.sign.postH > 0, `${part.id} needs a post`);
    assert.ok(part.sign.x > world.slab.footprint.minX && part.sign.x < world.slab.footprint.maxX);
    assert.ok(part.sign.z > world.slab.footprint.minZ && part.sign.z < world.slab.footprint.maxZ);
  }
});

test('planSigns gives a cylinder and a slab-level plate a signpost too', () => {
  const world = buildWorld(example('three-tier-web'));
  const cylinder = world.parts.find((part) => part.id === 'redis');
  const plate = world.parts.find((part) => part.id === 'queue');
  assert.ok(cylinder && cylinder.sign && cylinder.sign.postH > 0);
  assert.ok(plate && plate.sign && plate.sign.postH > 0);
});

test('planSigns is a pure function of the part list', () => {
  const first = buildWorld(example('rea')).parts.map((part) => part.sign);
  const second = buildWorld(example('rea')).parts.map((part) => part.sign);
  assert.deepEqual(second, first);
});

// ------------------------------------------------------------- texture helpers

test('uvScaleForBox scales every face from its own two dimensions', () => {
  const scales = uvScaleForBox([4.8, 2.4, 1.2], 2.4);
  assert.equal(scales.length, 6);
  // +x and -x span depth x height
  assert.deepEqual(scales[0], [0.5, 1]);
  assert.deepEqual(scales[1], [0.5, 1]);
  // +y and -y span width x depth
  assert.deepEqual(scales[2], [2, 0.5]);
  assert.deepEqual(scales[3], [2, 0.5]);
  // +z and -z span width x height
  assert.deepEqual(scales[4], [2, 1]);
  assert.deepEqual(scales[5], [2, 1]);
});

test('uvScaleForBox defaults to the shared texel density', () => {
  assert.equal(WORLD_TEXEL, 2.4);
  assert.deepEqual(uvScaleForBox([2.4, 2.4, 2.4]), uvScaleForBox([2.4, 2.4, 2.4], WORLD_TEXEL));
  // A part exactly one texel on a side wraps exactly one tile per face.
  for (const face of uvScaleForBox([2.4, 2.4, 2.4])) assert.deepEqual(face, [1, 1]);
});

test('uvScaleForBox is immune to sign and to a zero texel', () => {
  assert.deepEqual(uvScaleForBox([-4.8, 2.4, 1.2]), uvScaleForBox([4.8, 2.4, 1.2]));
  assert.deepEqual(uvScaleForBox([4.8, 2.4, 1.2], 0), uvScaleForBox([4.8, 2.4, 1.2], WORLD_TEXEL));
});

test('remapBoxUv scales each four-vertex face by its own face scale', () => {
  // The BoxGeometry unit square, repeated for all six faces.
  const square = [0, 1, 1, 1, 0, 0, 1, 0];
  const uv = [];
  for (let face = 0; face < 6; face += 1) uv.push(...square);
  const out = remapBoxUv(uv, [4.8, 2.4, 1.2], 2.4);
  assert.equal(out.length, uv.length);
  // Face 0 (+x) is [0.5, 1]: u halved, v untouched.
  assert.deepEqual(out.slice(0, 8), [0, 1, 0.5, 1, 0, 0, 0.5, 0]);
  // Face 2 (+y) is [2, 0.5].
  assert.deepEqual(out.slice(16, 24), [0, 0.5, 2, 0.5, 0, 0, 2, 0]);
  // Face 4 (+z) is [2, 1].
  assert.deepEqual(out.slice(32, 40), [0, 1, 2, 1, 0, 0, 2, 0]);
});

test('remapBoxUv never mutates its input and accepts a typed array', () => {
  const square = [0, 1, 1, 1, 0, 0, 1, 0];
  const uv = [];
  for (let face = 0; face < 6; face += 1) uv.push(...square);
  const before = uv.slice();
  const fromArray = remapBoxUv(uv, [4.8, 2.4, 1.2]);
  assert.deepEqual(uv, before);
  const fromTyped = remapBoxUv(Float32Array.from(uv), [4.8, 2.4, 1.2]);
  assert.deepEqual(fromTyped, fromArray);
});

test('cylinderUvScale wraps the circumference in u and the height in v', () => {
  const scale = cylinderUvScale(1.6, 4.8, 2.4);
  assert.equal(scale.v, 2);
  // 2 * pi * 1.6 / 2.4 = 4.18879...
  assert.ok(Math.abs(scale.u - 4.18879) < 1e-4, `u was ${scale.u}`);
  // Never below one tile: a squat drum still gets a whole skin.
  assert.deepEqual(cylinderUvScale(0.1, 0.2, 2.4), { u: 1, v: 1 });
});

test('partLightness stays inside the +/-3% band and is stable per id', () => {
  const ids = ['producer', 'consumerA', 'consumerB', 'dlq', 'sink', 'rack', 'p0', 'p1', 'p2', ''];
  for (const id of ids) {
    const value = partLightness(id);
    assert.ok(value >= 0.97 && value <= 1.03, `${id} -> ${value}`);
    assert.equal(partLightness(id), value);
  }
  // Different ids actually land on different factors, or the whole point of
  // the wobble is lost.
  const distinct = new Set(ids.map(partLightness));
  assert.ok(distinct.size >= ids.length - 1, `only ${distinct.size} distinct factors`);
});

test('hashToken is a stable unsigned 32-bit FNV-1a', () => {
  assert.equal(hashToken('producer'), hashToken('producer'));
  assert.notEqual(hashToken('producer'), hashToken('consumerA'));
  for (const text of ['', 'a', 'producer', 'a very long part identifier indeed']) {
    const value = hashToken(text);
    assert.ok(Number.isInteger(value) && value >= 0 && value <= 0xffffffff, `${text} -> ${value}`);
  }
  assert.equal(hashToken(''), 2166136261);
});

test('textureVariant only promotes parts that vent or rack', () => {
  assert.equal(textureVariant({}), 'plain');
  assert.equal(textureVariant({ vents: true }), 'detail');
  assert.equal(textureVariant({ detail: 'rack' }), 'detail');
  assert.equal(textureVariant({ detail: 'crate' }), 'plain');
  assert.equal(textureVariant({ vents: false, detail: 'coil' }), 'plain');
});

test('textureDescriptor is deterministic and keyed by family, not token', () => {
  const a = textureDescriptor('steel', 'metal', 'light', 'plain');
  const b = textureDescriptor('slate', 'metal', 'light', 'plain');
  assert.deepEqual(a, { ...b, token: 'steel' });
  assert.equal(a.key, 'albedo:metal:plain');
  assert.deepEqual(a, textureDescriptor('steel', 'metal', 'light', 'plain'));
  // Variant and family both move the cache key; the token never does.
  assert.equal(textureDescriptor('steel', 'metal', 'light', 'detail').key, 'albedo:metal:detail');
  assert.equal(textureDescriptor('blue', 'plastic', 'light').key, 'albedo:plastic:plain');
  assert.equal(textureDescriptor('copper', 'warm', 'light').key, 'albedo:warm:plain');
  // An unknown finish falls back to plastic rather than minting a new tile.
  assert.equal(textureDescriptor('ink', 'neutral', 'light').key, 'albedo:plastic:plain');
});

test('textureDescriptor carries the paint parameters the spec asks for', () => {
  const metal = textureDescriptor('steel', 'metal', 'light', 'detail');
  assert.equal(metal.grain, 'brushed');
  assert.equal(metal.panelStep, 96);
  assert.equal(metal.size, 256);
  assert.equal(metal.streaks, 4);
  assert.equal(metal.wear, 0.04);
  assert.equal(metal.grime, 0.05);
  const plastic = textureDescriptor('blue', 'plastic', 'light', 'plain');
  assert.equal(plastic.grain, 'speckle');
  // A moulded case is seamed too, at the same pitch as sheet metal.
  assert.equal(plastic.panelStep, 96);
  assert.equal(plastic.streaks, 0);
  assert.ok(plastic.bumpScale < metal.bumpScale);
  assert.equal(textureDescriptor('copper', 'warm', 'light').grain, 'crosshatch');
});

test('buildWorld hands every part a lightness, a variant and the texel size', () => {
  const world = buildWorld(minimal);
  for (const part of world.parts) {
    assert.ok(part.lightness >= 0.97 && part.lightness <= 1.03);
    assert.equal(part.lightness, partLightness(part.id));
    assert.equal(part.texel, WORLD_TEXEL);
    assert.ok(part.variant === 'plain' || part.variant === 'detail');
  }
  const kafka = buildWorld(example('kafka-pipeline'));
  const producer = kafka.parts.find((part) => part.id === 'producer');
  const controller = kafka.parts.find((part) => part.id === 'controller');
  const schema = kafka.parts.find((part) => part.id === 'schema');
  assert.equal(producer.variant, 'detail');   // vents: true
  assert.equal(controller.variant, 'detail'); // detail: "rack"
  assert.equal(schema.variant, 'plain');
});

// ------------------------------------------------------------- environment

function envScene(count, { size = [2, 2, 2], pitch = 4, theme = 'light', env } = {}) {
  const parts = [{ id: 'slab', kind: 'plate', at: [0, 0, 0], size: [200, 200, 0.6], color: 'slate', detail: 'concrete' }];
  for (let index = 0; index < count; index += 1) {
    parts.push({
      id: `m${index}`,
      kind: 'box',
      at: [10 + (index % 6) * pitch, 10 + Math.floor(index / 6) * pitch, 0.6],
      size: size.slice(),
      color: 'steel',
    });
  }
  const scene = { title: 'env', theme, parts, links: [] };
  if (env !== undefined) scene.env = env;
  return scene;
}

test('env accepts auto, warehouse and city, and rejects anything else', () => {
  for (const env of ['auto', 'warehouse', 'city']) {
    assert.ok(buildWorld(envScene(4, { env })));
  }
  // Absent and empty both mean auto.
  assert.equal(buildWorld(envScene(4)).env.requested, 'auto');
  assert.equal(buildWorld(envScene(4, { env: '' })).env.requested, 'auto');
  assert.throws(() => buildWorld(envScene(4, { env: 'factory' })), /unknown env: factory/);
  assert.throws(() => buildWorld(envScene(4, { env: 'City' })), /unknown env: City/);
  // The query override goes through the same gate.
  assert.throws(() => buildWorld(envScene(4), { env: 'street' }), /unknown env: street/);
  assert.equal(buildWorld(envScene(4, { env: 'warehouse' }), { env: 'city' }).env.mode, 'city');
});

test('pickEnvMode trips to city on each threshold, at the boundary itself', () => {
  const below = { parts: 17, area: 259, spread: 45 };
  assert.equal(pickEnvMode('auto', below), 'warehouse');
  assert.equal(pickEnvMode('auto', { ...below, parts: WORLD_ENV_TUNING.cityParts }), 'city');
  assert.equal(pickEnvMode('auto', { ...below, parts: WORLD_ENV_TUNING.cityParts - 1 }), 'warehouse');
  assert.equal(pickEnvMode('auto', { ...below, area: WORLD_ENV_TUNING.cityArea }), 'city');
  assert.equal(pickEnvMode('auto', { ...below, area: WORLD_ENV_TUNING.cityArea - 0.001 }), 'warehouse');
  assert.equal(pickEnvMode('auto', { ...below, spread: WORLD_ENV_TUNING.citySpread }), 'city');
  assert.equal(pickEnvMode('auto', { ...below, spread: WORLD_ENV_TUNING.citySpread - 0.001 }), 'warehouse');
  // An explicit request is not a suggestion.
  assert.equal(pickEnvMode('warehouse', { parts: 99, area: 9999, spread: 999 }), 'warehouse');
  assert.equal(pickEnvMode('city', below), 'city');
});

test('the three examples land on the mode their size asks for', () => {
  const kafka = buildWorld(example('kafka-pipeline')).env;
  assert.equal(kafka.mode, 'warehouse');
  assert.ok(kafka.metrics.parts < WORLD_ENV_TUNING.cityParts);
  assert.ok(kafka.metrics.area < WORLD_ENV_TUNING.cityArea);
  assert.ok(kafka.metrics.spread < WORLD_ENV_TUNING.citySpread);

  const web = buildWorld(example('three-tier-web')).env;
  assert.equal(web.mode, 'city');
  assert.ok(web.metrics.parts >= WORLD_ENV_TUNING.cityParts);

  const k8s = buildWorld(example('k8s-ci')).env;
  assert.equal(k8s.mode, 'city');
  assert.ok(k8s.metrics.area >= WORLD_ENV_TUNING.cityArea);
});

test('freeCells marks a cell free only when it clears every footprint', () => {
  const footprint = { minX: 0, maxX: 4, minZ: 0, maxZ: 4 };
  const grid = freeCells(footprint, [{ minX: 1, maxX: 2, minZ: 1, maxZ: 2 }], { step: 1, margin: 0 });
  assert.equal(grid.cols, 4);
  assert.equal(grid.rows, 4);
  const free = (col, row) => grid.free[col * grid.rows + row] === 1;
  assert.equal(free(1, 1), false);  // the blocked cell
  assert.equal(free(0, 0), true);
  assert.equal(free(3, 3), true);
  // A margin eats the ring of cells around the blocker.
  const grown = freeCells(footprint, [{ minX: 1, maxX: 2, minZ: 1, maxZ: 2 }], { step: 1, margin: 1 });
  assert.equal(grown.free[0 * grown.rows + 0], 0);
  assert.equal(grown.free[3 * grown.rows + 3], 1);
});

test('freeCorridors finds the clear band and trims it to its longest run', () => {
  // A 20x20 slab with one 4x4 block in the middle of the left half.
  const footprint = { minX: 0, maxX: 20, minZ: 0, maxZ: 20 };
  const grid = freeCells(footprint, [{ minX: 2, maxX: 6, minZ: 8, maxZ: 12 }], { step: 1, margin: 0 });
  const down = freeCorridors(grid, 'z', { minWidth: 3.5, minRun: 9 });
  assert.ok(down.length >= 1);
  for (const band of down) {
    assert.ok(band.width >= 3.5);
    assert.ok(band.run >= 9);
    // A corridor's lanes have to be genuinely clear across the whole band.
    assert.ok(band.from >= footprint.minX && band.to <= footprint.maxX);
    assert.ok(band.runFrom >= footprint.minZ && band.runTo <= footprint.maxZ);
  }
  // The band over the blocker is trimmed: it cannot run the full 20 units.
  const over = down.find((band) => band.from < 6 && band.to > 2);
  if (over) assert.ok(over.run < 20);
  // Corridors on one axis never overlap each other.
  for (let a = 0; a < down.length; a += 1) {
    for (let b = a + 1; b < down.length; b += 1) {
      assert.ok(down[a].to <= down[b].from || down[b].to <= down[a].from);
    }
  }
});

test('no avenue is laid over a part footprint plus its margin', () => {
  for (const name of ['kafka-pipeline', 'three-tier-web', 'k8s-ci']) {
    const world = buildWorld(example(name), { env: 'city' });
    const margin = WORLD_ENV_TUNING.roadMargin;
    const keepOut = world.parts.map((part) => partRect(part, margin));
    assert.ok(world.env.city.avenues.length > 0, `${name} has no avenue`);
    for (const avenue of world.env.city.avenues) {
      const road = avenueRect(avenue);
      // The asphalt plus its curbs. A curb runs alongside the street, so it
      // only widens the section across the run, never past its ends.
      const curb = WORLD_ENV_TUNING.curbWidth;
      const across = avenue.along === 'z' ? curb : 0;
      const down = avenue.along === 'z' ? 0 : curb;
      const section = {
        minX: road.minX - across,
        maxX: road.maxX + across,
        minZ: road.minZ - down,
        maxZ: road.maxZ + down,
      };
      assert.ok(rectClears(section, keepOut), `${name}: avenue on a part`);
      assert.ok(avenue.width >= WORLD_ENV_TUNING.avenueMin - 1e-9);
      assert.ok(avenue.width <= WORLD_ENV_TUNING.avenueMax + 1e-9);
      // And it stays on the slab.
      assert.ok(section.minX >= world.slab.footprint.minX - 1e-9);
      assert.ok(section.maxX <= world.slab.footprint.maxX + 1e-9);
      assert.ok(section.minZ >= world.slab.footprint.minZ - 1e-9);
      assert.ok(section.maxZ <= world.slab.footprint.maxZ + 1e-9);
    }
  }
});

test('avenue choice is deterministic and position-ordered', () => {
  const first = buildWorld(example('three-tier-web'), { env: 'city' }).env;
  const second = buildWorld(example('three-tier-web'), { env: 'city' }).env;
  assert.deepEqual(first, second);
  const down = first.city.avenues.filter((avenue) => avenue.along === 'z');
  for (let index = 1; index < down.length; index += 1) {
    assert.ok(down[index].center > down[index - 1].center);
  }
  assert.ok(down.length <= WORLD_ENV_TUNING.avenuesPerAxis);
  assert.ok(first.city.avenues.filter((avenue) => avenue.along === 'x').length <= WORLD_ENV_TUNING.avenuesPerAxis);
});

test('an intersection only exists where both streets reach the crossing', () => {
  const world = buildWorld(example('k8s-ci'), { env: 'city' });
  const { avenues, crossings } = world.env.city;
  for (const cross of crossings) {
    const down = avenues.find((avenue) => avenue.along === 'z' && avenue.center === cross.x);
    const across = avenues.find((avenue) => avenue.along === 'x' && avenue.center === cross.z);
    assert.ok(down && across);
    assert.ok(cross.z >= down.from && cross.z <= down.to);
    assert.ok(cross.x >= across.from && cross.x <= across.to);
  }
  // A street with no partner crossing it produces no junction.
  const kafka = buildWorld(example('kafka-pipeline'), { env: 'city' }).env.city;
  for (const cross of kafka.crossings) {
    assert.ok(kafka.avenues.some((avenue) => avenue.along === 'z' && avenue.center === cross.x));
  }
});

test('city props stay on the slab and clear the parts, the streets and each other', () => {
  for (const name of ['three-tier-web', 'k8s-ci']) {
    const world = buildWorld(example(name), { env: 'city' });
    const { footprint } = world.slab;
    const parts = world.parts.map((part) => partRect(part));
    const streets = world.env.city.avenues.map((avenue) => streetRect(avenue));
    const placed = [];
    assert.ok(world.env.city.props.length >= 3, `${name}: too few props`);
    for (const prop of world.env.city.props) {
      // foot is the ground the prop covers once turned; size is its own box.
      const rect = {
        minX: prop.pos[0] - prop.foot[0] / 2,
        maxX: prop.pos[0] + prop.foot[0] / 2,
        minZ: prop.pos[2] - prop.foot[1] / 2,
        maxZ: prop.pos[2] + prop.foot[1] / 2,
      };
      assert.ok(rect.minX >= footprint.minX, `${name}: ${prop.type} off the slab`);
      assert.ok(rect.maxX <= footprint.maxX, `${name}: ${prop.type} off the slab`);
      assert.ok(rect.minZ >= footprint.minZ, `${name}: ${prop.type} off the slab`);
      assert.ok(rect.maxZ <= footprint.maxZ, `${name}: ${prop.type} off the slab`);
      assert.ok(rectClears(rect, parts, WORLD_ENV_TUNING.propClear), `${name}: ${prop.type} on a part`);
      assert.ok(rectClears(rect, streets, WORLD_ENV_TUNING.propClear), `${name}: ${prop.type} on a street`);
      assert.ok(rectClears(rect, placed, WORLD_ENV_TUNING.propClear), `${name}: ${prop.type} on another prop`);
      placed.push(rect);
    }
    // One water tower, in a corner, and some containers.
    assert.equal(world.env.city.props.filter((prop) => prop.type === 'tower').length, 1);
    const containers = world.env.city.props.filter((prop) => prop.type === 'container');
    assert.ok(containers.length >= 2 && containers.length <= 4);
    for (const container of containers) assert.ok(container.stack >= 1 && container.stack <= 2);
  }
});

test('lamps and bollards stand on the pavement, never on the asphalt', () => {
  for (const name of ['three-tier-web', 'k8s-ci', 'kafka-pipeline']) {
    const world = buildWorld(example(name), { env: 'city' });
    const { footprint } = world.slab;
    const roads = world.env.city.avenues.map(avenueRect);
    for (const furniture of [...world.env.city.lamps, ...world.env.city.bollards]) {
      const [x, , z] = furniture.pos;
      assert.ok(x > footprint.minX && x < footprint.maxX, `${name}: furniture off the slab`);
      assert.ok(z > footprint.minZ && z < footprint.maxZ, `${name}: furniture off the slab`);
      for (const road of roads) {
        const onRoad = x > road.minX && x < road.maxX && z > road.minZ && z < road.maxZ;
        assert.equal(onRoad, false, `${name}: furniture at ${x},${z} stands on asphalt`);
      }
    }
    // Every second lamp glows, counted along the street.
    const glowing = world.env.city.lamps.filter((lamp) => lamp.glow).length;
    assert.equal(glowing, Math.ceil(world.env.city.lamps.length / 2));
  }
});

test('no pylon stands on asphalt', () => {
  for (const name of ['kafka-pipeline', 'three-tier-web', 'k8s-ci']) {
    const world = buildWorld(example(name), { env: 'city' });
    const clear = world.tuning.poleClear;
    for (const link of world.links) {
      for (const pole of link.poles) {
        for (const road of world.env.roadRects) {
          const onRoad = pole.pos[0] > road.minX - clear && pole.pos[0] < road.maxX + clear
            && pole.pos[2] > road.minZ - clear && pole.pos[2] < road.maxZ + clear;
          assert.equal(onRoad, false, `${name}: pylon on asphalt at ${pole.pos}`);
        }
      }
    }
  }
  // Warehouse mode has no asphalt to stand on, so nothing is pushed around.
  assert.deepEqual(buildWorld(example('kafka-pipeline')).env.roadRects, []);
});

test('warehouse floor paints its safety language and fences the perimeter', () => {
  const world = buildWorld(example('kafka-pipeline'));
  const yard = world.env.warehouse;
  const { footprint } = world.slab;
  assert.equal(world.env.city, null);

  // The yellow line is inset by exactly the tuning distance, all four sides.
  assert.equal(yard.line.minX, footprint.minX + WORLD_ENV_TUNING.safetyInset);
  assert.equal(yard.line.maxX, footprint.maxX - WORLD_ENV_TUNING.safetyInset);
  assert.equal(yard.line.minZ, footprint.minZ + WORLD_ENV_TUNING.safetyInset);
  assert.equal(yard.line.maxZ, footprint.maxZ - WORLD_ENV_TUNING.safetyInset);

  assert.ok(yard.corners.length >= 3 && yard.corners.length <= 4);
  // A bay number per machine, numbered in part order.
  assert.equal(yard.bays.length, world.parts.length);
  yard.bays.forEach((bay, index) => {
    assert.equal(bay.number, index + 1);
    assert.equal(bay.id, world.parts[index].id);
  });
  // Zone hatching rings the standing tanks, and only those.
  assert.equal(yard.zones.length, world.parts.filter((part) => part.kind === 'cylinder' && part.axis === 'y').length);

  // The fence has one gate, and the posts stop either side of it.
  assert.ok(yard.fence.gate, 'no gate');
  const gap = Math.hypot(yard.fence.gate.b[0] - yard.fence.gate.a[0], yard.fence.gate.b[2] - yard.fence.gate.a[2]);
  assert.ok(Math.abs(gap - WORLD_ENV_TUNING.fenceGate) < 1e-6);
  assert.ok(yard.fence.posts.length > 8);
  assert.equal(yard.fence.railHeights.length, 2);
  for (const [x, z] of yard.fence.posts) {
    assert.ok(x >= footprint.minX && x <= footprint.maxX);
    assert.ok(z >= footprint.minZ && z <= footprint.maxZ);
    // No post inside the gate run.
    const toA = Math.hypot(x - yard.fence.gate.a[0], z - yard.fence.gate.a[2]);
    const toB = Math.hypot(x - yard.fence.gate.b[0], z - yard.fence.gate.b[2]);
    assert.ok(toA + toB >= gap - 1e-6);
  }
});

test('warehouse props fill the free corners and clear everything', () => {
  const world = buildWorld(example('kafka-pipeline'));
  const yard = world.env.warehouse;
  const parts = world.parts.map((part) => partRect(part));
  const placed = [];
  const crates = yard.props.filter((prop) => prop.type === 'crate');
  assert.ok(crates.length >= 2 && crates.length <= 5);
  assert.ok(yard.props.filter((prop) => prop.type === 'pallets').length >= 1);
  assert.equal(yard.props.filter((prop) => prop.type === 'barrels').length, 1);
  for (const prop of yard.props) {
    const rect = {
      minX: prop.pos[0] - prop.foot[0] / 2,
      maxX: prop.pos[0] + prop.foot[0] / 2,
      minZ: prop.pos[2] - prop.foot[1] / 2,
      maxZ: prop.pos[2] + prop.foot[1] / 2,
    };
    assert.ok(rect.minX >= world.slab.footprint.minX);
    assert.ok(rect.maxX <= world.slab.footprint.maxX);
    assert.ok(rect.minZ >= world.slab.footprint.minZ);
    assert.ok(rect.maxZ <= world.slab.footprint.maxZ);
    assert.ok(rectClears(rect, parts, WORLD_ENV_TUNING.propClear), `${prop.type} on a part`);
    assert.ok(rectClears(rect, placed, WORLD_ENV_TUNING.propClear), `${prop.type} on another prop`);
    placed.push(rect);
  }
});

test('the shared ground language is painted in both modes', () => {
  for (const name of ['kafka-pipeline', 'three-tier-web', 'k8s-ci']) {
    const world = buildWorld(example(name));
    const { ground } = world.env;
    // An apron under every machine.
    assert.equal(ground.aprons.length, world.parts.length);
    assert.ok(ground.stains.length >= 2);
    assert.ok(ground.manholes.length >= 2 && ground.manholes.length <= 4);
    assert.ok(ground.grates.length >= 1);
    assert.ok(ground.tirePaths.length >= 1);
    // Manholes are spaced out and clear of the machines.
    const keepOut = world.parts.map((part) => partRect(part, 0.4));
    for (const hole of ground.manholes) {
      const rect = { minX: hole.x - 0.45, maxX: hole.x + 0.45, minZ: hole.z - 0.45, maxZ: hole.z + 0.45 };
      assert.ok(rectClears(rect, keepOut, 0.2), `${name}: manhole under a part`);
    }
    // Tire paths follow the roads when there are roads.
    if (world.env.roadRects.length) {
      assert.equal(ground.tirePaths.length, world.env.city.avenues.length);
      for (let index = 0; index < ground.tirePaths.length; index += 1) {
        assert.equal(ground.tirePaths[index].along, world.env.city.avenues[index].along);
        assert.equal(ground.tirePaths[index].center, world.env.city.avenues[index].center);
      }
    }
  }
});

test('the whole environment plan is a pure function of the scene', () => {
  for (const name of ['kafka-pipeline', 'three-tier-web', 'k8s-ci']) {
    for (const env of ['auto', 'warehouse', 'city']) {
      const a = buildWorld(example(name), { env });
      const b = buildWorld(example(name), { env });
      assert.equal(JSON.stringify(a.env), JSON.stringify(b.env));
      assert.equal(JSON.stringify(a), JSON.stringify(b));
    }
  }
});

test('buildWorld reports what the environment added', () => {
  const kafka = buildWorld(example('kafka-pipeline'));
  assert.equal(kafka.stats.env, 'warehouse');
  assert.equal(kafka.stats.roads, 0);
  assert.equal(kafka.stats.lamps, 0);
  assert.ok(kafka.stats.props > 0);
  const web = buildWorld(example('three-tier-web'));
  assert.equal(web.stats.env, 'city');
  assert.ok(web.stats.roads > 0);
  assert.ok(web.stats.lamps > 0);
});

// ------------------------------------------------- road network: termini v2
//
// The complaint these cover is "there are roads that lead nowhere, lying
// there, ending in nothing". So the invariant under test is not a look: it is
// that every end of every piece of surface has a named destination, and that
// nothing is left in a component you cannot drive into.

// A synthetic slab with one avenue down it, so a case can be set up by moving
// a single blocker instead of by finding a scene that happens to produce it.
function lane(options = {}) {
  return {
    along: 'z',
    center: 0,
    width: 4,
    from: options.from === undefined ? -6 : options.from,
    to: options.to === undefined ? 6 : options.to,
    band: { from: -2.5, to: 2.5, width: 5, run: 12 },
  };
}

const slab20 = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

test('envEdgeGap measures outward to the slab edge, one axis at a time', () => {
  assert.equal(envEdgeGap(slab20, 0, 6, [0, 1]), 4);
  assert.equal(envEdgeGap(slab20, 0, 6, [0, -1]), 16);
  assert.equal(envEdgeGap(slab20, -7, 0, [-1, 0]), 3);
  assert.equal(envEdgeGap(slab20, -7, 0, [1, 0]), 17);
});

test('envFacing finds the nearest rect ahead and ignores the ones off the band', () => {
  const rects = [
    { id: 'ahead', minX: -1, maxX: 1, minZ: 8, maxZ: 9 },
    { id: 'further', minX: -1, maxX: 1, minZ: 9.5, maxZ: 10 },
    { id: 'aside', minX: 6, maxX: 8, minZ: 8, maxZ: 9 },
    { id: 'behind', minX: -1, maxX: 1, minZ: -9, maxZ: -8 },
  ];
  const hit = envFacing(rects, 0, 6, [0, 1], 2);
  assert.equal(hit.rect.id, 'ahead');
  assert.equal(hit.gap, 2);
  assert.equal(envFacing(rects, 0, 6, [0, 1], 0.2).rect.id, 'ahead');
  // Nothing within the band at all is a clear sight line, not a zero gap.
  assert.equal(envFacing([rects[2]], 0, 6, [0, 1], 2), null);
});

test('envFacing breaks a tie on id, so the answer is independent of order', () => {
  const a = { id: 'aaa', minX: -1, maxX: 0, minZ: 8, maxZ: 9 };
  const b = { id: 'bbb', minX: 0, maxX: 1, minZ: 8, maxZ: 9 };
  assert.equal(envFacing([a, b], 0, 6, [0, 1], 2).rect.id, 'aaa');
  assert.equal(envFacing([b, a], 0, 6, [0, 1], 2).rect.id, 'aaa');
});

test('a terminus within reach of the slab edge becomes a gate', () => {
  const terminus = classifyTerminus(lane({ to: 8.5 }), 'to', { footprint: slab20, blockers: [] });
  assert.equal(terminus.kind, 'gate');
  // The asphalt is extended the rest of the way, so the edge is the end.
  assert.equal(terminus.extend, 1.5);
  assert.deepEqual(terminus.dir, [0, 1]);
  assert.deepEqual([terminus.x, terminus.z], [0, 8.5]);
});

test('a terminus in open ground becomes a cul-de-sac with a turning circle', () => {
  const terminus = classifyTerminus(lane(), 'to', { footprint: slab20, blockers: [] });
  assert.equal(terminus.kind, 'cul-de-sac');
  assert.equal(terminus.radius, WORLD_ENV_TUNING.turnRadius);
  assert.equal(terminus.extend, 0);
});

test('a terminus facing a part becomes a loading bay flush with its face', () => {
  const blockers = [{ id: 'db', minX: -2, maxX: 2, minZ: 7.2, maxZ: 9 }];
  const terminus = classifyTerminus(lane(), 'to', { footprint: slab20, blockers });
  assert.equal(terminus.kind, 'bay');
  assert.equal(terminus.part, 'db');
  assert.equal(terminus.extend, 1.2);
});

test('a junction sitting on an end is classified as the intersection it is', () => {
  const crossings = [{ x: 0, z: 6, w: 4, d: 4 }];
  const terminus = classifyTerminus(lane(), 'to', { footprint: slab20, blockers: [], crossings });
  assert.equal(terminus.kind, 'intersection');
  assert.equal(terminus.extend, 0);
  // A junction mid-span is not an end, so the end is still classified on its
  // own merits — this is what stops a crossed street losing its real terminus.
  const mid = classifyTerminus(lane(), 'to', {
    footprint: slab20,
    blockers: [],
    crossings: [{ x: 0, z: 0, w: 4, d: 4 }],
  });
  assert.equal(mid.kind, 'cul-de-sac');
});

test('a part too close to turn in front of still gets a bay, never nothing', () => {
  // 2.3 units ahead: past bayReach, inside turnClear. The circle will not fit
  // and the edge is far, so the only honest answer is to dock against it.
  const blockers = [{ id: 'wall', minX: -3, maxX: 3, minZ: 8.3, maxZ: 9 }];
  const terminus = classifyTerminus(lane(), 'to', { footprint: slab20, blockers });
  assert.equal(terminus.kind, 'bay');
  assert.equal(terminus.extend, 2.3);
});

test('a part off the shoulder blocks the circle and the bay aims at it', () => {
  // Clear straight ahead but inside the turning radius: a disc would clip it.
  const blockers = [{ id: 'corner', minX: 1.9, maxX: 4, minZ: 7.5, maxZ: 9 }];
  const terminus = classifyTerminus(lane(), 'to', { footprint: slab20, blockers });
  assert.equal(terminus.kind, 'bay');
  assert.equal(terminus.part, 'corner');
});

test('classifyTerminus is total: every end of every synthetic lane is named', () => {
  const kinds = new Set(['intersection', 'gate', 'cul-de-sac', 'bay']);
  for (let to = -9; to <= 9; to += 0.5) {
    for (const blocker of [[], [{ id: 'p', minX: -2, maxX: 2, minZ: to + 1, maxZ: to + 3 }]]) {
      for (const end of ['from', 'to']) {
        const terminus = classifyTerminus(lane({ from: -9, to }), end, {
          footprint: slab20,
          blockers: blocker,
        });
        assert.ok(kinds.has(terminus.kind), `unclassified at to=${to} ${end}`);
      }
    }
  }
});

test('terminusStub surfaces a gate run-out at road width and a bay at bay width', () => {
  const gate = terminusStub(classifyTerminus(lane({ to: 8.5 }), 'to', { footprint: slab20, blockers: [] }));
  assert.deepEqual(gate, { kind: 'gate', minX: -2, maxX: 2, minZ: 8.5, maxZ: 10 });
  const bay = terminusStub(classifyTerminus(lane(), 'to', {
    footprint: slab20,
    blockers: [{ id: 'db', minX: -2, maxX: 2, minZ: 7.2, maxZ: 9 }],
  }));
  assert.equal(bay.kind, 'bay');
  assert.equal(bay.maxX - bay.minX, WORLD_ENV_TUNING.bayWidth);
  assert.equal(bay.maxZ, 7.2, 'the apron finishes flush at the face');
  // A cul-de-sac adds no rectangle: its surface is the disc.
  assert.equal(terminusStub(classifyTerminus(lane(), 'to', { footprint: slab20, blockers: [] })), null);
});

test('a gate keeps its booth on the slab and its chevron on the asphalt', () => {
  const terminus = classifyTerminus(lane({ to: 8.5 }), 'to', { footprint: slab20, blockers: [] });
  const gate = planGate(terminus, slab20);
  assert.equal(gate.arms.length, 2);
  // Both arms swing in from the kerbs and stop short of each other.
  assert.ok(gate.arms.every((arm) => Math.abs(arm.pos[0]) < terminus.width / 2));
  assert.ok(gate.arms.every((arm) => Math.abs(arm.pivot[0]) === terminus.width / 2));
  const [bx, , bz] = gate.booth.pos;
  const [bw, , bd] = gate.booth.size;
  // The whole footing is on the slab, not just its centre: the gate line sits
  // back from the lip by less than half a booth.
  assert.ok(bx - bw / 2 >= slab20.minX && bx + bw / 2 <= slab20.maxX, 'the booth stands on the slab');
  assert.ok(bz - bd / 2 >= slab20.minZ && bz + bd / 2 <= slab20.maxZ);
  assert.ok(Math.abs(bx) > terminus.width / 2, 'and off the asphalt');
  // A shoulder blocked by a building is not a shoulder: no booth there.
  const blocked = planGate(terminus, slab20, [
    { id: 'l', minX: -6, maxX: -1, minZ: 6, maxZ: 10 },
    { id: 'r', minX: 1, maxX: 6, minZ: 6, maxZ: 10 },
  ]);
  assert.equal(blocked.booth, null, 'a booth buried in a wall is worse than none');
  assert.equal(blocked.arms.length, 2, 'but the arms and the chevron still gate it');
  // The chevron sits back inside the road, pointing the way out.
  assert.deepEqual(gate.chevron.dir, [0, 1]);
  assert.ok(gate.chevron.z < gate.z);
});

test('a cul-de-sac puts both bollards on the far arc, off the road', () => {
  const terminus = classifyTerminus(lane(), 'to', { footprint: slab20, blockers: [] });
  const circle = planCulDeSac(terminus);
  assert.equal(circle.bollards.length, 2);
  for (const bollard of circle.bollards) {
    const reach = Math.hypot(bollard.pos[0] - circle.x, bollard.pos[2] - circle.z);
    assert.ok(reach < circle.radius, 'inside the disc');
    assert.ok(bollard.pos[2] > circle.z, 'and beyond the mouth, not in it');
  }
  assert.ok(circle.island > 0 && circle.island < circle.radius);
});

test('a bay lays its bumper on the face it docks against', () => {
  const terminus = classifyTerminus(lane(), 'to', {
    footprint: slab20,
    blockers: [{ id: 'db', minX: -2, maxX: 2, minZ: 7.2, maxZ: 9 }],
  });
  const bay = planBay(terminus);
  assert.deepEqual(bay.face, [0, 7.2]);
  assert.equal(bay.part, 'db');
  assert.ok(Math.abs(bay.bumper.pos[2] - 7.2) < 0.1, 'the bumper is at the face');
  assert.equal(bay.bumper.pos[1], WORLD_ENV_TUNING.bumperHeight);
  assert.equal(bay.hatch.maxZ, 7.2);
});

test('driveways spur off the pavement to a face and skip parts a bay serves', () => {
  const avenues = [lane({ from: -8, to: 8 })];
  const blockers = [
    { id: 'near', minX: 4, maxX: 7, minZ: -2, maxZ: 2 },
    { id: 'far', minX: -9, maxX: -7.5, minZ: -2, maxZ: 2 },
  ];
  const spurs = planDriveways(avenues, blockers, new Set());
  assert.equal(spurs.length, 2);
  // Closest first, so a cut at drivewayMax keeps the ones that read best.
  assert.equal(spurs[0].part, 'near');
  assert.equal(spurs[0].width, WORLD_ENV_TUNING.drivewayWidth);
  // The spur starts at the pavement and finishes at the building face.
  assert.equal(spurs[0].to[0], 4);
  assert.ok(spurs[0].from[0] > 2 && spurs[0].from[0] < 4);
  // Its graph node is on the centre line: a spur joins a street, not a kerb.
  assert.equal(spurs[0].merge[0], 0);
  assert.equal(spurs[0].threshold.along, 'z');
  // A part already docked against is not also given a driveway.
  assert.deepEqual(
    planDriveways(avenues, blockers, new Set(['near'])).map((spur) => spur.part),
    ['far'],
  );
});

test('planDriveways respects drivewayMax and is independent of blocker order', () => {
  const avenues = [lane({ from: -8, to: 8 })];
  const blockers = ['a', 'b', 'c', 'd'].map((id, index) => ({
    id, minX: 3 + index, maxX: 3.5 + index, minZ: -1, maxZ: 1,
  }));
  const forward = planDriveways(avenues, blockers, new Set());
  const reversed = planDriveways(avenues, blockers.slice().reverse(), new Set());
  assert.ok(forward.length <= WORLD_ENV_TUNING.drivewayMax);
  assert.deepEqual(forward, reversed);
});

test('validateNetwork names an orphan and clears a network with a way in', () => {
  const gated = [
    { id: 'a', a: { x: 0, z: -5, kind: 'gate' }, b: { x: 0, z: 5, kind: 'cul-de-sac' } },
  ];
  assert.equal(validateNetwork(gated).ok, true);
  const stranded = [
    { id: 'a', a: { x: 0, z: -5, kind: 'cul-de-sac' }, b: { x: 0, z: 5, kind: 'cul-de-sac' } },
  ];
  const report = validateNetwork(stranded);
  assert.equal(report.ok, false);
  assert.deepEqual(report.orphans, ['a']);
});

test('validateNetwork reports an endpoint it cannot classify', () => {
  const report = validateNetwork([
    { id: 'a', a: { x: 0, z: -5, kind: 'gate' }, b: { x: 0, z: 5, kind: 'nowhere' } },
  ]);
  assert.equal(report.ok, false);
  assert.deepEqual(report.unclassified, [{ segment: 'a', side: 'b', kind: 'nowhere' }]);
});

test('validateNetwork joins a T-junction, not just coincident ends', () => {
  // The spur meets the avenue half-way along it. That is a connection, so the
  // spur inherits the avenue's gate and the pair is one component.
  const report = validateNetwork([
    { id: 'avenue', a: { x: 0, z: -5, kind: 'gate' }, b: { x: 0, z: 5, kind: 'cul-de-sac' } },
    { id: 'spur', a: { x: 0, z: 1, kind: 'driveway-merge' }, b: { x: 4, z: 1, kind: 'bay' } },
  ]);
  assert.equal(report.ok, true);
  assert.equal(report.components.length, 1);
  // A spur that misses the avenue is exactly the thing being guarded against.
  const missed = validateNetwork([
    { id: 'avenue', a: { x: 0, z: -5, kind: 'gate' }, b: { x: 0, z: 5, kind: 'cul-de-sac' } },
    { id: 'spur', a: { x: 2, z: 1, kind: 'driveway-merge' }, b: { x: 4, z: 1, kind: 'bay' } },
  ]);
  assert.equal(missed.ok, false);
  assert.deepEqual(missed.orphans, ['spur']);
});

test('repairTermini runs a stranded end out to the edge and gates it', () => {
  const avenues = [lane({ from: -4, to: 4 })];
  const context = { footprint: slab20, blockers: [], crossings: [] };
  const termini = planTermini(avenues, context);
  assert.ok(termini.every((terminus) => terminus.kind === 'cul-de-sac'));
  const repaired = repairTermini(avenues, termini, context);
  assert.deepEqual(repaired.dropped, []);
  const gates = repaired.termini.filter((terminus) => terminus.kind === 'gate');
  assert.equal(gates.length, 1, 'one way in is enough');
  assert.equal(gates[0].extend, 6);
  assert.equal(gates[0].repaired, true);
  // ... and the repaired plan passes the check it was repaired for.
  const segments = [{
    id: 'avenue-0',
    a: { x: repaired.termini[0].x, z: repaired.termini[0].z, kind: repaired.termini[0].kind },
    b: { x: repaired.termini[1].x, z: repaired.termini[1].z, kind: repaired.termini[1].kind },
  }];
  assert.equal(validateNetwork(segments).ok, true);
});

test('repairTermini drops a street it cannot plausibly run out to an edge', () => {
  const wide = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 };
  const avenues = [lane({ from: -4, to: 4 })];
  const context = { footprint: wide, blockers: [], crossings: [] };
  const repaired = repairTermini(avenues, planTermini(avenues, context), context);
  assert.deepEqual(repaired.dropped, [0], 'a street with no way in is worse than no street');
});

test('every example plans a network with no orphan segments', () => {
  for (const name of ['kafka-pipeline', 'three-tier-web', 'k8s-ci']) {
    for (const mode of ['auto', 'warehouse', 'city']) {
      const model = buildWorld(example(name), { env: mode });
      const report = model.env.network;
      assert.deepEqual(report.orphans, [], `${name} [${mode}] left a segment orphaned`);
      assert.deepEqual(report.unclassified, [], `${name} [${mode}] left an end unclassified`);
      assert.equal(report.ok, true);
      assert.ok(report.segments > 0, `${name} [${mode}] planned no network at all`);
      // Every component has to be drivable into, which is the whole point.
      assert.ok(model.env.network.components.every((part) => part.entry));
    }
  }
});

test('every city terminus in every example has a destination', () => {
  const kinds = new Set(['intersection', 'gate', 'cul-de-sac', 'bay']);
  for (const name of ['kafka-pipeline', 'three-tier-web', 'k8s-ci']) {
    const city = buildWorld(example(name), { env: 'city' }).env.city;
    assert.ok(city.avenues.length > 0);
    assert.equal(city.termini.length, city.avenues.length * 2);
    for (const terminus of city.termini) {
      assert.ok(kinds.has(terminus.kind), `${name}: ${terminus.kind}`);
    }
    // And the plan builds something at each one.
    const built = city.gates.length + city.culdesacs.length + city.bays.length;
    const junctions = city.termini.filter((terminus) => terminus.kind === 'intersection').length;
    assert.equal(built + junctions, city.termini.length);
  }
});

test('city stubs and driveways stay on the slab', () => {
  for (const name of ['kafka-pipeline', 'three-tier-web', 'k8s-ci']) {
    const model = buildWorld(example(name), { env: 'city' });
    const fp = model.slab.footprint;
    const rects = model.env.city.stubs.concat(model.env.city.driveways.map((spur) => spur.rect));
    for (const r of rects) {
      assert.ok(r.minX >= fp.minX - 1e-6 && r.maxX <= fp.maxX + 1e-6, `${name} stub off the slab in x`);
      assert.ok(r.minZ >= fp.minZ - 1e-6 && r.maxZ <= fp.maxZ + 1e-6, `${name} stub off the slab in z`);
    }
  }
});

test('no prop lands on the asphalt a terminus added', () => {
  for (const name of ['kafka-pipeline', 'three-tier-web', 'k8s-ci']) {
    const city = buildWorld(example(name), { env: 'city' }).env.city;
    const surfaces = city.stubs.concat(city.driveways.map((spur) => spur.rect));
    for (const prop of city.props) {
      const spot = {
        minX: prop.pos[0] - prop.size[0] / 2,
        maxX: prop.pos[0] + prop.size[0] / 2,
        minZ: prop.pos[2] - prop.size[2] / 2,
        maxZ: prop.pos[2] + prop.size[2] / 2,
      };
      assert.ok(rectClears(spot, surfaces), `${name}: ${prop.type} is standing in the road`);
      for (const circle of city.culdesacs) {
        const reach = Math.hypot(prop.pos[0] - circle.x, prop.pos[2] - circle.z);
        assert.ok(reach > circle.radius, `${name}: ${prop.type} is in a turning circle`);
      }
    }
  }
});

test('lamps keep out of the gate zones', () => {
  for (const name of ['kafka-pipeline', 'three-tier-web', 'k8s-ci']) {
    const city = buildWorld(example(name), { env: 'city' }).env.city;
    for (const lamp of city.lamps) {
      for (const gate of city.gates) {
        const reach = Math.max(Math.abs(lamp.pos[0] - gate.x), Math.abs(lamp.pos[2] - gate.z));
        assert.ok(reach > gate.width / 2, `${name}: a lamp is standing in a gate`);
      }
    }
    // The glow alternation still reads along the street after the filtering.
    city.lamps.forEach((lamp, index) => assert.equal(lamp.glow, index % 2 === 0));
  }
});

test('warehouse circulation joins the gate and every machine to one spine', () => {
  const model = buildWorld(example('kafka-pipeline'), { env: 'warehouse' });
  const flow = model.env.warehouse.circulation;
  assert.ok(flow, 'a factory floor has a route through it');
  assert.ok(flow.walkways.some((walk) => walk.role === 'spine'));
  assert.ok(flow.walkways.some((walk) => walk.fromKind === 'gate'), 'the gate is the entrance');
  assert.equal(flow.lineWidth, WORLD_ENV_TUNING.spineWalkWidth);
  assert.equal(flow.gap, WORLD_ENV_TUNING.spineWalkGap);
  // One component, so everything painted is reachable from the gate.
  const report = validateNetwork(networkSegments(model.env));
  assert.equal(report.components.length, 1);
  assert.equal(report.components[0].entry, true);
  // A stub per machine, bar any already standing on the spine.
  const stubs = flow.walkways.filter((walk) => walk.role === 'stub');
  assert.ok(stubs.length >= model.parts.length - 2, 'nearly every machine is joined');
});

test('nothing stands on the warehouse walkway', () => {
  const yard = buildWorld(example('kafka-pipeline'), { env: 'warehouse' }).env.warehouse;
  const flow = yard.circulation;
  const lanes = flow.walkways.map((walk) => ({
    minX: Math.min(walk.from[0], walk.to[0]) - flow.gap / 2,
    maxX: Math.max(walk.from[0], walk.to[0]) + flow.gap / 2,
    minZ: Math.min(walk.from[1], walk.to[1]) - flow.gap / 2,
    maxZ: Math.max(walk.from[1], walk.to[1]) + flow.gap / 2,
  }));
  for (const prop of yard.props) {
    const spot = {
      minX: prop.pos[0] - prop.size[0] / 2,
      maxX: prop.pos[0] + prop.size[0] / 2,
      minZ: prop.pos[2] - prop.size[2] / 2,
      maxZ: prop.pos[2] + prop.size[2] / 2,
    };
    assert.ok(rectClears(spot, lanes), `${prop.type} is blocking the walkway`);
  }
});

test('planCirculation gives up rather than inventing a spine on a full floor', () => {
  const packed = [{ id: 'all', minX: -9.5, maxX: 9.5, minZ: -9.5, maxZ: 9.5 }];
  assert.equal(planCirculation(slab20, packed, [], null), null);
});

test('the network plan is a pure function of the scene', () => {
  for (const name of ['kafka-pipeline', 'three-tier-web', 'k8s-ci']) {
    for (const mode of ['auto', 'warehouse', 'city']) {
      const once = buildWorld(example(name), { env: mode }).env;
      const twice = buildWorld(example(name), { env: mode }).env;
      assert.equal(JSON.stringify(once.city), JSON.stringify(twice.city), `${name} [${mode}] city`);
      assert.equal(
        JSON.stringify(once.warehouse),
        JSON.stringify(twice.warehouse),
        `${name} [${mode}] warehouse`,
      );
      assert.equal(JSON.stringify(once.network), JSON.stringify(twice.network));
    }
  }
});

test('planCity does not depend on the order the blockers arrive in', () => {
  const scene = example('three-tier-web');
  const model = buildWorld(scene, { env: 'city' });
  const footprint = model.slab.footprint;
  const blockers = model.parts.map((part) => partRect(part));
  const forward = planCity(footprint, blockers, model.parts, WORLD_ENV_TUNING, 'city');
  const reversed = planCity(footprint, blockers.slice().reverse(), model.parts, WORLD_ENV_TUNING, 'city');
  assert.equal(JSON.stringify(forward.termini), JSON.stringify(reversed.termini));
  assert.equal(JSON.stringify(forward.driveways), JSON.stringify(reversed.driveways));
});

test('planEnvironment carries the network verdict for a capture to read', () => {
  const model = buildWorld(example('three-tier-web'));
  assert.equal(model.stats.network, 'ok');
  assert.equal(model.stats.orphans, 0);
  assert.ok(model.stats.segments > 0);
  // And the plan a scene with no parts produces is still a valid one.
  const bare = planEnvironment('city', { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, []);
  assert.equal(bare.network.ok, true);
});

test('envReachToAvenue prefers a junction, and will not drive through a part', () => {
  const down = lane({ from: -8, to: 0 });
  const across = { along: 'x', center: 4, width: 4, from: -8, to: 8, band: {} };
  const terminus = classifyTerminus(down, 'to', { footprint: slab20, blockers: [] });
  // Clear ground between the end and the other street: that is a junction.
  const meet = envReachToAvenue(down, terminus, [across], []);
  assert.deepEqual(meet, { gap: 4, center: 4 });
  // A building in the way is not a road.
  const blocked = envReachToAvenue(down, terminus, [across], [
    { id: 'wall', minX: -1, maxX: 1, minZ: 1, maxZ: 3 },
  ]);
  assert.equal(blocked, null);
  // Nor is a street that does not reach this one's line.
  const short = envReachToAvenue(down, terminus, [{ ...across, from: 5, to: 8 }], []);
  assert.equal(short, null);
});

test('the repair prefers joining two stranded streets over dropping either', () => {
  // Two streets that cross nothing and reach no edge. Run one out to the
  // other and both are on a network with a junction in it.
  const avenues = [
    lane({ from: -6, to: -1 }),
    { along: 'x', center: 3, width: 4, from: -6, to: 6, band: {} },
  ];
  const context = { footprint: slab20, blockers: [], crossings: [] };
  const repaired = repairTermini(avenues, planTermini(avenues, context), context);
  assert.equal(repaired.joined, true, 'a junction, not a gate and not a drop');
  assert.deepEqual(repaired.dropped, []);
  assert.equal(repaired.avenues[0].to, 3, 'the street was run out to the other one');
  // ... and the layout that comes out of it really does cross.
  assert.equal(planIntersections(repaired.avenues).length, 1);
});

test('planCity settles on a network with no orphans over many layouts', () => {
  // The examples do not reach every branch — a repair that drops a street
  // moves the junctions, which re-classifies the ends, which can strand
  // another street. Only a spread of layouts exercises that, and the first
  // two versions of this planner both failed it.
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const seen = new Set();
  for (let trial = 0; trial < 240; trial += 1) {
    const span = 12 + Math.floor(rnd() * 26);
    const footprint = { minX: -span, maxX: span, minZ: -span * 0.8, maxZ: span * 0.8 };
    const parts = [];
    for (let index = 0; index < 1 + Math.floor(rnd() * 24); index += 1) {
      const w = 1 + rnd() * 6;
      const d = 1 + rnd() * 6;
      parts.push({
        id: `p${index}`,
        kind: 'box',
        axis: 'y',
        pos: [(rnd() * 2 - 1) * (span - w), 0, (rnd() * 2 - 1) * (span * 0.8 - d)],
        size: [w, 1 + rnd() * 4, d],
      });
    }
    for (const mode of ['city', 'warehouse']) {
      const env = planEnvironment(mode, footprint, parts);
      assert.deepEqual(env.network.orphans, [], `trial ${trial} [${mode}] orphaned a segment`);
      assert.deepEqual(env.network.unclassified, [], `trial ${trial} [${mode}] left an end unnamed`);
      if (env.city) {
        for (const terminus of env.city.termini) seen.add(terminus.kind);
        // Nothing the streets grew may hang off the slab.
        for (const r of env.city.stubs.concat(env.city.driveways.map((spur) => spur.rect))) {
          assert.ok(r.minX >= footprint.minX - 1e-6 && r.maxX <= footprint.maxX + 1e-6);
          assert.ok(r.minZ >= footprint.minZ - 1e-6 && r.maxZ <= footprint.maxZ + 1e-6);
        }
        // Nor may a guard booth — and a booth is seated whole, not centred:
        // the gate line is a third of a unit from the lip, so a booth centred
        // on it would hang its back half over the void.
        for (const gate of env.city.gates) {
          if (!gate.booth) continue;
          const [bx, , bz] = gate.booth.pos;
          const [bw, , bd] = gate.booth.size;
          assert.ok(bx - bw / 2 >= footprint.minX - 1e-6, `trial ${trial} booth over the edge in x`);
          assert.ok(bx + bw / 2 <= footprint.maxX + 1e-6, `trial ${trial} booth over the edge in x`);
          assert.ok(bz - bd / 2 >= footprint.minZ - 1e-6, `trial ${trial} booth over the edge in z`);
          assert.ok(bz + bd / 2 <= footprint.maxZ + 1e-6, `trial ${trial} booth over the edge in z`);
          // ... and never inside a machine.
          const footing = {
            minX: bx - bw / 2, maxX: bx + bw / 2,
            minZ: bz - bd / 2, maxZ: bz + bd / 2,
          };
          assert.ok(
            rectClears(footing, parts.map((part) => partRect(part))),
            `trial ${trial}: a guard booth is inside a building`,
          );
        }
      }
    }
  }
  // And the spread really did reach all four kinds, so the pass means something.
  assert.deepEqual([...seen].sort(), ['bay', 'cul-de-sac', 'gate', 'intersection']);
});

test('no cable pylon stands on any piece of asphalt', () => {
  for (const name of ['kafka-pipeline', 'three-tier-web', 'k8s-ci']) {
    const model = buildWorld(example(name), { env: 'city' });
    const roads = model.env.roadRects;
    // The termini grew asphalt after the avenues were planned, so this is
    // only true if roadRects was told about them.
    assert.ok(roads.length > model.env.city.avenues.length, `${name}: termini missing from roadRects`);
    for (const link of model.links) {
      for (const pole of link.poles) {
        const spot = {
          minX: pole.pos[0] - 0.2, maxX: pole.pos[0] + 0.2,
          minZ: pole.pos[2] - 0.2, maxZ: pole.pos[2] + 0.2,
        };
        assert.ok(rectClears(spot, roads), `${name}: a pylon is standing in the road`);
      }
    }
  }
});

test('tyre wear runs the full length of a street, run-outs included', () => {
  const model = buildWorld(example('three-tier-web'), { env: 'city' });
  const city = model.env.city;
  assert.equal(city.wear.length, city.avenues.length);
  city.wear.forEach((worn, index) => {
    const avenue = city.avenues[index];
    assert.ok(worn.from <= avenue.from + 1e-9, 'wear never falls short of the street');
    assert.ok(worn.to >= avenue.to - 1e-9);
    // Where an end grew asphalt, the wear grew with it.
    for (const terminus of city.termini.filter((t) => t.avenue === index && t.extend)) {
      if (terminus.end === 'from') assert.ok(worn.from < avenue.from);
      else assert.ok(worn.to > avenue.to);
    }
  });
  // Both are on the slab, so the paint has something to sit on.
  const fp = model.slab.footprint;
  for (const path of model.env.ground.tirePaths) {
    assert.ok(path.from >= (path.along === 'z' ? fp.minZ : fp.minX) - 1e-6);
    assert.ok(path.to <= (path.along === 'z' ? fp.maxZ : fp.maxX) + 1e-6);
  }
});

test('a warehouse wears its floor along the spine, not down an invented middle', () => {
  const model = buildWorld(example('kafka-pipeline'), { env: 'warehouse' });
  const spine = model.env.warehouse.circulation.spine;
  const paths = model.env.ground.tirePaths;
  assert.equal(paths.length, 1);
  assert.equal(paths[0].along, spine.along);
  assert.equal(paths[0].center, spine.center);
});

test('a barrier arm is a row of alternating blocks covering its own length', () => {
  const terminus = classifyTerminus(lane({ to: 8.5 }), 'to', { footprint: slab20, blockers: [] });
  const gate = planGate(terminus, slab20);
  for (const arm of gate.arms) {
    assert.equal(arm.stripes.length, WORLD_ENV_TUNING.gateArmBands);
    // The blocks alternate, so the arm reads as hazard striping.
    arm.stripes.forEach((stripe, index) => assert.equal(stripe.band, index % 2));
    // They tile the arm exactly: no gaps, no overhang past the bar.
    const lo = Math.min(...arm.stripes.map((s) => s.pos[0] - s.size[0] / 2));
    const hi = Math.max(...arm.stripes.map((s) => s.pos[0] + s.size[0] / 2));
    assert.ok(Math.abs(lo - (arm.pos[0] - arm.size[0] / 2)) < 1e-6, 'a stripe hangs off the arm');
    assert.ok(Math.abs(hi - (arm.pos[0] + arm.size[0] / 2)) < 1e-6);
    // And all of it stays over the asphalt.
    assert.ok(lo >= -terminus.width / 2 - 1e-6 && hi <= terminus.width / 2 + 1e-6);
  }
  // The two arms meet over the middle of the road without crossing.
  const [left, right] = gate.arms;
  assert.ok(left.pos[0] < 0 && right.pos[0] > 0);
  const inner = (left.pos[0] + left.size[0] / 2) - (right.pos[0] - right.size[0] / 2);
  assert.ok(inner < 0, 'the arms stop short of each other');
});

// ------------------------------------------------------------ first-person walk

// A hand-built model shaped exactly like the runtime's: a slab footprint, parts
// with a world centre and size, and a content box the spawn is derived from.
// The tier is a raised floor plate, the machine is a solid, and the coil and
// curb are below the obstacle bar.
const walkModel = {
  slab: { sourceId: 'ground', footprint: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 } },
  parts: [
    { id: 'tier', kind: 'plate', pos: [0, 0.15, 0], size: [6, 0.3, 6] },
    { id: 'machine', kind: 'box', pos: [-6, 1.25, -6], size: [3, 2.5, 3] },
    { id: 'coil', kind: 'cylinder', pos: [6, 0.1, 6], size: [1.2, 0.2, 1.2] },
    { id: 'curb', kind: 'box', pos: [7, 0.3, 0], size: [0.4, 0.4, 0.4] },
  ],
  content: { min: [-8, 0, -8], max: [8, 4, 8], center: [0, 2, 0], radius: 8 },
};

function flatWalk(obstacles = []) {
  return {
    speed: WALK_SPEED,
    run: WALK_RUN,
    radius: WALK_RADIUS,
    eye: WALK_EYE,
    footClear: WALK_FOOT_CLEAR,
    step: WALK_STEP,
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    surfaces: [{ id: 'slab', y: 0, footprint: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 } }],
    obstacles,
  };
}

test('planWalk builds surfaces, obstacles and a deterministic spawn', () => {
  const walk = planWalk(walkModel);
  // Highest first: the raised tier, then the slab it stands on.
  assert.deepEqual(walk.surfaces.map((surface) => surface.id), ['tier', 'slab']);
  assert.equal(walk.surfaces[0].y, 0.3);
  assert.equal(walk.surfaces[1].y, 0);
  assert.deepEqual(walk.surfaces[0].footprint, { minX: -3, maxX: 3, minZ: -3, maxZ: 3 });
  // Only the big solid blocks; the coil and the curb fall under the bar.
  assert.deepEqual(walk.obstacles.map((box) => box.id), ['machine']);
  assert.deepEqual(walk.obstacles[0].min, [-7.5, 0, -7.5]);
  assert.deepEqual(walk.obstacles[0].max, [-4.5, 2.5, -4.5]);
  // The spawn is on the slab, in front of the content, facing the centre.
  const spawn = walk.spawn;
  assert.ok(spawn.x > walk.bounds.minX && spawn.x < walk.bounds.maxX);
  assert.ok(spawn.z > walkModel.content.max[2], 'the spawn stands in front of the content');
  assert.equal(spawn.yaw, 0);
  // Same model, same plan.
  assert.deepEqual(planWalk(walkModel), walk);
});

test('planWalk is deterministic on a real built world', () => {
  const model = buildWorld(example('kafka-pipeline'));
  const first = planWalk(model);
  const second = planWalk(model);
  assert.deepEqual(second, first);
  // The concrete deck is always a surface, and its slab source survives.
  const base = first.surfaces[first.surfaces.length - 1];
  assert.equal(base.id, 'slab');
  assert.equal(base.source, model.slab.sourceId);
  assert.ok(first.obstacles.length > 0, 'a pipeline has solids to bump into');
});

test('planWalk turns a raised floor plate into a walkable surface', () => {
  // rea models its platform as four named tier plates on top of the deck.
  const model = buildWorld(example('rea'));
  const walk = planWalk(model);
  for (const id of ['tier-1', 'tier-2', 'tier-3', 'tier-4']) {
    const surface = walk.surfaces.find((entry) => entry.id === id);
    assert.ok(surface, `${id} should be walkable`);
    const part = model.parts.find((entry) => entry.id === id);
    assert.equal(surface.y, part.pos[1] + part.size[1] / 2);
    assert.ok(surface.y > 0, 'the tier stands above the deck');
  }
  // A tier is a floor, never also a wall.
  assert.equal(walk.obstacles.some((box) => box.id.startsWith('tier-')), false);
});

test('walkGroundY returns the highest surface footprint under the point', () => {
  const walk = planWalk(walkModel);
  assert.equal(walkGroundY(walk, 0, 0), 0.3); // on the tier
  assert.equal(walkGroundY(walk, 8, 8), 0); // on the deck
  assert.equal(walkGroundY(walk, 20, 20), null); // off every surface
});

test('walkStep is pure and moves at 3.5 walking and 7 running', () => {
  const start = { x: 0, z: 0, y: WALK_EYE, yaw: 0 };
  const walked = walkStep(start, { forward: 1 }, 1, flatWalk());
  assert.notEqual(walked, start);
  assert.deepEqual(start, { x: 0, z: 0, y: WALK_EYE, yaw: 0 }, 'the input state is not mutated');
  assert.ok(Math.abs(walked.z - -WALK_SPEED) < 1e-6);
  assert.ok(Math.abs(walked.x) < 1e-9);
  const ran = walkStep(start, { forward: 1, run: true }, 1, flatWalk());
  assert.ok(Math.abs(ran.z - -WALK_RUN) < 1e-6);
});

test('walkStep slides along a wall instead of sticking to it', () => {
  const walk = flatWalk([{ id: 'wall', min: [1, 0, -10], max: [2, 3, 10] }]);
  let walker = { x: 0, z: 0, y: WALK_EYE, yaw: 0 };
  for (let step = 0; step < 30; step += 1) {
    walker = walkStep(walker, { forward: 1, strafe: 1 }, 1 / 30, walk);
  }
  // x is pinned to the wall face, one radius clear; z keeps the tangential run.
  assert.ok(Math.abs(walker.x - (1 - WALK_RADIUS)) < 1e-6, `x was ${walker.x}`);
  assert.ok(walker.z < -2, `the walker should slide past, z was ${walker.z}`);
});

test('walkStep never tunnels a wall at a full sprint', () => {
  const walk = flatWalk([{ id: 'wall', min: [0.5, 0, -10], max: [0.8, 3, 10] }]);
  let walker = { x: -1, z: 0, y: WALK_EYE, yaw: -Math.PI / 2 }; // facing +x
  for (let step = 0; step < 30; step += 1) {
    walker = walkStep(walker, { forward: 1, run: true }, 1 / 30, walk);
  }
  assert.ok(walker.x <= 0.5 - WALK_RADIUS + 1e-6, `tunnelled to ${walker.x}`);
  assert.ok(walker.x > 0.5 - WALK_RADIUS - 1e-3, 'the walker should reach the wall');
});

test('walkStep lifts the eye onto a raised plate and back onto the deck', () => {
  const walk = flatWalk();
  walk.surfaces.unshift({ id: 'tier', y: 0.4, footprint: { minX: 1, maxX: 3, minZ: 1, maxZ: 3 } });
  let onTier = { x: 2, z: 2, y: WALK_EYE, yaw: 0 }; // standing over the tier
  for (let step = 0; step < 120; step += 1) onTier = walkStep(onTier, {}, 1 / 60, walk);
  assert.ok(Math.abs(onTier.y - (0.4 + WALK_EYE)) < 1e-3, `eye was ${onTier.y}`);
  let onDeck = { x: 0, z: 0, y: 0.4 + WALK_EYE, yaw: 0 }; // stepping back to the deck
  for (let step = 0; step < 120; step += 1) onDeck = walkStep(onDeck, {}, 1 / 60, walk);
  assert.ok(Math.abs(onDeck.y - WALK_EYE) < 1e-3, `eye was ${onDeck.y}`);
});

test('walkStep clamps to the slab and never falls off', () => {
  const walk = flatWalk();
  let east = { x: 9.9, z: 0, y: WALK_EYE, yaw: -Math.PI / 2 }; // facing +x
  for (let step = 0; step < 60; step += 1) east = walkStep(east, { forward: 1, run: true }, 1 / 30, walk);
  assert.equal(east.x, 10 - WALK_RADIUS);
  let north = { x: 0, z: 9.9, y: WALK_EYE, yaw: Math.PI }; // facing +z
  for (let step = 0; step < 60; step += 1) north = walkStep(north, { forward: 1, run: true }, 1 / 30, walk);
  assert.equal(north.z, 10 - WALK_RADIUS);
});

// ------------------------------------------------------------ step-up

test('planWalk publishes the step height a walker may climb', () => {
  assert.equal(WALK_STEP, 0.7);
  assert.equal(planWalk(walkModel).step, WALK_STEP);
});

test('walkStep steps up onto a plate within WALK_STEP', () => {
  const walk = flatWalk();
  walk.surfaces.unshift({ id: 'step', y: 0.6, footprint: { minX: 1, maxX: 9, minZ: -3, maxZ: 3 } });
  let walker = { x: 0.5, z: 0, y: WALK_EYE, yaw: -Math.PI / 2 }; // facing +x
  for (let step = 0; step < 120; step += 1) walker = walkStep(walker, { forward: 1 }, 1 / 60, walk);
  assert.ok(walker.x > 1 && walker.x < 9, `walked onto the plate, x was ${walker.x}`);
  assert.ok(Math.abs(walker.y - (0.6 + WALK_EYE)) < 1e-2, `eye was ${walker.y}`);
});

test('walkStep refuses a face taller than WALK_STEP', () => {
  const walk = flatWalk();
  // A 1.2 face is a wall, not a step: it blocks at its inflated edge and the
  // eye never leaves the slab.
  walk.surfaces.unshift({ id: 'wall', y: 1.2, footprint: { minX: 1, maxX: 3, minZ: -3, maxZ: 3 } });
  let walker = { x: 0.5, z: 0, y: WALK_EYE, yaw: -Math.PI / 2 }; // facing +x
  for (let step = 0; step < 120; step += 1) walker = walkStep(walker, { forward: 1, run: true }, 1 / 60, walk);
  assert.ok(walker.x <= 1 - WALK_RADIUS + 1e-6, `blocked at ${walker.x}`);
  assert.ok(walker.x > 1 - WALK_RADIUS - 1e-3, 'the walker should reach the face');
  assert.ok(Math.abs(walker.y - WALK_EYE) < 1e-3, `eye stayed on the slab, was ${walker.y}`);
});

test('walkStep steps off an edge and drops smoothly to the deck', () => {
  const walk = flatWalk();
  walk.surfaces.unshift({ id: 'step', y: 0.6, footprint: { minX: -3, maxX: -1, minZ: -3, maxZ: 3 } });
  let walker = { x: -2, z: 0, y: 0.6 + WALK_EYE, yaw: -Math.PI / 2 }; // facing +x, off the east edge
  let last = walker.y;
  let monotone = true;
  for (let step = 0; step < 120; step += 1) {
    walker = walkStep(walker, { forward: 1 }, 1 / 60, walk);
    if (walker.y > last + 1e-9) monotone = false;
    last = walker.y;
  }
  assert.ok(walker.x > -1, `stepped off the plate, x was ${walker.x}`);
  assert.ok(monotone, 'the descent never pops back up');
  assert.ok(Math.abs(walker.y - WALK_EYE) < 1e-2, `dropped to the deck, was ${walker.y}`);
});

test('walkStep keeps the slab clamp even after a step up', () => {
  const walk = flatWalk();
  // A step that overshoots the west slab edge: the walker climbs it but is
  // still held inside the slab bounds.
  walk.surfaces.unshift({ id: 'ledge', y: 0.5, footprint: { minX: -12, maxX: -4, minZ: -3, maxZ: 3 } });
  let walker = { x: -8, z: 0, y: WALK_EYE, yaw: Math.PI / 2 }; // facing -x
  for (let step = 0; step < 200; step += 1) walker = walkStep(walker, { forward: 1, run: true }, 1 / 30, walk);
  assert.equal(walker.x, -10 + WALK_RADIUS, 'clamped inside the slab');
  assert.ok(Math.abs(walker.y - (0.5 + WALK_EYE)) < 1e-3, `still on the ledge, was ${walker.y}`);
});

// ------------------------------------------------------------ head-bob

test('walkBobOffset is exactly zero at rest and scales with gait', () => {
  assert.equal(walkBobOffset(0, false), 0);
  assert.equal(walkBobOffset(0, true), 0);
  assert.ok(Math.abs(walkBobOffset(Math.PI / 2, false) - WALK_BOB_WALK) < 1e-12);
  assert.ok(Math.abs(walkBobOffset(Math.PI / 2, true) - WALK_BOB_RUN) < 1e-12);
  assert.equal(WALK_RUN_FOV, 3.5);
});

test('walkBobPhase advances by distance walked, never wall-clock', () => {
  // No distance, no phase change: a frozen frame cannot bob.
  assert.equal(walkBobPhase(0, 0), 0);
  assert.equal(walkBobPhase(1.234, 0), 1.234);
  // One full cycle per WALK_BOB_CYCLE units.
  assert.ok(Math.abs(walkBobPhase(0, WALK_BOB_CYCLE) - Math.PI * 2) < 1e-12);
});

