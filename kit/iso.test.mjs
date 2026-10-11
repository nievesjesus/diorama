import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { project, anchors, box, plate, cylinder, tube, linkPoints, renderSVG, TOKENS } from './iso.mjs';

function loadFixture(name) {
  return JSON.parse(readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
}

function makeScene(theme) {
  return {
    version: 1,
    title: 'Request path',
    subtitle: 'A small three-tier system',
    theme,
    size: [1280, 960],
    hint: 'Hover a part to trace its links.',
    parts: [
      { id: 'web', kind: 'box', label: 'Web', at: [0, 0, 0], size: [3, 3, 2], color: 'blue', accent: true },
      { id: 'api', kind: 'box', label: 'API', at: [5, 0, 0], size: [3, 3, 2.6], color: 'steel' },
      { id: 'db', kind: 'cylinder', label: 'Postgres', at: [9, 5, 0], radius: 1.6, h: 2.6, axis: 'z', color: 'amber' },
      { id: 'cache', kind: 'plate', label: 'Redis', at: [5, 5, 0], size: [3, 3, 0.3], color: 'sand' },
      { id: 'queue', kind: 'box', label: 'Queue', at: [0, 5, 0], size: [3, 3, 1.2], color: 'plum' },
      { id: 'logs', kind: 'cylinder', at: [9, 0, 0], radius: 1, h: 4, axis: 'z', color: 'copper' },
      { id: 'gw', kind: 'box', label: 'Gateway', at: [5, 9, 0], size: [3, 3, 2], color: 'slate' },
      { id: 'net', kind: 'plate', at: [0, 9, 0], size: [3, 2, 0.3], color: 'cloud' },
      { id: 'pipe', kind: 'cylinder', at: [13, 2, 0], radius: 0.8, h: 3, axis: 'x', color: 'brick' },
      { id: 'store', kind: 'box', label: 'Object store', at: [13, 6, 0], size: [2, 2, 2], color: 'green', accent: true },
      { id: 'cdn', kind: 'box', label: 'CDN', at: [0, 13, 0], size: [2, 2, 1], color: 'slate' }
    ],
    links: [
      { from: 'web', to: 'api', kind: 'tube', color: 'blue' },
      { from: 'api', to: 'db', kind: 'tube', color: 'green' },
      { from: 'web', to: 'queue', kind: 'cable', color: 'amber' },
      { from: 'gw', to: 'store', kind: 'tube', color: 'slate' },
      { from: 'logs', to: 'store', kind: 'cable', color: 'brick' },
      { from: 'api', to: 'cache', kind: 'tube', color: 'sand', fromPort: 'north', toPort: 'south' }
    ],
    flows: [
      { path: ['web', 'api', 'db'], kind: 'request', color: 'blue', speed: 12, count: 3 },
      { path: ['api', 'queue'], kind: 'job', color: 'plum', speed: 8, count: 2 }
    ],
    readout: [
      { label: 'p99', value: '142 ms' },
      { label: 'RPS', value: '3.2k' }
    ],
    notes: [
      { text: 'retries with backoff', at: 'api' }
    ]
  };
}

for (const theme of ['light', 'dark']) {
  test('renderSVG produces a complete svg document (' + theme + ')', () => {
    const svg = renderSVG(makeScene(theme));
    assert.ok(svg.startsWith('<svg'), 'svg starts with <svg');
    assert.ok(svg.endsWith('</svg>'), 'svg ends with </svg>');
    assert.ok(!svg.includes('NaN'), 'no NaN in output');
    assert.ok(!svg.includes('Infinity'), 'no Infinity in output');
  });

  test('renderSVG emits one group per part with data-id (' + theme + ')', () => {
    const scene = makeScene(theme);
    const svg = renderSVG(scene);
    const ids = [...svg.matchAll(/data-id="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(ids.length, scene.parts.length, 'one data-id per part');
    for (const part of scene.parts) {
      assert.ok(ids.includes(part.id), 'contains data-id ' + part.id);
    }
    const groups = [...svg.matchAll(/<g class="part"[^>]*>/g)];
    assert.equal(groups.length, scene.parts.length, 'one .part group per part');
  });

  test('renderSVG is byte-identical across runs (' + theme + ')', () => {
    const scene = makeScene(theme);
    assert.equal(renderSVG(scene), renderSVG(makeScene(theme)));
  });

  test('renderSVG wraps content in a single fit transform group (' + theme + ')', () => {
    const svg = renderSVG(makeScene(theme));
    const transforms = [...svg.matchAll(/<g transform="translate\([^"]+\) scale\([^"]+\)">/g)];
    assert.equal(transforms.length, 1, 'exactly one fit group');
  });

  test('renderSVG draws links with data-from and data-to (' + theme + ')', () => {
    const svg = renderSVG(makeScene(theme));
    assert.ok(svg.includes('class="link" data-from="web" data-to="api"'));
    assert.equal([...svg.matchAll(/<g class="link"/g)].length, makeScene(theme).links.length);
  });
}

test('renderSVG renders labels but never static flow packets', () => {
  const svg = renderSVG(makeScene('light'));
  assert.ok(svg.includes('<text class="label"'), 'draws part labels');
  assert.ok(!svg.includes('class="packet"'), 'packets are runtime-only');
});

test('renderSVG throws on an unknown color token', () => {
  const scene = makeScene('light');
  scene.parts[0].color = 'teal';
  assert.throws(() => renderSVG(scene), /unknown color token: teal/);
});

test('renderSVG throws on an unknown part kind', () => {
  const scene = makeScene('light');
  scene.parts[0].kind = 'prism';
  assert.throws(() => renderSVG(scene), /unknown part kind: prism/);
});

test('renderSVG throws when a part is missing an id', () => {
  const scene = makeScene('light');
  delete scene.parts[1].id;
  assert.throws(() => renderSVG(scene), /missing an id/);
});

test('renderSVG throws on a link to an unknown part', () => {
  const scene = makeScene('light');
  scene.links[0].to = 'ghost';
  assert.throws(() => renderSVG(scene), /unknown part: ghost/);
});

test('anchors returns six well-formed ports', () => {
  const parts = [
    { id: 'b', kind: 'box', at: [1, 2, 3], size: [4, 5, 6] },
    { id: 'p', kind: 'plate', at: [0, 0, 0], size: [2, 2, 0.4] },
    { id: 'c', kind: 'cylinder', at: [1, 1, 1], radius: 2, h: 5, axis: 'z' },
    { id: 'cx', kind: 'cylinder', at: [0, 0, 0], radius: 1, h: 3, axis: 'x' },
    { id: 'cy', kind: 'cylinder', at: [0, 0, 0], radius: 1, h: 3, axis: 'y' }
  ];
  for (const part of parts) {
    const ports = anchors(part);
    assert.equal(Object.keys(ports).length, 6, part.kind + ' exposes six ports');
    for (const name of ['top', 'bottom', 'north', 'south', 'east', 'west']) {
      const port = ports[name];
      assert.ok(Array.isArray(port) && port.length === 3, name + ' is a vec3');
      assert.ok(port.every(Number.isFinite), name + ' is finite');
    }
  }
});

test('project is a deterministic 2:1 isometric base', () => {
  assert.deepEqual(project(0, 0, 0), [0, 0]);
  assert.deepEqual(project(2, 0, 0), [2 * 0.8660254037844386, 1]);
  assert.deepEqual(project(0, 2, 0), [-2 * 0.8660254037844386, 1]);
  assert.deepEqual(project(0, 0, 3), [0, -3]);
  assert.deepEqual(project(1, 1, 1), project(1, 1, 1));
});

test('every polygon and path point is finite', () => {
  const solids = [
    box({ id: 'b', at: [0, 0, 0], size: [3, 4, 5], color: 'blue', accent: true }),
    plate({ id: 'p', at: [1, 1, 0], size: [2, 2, 0.3], color: 'sand' }),
    cylinder({ id: 'c', at: [2, 2, 0], radius: 1.5, h: 4, axis: 'y', color: 'amber', accent: true }),
    tube({ id: 't', points: [[0, 0, 0], [2, 1, 3], [4, 4, 1]], radius: 0.05, color: 'green', kind: 'tube' }),
    tube({ id: 'cb', points: [[0, 0, 0], [1, 2, 0]], radius: 0.02, color: 'plum', kind: 'cable' })
  ];
  for (const solid of solids) {
    assert.ok(Array.isArray(solid.polygons), 'solid exposes polygons array');
    for (const polygon of solid.polygons) {
      for (const point of polygon.points) {
        assert.ok(Number.isFinite(point[0]) && Number.isFinite(point[1]), 'finite polygon point');
      }
    }
    for (const path of solid.paths) {
      for (const point of path.points) {
        assert.ok(Number.isFinite(point[0]) && Number.isFinite(point[1]), 'finite path point');
      }
    }
  }
});

test('TOKENS exposes four tones for twelve tokens in both themes', () => {
  const names = ['ink', 'paper', 'steel', 'slate', 'amber', 'copper', 'blue', 'green', 'brick', 'plum', 'sand', 'cloud'];
  for (const theme of ['light', 'dark']) {
    for (const name of names) {
      const tone = TOKENS[theme][name];
      assert.ok(tone, theme + ' has ' + name);
      for (const key of ['top', 'left', 'right', 'edge']) {
        assert.match(tone[key], /^#[0-9a-f]{6}$/, name + '.' + key + ' is a hex color');
      }
      assert.notEqual(tone.top, tone.left, name + ' top differs from left');
      assert.notEqual(tone.right, tone.edge, name + ' right differs from edge');
    }
  }
});

test('three-tier fixture fills at least 80% of the usable stage', () => {
  const scene = loadFixture('three-tier.json');
  const svg = renderSVG(scene);
  const fillMatch = svg.match(/data-fill="([0-9.]+)"/);
  assert.ok(fillMatch, 'root svg exposes a data-fill ratio');
  const fill = Number(fillMatch[1]);
  assert.ok(fill >= 0.8, 'content fills >= 80% of the usable stage, got ' + fill);
});

test('three-tier fixture content is dominant and never clipped', () => {
  const scene = loadFixture('three-tier.json');
  const svg = renderSVG(scene);
  const transform = svg.match(/translate\((-?[0-9.]+),(-?[0-9.]+)\) scale\(([0-9.]+)\)/);
  assert.ok(transform, 'fit transform is present');
  const tx = Number(transform[1]);
  const ty = Number(transform[2]);
  const scale = Number(transform[3]);
  const screen = [];
  for (const polygon of svg.matchAll(/<polygon points="([^"]+)"/g)) {
    for (const pair of polygon[1].split(' ')) {
      const [x, y] = pair.split(',').map(Number);
      screen.push([x * scale + tx, y * scale + ty]);
    }
  }
  for (const path of svg.matchAll(/<path d="([^"]+)"/g)) {
    for (const pair of path[1].match(/-?[0-9.]+ -?[0-9.]+/g) || []) {
      const [x, y] = pair.split(' ').map(Number);
      screen.push([x * scale + tx, y * scale + ty]);
    }
  }
  assert.ok(screen.length > 0, 'fixture draws geometry');
  const xs = screen.map((point) => point[0]);
  const ys = screen.map((point) => point[1]);
  const [width, height] = scene.size;
  assert.ok(Math.min(...xs) >= -0.5, 'content stays inside the viewBox on the left');
  assert.ok(Math.max(...xs) <= width + 0.5, 'content stays inside the viewBox on the right');
  assert.ok(Math.min(...ys) >= -0.5, 'content stays inside the viewBox on the top');
  assert.ok(Math.max(...ys) <= height + 0.5, 'content stays inside the viewBox on the bottom');
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  assert.ok(spanX >= width * 0.85, 'drawing spans most of the stage width');
  assert.ok(spanY >= height * 0.7, 'drawing spans most of the stage height');
});

test('iso.css builds a full-bleed world with atmosphere and a HUD', () => {
  const css = readFileSync(new URL('./iso.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /max-width:\s*min\(1160px/, 'card max-width framing is gone');
  assert.doesNotMatch(css, /\.card\s*\{/, 'card chrome is removed');
  assert.match(css, /\.world\s*\{[^}]*position:\s*fixed/s, 'world is full-bleed');
  assert.match(css, /\.world\s*\{[^}]*radial-gradient/s, 'atmosphere layers are present');
  assert.match(css, /\.world\s*\{[^}]*linear-gradient/s, 'sky gradient is present');
  assert.match(css, /\.stage\s*\{[^}]*position:\s*absolute/s, 'stage fills the world');
  assert.match(css, /\.stage svg\s*\{[^}]*height:\s*100%/s, 'svg stretches to the viewport');
  assert.match(css, /\.hud\s*\{[^}]*pointer-events:\s*none/s, 'hud is click-through');
  assert.match(css, /\.hud\s*>\s*\*\s*\{[^}]*pointer-events:\s*auto/s, 'hud children stay interactive');
  assert.match(css, /\.hud-title[\s\S]*backdrop-filter:\s*blur\(10px\)/, 'title chip is glass');
  assert.match(css, /\.readout-item[\s\S]*backdrop-filter:\s*blur\(10px\)/, 'stat chips are glass');
  assert.match(css, /\.wordmark\s*\{/, 'wordmark present');
  assert.match(css, /\.corner\.tl[\s\S]*\.corner\.br/, 'corner brackets present');
  assert.match(css, /body\.frame\s+\.world\s*\{[^}]*border-radius:\s*16px/s, 'frame mode rounds the world');
});

test('eligible ground plates read as a floating slab with strata', () => {
  const scene = {
    version: 1,
    theme: 'light',
    size: [1280, 960],
    title: 'Slab',
    parts: [
      { id: 'base', kind: 'plate', at: [0, 0, -0.5], size: [34, 30, 0.5], color: 'sand', detail: 'concrete' },
      { id: 'box', kind: 'box', at: [5, 5, 0], size: [3, 3, 2], color: 'blue' }
    ]
  };
  const svg = renderSVG(scene);
  assert.equal(svg, renderSVG(JSON.parse(JSON.stringify(scene))), 'slab render is deterministic');
  for (const cls of ['face-strata-line', 'face-slab-ao', 'face-slab-rim']) assert.ok(svg.includes(cls), cls);
  assert.ok(svg.includes('class="ground slab-void"'), 'underside shadow is a ground layer');
  assert.match(svg, /<ellipse[^>]*fill="url\(#iso-slab-void\)"/, 'void ellipse uses the slab gradient');
  assert.match(svg, /<radialGradient id="iso-slab-void"[^>]*>.*stop-opacity="0.26"/s, 'void ink starts near 26%');
  const strata = [...svg.matchAll(/face-strata-line/g)];
  assert.ok(strata.length >= 4, 'at least two strata lines per visible face');
  const voidIndex = svg.indexOf('class="ground slab-void"');
  const baseIndex = svg.indexOf('data-id="base"');
  assert.ok(voidIndex >= 0 && voidIndex < baseIndex, 'void paints before the slab');
});

test('small raised plates are not decorated as slabs', () => {
  const scene = {
    version: 1,
    theme: 'light',
    parts: [{ id: 'tray', kind: 'plate', at: [2, 2, 1.2], size: [4, 3, 0.4], color: 'copper', detail: 'tray' }]
  };
  const svg = renderSVG(scene);
  assert.ok(!svg.includes('face-strata-line'), 'no strata on a small raised plate');
  assert.ok(!svg.includes('class="ground slab-void"'), 'no void shadow without an eligible ground plate');
});

test('renderSVG emits deterministic face gradients referenced by solids', () => {
  const svg = renderSVG(makeScene('light'));
  assert.ok(svg.includes('<defs>'), 'defs block is present');
  assert.match(svg, /<linearGradient id="iso-g-blue-top"[^>]*>/, 'per-token top gradient exists');
  assert.match(svg, /<radialGradient id="iso-shadow-soft"/, 'soft shadow gradient exists');
  assert.match(svg, /<radialGradient id="iso-shadow-contact"/, 'contact shadow gradient exists');
  const faceFills = [...svg.matchAll(/<polygon[^>]*class="face face-(?:top|left|right|chamfer)"[^>]*>/g)]
    .map((match) => match[0].match(/fill="([^"]+)"/)[1]);
  assert.ok(faceFills.length > 0, 'faces are drawn');
  for (const fill of faceFills) {
    assert.ok(fill.startsWith('url(#iso-g-'), 'face uses a gradient, got ' + fill);
  }
});

test('renderSVG draws ground shadows and an isometric dot grid', () => {
  const svg = renderSVG(makeScene('light'));
  assert.ok(svg.includes('class="ground"'), 'a ground group is present');
  assert.ok(svg.includes('class="grid"'), 'a grid group is present');
  assert.match(svg, /<ellipse[^>]*fill="url\(#iso-shadow-soft\)"/, 'soft ellipse shadow');
  assert.match(svg, /<ellipse[^>]*fill="url\(#iso-shadow-contact\)"/, 'contact ellipse shadow');
  assert.match(svg, /<circle[^>]*fill-opacity="0.07"[^>]*\/>/, 'faint grid dots');
  const groundIndex = svg.indexOf('class="ground"');
  const firstPart = svg.indexOf('class="part" data-id="web"');
  assert.ok(groundIndex < firstPart, 'shadows paint above floors and before raised solids');
});

test('box tops are chamfered octagons with machined edges', () => {
  const solid = box({ id: 'b', at: [0, 0, 0], size: [3, 3, 2], color: 'blue' });
  const top = solid.polygons.find((polygon) => polygon.cls === 'face face-top');
  assert.ok(top, 'a top face exists');
  assert.equal(top.points.length, 8, 'top face is an octagon');
  const chamfers = solid.polygons.filter((polygon) => polygon.cls.includes('face-chamfer'));
  assert.ok(chamfers.length >= 1, 'visible chamfer quads are emitted');
  const seams = solid.paths.filter((path) => path.cls.includes('face-seam'));
  assert.ok(seams.length >= 1, 'a shadow seam marks the shoulder joint');
  for (const polygon of solid.polygons) {
    for (const point of polygon.points) {
      assert.ok(Number.isFinite(point[0]) && Number.isFinite(point[1]), 'chamfer geometry is finite');
    }
  }
});

test('box decor honors detail, vents and leds fields', () => {
  const plain = box({ id: 'p', at: [0, 0, 0], size: [3, 3, 3], color: 'blue' });
  const rack = box({ id: 'r', at: [0, 0, 0], size: [3, 3, 3], color: 'blue', detail: 'rack', leds: 4 });
  const tray = box({ id: 't', at: [0, 0, 0], size: [3, 3, 2], color: 'sand', detail: 'tray', vents: true });
  assert.ok(rack.polygons.length > plain.polygons.length, 'rack adds slots and power strip');
  assert.equal(rack.polygons.filter((p) => p.cls === 'face face-led').length, 4, 'four leds');
  assert.equal(rack.polygons.filter((p) => p.cls === 'face face-led-glow').length, 4, 'each led glows');
  assert.ok(tray.paths.filter((p) => p.cls.includes('face-tray')).length === 3, 'three tray slot lines');
  assert.ok(tray.polygons.filter((p) => p.cls.includes('face-vent')).length >= 4, 'vents are drawn');
});

test('cylinder caps read as a stacked data store', () => {
  const solid = cylinder({ id: 'c', at: [0, 0, 0], radius: 1.5, h: 3, axis: 'z', color: 'amber' });
  const cap = solid.polygons.find((polygon) => polygon.cls === 'face face-cap');
  assert.ok(cap, 'inner cap is drawn');
  assert.equal(cap.points.length, 24, 'inner cap is a projected inset ring');
  const rings = solid.paths.filter((path) => path.cls.includes('face-ring'));
  assert.equal(rings.length, 4, 'two seams, each a highlight and a shadow arc');
  assert.ok(solid.paths.some((path) => path.cls.includes('face-base')), 'base ring is stroked');
});

test('links get a three-pass stroke and cables sag with matching sampling', () => {
  const tubeSolid = tube({ points: [[0, 0, 0], [4, 0, 2]], radius: 0.035, color: 'blue', kind: 'tube' });
  assert.equal(tubeSolid.paths.length, 3, 'outline, base and specular passes');
  assert.ok(tubeSolid.paths[0].width > tubeSolid.paths[1].width, 'outline is wider');
  assert.ok(tubeSolid.paths[2].width < tubeSolid.paths[1].width, 'specular is thinner');
  assert.equal(linkPoints([[0, 0, 0], [4, 0, 2]], 'tube').length, 2, 'tubes stay straight');
  const curve = linkPoints([[0, 0, 5], [10, 0, 5]], 'cable');
  assert.ok(curve.length > 2, 'cables are sampled curves');
  assert.deepEqual(curve[0], [0, 0, 5], 'cable keeps its start');
  assert.deepEqual(curve[curve.length - 1], [10, 0, 5], 'cable keeps its end');
  const middle = curve[Math.floor(curve.length / 2)];
  assert.ok(middle[2] < 5, 'cable sags below the chord');
});

test('link strokes follow the radius contract with a scaled outline', () => {
  const solid = tube({ points: [[0, 0, 0], [6, 0, 0]], radius: 0.05, color: 'blue', kind: 'tube' });
  const [outline, base, highlight] = solid.paths;
  assert.equal(base.width, 0.1, 'base stroke is radius * 2');
  assert.equal(outline.width, 0.2, 'outline stroke is base * 2');
  assert.equal(highlight.width, 0.025, 'highlight stroke is radius * 0.5');
  assert.equal(outline.stroke, TOKENS.light.blue.edge, 'outline uses the token edge color');
  assert.equal(base.stroke, TOKENS.light.blue.left, 'base uses the token base color');
  assert.equal(outline.opacity, 0.85, 'outline is nearly opaque');
  for (const path of solid.paths) {
    assert.equal(path.vectorEffect, false, 'link strokes scale with the group transform');
  }
});

test('rendered links keep scannable scaled strokes, not hairlines', () => {
  const scene = makeScene('light');
  const svg = renderSVG(scene);
  const outlines = [...svg.matchAll(/<path[^>]*link-outline[^>]*\/>/g)].map((match) => match[0]);
  assert.equal(outlines.length, scene.links.length, 'every link draws an outline pass');
  for (const outline of outlines) {
    assert.ok(!outline.includes('non-scaling-stroke'), 'link outlines scale with the fit transform');
    assert.match(outline, /stroke="#[0-9a-f]{6}"/, 'link outline carries a token edge color');
  }
  const tubeBase = svg.match(/<path[^>]*class="link-path link-tube"[^>]*\/>/)[0];
  assert.match(tubeBase, /stroke-width="0.1"/, 'tube base stroke is 0.1 world units');
  assert.ok(!tubeBase.includes('non-scaling-stroke'), 'tube base scales with the fit transform');
});

test('flow packets carry a token edge ring in the runtime', () => {
  const motion = readFileSync(new URL('./motion.mjs', import.meta.url), 'utf8');
  assert.match(motion, /packet\.setAttribute\('stroke', motion_rim\(ring\)\)/, 'packets get a darker rim derived from the edge token');
  assert.match(motion, /packet\.setAttribute\('stroke-width', '1'\)/, 'ring is a one-pixel hairline');
  assert.match(motion, /packet\.setAttribute\('vector-effect', 'non-scaling-stroke'\)/, 'ring stays crisp at any zoom');
  assert.match(motion, /const color = TOKENS\[/, 'ring color comes from the theme tokens');
});

test('labels render as museum chips around the text', () => {
  const svg = renderSVG(makeScene('light'));
  assert.ok(svg.includes('class="label-chip"'), 'chip rect is present');
  assert.match(svg, /<text class="label"/, 'label text is kept');
  const rects = [...svg.matchAll(/<rect[^>]*class="label-chip"[^>]*>/g)];
  assert.equal(rects.length, makeScene('light').parts.filter((part) => part.label).length, 'one chip per label');
});

test('fit reserves extra top space when a title exists', () => {
  const extract = (svg) => svg.match(/translate\((-?[0-9.]+),(-?[0-9.]+)\) scale\(([0-9.]+)\)/);
  const withTitle = extract(renderSVG(makeScene('light')));
  const withoutTitle = extract(renderSVG({ ...makeScene('light'), title: undefined }));
  assert.ok(withTitle, 'fit transform is present with a title');
  assert.ok(withoutTitle, 'fit transform is present without a title');
  assert.ok(Number(withTitle[2]) > Number(withoutTitle[2]), 'title pushes content down');
  assert.ok(Number(withTitle[3]) <= Number(withoutTitle[3]), 'title never grows the scale');
});

test('concrete joints and mottling are deterministic projected geometry', () => {
  const scene = { version: 1, parts: [{ id: 'floor', kind: 'plate', at: [-4, -4, -0.3], size: [16, 16, 0.3], color: 'paper', detail: 'concrete' }] };
  const first = renderSVG(scene);
  assert.equal(first, renderSVG(JSON.parse(JSON.stringify(scene))));
  for (const cls of ['face-joint', 'face-mottle', 'face-wear', 'face-lane']) assert.ok(first.includes(cls), cls);
  assert.ok(first.includes('stroke-dasharray="1.2 1.2"'));
  assert.doesNotMatch(first, /<filter|foreignObject|feGaussianBlur|feTurbulence/);
});

test('panels include paired seams, four screws and a hazard band', () => {
  const solid = box({ at: [0, 0, 0], size: [4, 3, 3], color: 'steel', panels: true, hazard: true });
  assert.equal(solid.paths.filter((p) => p.cls === 'face face-panel').length, 4);
  assert.equal(solid.polygons.filter((p) => p.cls === 'face face-screw').length, 4);
  assert.equal(solid.polygons.filter((p) => p.cls === 'face face-hazard').length, 2);
});

test('hardware vocabulary adds distinct projected surfaces', () => {
  const opts = { at: [0, 0, 0], size: [4, 3, 3], color: 'steel' };
  for (const [detail, cls] of [['rack', 'face-rail'], ['tower', 'face-drive'], ['switch', 'face-port'], ['crate', 'face-brace'], ['pallet', 'face-slat']]) {
    const solid = box({ ...opts, detail });
    assert.ok([...solid.polygons, ...solid.paths].some((p) => p.cls.includes(cls)), detail);
    assert.ok([...solid.polygons, ...solid.paths].every((p) => p.points.every((point) => point.every(Number.isFinite))));
  }
  const network = box({ ...opts, detail: 'switch' });
  assert.equal(network.polygons.filter((p) => p.cls === 'face face-port').length, 16);
  assert.equal(network.polygons.filter((p) => p.cls === 'face face-port-led').length, 8);
});

test('tank and coil details follow the cylinder axis', () => {
  for (const axis of ['x', 'y', 'z']) {
    const opts = { at: [2, 3, 0], radius: 1, h: 3, color: 'amber', axis };
    const tank = cylinder({ ...opts, detail: 'tank' });
    for (const cls of ['face-tank-rail', 'face-ladder', 'face-gauge-level', 'face-valve-handle']) assert.ok(tank.paths.some((p) => p.cls.includes(cls)), axis + cls);
    assert.equal(cylinder({ ...opts, detail: 'coil' }).paths.filter((p) => p.cls === 'face face-coil').length, 2);
  }
});

test('lighting is layered above floors with masked reflections only on supported solids', () => {
  const scene = { version: 1, parts: [
    { id: 'floor', kind: 'plate', at: [-1, -1, -0.3], size: [12, 12, 0.3], color: 'paper' },
    { id: 'near', kind: 'box', at: [5, 5, 0], size: [2, 2, 2], color: 'blue' },
    { id: 'far', kind: 'box', at: [0, 0, 0], size: [2, 2, 2], color: 'green' },
    { id: 'floating', kind: 'box', at: [8, 0, 2], size: [2, 2, 2], color: 'steel' }
  ] };
  const svg = renderSVG(scene);
  assert.equal([...svg.matchAll(/class="reflection"/g)].length, 2);
  assert.match(svg, /mask="url\(#iso-reflection-mask\)"/);
  assert.ok(svg.indexOf('class="ground floor-shadow"') < svg.indexOf('data-id="floor"'));
  assert.ok(svg.indexOf('data-id="floor"') < svg.indexOf('class="ground"'));
  assert.ok(svg.indexOf('class="reflections"') < svg.indexOf('data-id="far"'));
  for (const cls of ['face-rim', 'face-sheen', 'face-fog']) assert.ok(svg.includes(cls), cls);
  assert.ok(svg.includes('id="iso-hazard"'));
});

test('link connectors preserve world-unit strokes and cable ties', () => {
  const svg = renderSVG(makeScene('light'));
  for (const cls of ['link-collar', 'link-plug', 'link-flange', 'link-tie']) assert.ok(svg.includes(cls), cls);
  for (const match of svg.matchAll(/<polygon[^>]*class="link-flange"[^>]*>/g)) assert.ok(!match[0].includes('non-scaling-stroke'));
});

test('sublabels escape content and retain chip and label classes', () => {
  const scene = makeScene('dark');
  scene.parts[0].sublabel = 'controller <&>';
  const svg = renderSVG(scene);
  assert.match(svg, /class="label label-sublabel"/);
  assert.ok(svg.includes('controller &lt;&amp;&gt;'));
  assert.equal([...svg.matchAll(/class="label-chip"/g)].length, scene.parts.filter((p) => p.label).length);
});

test('rack unit labels are omitted below their readable effective size', () => {
  const scene = { version: 1, size: [1280, 960], parts: [{ id: 'rack', kind: 'box', at: [0, 0, 0], size: [3, 3, 4], color: 'steel', detail: 'rack' }] };
  assert.ok(renderSVG(scene).includes('face-unit-label'));
  scene.size = [80, 80];
  assert.ok(!renderSVG(scene).includes('face-unit-label'));
});

test('both fixture themes remain pure, deterministic and under 120KB', () => {
  for (const theme of ['light', 'dark']) {
    const scene = { ...loadFixture('three-tier.json'), theme };
    const before = JSON.stringify(scene);
    const svg = renderSVG(scene);
    assert.equal(svg, renderSVG(scene));
    assert.equal(JSON.stringify(scene), before);
    assert.ok(Buffer.byteLength(svg) < 120000);
    assert.doesNotMatch(svg, /<filter|foreignObject|feTurbulence|feGaussianBlur/);
  }
});

test('cylinder body silhouettes are convex and never self-intersect', () => {
  for (const axis of ['x', 'y', 'z']) {
    const body = cylinder({ at: [1, 2, 3], axis, radius: 1.5, h: 4, color: 'copper' }).polygons.find((p) => p.cls === 'face face-body');
    const points = body.points;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length];
      assert.ok((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= -1e-10, axis);
    }
  }
});

test('directional shadows use two gradient silhouettes per solid before raised objects', () => {
  const scene = makeScene('dark');
  const svg = renderSVG(scene);
  const shadows = [...svg.matchAll(/<polygon[^>]*class="shadow-directional"/g)];
  assert.equal(shadows.length, scene.parts.length * 2);
  for (const [element] of shadows) assert.match(element, /fill="url\(#iso-shadow-directional\)"/);
  assert.equal((svg.match(/id="iso-shadow-directional"/g) || []).length, 1);
  assert.ok(svg.indexOf('class="shadow-directional"') < svg.indexOf('data-id="web"'));
  assert.match(svg, /stop-opacity="0.24"/);
});

test('finish patterns are defined once per used family and overlay visible faces', () => {
  for (const theme of ['light', 'dark']) {
    const svg = renderSVG(makeScene(theme));
    for (const family of ['matte', 'rivets']) {
      assert.equal((svg.match(new RegExp('id="iso-tex-' + family + '"', 'g')) || []).length, 1);
      assert.ok(svg.includes('fill="url(#iso-tex-' + family + ')"'));
    }
    for (const family of ['brush', 'brushedWarm']) {
      for (const [variant, angle] of [['top', 30], ['left', 30], ['right', -30]]) {
        const id = 'iso-tex-' + family + '-' + variant;
        assert.equal((svg.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1);
        assert.match(svg, new RegExp('id="' + id + '"[^>]*patternTransform="rotate\\(' + angle + '\\)"'));
      }
      assert.ok(svg.includes('fill="url(#iso-tex-' + family + '-left)"'));
      assert.ok(svg.includes('fill="url(#iso-tex-' + family + '-right)"'));
    }
    assert.match(svg, /fill-opacity="0.025"[^>]*class="face face-texture"/);
    assert.match(svg, /fill-opacity="0.04"[^>]*class="face face-texture"/);
  }
  const svg = renderSVG({ parts: [makeScene('light').parts[0]] });
  assert.ok(!svg.includes('id="iso-tex-brush-top"'));
  assert.ok(!svg.includes('id="iso-tex-brushedWarm-top"'));
});

test('equipment decals require a large enough side face and grime stays under the vents', () => {
  for (const face of [5, 6, 20]) {
    const scene = { parts: [{ id: 'equipment', kind: 'box', at: [0, 0, 0], size: [4, face / 3, 3], color: 'steel', vents: true }] };
    const svg = renderSVG(scene);
    assert.equal((svg.match(/class="face face-decal"/g) || []).length, face >= 6 ? 1 : 0);
    assert.equal((svg.match(/class="face face-decal-line"/g) || []).length, face >= 6 ? 2 : 0);
    const grime = (svg.match(/class="face face-grime"/g) || []).length;
    assert.ok(grime >= 2 && grime <= 4);
    assert.equal(svg, renderSVG(scene));
  }
  const flat = { parts: [{ id: 'tray', kind: 'plate', at: [0, 0, 0], size: [6, 6, 0.4], color: 'sand', vents: true }] };
  assert.ok(!renderSVG(flat).includes('class="face face-decal"'), 'slabs and thin plates stay clean');
  const led = { parts: [{ id: 'node', kind: 'box', at: [0, 0, 0], size: [4, 4, 3], color: 'steel', leds: 3, vents: true }] };
  const decal = renderSVG(led).match(/<polygon points="([^"]+)"[^>]*class="face face-decal"/);
  assert.ok(decal, 'led equipment still gets a decal');
});

test('slab and raised platform equipment receive radial contact grime', () => {
  for (const z of [-0.4, 0, 3]) {
    const scene = { parts: [
      { id: 'floor', kind: 'plate', at: [0, 0, z], size: [8, 8, 0.4], color: 'cloud', detail: 'concrete' },
      { id: 'rack', kind: 'box', at: [2, 2, z + 0.4], size: [3, 3, 3], color: 'steel' }
    ] };
    const svg = renderSVG(scene);
    assert.match(svg, /<ellipse[^>]*fill="url\(#iso-contact-grime\)"/);
    assert.ok(svg.indexOf('class="surface-occlusion"') < svg.indexOf('data-id="rack"'));
    const cracks = (svg.match(/class="face face-crack"/g) || []).length;
    assert.ok(cracks >= 2 && cracks <= 3);
    assert.equal(svg, renderSVG(scene));
  }
});
