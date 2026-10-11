import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { solveLayout } from '../kit/layout.mjs';
import { validateScene } from '../kit/scene.mjs';

export function usageText() {
  return [
    'Usage: node scripts/layout.mjs <draft.json> --out <scene.json> [--theme light|dark] [--help]',
    '',
    'Lay out a scene draft (parts, links, optional tiers and flows, no coordinates)',
    'into a complete Scene JSON v1 file that passes the geometry audit.',
    'Deterministic: the same draft always produces byte-identical output.',
    '',
    'Options:',
    '  --out <file>        Output scene path ("-" for stdout)',
    '  --theme <name>      Scene theme, light or dark (default: the draft theme, else light)',
    '  -h, --help          Show this help and exit',
    '',
    'Exit codes:',
    '  0  success: the scene validates and the audit reports zero violations',
    '  1  usage error, unreadable draft, or no layout that passes the audit',
    '',
  ].join('\n');
}

export function parseArgs(argv) {
  const options = { input: null, out: null, theme: null, help: false };
  const args = [...argv];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--out') {
      if (args[index + 1] === undefined) throw new Error('--out requires a value');
      options.out = args[index + 1];
      index += 1;
    } else if (arg === '--theme') {
      if (args[index + 1] === undefined) throw new Error('--theme requires a value');
      options.theme = args[index + 1];
      index += 1;
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.input) {
      options.input = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (options.theme !== null && options.theme !== 'light' && options.theme !== 'dark') {
    throw new Error('--theme must be light or dark');
  }
  return options;
}

export function run(argv, streams = {}) {
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    stderr.write(`${error.message}\n\n${usageText()}`);
    return 1;
  }
  if (options.help) {
    stdout.write(usageText());
    return 0;
  }
  if (!options.input) {
    stderr.write(`missing <draft.json> input\n\n${usageText()}`);
    return 1;
  }
  if (!options.out) {
    stderr.write(`missing --out <scene.json>\n\n${usageText()}`);
    return 1;
  }
  let draft;
  try {
    draft = JSON.parse(readFileSync(options.input, 'utf8'));
  } catch (error) {
    stderr.write(`cannot read draft ${options.input}: ${error.message}\n`);
    return 1;
  }
  let solved;
  try {
    solved = solveLayout(draft, options.theme ? { theme: options.theme } : {});
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
  const checked = validateScene(solved.scene);
  if (!checked.ok) {
    stderr.write(`invalid scene:\n${checked.errors.join('\n')}\n`);
    return 1;
  }
  const json = `${JSON.stringify(solved.scene, null, 2)}\n`;
  const report = solved.audit;
  const summary = report.ok
    ? `audit: OK, 0 violations, ${report.warnings.length} warnings\n`
    : `audit: FAILED\n${report.violations.map((v) => `${v.code}: ${v.message}`).join('\n')}\n`;
  if (options.out === '-') {
    stdout.write(json);
    stderr.write(summary);
    return report.ok ? 0 : 1;
  }
  try {
    writeFileSync(resolve(options.out), json);
  } catch (error) {
    stderr.write(`cannot write ${options.out}: ${error.message}\n`);
    return 1;
  }
  stdout.write(`wrote ${options.out} (${solved.scene.parts.length} parts, ${solved.scene.links.length} links)\n`);
  stdout.write(summary);
  return report.ok ? 0 : 1;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  process.exitCode = run(process.argv.slice(2));
}
