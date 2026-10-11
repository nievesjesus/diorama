import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICE_SIZE = 3;
const TIER_GAP = 7;
const TIER_SPREAD = 5;
const MAX_REPLICAS = 1000;

const COLOR_RULES = [
  { test: /postgres|mysql|mariadb|mongo|sqlite/i, color: 'copper' },
  { test: /redis|memcached/i, color: 'amber' },
  { test: /kafka|rabbit|nats|pulsar|zookeeper/i, color: 'plum' },
  { test: /nginx|traefik|haproxy|envoy|caddy/i, color: 'steel' },
  { test: /minio|s3/i, color: 'green' },
];

export function yamlError(line, message) {
  const error = new Error(`line ${line}: ${message}`);
  error.line = line;
  return error;
}

export function colorForImage(image) {
  const value = typeof image === 'string' ? image : '';
  for (const rule of COLOR_RULES) {
    if (rule.test.test(value)) return rule.color;
  }
  return 'blue';
}

function stripComment(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\' && quote === '"') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || text[index - 1] === ' ' || text[index - 1] === '\t')) {
      return text.slice(0, index);
    }
  }
  return text;
}

export function scanLines(text) {
  const rawLines = String(text).split(/\r?\n/);
  const lines = [];
  for (let index = 0; index < rawLines.length; index += 1) {
    const lineNo = index + 1;
    const raw = rawLines[index];
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const noComment = stripComment(raw);
    if (noComment.trim() === '') continue;
    const leading = noComment.match(/^[ \t]*/)[0];
    if (leading.includes('\t')) {
      throw yamlError(lineNo, 'tab characters are not allowed for indentation');
    }
    const indent = leading.length;
    if (indent % 2 !== 0) {
      throw yamlError(lineNo, `indentation of ${indent} spaces is not a multiple of 2`);
    }
    const body = noComment.slice(indent).replace(/\s+$/, '');
    if (body === '') continue;
    lines.push({ lineNo, indent, body });
  }
  return lines;
}

function findKeyColon(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\' && quote === '"') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ':') {
      const after = text[index + 1];
      if (after === undefined || after === ' ' || after === '\t') return index;
    }
  }
  return -1;
}

function splitFlow(text, lineNo) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      current += char;
      if (char === '\\' && quote === '"') {
        current += text[index + 1] ?? '';
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '[' || char === '{') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ']' || char === '}') {
      depth -= 1;
      current += char;
      continue;
    }
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (quote) throw yamlError(lineNo, 'unterminated quoted string');
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

function parseQuoted(text, lineNo) {
  const quote = text[0];
  if (text.length < 2 || !text.endsWith(quote)) {
    throw yamlError(lineNo, 'unterminated quoted string');
  }
  const inner = text.slice(1, -1);
  if (quote === "'") return inner.replace(/''/g, "'");
  return inner
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

export function parseScalar(text, lineNo = 0) {
  const value = String(text).trim();
  if (value === '') return '';
  if (value.startsWith('[')) return parseFlowList(value, lineNo);
  if (value.startsWith('{')) return parseFlowMap(value, lineNo);
  if (value.startsWith('"') || value.startsWith("'")) return parseQuoted(value, lineNo);
  if (/^(true|yes|on)$/i.test(value)) return true;
  if (/^(false|no|off)$/i.test(value)) return false;
  if (/^(null|~)$/i.test(value)) return null;
  if (/^[+-]?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(value)) return Number(value);
  return value;
}

function parseFlowList(text, lineNo) {
  const inner = text.slice(1, text.endsWith(']') ? -1 : undefined);
  return splitFlow(inner, lineNo).map((part) => parseScalar(part, lineNo));
}

function parseFlowMap(text, lineNo) {
  const inner = text.slice(1, text.endsWith('}') ? -1 : undefined);
  const map = {};
  for (const part of splitFlow(inner, lineNo)) {
    const colon = findKeyColon(part);
    if (colon === -1) continue;
    const key = parseScalar(part.slice(0, colon).trim(), lineNo);
    const raw = part.slice(colon + 1).trim();
    map[String(key)] = raw === '' ? null : parseScalar(raw, lineNo);
  }
  return map;
}

function isListItem(body) {
  return body === '-' || body.startsWith('- ');
}

function splitEntry(body, lineNo) {
  const colon = findKeyColon(body);
  if (colon === -1) throw yamlError(lineNo, 'expected "key: value"');
  const key = parseScalar(body.slice(0, colon).trim(), lineNo);
  return { key: String(key), valueText: body.slice(colon + 1).trim() };
}

function parseMap(lines, start, indent, seed) {
  const map = {};
  let index = start;
  let pending = seed || null;
  while (true) {
    let line;
    if (pending) {
      line = pending;
      pending = null;
    } else {
      if (index >= lines.length || lines[index].indent !== indent || isListItem(lines[index].body)) break;
      line = lines[index];
      index += 1;
    }
    if (findKeyColon(line.body) === -1) continue;
    const { key, valueText } = splitEntry(line.body, line.lineNo);
    if (valueText === '') {
      const next = lines[index];
      if (next && next.indent === indent + 2) {
        const child = parseBlock(lines, index, indent + 2);
        map[key] = child.value;
        index = child.next;
      } else if (next && next.indent === indent && isListItem(next.body)) {
        const child = parseList(lines, index, indent);
        map[key] = child.value;
        index = child.next;
      } else if (next && next.indent > indent + 2) {
        throw yamlError(next.lineNo, `unexpected indentation (expected ${indent + 2} spaces)`);
      } else {
        map[key] = null;
      }
    } else {
      map[key] = parseScalar(valueText, line.lineNo);
    }
  }
  return { value: map, next: index };
}

function parseList(lines, start, indent) {
  const list = [];
  let index = start;
  while (index < lines.length && lines[index].indent === indent && isListItem(lines[index].body)) {
    const line = lines[index];
    const rest = line.body === '-' ? '' : line.body.slice(2).trim();
    index += 1;
    if (rest === '') {
      const next = lines[index];
      if (next && next.indent === indent + 2) {
        const child = parseBlock(lines, index, indent + 2);
        list.push(child.value);
        index = child.next;
      } else if (next && next.indent > indent + 2) {
        throw yamlError(next.lineNo, `unexpected indentation (expected ${indent + 2} spaces)`);
      } else {
        list.push(null);
      }
    } else if (findKeyColon(rest) !== -1) {
      const child = parseMap(lines, index, indent + 2, { body: rest, lineNo: line.lineNo });
      list.push(child.value);
      index = child.next;
    } else {
      list.push(parseScalar(rest, line.lineNo));
    }
  }
  return { value: list, next: index };
}

function parseBlock(lines, start, indent) {
  if (isListItem(lines[start].body)) return parseList(lines, start, indent);
  return parseMap(lines, start, indent);
}

export function parseYaml(text) {
  const lines = scanLines(text);
  if (lines.length === 0) return {};
  const result = parseBlock(lines, 0, lines[0].indent);
  if (result.next < lines.length) {
    throw yamlError(lines[result.next].lineNo, 'unexpected indentation');
  }
  return result.value;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.slice();
  if (value === null || value === undefined) return [];
  return [value];
}

function normalizeNames(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? null : String(entry)))
      .filter((entry) => entry !== null && entry !== '');
  }
  if (value && typeof value === 'object') return Object.keys(value).sort();
  if (typeof value === 'string' && value !== '') return [value];
  return [];
}

export function buildServices(root) {
  const raw = root && typeof root === 'object' ? root.services : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const names = Object.keys(raw).sort();
  const services = {};
  for (const name of names) {
    const value = raw[name];
    const service = { name, image: null, ports: [], dependsOn: [], networks: [], replicas: 1 };
    if (typeof value === 'string') {
      service.image = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      service.image = typeof value.image === 'string' ? value.image : null;
      service.ports = normalizeList(value.ports);
      service.networks = normalizeNames(value.networks);
      const deploy = value.deploy;
      if (deploy && typeof deploy === 'object' && !Array.isArray(deploy)) {
        const replicas = typeof deploy.replicas === 'number'
          ? deploy.replicas
          : Number.parseInt(deploy.replicas, 10);
        if (Number.isInteger(replicas) && replicas > 0) service.replicas = Math.min(replicas, MAX_REPLICAS);
      }
      service.dependsOn = normalizeNames(value.depends_on).filter((dep) => dep !== name);
    }
    services[name] = service;
  }
  for (const name of names) {
    services[name].dependsOn = services[name].dependsOn.filter((dep) => services[dep]);
  }
  return services;
}

export function computeTiers(services) {
  const names = Object.keys(services).sort();
  const tiers = {};
  const visiting = new Set();
  const depth = (name) => {
    if (Object.prototype.hasOwnProperty.call(tiers, name)) return tiers[name];
    if (visiting.has(name)) return 0;
    visiting.add(name);
    let value = 0;
    for (const dep of services[name].dependsOn.slice().sort()) {
      if (!services[dep]) continue;
      value = Math.max(value, depth(dep) + 1);
    }
    visiting.delete(name);
    tiers[name] = value;
    return value;
  };
  for (const name of names) depth(name);
  return tiers;
}

export function layoutServices(services, tiers) {
  const names = Object.keys(services).sort();
  const byTier = new Map();
  for (const name of names) {
    const tier = tiers[name] || 0;
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier).push(name);
  }
  const positions = {};
  for (const [tier, members] of byTier) {
    members.sort();
    const count = members.length;
    members.forEach((name, index) => {
      const centerX = (index - (count - 1) / 2) * TIER_SPREAD;
      positions[name] = [centerX - SERVICE_SIZE / 2, tier * TIER_GAP, 0];
    });
  }
  return positions;
}

function compareSeq(a, b) {
  const left = a.join('\u0000');
  const right = b.join('\u0000');
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function longestDependsPath(services, tiers) {
  const names = Object.keys(services).sort();
  const order = names.slice().sort((a, b) => (tiers[a] - tiers[b]) || a.localeCompare(b));
  const best = {};
  for (const name of order) {
    let bestPath = [name];
    for (const dep of services[name].dependsOn.slice().sort()) {
      if (!services[dep] || !best[dep]) continue;
      if (tiers[dep] >= tiers[name]) continue;
      const candidate = [name].concat(best[dep]);
      if (candidate.length > bestPath.length || (candidate.length === bestPath.length && compareSeq(candidate, bestPath) < 0)) {
        bestPath = candidate;
      }
    }
    best[name] = bestPath;
  }
  let result = [];
  for (const name of names) {
    const candidate = best[name] || [name];
    if (candidate.length > result.length || (candidate.length === result.length && compareSeq(candidate, result) < 0)) {
      result = candidate;
    }
  }
  return result;
}

function sharesNetwork(a, b) {
  if (a.networks.length === 0 || b.networks.length === 0) return false;
  return a.networks.some((network) => b.networks.includes(network));
}

function pairKey(a, b) {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function buildLinks(services, names) {
  const links = [];
  const seen = new Set();
  for (const name of names) {
    for (const dep of services[name].dependsOn) {
      links.push({ from: name, to: dep, kind: 'tube', color: 'slate' });
      seen.add(pairKey(name, dep));
    }
  }
  for (const name of names) {
    if (services[name].dependsOn.length > 0) continue;
    const partners = names.filter((other) => (
      other !== name &&
      services[other].dependsOn.length === 0 &&
      sharesNetwork(services[name], services[other])
    ));
    if (partners.length !== 1) continue;
    const other = partners[0];
    const key = pairKey(name, other);
    if (seen.has(key)) continue;
    links.push({ from: name, to: other, kind: 'cable', color: 'slate' });
    seen.add(key);
  }
  return links;
}

function uniqueId(base, taken) {
  let id = base;
  let counter = 2;
  while (taken.has(id)) {
    id = `${base}-${counter}`;
    counter += 1;
  }
  taken.add(id);
  return id;
}

function titleCase(text) {
  const words = String(text).split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0) return 'Docker Compose';
  return words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

export function titleForPath(path) {
  return titleCase(basename(dirname(resolve(path))));
}

export function composeToScene(services, options = {}) {
  const names = Object.keys(services).sort();
  const tiers = computeTiers(services);
  const positions = layoutServices(services, tiers);
  const taken = new Set(names);
  const parts = [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const name of names) {
    const [x, y] = positions[name];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + SERVICE_SIZE);
    maxY = Math.max(maxY, y + SERVICE_SIZE);
  }
  if (names.length > 0) {
    parts.push({
      id: uniqueId('base-plate', taken),
      kind: 'plate',
      at: [minX - 2, minY - 2, -0.3],
      size: [maxX - minX + 4, maxY - minY + 4, 0.3],
      color: 'sand',
    });
  }

  for (const name of names) {
    parts.push({
      id: name,
      kind: 'box',
      label: name,
      at: positions[name],
      size: [SERVICE_SIZE, SERVICE_SIZE, 2],
      color: colorForImage(services[name].image),
    });
  }

  const links = buildLinks(services, names);

  const path = longestDependsPath(services, tiers);
  let flowPath = null;
  if (path.length >= 2) {
    flowPath = path;
  } else {
    const tierZero = names.filter((name) => (tiers[name] || 0) === 0);
    if (tierZero.length >= 2) {
      const byX = tierZero.slice().sort((a, b) => (positions[a][0] - positions[b][0]) || a.localeCompare(b));
      flowPath = [byX[0], byX[byX.length - 1]];
    }
  }
  const flows = flowPath
    ? [{ path: flowPath, kind: 'request', color: 'green', speed: 12, count: 3 }]
    : [];

  const totalReplicas = names.reduce((sum, name) => sum + services[name].replicas, 0);

  return {
    version: 1,
    title: options.title ?? 'Docker Compose',
    subtitle: `${names.length} services`,
    theme: options.theme === 'dark' ? 'dark' : 'light',
    size: [1280, 960],
    hint: 'Generated from docker-compose; refine freely',
    parts,
    links,
    flows,
    readout: [
      { label: 'Services', value: String(names.length) },
      { label: 'Replicas', value: String(totalReplicas) },
    ],
  };
}

export function usageText() {
  return [
    'Usage: node scripts/from-compose.mjs <compose.yml> [--out scene.json] [--theme light|dark] [--title str] [--help]',
    '',
    'Turn a docker-compose file into a best-effort Scene JSON v1 draft.',
    'Zero dependencies: reads a YAML subset (maps, lists, comments, quotes,',
    'booleans and numbers) and ignores everything it does not need.',
    '',
    'Options:',
    '  --out <file>        Output scene path (default: <compose dir>/scene.json, "-" for stdout)',
    '  --theme <name>      Scene theme, light or dark (default: light)',
    '  --title <text>      Scene title (default: the compose parent directory name)',
    '  -h, --help          Show this help and exit',
    '',
    'Exit codes:',
    '  0  success',
    '  1  unreadable input, invalid YAML or no services found',
    '',
  ].join('\n');
}

export function parseArgs(argv) {
  const options = { input: null, out: null, theme: 'light', title: null, help: false };
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
    } else if (arg === '--title') {
      if (args[index + 1] === undefined) throw new Error('--title requires a value');
      options.title = args[index + 1];
      index += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
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
    stderr.write(`missing <compose.yml> input\n\n${usageText()}`);
    return 1;
  }
  let text;
  try {
    text = readFileSync(options.input, 'utf8');
  } catch (error) {
    stderr.write(`cannot read ${options.input}: ${error.message}\n`);
    return 1;
  }
  let root;
  try {
    root = parseYaml(text);
  } catch (error) {
    stderr.write(`invalid YAML in ${options.input}: ${error.message}\n`);
    return 1;
  }
  const services = buildServices(root);
  if (!services || Object.keys(services).length === 0) {
    stderr.write(`invalid docker-compose in ${options.input}: no services found\n`);
    return 1;
  }
  const title = options.title ?? titleForPath(options.input);
  const scene = composeToScene(services, { title, theme: options.theme });
  const json = `${JSON.stringify(scene, null, 2)}\n`;
  if (options.out === '-') {
    stdout.write(json);
    return 0;
  }
  const outPath = options.out ?? join(dirname(options.input), 'scene.json');
  try {
    writeFileSync(resolve(outPath), json);
  } catch (error) {
    stderr.write(`cannot write ${outPath}: ${error.message}\n`);
    return 1;
  }
  stdout.write(`wrote ${outPath}\n`);
  return 0;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  process.exitCode = run(process.argv.slice(2));
}
