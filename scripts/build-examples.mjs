import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from '../build.mjs';

export function listExampleScenes(examplesDir, { readdir = readdirSync, exists = existsSync } = {}) {
  if (!exists(examplesDir)) return [];
  let entries;
  try {
    entries = readdir(examplesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(examplesDir, entry.name))
    .filter((dir) => exists(join(dir, 'scene.json')))
    .sort();
}

export function usageText() {
  return [
    'Usage: node scripts/build-examples.mjs [--svg] [--webgl] [--audit] [--theme light|dark]',
    '',
    'Build every examples/<name>/scene.json into examples/<name>/index.html.',
    'With --svg, also write examples/<name>/index.svg; with --webgl, also write',
    'examples/<name>/world.html (the three.js page). Skips gracefully when no',
    'examples are present and exits 0.',
    '',
  ].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usageText());
    return;
  }
  const withSvg = args.includes('--svg');
  const withWebgl = args.includes('--webgl');
  const audit = args.includes('--audit');
  const themeIndex = args.indexOf('--theme');
  const theme = themeIndex >= 0 ? args[themeIndex + 1] : null;

  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const examplesDir = join(root, 'examples');
  const scenes = listExampleScenes(examplesDir);

  if (!scenes.length) {
    process.stdout.write(`no examples found in ${examplesDir}\n`);
    return;
  }

  let failures = 0;
  for (const dir of scenes) {
    const input = join(dir, 'scene.json');
    const out = join(dir, 'index.html');
    const svg = withSvg ? join(dir, 'index.svg') : null;
    const result = await build({ input, out, svg, theme, audit, webgl: withWebgl });
    if (result.code !== 0) {
      process.stderr.write(`${dir}: ${result.message}\n`);
      failures += 1;
    } else {
      process.stdout.write(`built ${result.outputs.join(' and ')}\n`);
    }
  }
  if (failures) process.exitCode = 1;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
