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
