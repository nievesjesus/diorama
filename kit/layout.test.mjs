import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LAYOUT_KINDS, layoutScene, solveLayout } from './layout.mjs';
import { validateScene } from './scene.mjs';
import { audit } from './audit.mjs';

function hash32(a, b) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function makeRng(seed) {
  let n = 0;
  return (mod) => hash32(seed, n++) % mod;
}

const WORDS = ['API', 'Postgres', 'nginx', 'S3', 'Kafka', 'Redis', 'Auth', 'Worker', 'Gateway',
  'Search index', 'Scheduler', 'Billing', 'Ledger', 'CDN', 'Queue', 'Metrics', 'Notifier',
  'Uploader', 'Indexer', 'Cache', 'Router', 'Mailer', 'Vault', 'Schema registry'];
const SHAPES = ['chain', 'fanout', 'fanin', 'skip', 'dag', 'tiers', 'mixed', 'dense', 'cycle'];

function makeDraft(seed) {
  const r = makeRng(seed);
  const shape = SHAPES[seed % SHAPES.length];
  const n = 2 + r(23);
  const parts = [];
  for (let i = 0; i < n; i += 1) {
    const part = { id: 'p' + i, kind: LAYOUT_KINDS[r(LAYOUT_KINDS.length)] };
    if (r(10) < 9) part.label = WORDS[(i + r(WORDS.length)) % WORDS.length] + (i >= WORDS.length || r(3) === 0 ? ' ' + i : '');
    if (r(12) === 0) part.sublabel = 'replica ' + (1 + r(5));
    parts.push(part);
  }
  if (r(3) === 0) parts[r(n)].accent = true;
  const links = [];
  const add = (a, b) => {
    if (a !== b) links.push({ id: 'l' + links.length, from: 'p' + a, to: 'p' + b, kind: r(2) ? 'tube' : 'cable' });
  };
  if (shape === 'chain') for (let i = 1; i < n; i += 1) add(i - 1, i);
  if (shape === 'fanout') for (let i = 1; i < n; i += 1) add(r(Math.min(i, 2)), i);
  if (shape === 'fanin') for (let i = 0; i < n - 1; i += 1) add(i, n - 1);
  if (shape === 'skip') {
    for (let i = 1; i < n; i += 1) add(i - 1, i);
    for (let i = 0; i + 2 < n; i += 1) if (r(2)) add(i, i + 2 + r(Math.min(4, n - i - 2)));
  }
  if (shape === 'dag' || shape === 'mixed') {
    for (let i = 1; i < n; i += 1) {
      const k = 1 + r(3);
      for (let j = 0; j < k; j += 1) add(r(i), i);
    }
  }
  if (shape === 'dense') {
    for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) if (r(n) < 4) add(i, j);
  }
  if (shape === 'cycle') {
    for (let i = 1; i < n; i += 1) add(i - 1, i);
    add(n - 1, 0);
    if (n > 3) add(r(n), r(n));
  }
  if (shape === 'tiers' || shape === 'mixed') {
    const tiers = 2 + r(3);
    for (const part of parts) part.tier = r(tiers);
    if (shape === 'tiers') for (let i = 1; i < n; i += 1) add(r(i), i);
  }
  const draft = { title: 'Fuzz ' + seed, parts, links };
  if (links.length >= 2 && r(2)) draft.flows = [{ path: [links[0].id] }];
  if (r(4) === 0) draft.theme = 'dark';
  return { shape, draft };
}

function quietAudit(scene) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return audit(scene);
  } finally {
    console.warn = warn;
  }
}

function quietLayout(draft, opts) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return layoutScene(draft, opts);
  } finally {
    console.warn = warn;
  }
}

const SAMPLE = {
  title: 'Sample',
  parts: [
    { id: 'web', label: 'nginx', kind: 'server', accent: true },
    { id: 'api', label: 'API', kind: 'rack' },
    { id: 'db', label: 'Postgres', kind: 'database' },
    { id: 'cache', label: 'Redis', kind: 'cylinder' }
  ],
  links: [
    { id: 'a', from: 'web', to: 'api' },
    { id: 'b', from: 'api', to: 'db', kind: 'cable' },
    { id: 'c', from: 'web', to: 'db' },
    { from: 'api', to: 'cache' }
  ],
  flows: [{ path: ['a', 'b'] }]
};

test('layout is deterministic: same draft twice gives byte-identical JSON', () => {
  const first = JSON.stringify(quietLayout(SAMPLE));
  const second = JSON.stringify(quietLayout(JSON.parse(JSON.stringify(SAMPLE))));
  assert.equal(first, second);
});

test('layout output validates, passes the audit and keeps the draft facts', () => {
  const scene = quietLayout(SAMPLE);
  assert.equal(validateScene(scene).ok, true);
  assert.equal(audit(scene).ok, true);
  const byId = new Map(scene.parts.map((part) => [part.id, part]));
  assert.equal(byId.get('web').accent, true);
  assert.equal(byId.get('api').accent, undefined);
  assert.equal(byId.get('ground').kind, 'plate');
  assert.equal(scene.links.length, 4);
  for (const link of scene.links) {
    assert.ok(link.fromPort === 'east' || link.fromPort === 'west');
    assert.ok(link.toPort === 'east' || link.toPort === 'west');
  }
  assert.deepEqual(scene.flows[0].path, ['web', 'api', 'db']);
});

test('tiers become raised plates under their parts', () => {
  const draft = {
    title: 'Tiers',
    parts: [
      { id: 'lb', label: 'LB', tier: 'edge' },
      { id: 'app', label: 'App', tier: 'app' },
      { id: 'db', label: 'DB', kind: 'database', tier: 'data' }
    ],
    links: [{ from: 'lb', to: 'app' }, { from: 'app', to: 'db' }, { from: 'lb', to: 'db' }]
  };
  const scene = quietLayout(draft);
  const plates = scene.parts.filter((part) => part.id.startsWith('tier-'));
  assert.equal(plates.length, 3);
  assert.equal(quietAudit(scene).ok, true);
});

test('bad drafts fail with a clear message', () => {
  assert.throws(() => layoutScene({ parts: [] }), /title/);
  assert.throws(() => layoutScene({ title: 'x', parts: [{ id: 'a', kind: 'blob' }] }), /kind "blob"/);
  assert.throws(() => layoutScene({ title: 'x', parts: [{ id: 'a' }], links: [{ from: 'a', to: 'zz' }] }), /links\[0\]\.to/);
  assert.throws(() => layoutScene({ title: 'x', parts: [{ id: 'a' }], links: [{ from: 'a', to: 'a' }] }), /itself/);
});

test('fuzz: 540 seeded drafts across graph shapes all lay out with zero audit violations', () => {
  const failures = [];
  const shapes = new Map();
  let total = 0;
  for (let seed = 0; seed < 540; seed += 1) {
    const { shape, draft } = makeDraft(seed);
    shapes.set(shape, (shapes.get(shape) || 0) + 1);
    total += 1;
    try {
      const scene = quietLayout(draft);
      const checked = validateScene(scene);
      const result = quietAudit(scene);
      if (!checked.ok || !result.ok) {
        failures.push(`${seed} ${shape}: ${checked.errors.concat(result.violations.map((v) => v.code)).join(', ')}`);
      }
    } catch (error) {
      failures.push(`${seed} ${shape}: ${error.message.split('\n')[0]}`);
    }
  }
  assert.equal(total, 540);
  assert.equal(shapes.size, SHAPES.length);
  assert.deepEqual(failures, []);
});

test('a draft too dense for straight links fails loudly instead of emitting a bad scene', () => {
  const parts = Array.from({ length: 24 }, (_, i) => ({ id: 'n' + i, label: 'Node ' + i }));
  const links = [];
  for (let i = 0; i < 24; i += 1) for (let j = i + 1; j < 24; j += 1) links.push({ from: 'n' + i, to: 'n' + j });
  assert.throws(() => layoutScene({ title: 'Complete graph', parts, links }), /no readable layout for 24 parts and 276 links/);
});

test('label stress: a wide fan of long labels and sublabels at mixed heights stays clean', () => {
  const kinds = ['tower', 'pallet', 'rack', 'plate', 'tank', 'switch'];
  const parts = [{ id: 'hub', label: 'Gateway', kind: 'server' }];
  const links = [];
  for (let i = 0; i < 20; i += 1) {
    parts.push({ id: 's' + i, label: 'Service number ' + i, sublabel: i % 3 === 0 ? 'replica set of three' : undefined, kind: kinds[i % kinds.length] });
    links.push({ from: 'hub', to: 's' + i });
  }
  for (const part of parts) if (part.sublabel === undefined) delete part.sublabel;
  const scene = quietLayout({ title: 'Fan', parts, links });
  const result = quietAudit(scene);
  assert.deepEqual(result.violations, []);
});

test('label stress: a chain alternating tall and flat parts with identical long labels stays clean', () => {
  const parts = [];
  const links = [];
  for (let i = 0; i < 16; i += 1) {
    parts.push({ id: 'c' + i, label: 'Ingestion stage ' + i, kind: i % 2 ? 'tower' : 'pallet' });
    if (i > 0) links.push({ from: 'c' + (i - 1), to: 'c' + i });
    if (i > 2 && i % 3 === 0) links.push({ from: 'c' + (i - 3), to: 'c' + i, kind: 'cable' });
  }
  const scene = quietLayout({ title: 'Chain', parts, links });
  assert.deepEqual(quietAudit(scene).violations, []);
});

test('solveLayout returns the audit it ran and honours the theme option', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const solved = solveLayout(SAMPLE, { theme: 'dark' });
    assert.equal(solved.scene.theme, 'dark');
    assert.equal(solved.audit.ok, true);
  } finally {
    console.warn = warn;
  }
});
