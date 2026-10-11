import { test } from 'node:test';
import assert from 'node:assert/strict';

let isoMod = null;
try {
  isoMod = await import('./iso.mjs');
} catch (error) {
  isoMod = null;
}
let sceneMod = null;
if (isoMod) {
  try {
    sceneMod = await import('./scene.mjs');
  } catch (error) {
    sceneMod = null;
  }
}
const skip = isoMod && sceneMod ? false : 'kit/iso.mjs not available yet';

function isoCenter(ports) {
  const keys = Object.keys(ports);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const key of keys) {
    cx += ports[key][0];
    cy += ports[key][1];
    cz += ports[key][2];
  }
  const count = keys.length || 1;
  return [cx / count, cy / count, cz / count];
}

function isoPickPort(ports, requested, target) {
  if (requested != null) {
    if (!Object.prototype.hasOwnProperty.call(ports, requested)) {
      throw new Error('unknown port ' + String(requested));
    }
    return ports[requested];
  }
  let best = null;
  let bestDistance = Infinity;
  for (const key of Object.keys(ports)) {
    const point = ports[key];
    const dx = point[0] - target[0];
    const dy = point[1] - target[1];
    const dz = point[2] - target[2];
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < bestDistance - 1e-12) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

function renderLinkEndpoints(scene, link) {
  const byId = new Map((scene.parts || []).map((part) => [part.id, part]));
  const sourcePorts = isoMod.anchors(byId.get(link.from));
  const targetPorts = isoMod.anchors(byId.get(link.to));
  const from = isoPickPort(sourcePorts, link.fromPort, isoCenter(targetPorts));
  const to = isoPickPort(targetPorts, link.toPort, isoCenter(sourcePorts));
  return [from, to];
}

function baseScene() {
  return {
    version: 1,
    title: 'Test scene',
    theme: 'light',
    parts: [
      { id: 'a', kind: 'box', at: [0, 0, 0], size: [2, 2, 2], color: 'blue' },
      { id: 'b', kind: 'box', at: [0, 6, 0], size: [2, 2, 2], color: 'copper' }
    ],
    links: [
      { from: 'a', to: 'b', kind: 'tube', color: 'slate' }
    ],
    flows: [
      { path: ['a', 'b'], kind: 'request', color: 'green', speed: 12, count: 3 }
    ]
  };
}

test('valid minimal scene passes validation', { skip }, () => {
  const result = sceneMod.validateScene(baseScene());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('rejects wrong version', { skip }, () => {
  const scene = baseScene();
  scene.version = 2;
  const result = sceneMod.validateScene(scene);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.startsWith('version:')));
});

test('rejects duplicate part ids with a JSON path', { skip }, () => {
  const scene = baseScene();
  scene.parts[1].id = 'a';
  const result = sceneMod.validateScene(scene);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.startsWith('parts[1].id:')));
});

test('rejects a link that references an unknown part', { skip }, () => {
  const scene = baseScene();
  scene.links[0].to = 'missing';
  const result = sceneMod.validateScene(scene);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.startsWith('links[0].to:')));
});

test('rejects an unknown color token', { skip }, () => {
  const scene = baseScene();
  scene.parts[0].color = 'rainbow';
  const result = sceneMod.validateScene(scene);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.startsWith('parts[0].color:')));
});

test('accepts the optional decorative part fields', { skip }, () => {
  const scene = baseScene();
  scene.parts[0].detail = 'rack';
  scene.parts[0].vents = true;
  scene.parts[0].leds = 3;
  const result = sceneMod.validateScene(scene);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('rejects an unknown detail value', { skip }, () => {
  const scene = baseScene();
  scene.parts[0].detail = 'grill';
  const result = sceneMod.validateScene(scene);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.startsWith('parts[0].detail:')));
});

test('rejects a non-boolean vents field', { skip }, () => {
  const scene = baseScene();
  scene.parts[0].vents = 'yes';
  const result = sceneMod.validateScene(scene);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.startsWith('parts[0].vents:')));
});

test('rejects a leds count outside 0..6', { skip }, () => {
  const scene = baseScene();
  scene.parts[0].leds = 7;
  const result = sceneMod.validateScene(scene);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.startsWith('parts[0].leds:')));
});

test('cable edges resolve to a sagging sampled curve', { skip }, () => {
  const scene = baseScene();
  scene.links[0].kind = 'cable';
  const edge = sceneMod.resolveLinks(scene)[0];
  assert.ok(edge.points.length > 2, 'cable edge carries sampled points');
  const first = edge.points[0];
  const last = edge.points[edge.points.length - 1];
  const middle = edge.points[Math.floor(edge.points.length / 2)];
  const chordMidZ = (first[2] + last[2]) / 2;
  assert.ok(middle[2] < chordMidZ, 'sampled curve sags below the chord');
  const sampled = sceneMod.sampleFlowPoint(sceneMod.resolveFlows(scene)[0].edges, 0.5);
  assert.ok(sampled[2] < chordMidZ, 'flow sampling rides the sagging curve');
});

test('rejects a flow speed outside 6..24', { skip }, () => {
  const scene = baseScene();
  scene.flows[0].speed = 3;
  const result = sceneMod.validateScene(scene);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.startsWith('flows[0].speed:')));
});

test('rejects a flow count outside 2..6', { skip }, () => {
  const scene = baseScene();
  scene.flows[0].count = 9;
  const result = sceneMod.validateScene(scene);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.startsWith('flows[0].count:')));
});

test('rejects more than four readout entries', { skip }, () => {
  const scene = baseScene();
  scene.readout = [1, 2, 3, 4, 5].map((n) => ({ label: `l${n}`, value: `v${n}` }));
  const result = sceneMod.validateScene(scene);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.startsWith('readout:')));
});

test('port-nearest picking chooses an anchor facing the other part', { skip }, () => {
  const scene = baseScene();
  const resolved = sceneMod.resolveLinks(scene);
  assert.equal(resolved.length, 1);
  const edge = resolved[0];
  assert.ok(['top', 'bottom', 'north', 'south', 'east', 'west'].includes(edge.fromPort));
  assert.ok(['top', 'bottom', 'north', 'south', 'east', 'west'].includes(edge.toPort));
  assert.equal(edge.points.length, 2);
  const fromAnchors = Object.values(isoMod.anchors(scene.parts[0]));
  const onAnchor = fromAnchors.some((anchor) => (
    Math.hypot(
      anchor[0] - edge.points[0][0],
      anchor[1] - edge.points[0][1],
      anchor[2] - edge.points[0][2]
    ) <= 1e-9
  ));
  assert.equal(onAnchor, true);
});

test('resolveFlows uses the resolved link for consecutive path ids', { skip }, () => {
  const scene = baseScene();
  const resolved = sceneMod.resolveFlows(scene);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].edges.length, 1);
  assert.equal(resolved[0].edges[0].points.length, 2);
});

test('resolveLinks picks the same ports renderSVG draws for a straight link', { skip }, () => {
  const scene = baseScene();
  const expected = renderLinkEndpoints(scene, scene.links[0]);
  const edge = sceneMod.resolveLinks(scene)[0];
  assert.deepEqual(edge.points, expected);
});

test('sampled point at u=0.5 is the midpoint of the anchors renderSVG draws', { skip }, () => {
  const scene = baseScene();
  const [from, to] = renderLinkEndpoints(scene, scene.links[0]);
  const edges = sceneMod.resolveFlows(scene)[0].edges;
  const sampled = sceneMod.sampleFlowPoint(edges, 0.5);
  const midpoint = [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2,
    (from[2] + to[2]) / 2
  ];
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(Math.abs(sampled[axis] - midpoint[axis]) < 1e-6, `axis ${axis}`);
  }
});

test('sampled point at u=0.5 is the midpoint with explicit ports too', { skip }, () => {
  const scene = baseScene();
  scene.links[0].fromPort = 'east';
  scene.links[0].toPort = 'west';
  const [from, to] = renderLinkEndpoints(scene, scene.links[0]);
  const edges = sceneMod.resolveFlows(scene)[0].edges;
  const sampled = sceneMod.sampleFlowPoint(edges, 0.5);
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(Math.abs(sampled[axis] - (from[axis] + to[axis]) / 2) < 1e-6, `axis ${axis}`);
  }
});

test('sampleFlowPose direction is constant along a straight link', { skip }, () => {
  const scene = baseScene();
  const edges = sceneMod.resolveFlows(scene)[0].edges;
  const early = sceneMod.sampleFlowPose(edges, 0.2);
  const late = sceneMod.sampleFlowPose(edges, 0.8);
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(Math.abs(early.dir[axis] - late.dir[axis]) < 1e-6, `axis ${axis}`);
  }
});

test('sampleFlowPoint hits u=0 and u=0.5 on a straight path', { skip }, () => {
  const edges = [{ points: [[0, 0, 0], [10, 0, 0]] }];
  assert.deepEqual(sceneMod.sampleFlowPoint(edges, 0), [0, 0, 0]);
  assert.deepEqual(sceneMod.sampleFlowPoint(edges, 0.5), [5, 0, 0]);
});

test('sampleFlowPoint walks across multiple segments', { skip }, () => {
  const edges = [{ points: [[0, 0, 0], [4, 0, 0], [10, 0, 0]] }];
  assert.deepEqual(sceneMod.sampleFlowPoint(edges, 0.5), [5, 0, 0]);
  assert.deepEqual(sceneMod.sampleFlowPoint(edges, 0.8), [8, 0, 0]);
});

test('sampleFlowPoint wraps u=1 back to u=0', { skip }, () => {
  const edges = [{ points: [[0, 0, 0], [10, 0, 0]] }];
  assert.deepEqual(sceneMod.sampleFlowPoint(edges, 1), sceneMod.sampleFlowPoint(edges, 0));
});

test('sampleFlowPose returns a unit direction along a straight path', { skip }, () => {
  const edges = [{ points: [[0, 0, 0], [10, 0, 0]] }];
  const pose = sceneMod.sampleFlowPose(edges, 0.25);
  assert.deepEqual(pose.pos, [2.5, 0, 0]);
  assert.ok(Math.abs(pose.dir[0] - 1) < 1e-6);
});

test('loadScene throws with validation errors on a broken fixture', { skip }, () => {
  const path = new URL('./fixtures/broken-link.json', import.meta.url);
  assert.throws(() => sceneMod.loadScene(path), /invalid scene/);
});

test('schema v1 accepts all material details and optional chip fields', { skip }, () => {
  for (const detail of ['rack', 'tray', 'tower', 'switch', 'tank', 'crate', 'pallet', 'coil', 'concrete', 'none']) {
    const scene = baseScene();
    Object.assign(scene.parts[0], { detail, panels: true, hazard: false, sublabel: 'controller' });
    assert.deepEqual(sceneMod.validateScene(scene).errors, [], detail);
  }
});

test('schema reports paths for invalid optional material fields', { skip }, () => {
  for (const [field, value] of [['panels', 1], ['hazard', 'true'], ['sublabel', false], ['detail', 'server']]) {
    const scene = baseScene();
    scene.parts[0][field] = value;
    const result = sceneMod.validateScene(scene);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((message) => message.startsWith('parts[0].' + field + ':')));
  }
});
