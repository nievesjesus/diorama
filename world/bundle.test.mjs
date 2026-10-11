import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { addonOrder, bundleWebgl, moduleOrder, stripModuleSyntax, stripThreeExports } from './bundle.mjs';
import { build } from '../build.mjs';

const worldDir = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(join(worldDir, relative), 'utf8');

test('stripModuleSyntax removes single-line imports', () => {
  const { code, exports } = stripModuleSyntax("import { A } from 'three';\nconst x = 1;\n");
  assert.equal(code.includes('import'), false);
  assert.equal(code.includes('const x = 1;'), true);
  assert.deepEqual(exports, []);
});

test('stripModuleSyntax removes multi-line braced imports', () => {
  const source = ['import {', '\tMesh,', '\tVector3', "} from 'three';", 'const y = 2;'].join('\n');
  const { code } = stripModuleSyntax(source);
  assert.equal(code.trim(), 'const y = 2;');
});

test('stripModuleSyntax removes side-effect and relative imports', () => {
  const source = ["import './side-effect.js';", "import Thing from '../a/b.js';", 'const z = 3;'].join('\n');
  assert.equal(stripModuleSyntax(source).code.trim(), 'const z = 3;');
});

test('stripModuleSyntax collects names from an export list', () => {
  const { code, exports } = stripModuleSyntax('class A {}\nclass B {}\nexport { A, B };\n');
  assert.deepEqual(exports, ['A', 'B']);
  assert.equal(code.includes('export'), false);
});

test('stripModuleSyntax unwraps export declarations and drops export default', () => {
  const source = ['export function go() {}', 'export const K = 1;', 'export default go;'].join('\n');
  const { code, exports } = stripModuleSyntax(source);
  assert.deepEqual(exports, ['go', 'K']);
  assert.equal(code.includes('function go() {}'), true);
  assert.equal(code.includes('const K = 1;'), true);
  assert.equal(/^\s*export\b/m.test(code), false);
});

test('stripModuleSyntax honours renamed exports', () => {
  assert.deepEqual(stripModuleSyntax('export { inner as outer };').exports, ['outer']);
});

test('stripThreeExports drops the trailing export statement of three.module.js', () => {
  const three = read('vendor/three/three.module.js');
  assert.equal(/^\s*export\b/m.test(three), true, 'fixture should start with module syntax');
  const stripped = stripThreeExports(three);
  assert.equal(/^\s*export\b/m.test(stripped), false);
  assert.equal(stripped.includes('class WebGLRenderer'), true);
});

test('addonOrder lists dependencies before the files that import them', () => {
  const order = addonOrder();
  const at = (name) => order.findIndex((entry) => entry.endsWith(name));
  assert.ok(at('Pass.js') < at('ShaderPass.js'));
  assert.ok(at('ShaderPass.js') < at('EffectComposer.js'));
  assert.ok(at('CopyShader.js') < at('EffectComposer.js'));
  assert.ok(at('LuminosityHighPassShader.js') < at('UnrealBloomPass.js'));
  assert.ok(at('OutputShader.js') < at('OutputPass.js'));
  assert.ok(at('MaskPass.js') < at('EffectComposer.js'));
});

test('moduleOrder puts the pure mapping before the runtime that consumes it', () => {
  assert.deepEqual(moduleOrder(), ['scene3d.mjs', 'runtime.mjs']);
});

test('bundleWebgl wraps an addon in an IIFE that exposes its exports', () => {
  const output = bundleWebgl({
    three: 'const REVISION = "169";\nexport { REVISION };\n',
    addons: [{ name: 'Thing.js', source: "import { REVISION } from 'three';\nclass Thing {}\nexport { Thing };\n" }],
    modules: [],
    entry: '',
  });
  assert.equal(output.includes('const { Thing } = (function () {'), true);
  assert.equal(output.includes('return { Thing };'), true);
  assert.equal(/^\s*import\b/m.test(output), false);
});

test('bundleWebgl output of the real world has no module syntax and parses', () => {
  const output = bundleWebgl({
    three: read('vendor/three/three.module.js'),
    addons: addonOrder().map((relative) => ({ name: relative, source: read(join('vendor', relative)) })),
    modules: moduleOrder().map((relative) => ({ name: `world/${relative}`, source: read(relative) })),
  });
  // No top-level module syntax survives: the bundle must be a plain script.
  assert.equal(/^\s*import\b/m.test(output), false, 'no top-level import lines');
  assert.equal(/^\s*export\b/m.test(output), false, 'no top-level export lines');
  // three.js is really in there, not just a stub.
  assert.equal(output.includes('class WebGLRenderer'), true);
  assert.equal(output.includes('const REVISION = '), true);
  // So are the addons and our own runtime.
  assert.equal(output.includes('const { OrbitControls } = (function () {'), true);
  assert.equal(output.includes('const { UnrealBloomPass } = (function () {'), true);
  assert.equal(output.includes('function world_mount('), true);
  assert.equal(output.includes('function buildWorld('), true);
  assert.equal(output.trimEnd().endsWith('})();'), true);
  // It is valid JavaScript.
  assert.doesNotThrow(() => new Function(output));
});

test('bundleWebgl is deterministic', () => {
  const input = {
    three: read('vendor/three/three.module.js'),
    addons: addonOrder().map((relative) => ({ name: relative, source: read(join('vendor', relative)) })),
    modules: moduleOrder().map((relative) => ({ name: `world/${relative}`, source: read(relative) })),
  };
  assert.equal(bundleWebgl(input), bundleWebgl(input));
});

test('the vendored three.js is the pinned MIT release', () => {
  const three = read('vendor/three/three.module.js');
  assert.equal(three.includes("const REVISION = '169'"), true);
  assert.equal(read('vendor/three/LICENSE').includes('The MIT License'), true);
  assert.equal(read('vendor/LICENSE-three.md').includes('three@0.169.0'), true);
});

test('a kit-fixture world page stays under budget, self-contained and has the fallback', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'diorama-world-budget-'));
  const input = join(worldDir, '..', 'kit', 'fixtures', 'three-tier.json');
  const out = join(dir, 'world.html');
  const result = await build({ input, out: join(dir, 'index.html'), webgl: true, webglOut: out });
  assert.equal(result.code, 0, result.message);
  const html = readFileSync(out, 'utf8');
  const bytes = statSync(out).size;
  assert.ok(bytes < 2_600_000, `world page is ${bytes} bytes, budget is 2.6 MB`);
  // Self-contained: nothing is fetched at runtime.
  assert.equal(/<script[^>]*\ssrc=/.test(html), false, 'no external scripts');
  assert.equal(/<link[^>]*rel=["']?stylesheet/.test(html), false, 'no external stylesheets');
  // The static SVG fallback is inlined and announced as a picture.
  assert.equal(html.includes('id="world-fallback"'), true, 'the fallback template is embedded');
  assert.ok(/<svg role="img" aria-label="/.test(html), 'the fallback SVG is labelled');
});
