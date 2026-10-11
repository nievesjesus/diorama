import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { validateScene } from '../kit/scene.mjs';
import {
  parseYaml,
  buildServices,
  computeTiers,
  layoutServices,
  longestDependsPath,
  colorForImage,
  composeToScene,
  parseArgs,
  usageText,
  titleForPath,
  run,
} from './from-compose.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures-compose');
const cli = join(here, 'from-compose.mjs');

function fixturePath(name) {
  return join(fixtures, name);
}

function fixtureText(name) {
  return readFileSync(fixturePath(name), 'utf8');
}

function sceneFor(name, options) {
  const services = buildServices(parseYaml(fixtureText(name)));
  assert.ok(services, `services parsed for ${name}`);
  return composeToScene(services, options);
}

test('parseArgs reads positional input and flags', () => {
  const options = parseArgs(['compose.yml', '--out', 'scene.json', '--theme', 'dark', '--title', 'Hi']);
  assert.equal(options.input, 'compose.yml');
  assert.equal(options.out, 'scene.json');
  assert.equal(options.theme, 'dark');
  assert.equal(options.title, 'Hi');
  assert.equal(options.help, false);
});

test('parseArgs defaults and rejects unknown flags', () => {
  assert.deepEqual(parseArgs([]), { input: null, out: null, theme: 'light', title: null, help: false });
  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
  assert.throws(() => parseArgs(['--out']), /requires a value/);
});

test('usageText documents the command', () => {
  const text = usageText();
  assert.ok(text.includes('Usage: node scripts/from-compose.mjs'));
  assert.ok(text.includes('no services found'));
});

test('titleForPath title-cases the parent directory', () => {
  assert.equal(titleForPath('/repo/examples/my-app/docker-compose.yml'), 'My App');
  assert.equal(titleForPath('compose.yml'), 'Diorama');
});

test('colorForImage maps image keywords deterministically', () => {
  assert.equal(colorForImage('postgres:16'), 'copper');
  assert.equal(colorForImage('mysql:8'), 'copper');
  assert.equal(colorForImage('redis:7'), 'amber');
  assert.equal(colorForImage('memcached'), 'amber');
  assert.equal(colorForImage('confluentinc/cp-kafka'), 'plum');
  assert.equal(colorForImage('zookeeper'), 'plum');
  assert.equal(colorForImage('nginx:1.27'), 'steel');
  assert.equal(colorForImage('traefik'), 'steel');
  assert.equal(colorForImage('minio/minio'), 'green');
  assert.equal(colorForImage('node:20'), 'blue');
  assert.equal(colorForImage(null), 'blue');
});

test('parseYaml handles maps, lists, inline lists, comments and quotes', () => {
  const parsed = parseYaml([
    'services:',
    '  web:',
    '    image: nginx # the proxy',
    '    ports: ["8080:80", "443:443"]',
    '    depends_on:',
    '      - db',
    '      - cache',
    '  db:',
    '    image: "postgres:16"',
  ].join('\n'));
  assert.equal(parsed.services.web.image, 'nginx');
  assert.deepEqual(parsed.services.web.ports, ['8080:80', '443:443']);
  assert.deepEqual(parsed.services.web.depends_on, ['db', 'cache']);
  assert.equal(parsed.services.db.image, 'postgres:16');
});

test('parseYaml accepts list items at the key indentation', () => {
  const parsed = parseYaml(['services:', '  web:', '    image: nginx', '    ports:', '    - "80:80"'].join('\n'));
  assert.deepEqual(parsed.services.web.ports, ['80:80']);
});

test('parseYaml tolerates junk lines inside a service', () => {
  const parsed = parseYaml(['services:', '  web:', '    image: nginx', '    junk line here', '    replica: 2'].join('\n'));
  const services = buildServices(parsed);
  assert.equal(services.web.image, 'nginx');
  assert.equal(services.web.replicas, 1);
});

test('fixture (a) builds a valid scene', () => {
  const scene = sceneFor('web-stack.yml', { title: 'Web Stack' });
  const result = validateScene(scene);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('fixture (a) derives tiers and centered positions', () => {
  const services = buildServices(parseYaml(fixtureText('web-stack.yml')));
  const tiers = computeTiers(services);
  assert.equal(tiers.web, 0);
  assert.equal(tiers.postgres, 0);
  assert.equal(tiers.redis, 0);
  assert.equal(tiers.api, 1);
  assert.equal(tiers.worker, 1);
  const positions = layoutServices(services, tiers);
  assert.deepEqual(positions.postgres, [-6.5, 0, 0]);
  assert.deepEqual(positions.redis, [-1.5, 0, 0]);
  assert.deepEqual(positions.web, [3.5, 0, 0]);
  assert.deepEqual(positions.api, [-4, 7, 0]);
  assert.deepEqual(positions.worker, [1, 7, 0]);
});

test('fixture (a) colors services by image and sums replicas', () => {
  const scene = sceneFor('web-stack.yml', { title: 'Web Stack' });
  const boxes = new Map(scene.parts.filter((part) => part.kind === 'box').map((part) => [part.id, part.color]));
  assert.equal(boxes.get('web'), 'steel');
  assert.equal(boxes.get('api'), 'blue');
  assert.equal(boxes.get('postgres'), 'copper');
  assert.equal(boxes.get('redis'), 'amber');
  assert.equal(boxes.get('worker'), 'blue');
  const replicas = scene.readout.find((entry) => entry.label === 'Replicas');
  assert.equal(replicas.value, '6');
  assert.equal(scene.readout[0].value, '5');
});

test('fixture (a) emits depends_on tubes, a network cable and the longest path flow', () => {
  const scene = sceneFor('web-stack.yml', { title: 'Web Stack' });
  const tubes = scene.links.filter((link) => link.kind === 'tube');
  const cables = scene.links.filter((link) => link.kind === 'cable');
  assert.equal(tubes.length, 3);
  assert.equal(cables.length, 1);
  assert.equal(cables[0].from, 'postgres');
  assert.equal(cables[0].to, 'redis');
  assert.deepEqual(scene.flows[0].path, ['api', 'web']);
  assert.equal(scene.flows[0].speed, 12);
  assert.equal(scene.flows[0].count, 3);
  const plate = scene.parts.find((part) => part.kind === 'plate');
  assert.equal(plate.color, 'sand');
  assert.equal(plate.size[2], 0.3);
  assert.equal(plate.at[2], -0.3);
});

test('fixture (b) builds a valid 3-tier chain with a 3-node flow', () => {
  const scene = sceneFor('kafka-pipeline.yml', { title: 'Kafka Pipeline' });
  assert.equal(validateScene(scene).ok, true);
  const tiers = new Map(scene.parts.filter((part) => part.kind === 'box').map((part) => [part.id, part.at[1]]));
  assert.equal(tiers.get('zookeeper'), 0);
  assert.equal(tiers.get('broker'), 7);
  assert.equal(tiers.get('connect'), 14);
  assert.deepEqual(scene.flows[0].path, ['connect', 'broker', 'zookeeper']);
  const colors = scene.parts.filter((part) => part.kind === 'box').map((part) => part.color);
  assert.deepEqual(colors, ['plum', 'plum', 'plum']);
});

test('longestDependsPath breaks and picks deterministically', () => {
  const services = {
    a: { name: 'a', dependsOn: ['b'], replicas: 1, networks: [], image: null, ports: [] },
    b: { name: 'b', dependsOn: [], replicas: 1, networks: [], image: null, ports: [] },
    c: { name: 'c', dependsOn: ['b'], replicas: 1, networks: [], image: null, ports: [] },
  };
  const tiers = computeTiers(services);
  assert.deepEqual(longestDependsPath(services, tiers), ['a', 'b']);
});

test('order tie-breaks by code unit, not locale collation', () => {
  const services = {
    Zeta: { name: 'Zeta', dependsOn: [], replicas: 1, networks: [], image: null, ports: [] },
    alpha: { name: 'alpha', dependsOn: [], replicas: 1, networks: [], image: null, ports: [] },
  };
  const tiers = computeTiers(services);
  assert.deepEqual(longestDependsPath(services, tiers), ['Zeta']);
  const first = composeToScene(services, { title: 'Order' });
  const second = composeToScene(services, { title: 'Order' });
  assert.deepEqual(first.flows[0].path, ['Zeta', 'alpha']);
  assert.deepEqual(second.flows[0].path, ['Zeta', 'alpha']);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('deterministic output: two runs are byte identical', () => {
  const first = JSON.stringify(sceneFor('web-stack.yml', { title: 'Web Stack' }), null, 2);
  const second = JSON.stringify(sceneFor('web-stack.yml', { title: 'Web Stack' }), null, 2);
  assert.equal(first, second);
});

test('cli: valid fixture writes a scene file and exits 0', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'diorama-compose-'));
  const outPath = join(outDir, 'scene.json');
  const result = spawnSync(process.execPath, [cli, fixturePath('web-stack.yml'), '--title', 'Web Stack', '--out', outPath], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('wrote'));
  const scene = JSON.parse(readFileSync(outPath, 'utf8'));
  assert.equal(validateScene(scene).ok, true);
  assert.equal(scene.title, 'Web Stack');
});

test('cli: --out - streams the scene to stdout', () => {
  const result = spawnSync(process.execPath, [cli, fixturePath('kafka-pipeline.yml'), '--out', '-'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const scene = JSON.parse(result.stdout);
  assert.equal(scene.version, 1);
  assert.equal(scene.theme, 'light');
});

test('cli: bad indentation exits 1 with a line number', () => {
  const result = spawnSync(process.execPath, [cli, fixturePath('bad-indent.yml'), '--out', '-'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid YAML/);
  assert.match(result.stderr, /line 4/);
});

test('cli: unreadable input exits 1 with a clear message', () => {
  const result = spawnSync(process.execPath, [cli, join(fixtures, 'missing.yml')], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot read/);
});

test('cli: --help prints usage and exits 0', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('Usage: node scripts/from-compose.mjs'));
});

test('run reports no services for an empty compose', () => {
  const dir = mkdtempSync(join(tmpdir(), 'diorama-empty-'));
  const path = join(dir, 'compose.yml');
  writeFileSync(path, 'version: "3"\n');
  let captured = '';
  const code = run([path], { stdout: { write: () => {} }, stderr: { write: (text) => { captured += text; } } });
  assert.equal(code, 1);
  assert.match(captured, /no services found/);
});

test('integration: build.mjs renders the generated scene', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'diorama-build-'));
  const scenePath = join(outDir, 'scene.json');
  const htmlPath = join(outDir, 'out.html');
  const generated = spawnSync(process.execPath, [cli, fixturePath('web-stack.yml'), '--title', 'Web Stack', '--out', scenePath], { encoding: 'utf8' });
  assert.equal(generated.status, 0);
  const build = spawnSync(process.execPath, [join(here, '..', 'build.mjs'), scenePath, '-o', htmlPath], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const html = readFileSync(htmlPath, 'utf8');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('Web Stack'));
});
