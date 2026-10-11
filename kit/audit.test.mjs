import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const auditMod = await import('./audit.mjs');

let isoOk = true;
try {
  await import('./iso.mjs');
} catch (error) {
  isoOk = false;
}
const geometrySkip = isoOk ? false : 'kit/iso.mjs not available yet';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));

test('flags an empty scene', {}, () => {
  const result = auditMod.audit({ version: 1, title: 'Empty', theme: 'light', parts: [] });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.code === 'EMPTY_SCENE'));
});

test('flags duplicate part ids', {}, () => {
  const scene = {
    version: 1,
    title: 'Dupes',
    theme: 'light',
    parts: [
      { id: 'x', kind: 'box', at: [0, 0, 0], size: [2, 2, 2], color: 'blue' },
      { id: 'x', kind: 'box', at: [4, 0, 0], size: [2, 2, 2], color: 'blue' }
    ]
  };
  const result = auditMod.audit(scene);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.code === 'DUPLICATE_ID'));
});

test('broken-link fixture fails with LINK_OFF_ANCHOR', {}, () => {
  const result = auditMod.audit(fixture('broken-link.json'));
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.code === 'LINK_OFF_ANCHOR'));
});

test('three-tier fixture passes a full audit', { skip: geometrySkip }, () => {
  const result = auditMod.audit(fixture('three-tier.json'));
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.deepEqual(result.violations, []);
});

test('inverted-depth fixture reports a DEPTH_INVERSION', { skip: geometrySkip }, () => {
  const result = auditMod.audit(fixture('inverted-depth.json'));
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.code === 'DEPTH_INVERSION'));
});

test('audit reports AUDIT_PARTIAL when iso is unavailable', {}, () => {
  if (isoOk) {
    assert.equal(auditMod.audit(fixture('three-tier.json')).violations.some((v) => v.code === 'AUDIT_PARTIAL'), false);
    return;
  }
  const result = auditMod.audit(fixture('three-tier.json'));
  assert.ok(result.violations.some((violation) => violation.code === 'AUDIT_PARTIAL'));
});

const scene = (parts, extra = {}) => ({
  version: 1,
  title: 'Test',
  theme: 'light',
  size: [1280, 960],
  parts,
  ...extra
});

test('SOLID_OVERLAP passes for solids that only touch', { skip: geometrySkip }, () => {
  const result = auditMod.audit(scene([
    { id: 'a', kind: 'box', at: [0, 0, 0], size: [3, 3, 2], color: 'steel' },
    { id: 'b', kind: 'box', at: [5, 0, 0], size: [3, 3, 2], color: 'blue' }
  ]));
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.equal(result.violations.some((violation) => violation.code === 'SOLID_OVERLAP'), false);
});

test('SOLID_OVERLAP flags interpenetrating solids', { skip: geometrySkip }, () => {
  const result = auditMod.audit(scene([
    { id: 'a', kind: 'box', at: [0, 0, 0], size: [4, 4, 2], color: 'steel' },
    { id: 'b', kind: 'box', at: [2, 2, 0], size: [4, 4, 2], color: 'blue' }
  ]));
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.code === 'SOLID_OVERLAP'));
});

test('FLOATING passes for a part resting on the ground plate', { skip: geometrySkip }, () => {
  const result = auditMod.audit(scene([
    { id: 'ground', kind: 'plate', at: [0, 0, 0], size: [20, 20, 1], color: 'paper' },
    { id: 'box', kind: 'box', at: [2, 2, 1], size: [3, 3, 2], color: 'blue' }
  ]));
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.equal(result.violations.some((violation) => violation.code === 'FLOATING'), false);
});

test('FLOATING flags an unsupported solid', { skip: geometrySkip }, () => {
  const result = auditMod.audit(scene([
    { id: 'sky', kind: 'box', at: [0, 0, 5], size: [2, 2, 2], color: 'blue' }
  ]));
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.code === 'FLOATING'));
});

test('LABEL_OVERLAP passes for a single readable label', { skip: geometrySkip }, () => {
  const result = auditMod.audit(scene([
    { id: 'ground', kind: 'plate', at: [-20, -20, 0], size: [120, 120, 1], color: 'paper' },
    { id: 'api', kind: 'box', label: 'API', at: [0, 0, 1], size: [3, 3, 2], color: 'blue' }
  ]));
  assert.equal(result.violations.some((violation) => violation.code === 'LABEL_OVERLAP'), false);
});

test('LABEL_OVERLAP flags colliding label chips', { skip: geometrySkip }, () => {
  const result = auditMod.audit(scene([
    { id: 'ground', kind: 'plate', at: [-500, -500, 0], size: [1000, 1000, 1], color: 'paper' },
    { id: 'a', kind: 'box', label: 'AAAAAAAAAAAA', at: [0, 0, 1], size: [3, 3, 2], color: 'steel' },
    { id: 'b', kind: 'box', label: 'BBBBBBBBBBBB', at: [0, 3, 1], size: [3, 3, 2], color: 'steel' }
  ]));
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.code === 'LABEL_OVERLAP'));
});

test('a single accent produces no warning', { skip: geometrySkip }, () => {
  const result = auditMod.audit(scene([
    { id: 'a', kind: 'box', accent: true, at: [0, 0, 0], size: [3, 3, 2], color: 'steel' },
    { id: 'b', kind: 'box', at: [5, 0, 0], size: [3, 3, 2], color: 'blue' }
  ]));
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.deepEqual(result.warnings, []);
});

test('more than one accent warns without failing', { skip: geometrySkip }, () => {
  const result = auditMod.audit(scene([
    { id: 'a', kind: 'box', accent: true, at: [0, 0, 0], size: [3, 3, 2], color: 'steel' },
    { id: 'b', kind: 'box', accent: true, at: [5, 0, 0], size: [3, 3, 2], color: 'blue' }
  ]));
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, 'MULTIPLE_ACCENTS');
});
