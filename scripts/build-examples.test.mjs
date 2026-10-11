import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { listExampleScenes, usageText } from './build-examples.mjs';

function fakeEntries(names) {
  return names.map((name) => ({ name, isDirectory: () => !name.includes('.') }));
}

test('listExampleScenes returns sorted scene directories', () => {
  const examplesDir = '/repo/examples';
  const readdir = () => fakeEntries(['beta', 'alpha', 'notes.txt']);
  const exists = (path) =>
    path === examplesDir ||
    path === join(examplesDir, 'alpha', 'scene.json') ||
    path === join(examplesDir, 'beta', 'scene.json');
  assert.deepEqual(listExampleScenes(examplesDir, { readdir, exists }), [
    join(examplesDir, 'alpha'),
    join(examplesDir, 'beta'),
  ]);
});

test('listExampleScenes skips directories without a scene.json', () => {
  const examplesDir = '/repo/examples';
  const readdir = () => fakeEntries(['empty', 'real']);
  const exists = (path) => path === examplesDir || path === join(examplesDir, 'real', 'scene.json');
  assert.deepEqual(listExampleScenes(examplesDir, { readdir, exists }), [join(examplesDir, 'real')]);
});

test('listExampleScenes returns empty when the examples dir is absent', () => {
  assert.deepEqual(listExampleScenes('/repo/examples', { exists: () => false }), []);
});

test('usageText documents the script', () => {
  const text = usageText();
  assert.ok(text.includes('Usage: node scripts/build-examples.mjs'));
  assert.ok(text.includes('examples/<name>/index.html'));
});
