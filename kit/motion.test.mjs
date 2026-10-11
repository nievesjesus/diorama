import { test } from 'node:test';
import assert from 'node:assert/strict';

let isoMod = null;
try {
  isoMod = await import('./iso.mjs');
} catch (error) {
  isoMod = null;
}
let motionMod = null;
if (isoMod) {
  try {
    motionMod = await import('./motion.mjs');
  } catch (error) {
    motionMod = null;
  }
}
let sceneMod = null;
if (isoMod) {
  try {
    sceneMod = await import('./scene.mjs');
  } catch (error) {
    sceneMod = null;
  }
}
const skip = isoMod && motionMod && sceneMod ? false : 'kit/iso.mjs not available yet';

function trailScene() {
  return {
    version: 1,
    title: 'Trail wrap',
    theme: 'light',
    parts: [
      { id: 'a', kind: 'box', at: [0, 0, 0], size: [2, 2, 2], color: 'blue' },
      { id: 'b', kind: 'box', at: [0, 0, 12], size: [2, 2, 2], color: 'copper' },
      { id: 'c', kind: 'box', at: [12, 0, 12], size: [2, 2, 2], color: 'green' }
    ],
    links: [
      { from: 'a', to: 'b', kind: 'tube', color: 'slate' },
      { from: 'b', to: 'c', kind: 'tube', color: 'slate' }
    ],
    flows: [{ path: ['a', 'b', 'c'], kind: 'request', color: 'green', speed: 12, count: 1 }]
  };
}

function trailSegmentIndex(edges, u) {
  const polyline = [];
  for (const edge of edges) {
    for (const point of edge.points) {
      const last = polyline[polyline.length - 1];
      if (last && last[0] === point[0] && last[1] === point[1] && last[2] === point[2]) continue;
      polyline.push(point);
    }
  }
  const segments = [];
  let total = 0;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const a = polyline[index];
    const b = polyline[index + 1];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    segments.push({ a, b, length });
    total += length;
  }
  let remaining = u * total;
  for (let index = 0; index < segments.length; index += 1) {
    if (remaining <= segments[index].length || index === segments.length - 1) return index;
    remaining -= segments[index].length;
  }
  return segments.length - 1;
}

function trailVertices(trail) {
  return trail.children.flatMap((piece) => String(piece.attrs.points || '').trim().split(/\s+/).filter(Boolean).map((pair) => pair.split(',').map(Number)));
}

function trailGeometry(trail) {
  return JSON.stringify(trail.children.map((piece) => piece.attrs));
}

function flowScene() {
  return {
    version: 1,
    title: 'Motion',
    theme: 'light',
    parts: [
      { id: 'a', kind: 'box', at: [0, 0, 0], size: [2, 2, 2], color: 'blue' },
      { id: 'b', kind: 'box', at: [0, 6, 0], size: [2, 2, 2], color: 'copper' }
    ],
    links: [{ from: 'a', to: 'b', kind: 'tube', color: 'slate' }],
    flows: [{ path: ['a', 'b'], kind: 'request', color: 'green', speed: 12, count: 3 }]
  };
}

function fakeNode(attrs) {
  return {
    attrs: { ...attrs },
    getAttribute(name) {
      return name in this.attrs ? this.attrs[name] : null;
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    }
  };
}

function fakeSvg(count, trailCount = 0) {
  const circles = [];
  for (let index = 0; index < count; index += 1) circles.push(fakeNode({ 'data-flow': '0' }));
  const trails = [];
  for (let index = 0; index < trailCount; index += 1) trails.push({ ...fakeNode({ 'data-flow': '0' }), children: Array.from({ length: 7 }, () => fakeNode({})) });
  return {
    circles,
    trails,
    querySelectorAll(selector) {
      if (selector === 'circle.packet') return circles;
      if (selector === 'g.packet-trail') return trails;
      return [];
    }
  };
}

function fakeElement(name) {
  return {
    name,
    attrs: {},
    children: [],
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    },
    getAttribute(key) {
      return key in this.attrs ? this.attrs[key] : null;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    querySelector(selector) {
      if (selector === 'circle.packet') {
        return this.children.find((child) => child.name === 'circle' && child.attrs.class === 'packet') || null;
      }
      const byId = /^([a-zA-Z]+)\[id="([^"]+)"\]$/.exec(selector);
      if (byId) {
        return this.children.find((child) => child.name === byId[1] && child.attrs.id === byId[2]) || null;
      }
      return null;
    }
  };
}

function fakeRoot() {
  return {
    children: [],
    firstChild: null,
    querySelector(selector) {
      if (selector === 'g.packets') {
        return this.children.find((child) => child.name === 'g' && child.attrs.class === 'packets') || null;
      }
      if (selector === 'defs') return this.children.find((child) => child.name === 'defs') || null;
      if (selector === 'g[transform]') return this.children.find((child) => child.name === 'g' && child.attrs.transform) || null;
      return null;
    },
    insertBefore(node, reference) {
      const at = this.children.indexOf(reference);
      if (at < 0) this.children.unshift(node);
      else this.children.splice(at, 0, node);
      this.firstChild = this.children[0];
      return node;
    },
    appendChild(node) {
      this.children.push(node);
      this.firstChild = this.children[0];
      return node;
    }
  };
}

test('tick is deterministic: same t twice yields the same positions', { skip }, () => {
  const scene = flowScene();
  const svg = fakeSvg(3);
  motionMod.tick(scene, svg, 1.5);
  const first = svg.circles.map((circle) => `${circle.attrs.cx},${circle.attrs.cy}`);
  motionMod.tick(scene, svg, 1.5);
  const second = svg.circles.map((circle) => `${circle.attrs.cx},${circle.attrs.cy}`);
  assert.deepEqual(second, first);
});

test('tick moves packets to distinct positions', { skip }, () => {
  const scene = flowScene();
  const svg = fakeSvg(3);
  motionMod.tick(scene, svg, 0);
  const positions = new Set(svg.circles.map((circle) => `${circle.attrs.cx},${circle.attrs.cy}`));
  assert.equal(positions.size, 3);
  svg.circles.forEach((circle) => {
    assert.ok(Number.isFinite(Number(circle.attrs.cx)));
    assert.ok(Number.isFinite(Number(circle.attrs.cy)));
  });
});

test('tick with no packets is a no-op and does not throw', { skip }, () => {
  const scene = flowScene();
  const svg = fakeSvg(0);
  assert.doesNotThrow(() => motionMod.tick(scene, svg, 2));
});

test('tick ignores an invalid svg element', { skip }, () => {
  const scene = flowScene();
  assert.doesNotThrow(() => motionMod.tick(scene, null, 1));
});

test('tick is deterministic: same t twice yields the same trail geometry', { skip }, () => {
  const scene = flowScene();
  const svg = fakeSvg(3, 3);
  motionMod.tick(scene, svg, 1.5);
  const first = svg.trails.map((trail) => trailGeometry(trail));
  motionMod.tick(scene, svg, 1.5);
  const second = svg.trails.map((trail) => trailGeometry(trail));
  assert.deepEqual(second, first);
  assert.equal(first.length, 3);
});

test('tick moves trail geometry between times', { skip }, () => {
  const scene = flowScene();
  const svg = fakeSvg(3, 3);
  motionMod.tick(scene, svg, 0);
  const first = svg.trails.map((trail) => trailGeometry(trail));
  motionMod.tick(scene, svg, 1.5);
  const second = svg.trails.map((trail) => trailGeometry(trail));
  assert.notDeepEqual(second, first);
  svg.trails.forEach((trail) => {
    assert.equal(trail.children.length, 7);
    assert.match(trail.children[0].attrs.points, /^-?\d/);
  });
});

test('trail stays on its segment near the path start (no wrap artifact)', { skip }, () => {
  const scene = trailScene();
  const edges = sceneMod.resolveFlows(scene)[0].edges;
  const epsilon = 0.6;
  for (const [t, u] of [[0, 0], [0.25, 0.05]]) {
    const svg = fakeSvg(1, 1);
    motionMod.tick(scene, svg, t);
    const points = edges[trailSegmentIndex(edges, u)].points;
    const first = isoMod.project(points[0][0], points[0][1], points[0][2]);
    const last = points[points.length - 1];
    const final = isoMod.project(last[0], last[1], last[2]);
    const minX = Math.min(first[0], final[0]) - epsilon;
    const minY = Math.min(first[1], final[1]) - epsilon;
    const maxX = Math.max(first[0], final[0]) + epsilon;
    const maxY = Math.max(first[1], final[1]) + epsilon;
    const vertices = trailVertices(svg.trails[0]);
    assert.ok(vertices.length > 0);
    vertices.forEach(([x, y]) => {
      assert.ok(
        x >= minX && x <= maxX && y >= minY && y <= maxY,
        `trail vertex ${x},${y} left its segment bbox at u=${u}`
      );
    });
    const firstPass = svg.trails.map((trail) => trailGeometry(trail));
    motionMod.tick(scene, svg, t);
    const secondPass = svg.trails.map((trail) => trailGeometry(trail));
    assert.deepEqual(secondPass, firstPass);
  }
});

test('reduced motion omits packet trails', { skip }, () => {
  const originalDocument = globalThis.document;
  const originalMatchMedia = globalThis.matchMedia;
  globalThis.document = { createElementNS: (namespace, name) => fakeElement(name) };
  try {
    const reducedRoot = fakeRoot();
    globalThis.matchMedia = () => ({ matches: true });
    motionMod.seedPackets(reducedRoot, flowScene());
    const reducedGroup = reducedRoot.querySelector('g.packets');
    const reducedTrails = reducedGroup.children.filter((child) => child.attrs.class === 'packet-trail');
    assert.equal(reducedTrails.length, 0);
    assert.equal(reducedGroup.children.length, 0);

    delete globalThis.matchMedia;
    const liveRoot = fakeRoot();
    motionMod.seedPackets(liveRoot, flowScene());
    const liveGroup = liveRoot.querySelector('g.packets');
    const liveTrails = liveGroup.children.filter((child) => child.attrs.class === 'packet-trail');
    assert.equal(liveTrails.length, 3);
    const livePackets = liveGroup.children.filter((child) => child.attrs.class === 'packet');
    assert.equal(livePackets.length, 3);
    const defs = liveRoot.querySelector('defs');
    const gradients = defs.children.filter((child) => child.name === 'radialGradient');
    assert.equal(gradients.length, 1);
    assert.equal(gradients[0].attrs.id, 'diorama-trail-green');
    assert.equal(gradients[0].children[0].attrs['stop-opacity'], '0.62');
    assert.equal(gradients[0].children[1].attrs['stop-opacity'], '0');
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalMatchMedia === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = originalMatchMedia;
  }
});

function fakeParent() {
  return {
    children: [],
    insertBefore(node, reference) {
      const at = this.children.indexOf(reference);
      if (at < 0) this.children.push(node);
      else this.children.splice(at, 0, node);
      return node;
    },
    appendChild(node) {
      this.children.push(node);
      return node;
    }
  };
}

test('parallax is disabled under reduced motion', { skip }, () => {
  const original = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    assert.equal(motionMod.seedParallax({ querySelector: () => ({}) }, null), null);
  } finally {
    if (original === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = original;
  }
});

test('parallax is frozen while a ?t= seek is active', { skip }, () => {
  assert.equal(motionMod.seedParallax({ querySelector: () => ({}) }, 2.5), null);
});

test('parallax wraps the fit group and lerps deterministically', { skip }, () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalMatchMedia = globalThis.matchMedia;
  let move = null;
  globalThis.document = { createElementNS: (namespace, name) => fakeElement(name) };
  globalThis.window = {
    innerWidth: 1000,
    innerHeight: 500,
    addEventListener(type, handler) { if (type === 'mousemove') move = handler; },
    removeEventListener() {}
  };
  globalThis.matchMedia = () => ({ matches: false });
  try {
    const parent = fakeParent();
    const fit = fakeNode({ transform: 'translate(1,2) scale(3)' });
    fit.parentNode = parent;
    parent.children.push(fit);
    const svg = { querySelector: (selector) => (selector === 'g[transform]' ? fit : null) };
    const parallax = motionMod.seedParallax(svg, null);
    assert.ok(parallax, 'controller is created');
    assert.equal(parent.children[0], parallax.wrap, 'wrapper precedes the fit group');
    assert.equal(parallax.wrap.attrs.class, 'parallax', 'wrapper carries the parallax class');
    assert.equal(parallax.wrap.children[0], fit, 'fit group is reparented into the wrapper');
    move({ clientX: 1000, clientY: 0 });
    parallax.step();
    const first = parallax.wrap.attrs.transform;
    parallax.step();
    const second = parallax.wrap.attrs.transform;
    assert.match(second, /^translate\(/);
    assert.ok(!second.includes('NaN'), 'transform stays finite');
    assert.notEqual(second, first, 'the world keeps easing toward the pointer');
    parallax.step();
    parallax.step();
    const settled = parallax.wrap.attrs.transform;
    assert.ok(Number(settled.match(/(-?[\d.]+),/)[1]) > 0, 'x drifts toward the pointer');
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalMatchMedia === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = originalMatchMedia;
  }
});

test('frame mode toggles the body class from ?frame=1', { skip }, () => {
  const originalLocation = globalThis.location;
  try {
    globalThis.location = { search: '?frame=1' };
    const body = { classList: { added: [], add(name) { this.added.push(name); } } };
    assert.equal(motionMod.applyFrameMode({ body }), true);
    assert.deepEqual(body.classList.added, ['frame']);
    globalThis.location = { search: '?t=2' };
    assert.equal(motionMod.applyFrameMode({ body }), false);
  } finally {
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
  }
});

test('mount fails silently and returns null on an unexpected DOM', { skip }, () => {
  const original = console.error;
  let logged = false;
  console.error = () => { logged = true; };
  try {
    const result = motionMod.mount({ querySelector: () => null });
    assert.equal(result, null);
    assert.equal(logged, true);
  } finally {
    console.error = original;
  }
});

test('electric pulses seed aura, bright core, seven hot strokes and three sparks per packet', { skip }, () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElementNS: (namespace, name) => fakeElement(name) };
  try {
    const root = fakeRoot();
    const scene = flowScene();
    motionMod.seedPackets(root, scene);
    const group = root.querySelector('g.packets');
    const select = (cls) => group.children.filter((node) => node.attrs.class === cls);
    assert.equal(select('packet').length, 3);
    assert.equal(select('packet-aura').length, 3);
    assert.equal(select('packet-spark').length, 9);
    assert.equal(select('packet-trail').length, 3);
    for (const trail of select('packet-trail')) {
      assert.equal(trail.children.length, 7);
      assert.equal(trail.children[0].attrs['stroke-opacity'], '1');
      assert.equal(trail.children[6].attrs['stroke-opacity'], '0.1');
      assert.ok(trail.children.every((piece) => piece.name === 'polyline'));
    }
    root.querySelectorAll = (selector) => select(selector.split('.')[1]);
    motionMod.tick(scene, root, 0.25);
    const first = JSON.stringify(group.children);
    motionMod.tick(scene, root, 0.25);
    assert.equal(JSON.stringify(group.children), first);
    for (const packet of select('packet')) {
      assert.equal(packet.attrs.cx, packet.motion_aura.attrs.cx);
      assert.equal(packet.attrs.cy, packet.motion_aura.attrs.cy);
      assert.equal(packet.attrs.r, '0.215');
      assert.notEqual(packet.attrs.fill, packet.attrs.stroke);
    }
    for (const spark of select('packet-spark')) assert.ok(Number(spark.attrs.opacity) <= 0.55);
    motionMod.tick(scene, root, 0.5);
    assert.notEqual(JSON.stringify(group.children), first);
    motionMod.seedPackets(root, scene);
    assert.equal(select('packet').length, 3);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('hot strokes stay on the sampled cable including the first fifth of the path', { skip }, () => {
  const scene = flowScene();
  scene.links[0].kind = 'cable';
  scene.flows[0].count = 1;
  const edges = sceneMod.resolveFlows(scene)[0].edges;
  const path = edges.flatMap((edge) => edge.points.map((point) => isoMod.project(...point)));
  const minX = Math.min(...path.map((p) => p[0])) - 0.001;
  const maxX = Math.max(...path.map((p) => p[0])) + 0.001;
  const minY = Math.min(...path.map((p) => p[1])) - 0.001;
  const maxY = Math.max(...path.map((p) => p[1])) + 0.001;
  for (const u of [0, 0.01, 0.05, 0.19, 0.5, 0.95]) {
    const svg = fakeSvg(1, 1);
    motionMod.tick(scene, svg, u * 5);
    for (const [x, y] of trailVertices(svg.trails[0])) {
      assert.ok(x >= minX && x <= maxX && y >= minY && y <= maxY);
      const distance = Math.min(...path.slice(1).map((b, i) => {
        const a = path[i];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
      }));
      assert.ok(distance < 0.001);
    }
  }
});
