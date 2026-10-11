import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  parseArgs,
  usageText,
  stableStringify,
  escapeText,
  escapeAttribute,
  stripKitImports,
  bundleModules,
  defaultWorldDir,
  worldFilePaths,
  missingWorldFiles,
  escapeJsonScript,
  renderWorldHtml,
  renderReadout,
  renderHtml,
  kitFilePaths,
  missingKitFiles,
  auditViolations,
  formatViolation,
  build,
} from '../build.mjs';

test('parseArgs reads positional input and flags', () => {
  const options = parseArgs(['scene.json', '-o', 'out.html', '--theme', 'dark', '--svg', 'out.svg', '--audit', '--title-override', 'Hi']);
  assert.equal(options.input, 'scene.json');
  assert.equal(options.out, 'out.html');
  assert.equal(options.theme, 'dark');
  assert.equal(options.svg, 'out.svg');
  assert.equal(options.audit, true);
  assert.equal(options.titleOverride, 'Hi');
  assert.equal(options.help, false);
});

test('parseArgs defaults', () => {
  const options = parseArgs([]);
  assert.deepEqual(options, {
    input: null,
    out: null,
    theme: null,
    svg: null,
    webgl: false,
    webglOut: null,
    audit: false,
    titleOverride: null,
    help: false,
  });
});

test('parseArgs rejects unknown options', () => {
  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
  assert.throws(() => parseArgs(['a.json', 'b.json']), /Unexpected argument/);
});

test('stableStringify sorts keys recursively and preserves arrays', () => {
  const value = { b: 1, a: { d: 2, c: 3 }, list: [{ z: 1, y: 2 }] };
  assert.equal(stableStringify(value), '{"a":{"c":3,"d":2},"b":1,"list":[{"y":2,"z":1}]}');
});

test('escaping helpers escape markup', () => {
  assert.equal(escapeText('a<b>&"c"'), 'a&lt;b&gt;&amp;"c"');
  assert.equal(escapeAttribute('a<b>&"c"\'d'), 'a&lt;b&gt;&amp;&quot;c&quot;&#39;d');
});

test('stripKitImports removes relative module lines and keeps the rest', () => {
  const source = [
    "import { project } from './iso.mjs';",
    "export { thing } from './scene.mjs';",
    "import './side.mjs';",
    "import { readFileSync } from 'node:fs';",
    'export function foo() {',
    '  return 1;',
    '}',
  ].join('\n');
  const stripped = stripKitImports(source);
  assert.ok(!stripped.includes('./iso.mjs'));
  assert.ok(!stripped.includes('./scene.mjs'));
  assert.ok(!stripped.includes('./side.mjs'));
  assert.ok(stripped.includes("from 'node:fs'"));
  assert.ok(stripped.includes('export function foo()'));
});

test('bundleModules concatenates iso, scene, motion then mounts', () => {
  const runtime = bundleModules({
    isoSource: 'export const isoMark = 1;',
    sceneSource: 'export const sceneMark = 2;',
    motionSource: 'export function mount() {}',
  });
  assert.ok(runtime.indexOf('isoMark') < runtime.indexOf('sceneMark'));
  assert.ok(runtime.indexOf('sceneMark') < runtime.indexOf('mount() {}'));
  assert.ok(runtime.trimEnd().endsWith('mount();'));
});

test('renderReadout emits the contracted item structure', () => {
  assert.equal(
    renderReadout([{ label: 'QPS', value: '42' }]),
    '<div class="readout"><div class="readout-item"><span class="readout-label">QPS</span><span class="readout-value">42</span></div></div>',
  );
  assert.equal(renderReadout([]), '<div class="readout"></div>');
});

test('renderHtml emits the standalone page skeleton', () => {
  const html = renderHtml({
    scene: { title: 'T<x>', subtitle: 'Sub', theme: 'dark', readout: [{ label: 'L', value: 'V' }], hint: 'H' },
    svg: '<svg></svg>',
    css: 'body{color:red}',
    runtime: 'mount();',
  });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<body class="theme-dark">'));
  assert.ok(html.includes('<div class="world" data-scene="'));
  assert.ok(!html.includes('class="card"'), 'card chrome is gone');
  assert.ok(html.includes('<div class="stage"><svg></svg></div>'));
  assert.ok(html.includes('<div class="hud">'));
  assert.ok(html.includes('<div class="hud-title">'));
  assert.ok(html.includes('<h1>T&lt;x&gt;</h1>'));
  assert.ok(html.includes('<p class="subtitle">Sub</p>'));
  assert.ok(html.includes('<div class="readout"><div class="readout-item">'));
  assert.ok(html.includes('<p class="hint">H</p>'));
  assert.ok(html.includes('<div class="wordmark">diorama</div>'));
  for (const corner of ['tl', 'tr', 'bl', 'br']) assert.ok(html.includes(`class="corner ${corner}"`));
  assert.ok(html.includes('<script type="module">'));
  assert.ok(html.includes('mount();'));
  assert.ok(html.endsWith('\n'));
});

test('renderHtml escapes the embedded scene JSON', () => {
  const html = renderHtml({
    scene: { title: 'x"y', subtitle: '', theme: 'light', readout: [] },
    svg: '<svg></svg>',
    css: '',
    runtime: '',
  });
  assert.ok(html.includes('&quot;y'));
  assert.ok(!html.includes('data-scene="{"'));
});

test('kitFilePaths and missingKitFiles describe the kit manifest', () => {
  const paths = kitFilePaths('/kit');
  assert.equal(paths.iso, '/kit/iso.mjs');
  assert.equal(paths.css, '/kit/iso.css');
  assert.equal(paths.scene, '/kit/scene.mjs');
  assert.equal(paths.motion, '/kit/motion.mjs');
  assert.equal(missingKitFiles('/kit', () => true).length, 0);
  assert.equal(missingKitFiles('/kit', () => false).length, 4);
});

test('auditViolations normalizes the audit return shape', () => {
  assert.deepEqual(auditViolations({ audit: () => ['a'] }, {}), ['a']);
  assert.deepEqual(auditViolations({ default: () => ({ violations: ['b'] }) }, {}), ['b']);
  assert.deepEqual(auditViolations({ audit: () => undefined }, {}), []);
});

test('formatViolation renders strings and objects', () => {
  assert.equal(formatViolation('boom'), '- boom');
  assert.equal(formatViolation({ part: 'p1', message: 'bad' }), '- p1: bad');
  assert.equal(formatViolation({ message: 'bad' }), '- bad');
});

test('usageText documents usage and exit codes', () => {
  const text = usageText();
  assert.ok(text.includes('Usage: node build.mjs'));
  assert.ok(text.includes('kit not ready'));
});

test('build rejects a missing input with usage error', async () => {
  const result = await build({});
  assert.equal(result.code, 2);
  assert.ok(result.message.includes('missing <scene.json>'));
});

test('build reports kit not ready when the kit is absent', async () => {
  const result = await build({ input: 'scene.json', kitDir: '/definitely/not/here' });
  assert.equal(result.code, 2);
  assert.ok(result.message.startsWith('kit not ready:'));
});

const buildPath = fileURLToPath(new URL('../build.mjs', import.meta.url));

test('cli: --help prints usage and exits 0', () => {
  const result = spawnSync(process.execPath, [buildPath, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('Usage: node build.mjs'));
});

test('cli: missing kit exits 2 with a clear message', () => {
  const sceneDir = mkdtempSync(join(tmpdir(), 'diorama-scene-'));
  const emptyKit = mkdtempSync(join(tmpdir(), 'diorama-kit-'));
  const scenePath = join(sceneDir, 'scene.json');
  writeFileSync(scenePath, '{"version":1,"title":"t","theme":"light","parts":[]}');
  const result = spawnSync(process.execPath, [buildPath, scenePath], {
    encoding: 'utf8',
    env: { ...process.env, DIORAMA_KIT_DIR: emptyKit },
  });
  assert.equal(result.status, 2);
  assert.ok(result.stderr.includes('kit not ready'));
});

test('parseArgs reads the webgl flags', () => {
  assert.equal(parseArgs(['scene.json', '--webgl']).webgl, true);
  const explicit = parseArgs(['scene.json', '--webgl-out', 'world.html']);
  assert.equal(explicit.webgl, true, '--webgl-out implies --webgl');
  assert.equal(explicit.webglOut, 'world.html');
  assert.equal(parseArgs(['scene.json']).webgl, false);
});

test('usageText documents the webgl output', () => {
  const text = usageText();
  assert.ok(text.includes('--webgl'));
  assert.ok(text.includes('world.html'));
});

test('worldFilePaths covers three, the addons, the runtime and the css', () => {
  const paths = worldFilePaths('/world');
  const values = Object.values(paths);
  assert.ok(values.some((path) => path.endsWith('three.module.js')));
  assert.ok(values.some((path) => path.endsWith('OrbitControls.js')));
  assert.ok(values.some((path) => path.endsWith('UnrealBloomPass.js')));
  assert.ok(values.some((path) => path.endsWith('scene3d.mjs')));
  assert.ok(values.some((path) => path.endsWith('runtime.mjs')));
  assert.ok(values.some((path) => path.endsWith('world.css')));
});

test('missingWorldFiles reports every absent asset', () => {
  assert.deepEqual(missingWorldFiles(defaultWorldDir()), [], 'the repo ships a complete world/');
  const missing = missingWorldFiles('/nowhere', () => false);
  assert.equal(missing.length, Object.keys(worldFilePaths('/nowhere')).length);
});

test('escapeJsonScript neutralises a closing script tag', () => {
  const escaped = escapeJsonScript({ note: '</script><img onerror=1>' });
  assert.equal(escaped.includes('</script>'), false);
  assert.equal(escaped.includes('\\u003c/script>'), true);
  assert.deepEqual(JSON.parse(escaped), { note: '</script><img onerror=1>' });
});

test('renderWorldHtml inlines the scene JSON, the css and the bundle', () => {
  const html = renderWorldHtml({
    scene: { title: 'T', subtitle: 'S', theme: 'dark', readout: [{ label: 'a', value: 'b' }] },
    css: '.x{}',
    runtime: 'world_mount();',
  });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('class="theme-dark world-page"'));
  assert.ok(html.includes('<div class="stage"></div>'));
  assert.ok(html.includes('<script type="application/json" id="world-scene">'));
  assert.ok(html.includes('world_mount();'));
  assert.ok(html.includes('.x{}'));
  // The HUD markup is shared with the SVG page.
  assert.ok(html.includes('class="readout-label"'));
  assert.ok(html.includes('<div class="wordmark">diorama</div>'));
});

test('build --webgl writes a self-contained world page next to the scene', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'diorama-world-'));
  const input = join(dir, 'scene.json');
  writeFileSync(input, JSON.stringify({
    version: 1,
    title: 'World build',
    theme: 'light',
    parts: [
      { id: 'ground', kind: 'plate', at: [0, 0, 0], size: [12, 12, 0.3], color: 'slate', detail: 'concrete' },
      { id: 'a', kind: 'box', at: [2, 2, 0.3], size: [2, 2, 2], color: 'blue', label: 'A' },
      { id: 'b', kind: 'box', at: [7, 7, 0.3], size: [2, 2, 2], color: 'green' },
    ],
    links: [{ from: 'a', to: 'b', kind: 'tube', color: 'blue' }],
  }));
  const result = await build({ input, webgl: true });
  assert.equal(result.code, 0);
  const worldPath = join(dir, 'world.html');
  assert.ok(result.outputs.includes(worldPath));
  const html = readFileSync(worldPath, 'utf8');
  assert.ok(html.includes('class WebGLRenderer'), 'three.js is inlined');
  assert.ok(html.includes('function world_mount('), 'the runtime is inlined');
  assert.ok(html.includes('"title":"World build"'), 'the scene is inlined');
  // Self-contained: nothing is fetched at runtime.
  assert.equal(/<script[^>]*\ssrc=/.test(html), false);
  assert.equal(/<link[^>]*rel="stylesheet"/.test(html), false);
});

test('build --webgl reports a missing world directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'diorama-world-missing-'));
  const input = join(dir, 'scene.json');
  writeFileSync(input, JSON.stringify({ version: 1, title: 'x', theme: 'light', parts: [] }));
  const result = await build({ input, webgl: true, worldDir: join(dir, 'nope') });
  assert.equal(result.code, 2);
  assert.match(result.message, /world not ready/);
});
