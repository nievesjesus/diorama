import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { addonOrder, bundleWebgl, moduleOrder } from './world/bundle.mjs';

const RELATIVE_IMPORT = /^\s*import\s.+from\s+['"]\.\/.+['"];?\s*$/;
const RELATIVE_REEXPORT = /^\s*export\s+.*\s+from\s+['"]\.\/.+['"];?\s*$/;
const RELATIVE_SIDE_EFFECT = /^\s*import\s+['"]\.\/.+['"];?\s*$/;

export function defaultKitDir() {
  return join(dirname(fileURLToPath(import.meta.url)), 'kit');
}

export function usageText() {
  return [
    'Usage: node build.mjs <scene.json> [-o out.html] [--theme light|dark] [--svg out.svg] [--webgl] [--audit] [--title-override str]',
    '',
    'Build a standalone, dependency-free HTML diorama from a scene JSON file.',
    'The emitted HTML inlines the iso/scene/motion runtime and works from file://',
    'with a double-click. No network access and no npm install required.',
    '',
    'Options:',
    '  -o, --out <file>        Output HTML path (default: <scene dir>/index.html)',
    '      --theme <name>      Force light or dark theme (overrides the scene)',
    '      --svg <file>        Also write a standalone static SVG (no runtime)',
    '      --webgl             Also write a three.js world page (default:',
    '                          <scene dir>/world.html)',
    '      --webgl-out <file>  Output path for the world page',
    '      --audit             Run kit/audit.mjs and fail on violations',
    '      --title-override <s> Override the scene title in the output',
    '  -h, --help              Show this help and exit',
    '',
    'Exit codes:',
    '  0  success',
    '  1  scene validation or audit failure',
    '  2  usage error, or kit not ready (kit/iso.mjs, kit/iso.css,',
    '     kit/scene.mjs or kit/motion.mjs is missing), or the world assets',
    '     under world/ are missing while --webgl is set',
    '',
  ].join('\n');
}

export function parseArgs(argv) {
  const options = {
    input: null,
    out: null,
    theme: null,
    svg: null,
    webgl: false,
    webglOut: null,
    audit: false,
    titleOverride: null,
    help: false,
  };
  const args = [...argv];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '-o' || arg === '--out') {
      options.out = args[index + 1];
      index += 1;
    } else if (arg === '--theme') {
      options.theme = args[index + 1];
      index += 1;
    } else if (arg === '--svg') {
      options.svg = args[index + 1];
      index += 1;
    } else if (arg === '--webgl') {
      options.webgl = true;
    } else if (arg === '--webgl-out') {
      options.webglOut = args[index + 1];
      options.webgl = true;
      index += 1;
    } else if (arg === '--audit') {
      options.audit = true;
    } else if (arg === '--title-override') {
      options.titleOverride = args[index + 1];
      index += 1;
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.input) {
      options.input = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return options;
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const ordered = {};
    for (const key of Object.keys(value).sort()) ordered[key] = sortKeysDeep(value[key]);
    return ordered;
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(sortKeysDeep(value));
}

export function escapeText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeAttribute(text) {
  return escapeText(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isStrippedLine(line) {
  return RELATIVE_IMPORT.test(line) || RELATIVE_REEXPORT.test(line) || RELATIVE_SIDE_EFFECT.test(line);
}

export function stripKitImports(source) {
  return source
    .split('\n')
    .filter((line) => !isStrippedLine(line))
    .join('\n');
}

export function bundleModules({ isoSource, sceneSource, motionSource }) {
  const parts = [isoSource, sceneSource, motionSource].map(stripKitImports);
  return `${parts.join('\n')}\nmount();\n`;
}

export function renderReadout(readout) {
  const entries = Array.isArray(readout) ? readout : [];
  const items = entries
    .map(
      (entry) =>
        `<div class="readout-item"><span class="readout-label">${escapeText(entry.label)}</span><span class="readout-value">${escapeText(entry.value)}</span></div>`,
    )
    .join('');
  return `<div class="readout">${items}</div>`;
}

export function prettySvg(svg) {
  const text = String(svg).trim();
  return `${text.replace(/></g, '>\n<')}\n`;
}

export function renderHtml({ scene, svg, css, runtime }) {
  const theme = scene.theme === 'dark' ? 'dark' : 'light';
  const title = escapeText(scene.title ?? '');
  const subtitle = escapeText(scene.subtitle ?? '');
  const hint = escapeText(scene.hint ?? '');
  const dataScene = escapeAttribute(stableStringify(scene));
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    '<style>',
    css,
    '</style>',
    '</head>',
    `<body class="theme-${theme}">`,
    `<div class="world" data-scene="${dataScene}">`,
    `<div class="stage">${svg}</div>`,
    '<div class="hud">',
    '<div class="hud-title">',
    `<h1>${title}</h1>`,
    `<p class="subtitle">${subtitle}</p>`,
    '</div>',
    renderReadout(scene.readout),
    `<p class="hint">${hint}</p>`,
    '<div class="wordmark">diorama</div>',
    '<span class="corner tl"></span>',
    '<span class="corner tr"></span>',
    '<span class="corner bl"></span>',
    '<span class="corner br"></span>',
    '</div>',
    '</div>',
    '<script type="module">',
    runtime,
    '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function kitFilePaths(kitDir) {
  return {
    iso: join(kitDir, 'iso.mjs'),
    css: join(kitDir, 'iso.css'),
    scene: join(kitDir, 'scene.mjs'),
    motion: join(kitDir, 'motion.mjs'),
  };
}

export function missingKitFiles(kitDir, exists = existsSync) {
  return Object.values(kitFilePaths(kitDir)).filter((path) => !exists(path));
}

export function defaultWorldDir() {
  return join(dirname(fileURLToPath(import.meta.url)), 'world');
}

export function worldFilePaths(worldDir) {
  const paths = {
    three: join(worldDir, 'vendor', 'three', 'three.module.js'),
    css: join(worldDir, 'world.css'),
  };
  for (const relative of addonOrder()) paths[relative] = join(worldDir, 'vendor', relative);
  for (const relative of moduleOrder()) paths[relative] = join(worldDir, relative);
  return paths;
}

export function missingWorldFiles(worldDir, exists = existsSync) {
  return Object.values(worldFilePaths(worldDir)).filter((path) => !exists(path));
}

/** Read world/ off disk and produce the single inlined <script> body. */
export function worldRuntime(worldDir, read = readFileSync) {
  return bundleWebgl({
    three: read(join(worldDir, 'vendor', 'three', 'three.module.js'), 'utf8'),
    addons: addonOrder().map((relative) => ({
      name: relative,
      source: read(join(worldDir, 'vendor', relative), 'utf8'),
    })),
    modules: moduleOrder().map((relative) => ({
      name: `world/${relative}`,
      source: read(join(worldDir, relative), 'utf8'),
    })),
  });
}

/** JSON inlined in a <script type="application/json"> must not close the tag. */
export function escapeJsonScript(value) {
  return stableStringify(value).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, (char) =>
    char === '\u2028' ? '\\u2028' : '\\u2029');
}

export function renderWorldHtml({ scene, css, runtime }) {
  const theme = scene.theme === 'dark' ? 'dark' : 'light';
  const title = escapeText(scene.title ?? '');
  const subtitle = escapeText(scene.subtitle ?? '');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    '<style>',
    css,
    '</style>',
    '</head>',
    `<body class="theme-${theme} world-page">`,
    '<div class="world">',
    '<div class="stage"></div>',
    '<div class="hud">',
    '<div class="hud-title">',
    `<h1>${title}</h1>`,
    `<p class="subtitle">${subtitle}</p>`,
    '</div>',
    renderReadout(scene.readout),
    '<p class="hint"></p>',
    '<div class="wordmark">diorama</div>',
    '<span class="corner tl"></span>',
    '<span class="corner tr"></span>',
    '<span class="corner bl"></span>',
    '<span class="corner br"></span>',
    '</div>',
    '</div>',
    `<script type="application/json" id="world-scene">${escapeJsonScript(scene)}</script>`,
    '<script type="module">',
    runtime,
    '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function auditViolations(auditModule, scene) {
  const audit = auditModule.audit ?? auditModule.default;
  if (typeof audit !== 'function') throw new Error('kit/audit.mjs does not export an audit function');
  const result = audit(scene);
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.violations)) return result.violations;
  return [];
}

export function formatViolation(violation) {
  if (typeof violation === 'string') return `- ${violation}`;
  if (violation && typeof violation === 'object') {
    const where = violation.path ?? violation.part ?? violation.id ?? '';
    const message = violation.message ?? violation.msg ?? JSON.stringify(violation);
    return where ? `- ${where}: ${message}` : `- ${message}`;
  }
  return `- ${String(violation)}`;
}

async function importFrom(kitDir, name) {
  return import(pathToFileURL(join(kitDir, name)).href);
}

async function loadScene(sceneModule, input) {
  if (typeof sceneModule.loadScene === 'function') return sceneModule.loadScene(input);
  const raw = JSON.parse(readFileSync(input, 'utf8'));
  if (typeof sceneModule.validateScene === 'function') {
    const result = sceneModule.validateScene(raw);
    if (result && result.ok === false) throw new Error((result.errors ?? []).join('; '));
    if (Array.isArray(result) && result.length) throw new Error(result.join('; '));
  }
  return raw;
}

export async function build(options, env = process.env) {
  if (!options.input) return { code: 2, message: 'missing <scene.json> input path\n\n' + usageText() };
  const kitDir = options.kitDir ?? env.DIORAMA_KIT_DIR ?? defaultKitDir();
  const missing = missingKitFiles(kitDir);
  if (missing.length) {
    return {
      code: 2,
      message: `kit not ready: missing ${missing.join(', ')}. See --help.`,
    };
  }

  const worldDir = options.worldDir ?? env.DIORAMA_WORLD_DIR ?? defaultWorldDir();
  if (options.webgl) {
    const missingWorld = missingWorldFiles(worldDir);
    if (missingWorld.length) {
      return { code: 2, message: `world not ready: missing ${missingWorld.join(', ')}. See --help.` };
    }
  }

  let scene;
  try {
    scene = await loadScene(await importFrom(kitDir, 'scene.mjs'), options.input);
  } catch (error) {
    return { code: 1, message: `scene error: ${error.message}` };
  }

  if (options.titleOverride != null) scene.title = options.titleOverride;
  scene.theme = (options.theme ?? scene.theme) === 'dark' ? 'dark' : 'light';

  if (options.audit) {
    try {
      const violations = auditViolations(await importFrom(kitDir, 'audit.mjs'), scene);
      if (violations.length) {
        return { code: 1, message: `audit failed:\n${violations.map(formatViolation).join('\n')}` };
      }
    } catch (error) {
      return { code: 1, message: `audit error: ${error.message}` };
    }
  }

  let svg;
  try {
    const isoModule = await importFrom(kitDir, 'iso.mjs');
    svg = isoModule.renderSVG(scene);
  } catch (error) {
    return { code: 1, message: `render error: ${error.message}` };
  }

  const outputs = [];
  if (options.svg) {
    writeFileSync(options.svg, prettySvg(svg));
    outputs.push(options.svg);
  }

  const outPath = options.out ? options.out : join(dirname(resolve(options.input)), 'index.html');
  const css = readFileSync(join(kitDir, 'iso.css'), 'utf8');
  const runtime = bundleModules({
    isoSource: readFileSync(join(kitDir, 'iso.mjs'), 'utf8'),
    sceneSource: readFileSync(join(kitDir, 'scene.mjs'), 'utf8'),
    motionSource: readFileSync(join(kitDir, 'motion.mjs'), 'utf8'),
  });
  const html = renderHtml({ scene, svg, css, runtime });
  writeFileSync(outPath, html);
  outputs.push(outPath);

  if (options.webgl) {
    const worldOut = options.webglOut
      ? options.webglOut
      : join(dirname(resolve(options.input)), 'world.html');
    const worldHtml = renderWorldHtml({
      scene,
      css: `${css}\n${readFileSync(join(worldDir, 'world.css'), 'utf8')}`,
      runtime: worldRuntime(worldDir),
    });
    writeFileSync(worldOut, worldHtml);
    outputs.push(worldOut);
  }

  return { code: 0, outputs, scene };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usageText()}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(usageText());
    return;
  }
  const result = await build(options);
  if (result.code !== 0) {
    process.stderr.write(`${result.message}\n`);
    process.exitCode = result.code;
    return;
  }
  for (const path of result.outputs) process.stdout.write(`wrote ${path}\n`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
