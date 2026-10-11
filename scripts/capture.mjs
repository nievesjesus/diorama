import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';

export function usageText() {
  return [
    'Usage: node scripts/capture.mjs <file-or-url> <out.png> [--t 2.5] [--w 1280] [--h 960] [--zoom 2] [--budget 10000]',
    '',
    'Render a diorama page to a deterministic PNG using headless Chrome.',
    'A file path is converted to a file:// URL; http(s) and file URLs pass through.',
    '--t freezes the runtime at that many seconds (appended as ?t=<value>).',
    '--w/--h set the CSS viewport (window-size is always W,H).',
    '--zoom sets the device scale factor, so the PNG is W*zoom x H*zoom',
    'with the same CSS layout as a 1x run (default 2 for Retina-sharp shots).',
    '--budget sets the virtual time budget in milliseconds (default 10000),',
    'long enough for WebGL pages to paint before the compositor commits.',
    '',
    'Chrome discovery order: $CHROME_PATH, then the platform install paths,',
    'then the Playwright browser cache.',
    '',
    'Exit codes:',
    '  0  success',
    '  1  capture failed',
    '  2  usage error',
    '  3  no Chrome/Chromium binary found',
    '',
  ].join('\n');
}

export function parseArgs(argv) {
  const options = { input: null, out: null, t: null, width: 1280, height: 960, zoom: 2, budget: 10000, help: false };
  const args = [...argv];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--t') {
      options.t = args[index + 1];
      index += 1;
    } else if (arg === '--w') {
      options.width = Number(args[index + 1]);
      index += 1;
    } else if (arg === '--h') {
      options.height = Number(args[index + 1]);
      index += 1;
    } else if (arg === '--zoom') {
      options.zoom = Number(args[index + 1]);
      index += 1;
    } else if (arg === '--budget') {
      options.budget = Number(args[index + 1]);
      index += 1;
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.input) {
      options.input = arg;
    } else if (!options.out) {
      options.out = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return options;
}

export function chromePathCandidates({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  const candidates = [];
  if (env.CHROME_PATH) candidates.push(env.CHROME_PATH);
  if (platform === 'darwin') {
    const apps = ['Google Chrome', 'Google Chrome Canary', 'Chromium', 'Microsoft Edge'];
    for (const app of apps) {
      candidates.push(`/Applications/${app}.app/Contents/MacOS/${app}`);
      candidates.push(join(home, `Applications/${app}.app/Contents/MacOS/${app}`));
    }
  } else if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    const relatives = [
      'Google/Chrome/Application/chrome.exe',
      'Chromium/Application/chrome.exe',
      'Microsoft/Edge/Application/msedge.exe',
    ];
    for (const root of roots) for (const relative of relatives) candidates.push(join(root, relative));
  } else {
    const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
    const dirs = (env.PATH || '').split(delimiter).filter(Boolean);
    for (const dir of dirs) for (const name of names) candidates.push(join(dir, name));
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/snap/bin/chromium');
  }
  return candidates;
}

function safeReaddir(dir, readdir) {
  try {
    return readdir(dir);
  } catch {
    return [];
  }
}

export function playwrightChromiumCandidates({ platform = process.platform, env = process.env, home = homedir() } = {}, readdir = readdirSync) {
  let cache;
  if (platform === 'darwin') cache = join(home, 'Library/Caches/ms-playwright');
  else if (platform === 'win32') cache = join(env.LOCALAPPDATA || '', 'ms-playwright');
  else cache = join(home, '.cache/ms-playwright');

  const candidates = [];
  const entries = safeReaddir(cache, readdir)
    .filter((name) => String(name).startsWith('chromium'))
    .sort();
  for (const entry of entries) {
    const dir = join(cache, entry);
    const inner = safeReaddir(dir, readdir).map(String);
    if (platform === 'darwin') {
      for (const sub of inner.filter((name) => name.startsWith('chrome-mac'))) {
        candidates.push(join(dir, sub, 'Chromium.app/Contents/MacOS/Chromium'));
        candidates.push(join(dir, sub, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
      }
    } else if (platform === 'win32') {
      for (const sub of inner.filter((name) => name.startsWith('chrome-win'))) {
        candidates.push(join(dir, sub, 'chrome.exe'));
      }
    } else {
      for (const sub of inner.filter((name) => name.startsWith('chrome-linux'))) {
        candidates.push(join(dir, sub, 'chrome'));
      }
    }
  }
  return candidates;
}

export function findChrome(options = {}) {
  const { exists = existsSync, readdir = readdirSync } = options;
  for (const candidate of chromePathCandidates(options)) {
    if (exists(candidate)) return candidate;
  }
  for (const candidate of playwrightChromiumCandidates(options, readdir)) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function pageUrl(input, t) {
  let base;
  const windowsPath = /^[a-zA-Z]:[\\/]/.test(input);
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(input);
  if (windowsPath) base = pathToFileURL(input).href;
  else if (hasScheme) base = input;
  else base = pathToFileURL(resolve(input)).href;
  if (t === null || t === undefined || t === '') return base;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}t=${encodeURIComponent(String(t))}`;
}

export function chromeArgs({ url, out, width = 1280, height = 960, zoom = 2, budget = 10000 }) {
  return [
    '--headless=new',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    `--window-size=${Math.round(width)},${Math.round(height)}`,
    `--force-device-scale-factor=${zoom}`,
    `--screenshot=${out}`,
    `--virtual-time-budget=${budget}`,
    '--default-background-color=ffffffff',
    url,
  ];
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
  if (!options.input || !options.out) {
    process.stderr.write(usageText());
    process.exitCode = 2;
    return;
  }

  const chrome = findChrome();
  if (!chrome) {
    process.stderr.write(
      'no Chrome/Chromium binary found. Set CHROME_PATH to a Chrome or Chromium executable, or install Google Chrome.\n',
    );
    process.exitCode = 3;
    return;
  }

  const outPath = resolve(options.out);
  const url = pageUrl(options.input, options.t);
  process.stdout.write(`chrome: ${chrome}\n`);
  process.stdout.write(`url: ${url}\n`);

  const result = spawnSync(
    chrome,
    chromeArgs({ url, out: outPath, width: options.width, height: options.height, zoom: options.zoom, budget: options.budget }),
    { stdio: 'inherit' },
  );
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exitCode = 1;
    return;
  }

  let size;
  try {
    size = statSync(outPath).size;
  } catch {
    process.stderr.write(`screenshot was not produced at ${outPath}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`wrote ${outPath} (${size} bytes)\n`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
