import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  parseArgs,
  usageText,
  chromePathCandidates,
  playwrightChromiumCandidates,
  findChrome,
  pageUrl,
  chromeArgs,
} from './capture.mjs';

test('parseArgs reads positionals and numeric flags', () => {
  const options = parseArgs(['page.html', 'shot.png', '--t', '2.5', '--w', '800', '--h', '600', '--zoom', '3', '--budget', '5000']);
  assert.equal(options.input, 'page.html');
  assert.equal(options.out, 'shot.png');
  assert.equal(options.t, '2.5');
  assert.equal(options.width, 800);
  assert.equal(options.height, 600);
  assert.equal(options.zoom, 3);
  assert.equal(options.budget, 5000);
});

test('parseArgs defaults and help', () => {
  const options = parseArgs(['--help']);
  assert.equal(options.help, true);
  assert.equal(options.t, null);
  assert.equal(options.width, 1280);
  assert.equal(options.height, 960);
  assert.equal(options.zoom, 2);
  assert.equal(options.budget, 10000);
});

test('parseArgs rejects unknown options', () => {
  assert.throws(() => parseArgs(['--bogus']), /Unknown option/);
});

test('chromePathCandidates honors CHROME_PATH first', () => {
  const candidates = chromePathCandidates({ platform: 'darwin', env: { CHROME_PATH: '/custom/chrome' }, home: '/home/u' });
  assert.equal(candidates[0], '/custom/chrome');
});

test('chromePathCandidates lists mac app bundles', () => {
  const candidates = chromePathCandidates({ platform: 'darwin', env: {}, home: '/home/u' });
  assert.ok(candidates.includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
  assert.ok(candidates.includes(join('/home/u', 'Applications/Chromium.app/Contents/MacOS/Chromium')));
});

test('chromePathCandidates expands linux PATH entries', () => {
  const candidates = chromePathCandidates({
    platform: 'linux',
    env: { PATH: ['/opt/bin', '/usr/local/bin'].join(':') },
    home: '/home/u',
  });
  assert.ok(candidates.includes(join('/opt/bin', 'google-chrome')));
  assert.ok(candidates.includes(join('/usr/local/bin', 'chromium-browser')));
});

test('chromePathCandidates lists windows program files', () => {
  const candidates = chromePathCandidates({
    platform: 'win32',
    env: { PROGRAMFILES: 'C:/Program Files', LOCALAPPDATA: 'C:/Users/u/AppData/Local' },
    home: 'C:/Users/u',
  });
  assert.ok(candidates.includes(join('C:/Program Files', 'Google/Chrome/Application/chrome.exe')));
  assert.ok(candidates.includes(join('C:/Users/u/AppData/Local', 'Google/Chrome/Application/chrome.exe')));
});

test('playwrightChromiumCandidates finds a linux build', () => {
  const home = '/home/u';
  const cache = join(home, '.cache/ms-playwright');
  const readdir = (dir) => {
    if (dir === cache) return ['chromium-1234', 'ffmpeg-1000'];
    if (dir === join(cache, 'chromium-1234')) return ['chrome-linux'];
    throw new Error('missing');
  };
  const candidates = playwrightChromiumCandidates({ platform: 'linux', env: {}, home }, readdir);
  assert.deepEqual(candidates, [join(cache, 'chromium-1234', 'chrome-linux', 'chrome')]);
});

test('playwrightChromiumCandidates finds a mac build', () => {
  const home = '/Users/u';
  const cache = join(home, 'Library/Caches/ms-playwright');
  const readdir = (dir) => {
    if (dir === cache) return ['chromium-1234'];
    if (dir === join(cache, 'chromium-1234')) return ['chrome-mac'];
    throw new Error('missing');
  };
  const candidates = playwrightChromiumCandidates({ platform: 'darwin', env: {}, home }, readdir);
  assert.ok(candidates.includes(join(cache, 'chromium-1234', 'chrome-mac', 'Chromium.app/Contents/MacOS/Chromium')));
});

test('findChrome returns the first existing candidate', () => {
  const target = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chrome = findChrome({
    platform: 'darwin',
    env: {},
    home: '/home/u',
    exists: (path) => path === target,
    readdir: () => {
      throw new Error('no cache');
    },
  });
  assert.equal(chrome, target);
});

test('findChrome returns null when nothing exists', () => {
  const chrome = findChrome({
    platform: 'darwin',
    env: {},
    home: '/home/u',
    exists: () => false,
    readdir: () => {
      throw new Error('no cache');
    },
  });
  assert.equal(chrome, null);
});

test('pageUrl converts a file path and appends t only when given', () => {
  const withTime = pageUrl('/tmp/my page.html', 2.5);
  assert.ok(withTime.startsWith('file://'));
  assert.ok(withTime.endsWith('?t=2.5'));
  const withoutTime = pageUrl('/tmp/my page.html', null);
  assert.ok(!withoutTime.includes('?t='));
});

test('pageUrl passes through URLs and appends with the right separator', () => {
  assert.equal(pageUrl('http://example.com/d', null), 'http://example.com/d');
  assert.equal(pageUrl('http://example.com/d?x=1', '3'), 'http://example.com/d?x=1&t=3');
  assert.equal(pageUrl('file:///tmp/a.html', '0'), 'file:///tmp/a.html?t=0');
});

test('pageUrl treats a windows drive path as a file', () => {
  const url = pageUrl('C:\\Users\\u\\a.html', null);
  assert.ok(url.startsWith('file://'));
});

test('chromeArgs is fully headless, keeps the software GL path, and uses the CSS viewport with a device scale factor', () => {
  const args = chromeArgs({ url: 'file:///x?t=1', out: 'out.png', width: 1280, height: 960, zoom: 2 });
  assert.ok(args.includes('--headless=new'));
  assert.ok(args.includes('--use-gl=angle'));
  assert.ok(args.includes('--use-angle=swiftshader'));
  assert.ok(args.includes('--enable-unsafe-swiftshader'));
  assert.ok(!args.includes('--disable-gpu'));
  assert.ok(args.includes('--hide-scrollbars'));
  assert.ok(args.includes('--force-color-profile=srgb'));
  assert.ok(args.includes('--window-size=1280,960'));
  assert.ok(args.includes('--force-device-scale-factor=2'));
  assert.ok(!args.includes('--window-size=2560,1920'));
  assert.ok(args.includes('--screenshot=out.png'));
  assert.ok(args.includes('--virtual-time-budget=10000'));
  assert.ok(args.includes('--default-background-color=ffffffff'));
  assert.equal(args[args.length - 1], 'file:///x?t=1');
});

test('chromeArgs honors a custom virtual time budget', () => {
  const args = chromeArgs({ url: 'file:///x', out: 'out.png', budget: 5000 });
  assert.ok(args.includes('--virtual-time-budget=5000'));
  assert.ok(!args.includes('--virtual-time-budget=10000'));
});

test('chromeArgs keeps the CSS viewport fixed and emits the matching scale factor', () => {
  const retina = chromeArgs({ url: 'file:///x', out: 'out.png', width: 1280, height: 960, zoom: 2 });
  assert.ok(retina.includes('--window-size=1280,960'));
  assert.ok(retina.includes('--force-device-scale-factor=2'));
  const oneX = chromeArgs({ url: 'file:///x', out: 'out.png', width: 1280, height: 960, zoom: 1 });
  assert.ok(oneX.includes('--window-size=1280,960'));
  assert.ok(oneX.includes('--force-device-scale-factor=1'));
});

test('usageText documents usage and exit codes', () => {
  const text = usageText();
  assert.ok(text.includes('Usage: node scripts/capture.mjs'));
  assert.ok(text.includes('--budget 10000'));
  assert.ok(text.includes('CHROME_PATH'));
  assert.ok(text.includes('3  no Chrome/Chromium binary found'));
});
