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
  const transform = trail.attrs.transform || '';
  const move = /translate\(([-\d.]+),([-\d.]+)\)/.exec(transform);
  const spin = /rotate\(([-\d.]+)\)/.exec(transform);
  const tx = move ? Number(move[1]) : 0;
  const ty = move ? Number(move[2]) : 0;
  const angle = spin ? (Number(spin[1]) * Math.PI) / 180 : 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return String(trail.attrs.points || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => pair.split(',').map(Number))
    .map(([px, py]) => [tx + px * cos - py * sin, ty + px * sin + py * cos]);
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
  for (let index = 0; index < trailCount; index += 1) trails.push(fakeNode({ 'data-flow': '0' }));
  return {
    circles,
    trails,
    querySelectorAll(selector) {
      if (selector === 'circle.packet') return circles;
      if (selector === 'polygon.packet-trail') return trails;
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
  const first = svg.trails.map((trail) => `${trail.attrs.transform}|${trail.attrs.points}`);
  motionMod.tick(scene, svg, 1.5);
  const second = svg.trails.map((trail) => `${trail.attrs.transform}|${trail.attrs.points}`);
  assert.deepEqual(second, first);
  assert.equal(first.length, 3);
});

test('tick moves trail geometry between times', { skip }, () => {
  const scene = flowScene();
  const svg = fakeSvg(3, 3);
  motionMod.tick(scene, svg, 0);
  const first = svg.trails.map((trail) => `${trail.attrs.transform}|${trail.attrs.points}`);
  motionMod.tick(scene, svg, 1.5);
  const second = svg.trails.map((trail) => `${trail.attrs.transform}|${trail.attrs.points}`);
  assert.notDeepEqual(second, first);
  svg.trails.forEach((trail) => {
    assert.match(trail.attrs.transform, /^translate\(/);
    assert.match(trail.attrs.points, /^-?\d/);
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
    const firstPass = svg.trails.map((trail) => `${trail.attrs.transform}|${trail.attrs.points}`);
    motionMod.tick(scene, svg, t);
    const secondPass = svg.trails.map((trail) => `${trail.attrs.transform}|${trail.attrs.points}`);
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

    delete globalThis.matchMedia;
    const liveRoot = fakeRoot();
    motionMod.seedPackets(liveRoot, flowScene());
    const liveGroup = liveRoot.querySelector('g.packets');
    const liveTrails = liveGroup.children.filter((child) => child.attrs.class === 'packet-trail');
    assert.equal(liveTrails.length, 3);
    const livePackets = liveGroup.children.filter((child) => child.attrs.class === 'packet');
    assert.equal(livePackets.length, 3);
    const defs = liveRoot.querySelector('defs');
    const gradients = defs.children.filter((child) => child.name === 'linearGradient');
    assert.equal(gradients.length, 1);
    assert.equal(gradients[0].attrs.id, 'diorama-trail-green');
    assert.equal(gradients[0].children[0].attrs['stop-opacity'], '0.45');
    assert.equal(gradients[0].children[1].attrs['stop-opacity'], '0');
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalMatchMedia === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = originalMatchMedia;
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
