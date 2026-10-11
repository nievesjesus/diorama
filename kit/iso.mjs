const ISO_COS = 0.8660254037844386;
const ISO_MARGIN = 32;
const ISO_TITLE_SPACE = 38;
const ISO_LABEL_PX = 12;
const ISO_LABEL_LIFT_PX = 10;
const ISO_SEGMENTS = 24;
const ISO_CHAMFER_MAX = 0.16;
const ISO_VIEW = [1, 1, 1];
const ISO_GLOW_SCALE = 1.16;
const ISO_GLOW_OPACITY = 0.2;
const ISO_CABLE_SEGMENTS = 24;
const ISO_CABLE_SAG_RATIO = 0.04;
const ISO_CABLE_SAG_MAX = 0.2;
const ISO_LINK_SPECULAR_PX = 0.35;
const ISO_DOT_SPACING = 2;
const ISO_DOT_RADIUS = 0.03;
const ISO_DOT_OPACITY = 0.07;
const ISO_DOT_LIMIT = 900;
const ISO_SHADOW_SOFT = 1.34;
const ISO_SHADOW_CONTACT = 0.86;
const ISO_SHADOW_OFFSET = 0.32;
const ISO_LED_RADIUS = 0.06;
const ISO_LED_GLOW = 0.16;
const ISO_LED_RING = ['green', 'amber', 'blue', 'plum'];
const ISO_TEX_FACES = [['top', 30], ['left', 30], ['right', -30]];

const ISO_BASE = {
  light: {
    ink: '#32363d',
    paper: '#ece5d6',
    steel: '#8796a4',
    slate: '#4d5b6c',
    amber: '#d7a442',
    copper: '#b87950',
    blue: '#46799f',
    green: '#608968',
    brick: '#b55a4b',
    plum: '#795780',
    sand: '#cebb92',
    cloud: '#c1c9d2'
  },
  dark: {
    ink: '#b9c3cf',
    paper: '#3e444c',
    steel: '#6f7c8a',
    slate: '#424d5a',
    amber: '#c99b43',
    copper: '#b0744b',
    blue: '#456f96',
    green: '#567e60',
    brick: '#a85449',
    plum: '#745282',
    sand: '#b8a37d',
    cloud: '#4d5661'
  }
};

function iso_parseHex(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error('invalid hex color: ' + String(hex));
  }
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

function iso_clampChannel(value) {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

function iso_toHex(rgb) {
  const channel = (value) => iso_clampChannel(Math.round(value)).toString(16).padStart(2, '0');
  return '#' + channel(rgb[0]) + channel(rgb[1]) + channel(rgb[2]);
}

function iso_mix(from, to, amount) {
  const a = iso_parseHex(from);
  const b = iso_parseHex(to);
  return iso_toHex([
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount
  ]);
}

function iso_lighten(hex, amount) {
  return iso_mix(hex, '#ffffff', amount);
}

function iso_darken(hex, amount) {
  return iso_mix(hex, '#000000', amount);
}

function iso_buildTokens() {
  const themes = {};
  for (const theme of ['light', 'dark']) {
    const table = {};
    const base = ISO_BASE[theme];
    for (const name of Object.keys(base)) {
      const tone = base[name];
      table[name] = {
        top: iso_lighten(tone, 0.24),
        left: tone,
        right: iso_darken(tone, 0.2),
        edge: iso_darken(tone, 0.36)
      };
    }
    themes[theme] = table;
  }
  return themes;
}

export const TOKENS = iso_buildTokens();

export function project(x, y, z) {
  return [(x - y) * ISO_COS, (x + y) * 0.5 - z];
}

function iso_format(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('non-finite coordinate: ' + String(value));
  }
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded === 0 ? 0 : rounded);
}

function iso_points(points) {
  return points.map((point) => iso_format(point[0]) + ',' + iso_format(point[1])).join(' ');
}

function iso_pathData(points) {
  if (points.length === 0) return '';
  let data = 'M ' + iso_format(points[0][0]) + ' ' + iso_format(points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    data += ' L ' + iso_format(points[index][0]) + ' ' + iso_format(points[index][1]);
  }
  return data;
}

function iso_escape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function iso_resolveTheme(theme) {
  if (theme == null) return 'light';
  if (theme === 'light' || theme === 'dark') return theme;
  throw new Error('scene.theme must be "light" or "dark", got ' + String(theme));
}

function iso_resolveSize(size) {
  if (size == null) return [1280, 960];
  if (!Array.isArray(size) || size.length < 2) {
    throw new Error('scene.size must be [width, height]');
  }
  const width = Number(size[0]);
  const height = Number(size[1]);
  if (!(width > 0) || !(height > 0)) {
    throw new Error('scene.size must be positive numbers');
  }
  return [width, height];
}

function iso_token(name, theme) {
  const table = TOKENS[iso_resolveTheme(theme)];
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(table, name)) {
    throw new Error('unknown color token: ' + String(name));
  }
  return table[name];
}

function iso_gradientId(token, face) {
  return 'iso-g-' + token + '-' + face;
}

function iso_linearGradient(id, x1, y1, x2, y2, stops) {
  let markup = '<linearGradient id="' + id + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '">';
  for (const stop of stops) {
    markup += '<stop offset="' + stop[0] + '" stop-color="' + stop[1] + '"/>';
  }
  return markup + '</linearGradient>';
}

function iso_radialGradient(id, color, stops) {
  let markup = '<radialGradient id="' + id + '" cx="0.5" cy="0.5" r="0.5">';
  for (const stop of stops) {
    markup += '<stop offset="' + stop[0] + '" stop-color="' + color + '" stop-opacity="' + stop[1] + '"/>';
  }
  return markup + '</radialGradient>';
}

function iso_fadeGradient(id, x1, y1, x2, y2, color, stops) {
  let markup = '<linearGradient id="' + id + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '">';
  for (const stop of stops) {
    markup += '<stop offset="' + stop[0] + '" stop-color="' + color + '" stop-opacity="' + stop[1] + '"/>';
  }
  return markup + '</linearGradient>';
}

function iso_finish(token) {
  if (['copper', 'sand'].includes(token)) return 'brushedWarm';
  return ['blue', 'green', 'plum', 'amber', 'brick'].includes(token) ? 'matte' : 'brush';
}

function iso_textureDefs(parts, table) {
  const families = new Set(parts.map((part) => iso_finish(part.color)));
  families.add('rivets');
  let markup = '';
  for (const family of families) {
    const ink = family === 'brushedWarm' ? table.copper.edge : table.ink.left;
    if (family === 'brush' || family === 'brushedWarm') {
      for (const [variant, angle] of ISO_TEX_FACES) {
        markup += '<pattern id="iso-tex-' + family + '-' + variant + '" width="0.8" height="0.8" patternUnits="userSpaceOnUse" patternTransform="rotate(' + angle + ')">';
        markup += '<path d="M0 0.12H0.8 M0 0.38H0.8 M0 0.65H0.8" fill="none" stroke="' + ink + '" stroke-width="0.022"/>';
        markup += '</pattern>';
      }
      continue;
    }
    markup += '<pattern id="iso-tex-' + family + '" width="0.8" height="0.8" patternUnits="userSpaceOnUse">';
    const count = family === 'rivets' ? 1 : 5;
    for (let i = 0; i < count; i += 1) {
      const hash = iso_hash(i, 71);
      markup += '<circle cx="' + iso_format(0.06 + (hash % 680) / 1000) + '" cy="' + iso_format(0.06 + ((hash >>> 12) % 680) / 1000) + '" r="' + (family === 'rivets' ? '0.035' : '0.03') + '" fill="' + ink + '"/>';
    }
    markup += '</pattern>';
  }
  return markup;
}

function iso_textureRef(finish, face) {
  if (finish !== 'brush' && finish !== 'brushedWarm') return 'iso-tex-' + finish;
  if (face === 'right' || face === 'body') return 'iso-tex-' + finish + '-right';
  if (face === 'left') return 'iso-tex-' + finish + '-left';
  return 'iso-tex-' + finish + '-top';
}

function iso_idHash(id) {
  let hash = 2166136261;
  for (const char of String(id || 'ground')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function iso_defs(theme, parts) {
  const table = TOKENS[theme];
  const shadowInk = theme === 'dark' ? '#05070a' : table.ink.left;
  const slabVoid = theme === 'dark' ? '#04060a' : table.ink.left;
  let defs = '<defs>' + iso_textureDefs(parts, table);
  for (const name of Object.keys(table)) {
    const base = table[name].left;
    defs += iso_linearGradient(iso_gradientId(name, 'top'), '0', '0', '0', '1',
      [['0', iso_lighten(base, 0.44)], ['1', iso_lighten(base, 0.18)]]);
    defs += iso_linearGradient(iso_gradientId(name, 'left'), '0', '0', '0', '1',
      [['0', iso_lighten(base, 0.14)], ['1', iso_darken(base, 0.05)]]);
    defs += iso_linearGradient(iso_gradientId(name, 'right'), '0', '0', '0', '1',
      [['0', iso_darken(base, 0.06)], ['1', iso_darken(base, 0.32)]]);
    defs += iso_linearGradient(iso_gradientId(name, 'rim'), '0', '0', '1', '0',
      [['0', iso_lighten(base, 0.34)], ['1', iso_lighten(base, 0.54)]]);
  }
  defs += iso_radialGradient('iso-shadow-soft', shadowInk, [['0', '0.2'], ['0.72', '0.08'], ['1', '0']]);
  defs += iso_radialGradient('iso-shadow-contact', shadowInk, [['0', '0.38'], ['0.7', '0.18'], ['1', '0']]);
  defs += iso_fadeGradient('iso-shadow-directional', '0', '0', '0.67', '1', shadowInk, [['0', '0.24'], ['1', '0']]);
  if (theme !== 'dark') defs += iso_fadeGradient('iso-shadow-bounce', '1', '1', '0.33', '0', shadowInk, [['0', '0.11'], ['1', '0']]);
  defs += iso_radialGradient('iso-contact-grime', shadowInk, [['0', '0.2'], ['0.55', '0.12'], ['1', '0']]);
  defs += iso_radialGradient('iso-slab-void', slabVoid, [['0', '0.26'], ['0.55', '0.12'], ['1', '0']]);
  defs += iso_fadeGradient('iso-slab-ao', '0', '0', '0', '1', slabVoid, [['0', '0'], ['1', '0.5']]);
  defs += '<pattern id="iso-hazard" width="0.34" height="0.34" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="0.34" height="0.34" fill="' + table.amber.left + '"/><rect width="0.17" height="0.34" fill="' + table.slate.edge + '"/></pattern>';
  defs += '<linearGradient id="iso-sheen" x1="0" y1="0.25" x2="1" y2="0.83"><stop offset="0.2" stop-color="white" stop-opacity="0"/><stop offset="0.48" stop-color="white" stop-opacity="0.08"/><stop offset="0.7" stop-color="white" stop-opacity="0"/></linearGradient>';
  defs += iso_radialGradient('iso-reflection-fade', '#ffffff', [['0', '1'], ['0.4', '1'], ['1', '0']]);
  defs += '<mask id="iso-reflection-mask" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#iso-reflection-fade)"/></mask>';
  defs += '</defs>';
  return defs;
}

function iso_dot2(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function iso_centroid3(points) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
    z += point[2];
  }
  const count = points.length || 1;
  return [x / count, y / count, z / count];
}

function iso_newellNormal(points) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

function iso_outwardNormal(points, center) {
  let normal = iso_newellNormal(points);
  const face = iso_centroid3(points);
  const outward = [
    face[0] - center[0],
    face[1] - center[1],
    face[2] - center[2]
  ];
  if (iso_dot2(normal, outward) < 0) {
    normal = [-normal[0], -normal[1], -normal[2]];
  }
  return normal;
}

function iso_prismSize(part) {
  const size = Array.isArray(part.size) ? part.size : [];
  const width = size.length > 0 ? Number(size[0]) : 1;
  const depth = size.length > 1 ? Number(size[1]) : 1;
  const fallbackHeight = part.kind === 'plate' ? 0.2 : 1;
  const height = size.length > 2 ? Number(size[2]) : fallbackHeight;
  return [width, depth, height];
}

function iso_prismAnchors(part) {
  const [x, y, z] = part.at;
  const [width, depth, height] = iso_prismSize(part);
  return {
    top: [x + width / 2, y + depth / 2, z + height],
    bottom: [x + width / 2, y + depth / 2, z],
    north: [x + width / 2, y, z + height / 2],
    south: [x + width / 2, y + depth, z + height / 2],
    east: [x + width, y + depth / 2, z + height / 2],
    west: [x, y + depth / 2, z + height / 2]
  };
}

function iso_axisBasis(axis) {
  if (axis === 'z') return { along: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] };
  if (axis === 'x') return { along: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] };
  if (axis === 'y') return { along: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] };
  throw new Error('unknown cylinder axis: ' + String(axis));
}

function iso_cylinderAnchors(part) {
  const [x, y, z] = part.at;
  const radius = Number(part.radius);
  const height = Number(part.h);
  const axis = part.axis == null ? 'z' : part.axis;
  if (axis === 'z') {
    return {
      top: [x, y, z + height],
      bottom: [x, y, z],
      north: [x, y - radius, z + height / 2],
      south: [x, y + radius, z + height / 2],
      east: [x + radius, y, z + height / 2],
      west: [x - radius, y, z + height / 2]
    };
  }
  if (axis === 'x') {
    return {
      top: [x + height / 2, y, z + radius],
      bottom: [x + height / 2, y, z - radius],
      north: [x + height / 2, y - radius, z],
      south: [x + height / 2, y + radius, z],
      east: [x + height, y, z],
      west: [x, y, z]
    };
  }
  return {
    top: [x, y + height / 2, z + radius],
    bottom: [x, y + height / 2, z - radius],
    north: [x, y, z],
    south: [x, y + height, z],
    east: [x + radius, y + height / 2, z],
    west: [x - radius, y + height / 2, z]
  };
}

export function anchors(part) {
  if (!part || typeof part !== 'object') {
    throw new Error('anchors requires a part object');
  }
  if (!Array.isArray(part.at)) {
    throw new Error('part requires "at" [x,y,z]');
  }
  if (part.kind === 'box' || part.kind === 'plate') return iso_prismAnchors(part);
  if (part.kind === 'cylinder') return iso_cylinderAnchors(part);
  throw new Error('unknown part kind: ' + String(part.kind));
}

function iso_expand(points, factor) {
  if (points.length === 0) return [];
  let cx = 0;
  let cy = 0;
  for (const point of points) {
    cx += point[0];
    cy += point[1];
  }
  cx /= points.length;
  cy /= points.length;
  return points.map((point) => [cx + (point[0] - cx) * factor, cy + (point[1] - cy) * factor]);
}

function iso_partAttributes(opts) {
  const attributes = {};
  if (opts.id) attributes['data-id'] = opts.id;
  if (opts.label) attributes['aria-label'] = opts.label;
  return attributes;
}

function iso_octagon(x, y, w, d, inset, k, z) {
  const x0 = x + inset;
  const x1 = x + w - inset;
  const y0 = y + inset;
  const y1 = y + d - inset;
  return [
    [x0 + k, y0, z],
    [x1 - k, y0, z],
    [x1, y0 + k, z],
    [x1, y1 - k, z],
    [x1 - k, y1, z],
    [x0 + k, y1, z],
    [x0, y1 - k, z],
    [x0, y0 + k, z]
  ];
}

function iso_chamferedFaces(x, y, z, w, d, h, c, k) {
  const base = iso_octagon(x, y, w, d, 0, k, z);
  const shoulder = iso_octagon(x, y, w, d, 0, k, z + h - c);
  const top = iso_octagon(x, y, w, d, c, k, z + h);
  const faces = [];
  for (let index = 0; index < 8; index += 1) {
    const next = (index + 1) % 8;
    faces.push({ kind: 'side', pts: [base[index], base[next], shoulder[next], shoulder[index]] });
    faces.push({ kind: 'chamfer', pts: [shoulder[index], shoulder[next], top[next], top[index]] });
  }
  faces.push({ kind: 'top', pts: top });
  return faces;
}

function iso_circlePlane(planeAxis, along, a, b, radius) {
  const points = [];
  for (let index = 0; index < ISO_SEGMENTS; index += 1) {
    const angle = (index / ISO_SEGMENTS) * Math.PI * 2;
    const ca = Math.cos(angle) * radius;
    const cb = Math.sin(angle) * radius;
    if (planeAxis === 'x') points.push([along, a + ca, b + cb]);
    else if (planeAxis === 'y') points.push([a + ca, along, b + cb]);
    else points.push([a + ca, b + cb, along]);
  }
  return points;
}

function iso_hash(ix, iy) {
  let n = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}

function iso_detail(part, tones, theme) {
  const polygons = [];
  const paths = [];
  const texts = [];
  const [x, y, z] = part.at;
  const [w, d, h] = iso_prismSize(part);
  const ink = TOKENS[theme].ink.left;
  const line = (points, cls, opacity = 0.5, width = 0.6, stroke = tones.edge) => {
    const p = points.map((v) => project(...v));
    paths.push({ points: p, d: iso_pathData(p), stroke, width, opacity, vectorEffect: true, cls: 'face ' + cls });
  };
  const poly = (points, cls, fill = tones.edge, opacity = 1) => polygons.push({ points: points.map((v) => project(...v)), fill, opacity, stroke: 'none', cls: 'face ' + cls });
  const front = (u, v) => [x + u * w, y + d, z + v * h];
  const side = (u, v) => [x + w, y + u * d, z + v * h];
  const rect = (face, u, v, a, b, cls, fill, opacity) => poly([face(u, v), face(a, v), face(a, b), face(u, b)], cls, fill, opacity);
  const seed = iso_idHash(part.id);
  if (part.vents || part.detail === 'rack') {
    const smudge = theme === 'light' ? 0.045 : 0.065;
    for (let i = 0; i < 2 + seed % 3; i += 1) {
      const hash = iso_hash(seed, i);
      const u = 0.31 + (hash % 330) / 1000;
      const v = 0.2 + ((hash >>> 10) % 260) / 1000;
      rect(front, u, Math.max(0.06, v - 0.13), Math.min(0.69, u + 0.055 / w), v, 'face-grime', ink, smudge);
    }
  }
  const crowded = Number.isInteger(part.leds) && part.leds > 0 ? 0.68 : part.detail === 'tower' ? 0.64 : 0.8;
  if (part.id && part.kind === 'box' && part.detail !== 'rack' && h >= 1.5 && d * h >= 6) {
    const a = Math.min(0.9 / d, 0.3);
    const b = Math.min(0.5 / h, 0.24);
    const u = 0.18 + (seed % 300) / 1000;
    const v = Math.min(0.25 + ((seed >>> 9) % 200) / 1000, crowded - b);
    rect(side, u, v, u + a, v + b, 'face-decal', TOKENS[theme].paper.top, 0.72);
    for (const row of [0.33, 0.67]) line([side(u + a * 0.18, v + b * row), side(u + a * 0.8, v + b * row)], 'face-decal-line', 0.55, 0.45, tones.edge);
  }
  for (const face of [front, side]) {
    for (const u of [0.05, 0.93]) rect(face, u, 0.07, u + 0.02, 0.93, 'face-rivets', 'url(#iso-tex-rivets)', 0.22);
  }
  if (part.panels) {
    for (const face of [front, side]) {
      for (const inset of [0.12, 0.14]) line([face(inset, inset), face(1 - inset, inset), face(1 - inset, 1 - inset), face(inset, 1 - inset), face(inset, inset)], 'face-panel', inset === 0.12 ? 0.18 : 0.1, 0.6, ink);
    }
    for (const u of [0.18, 0.82]) for (const v of [0.18, 0.82]) poly(iso_circlePlane('z', z + h, x + w * u, y + d * v, Math.min(w, d) * 0.017), 'face-screw', tones.edge, 0.7);
  }
  if (part.hazard) {
    for (const face of [front, side]) rect(face, 0.025, 0.03, 0.975, Math.min(0.03 + 0.25 / h, 0.5), 'face-hazard', 'url(#iso-hazard)');
  }
  if (part.detail === 'rack') {
    for (const u of [0.06, 0.9]) rect(front, u, 0.08, Math.min(u + 0.15 / w, 0.96), 0.91, 'face-rail', tones.edge, 0.65);
    line([[x + w * 0.8, y + d * 0.45, z + h], [x + w * 0.8, y + d * 0.2, z + h + 0.13], [x + w * 0.7, y + d * 0.15, z + h]], 'face-exit', 0.85, 1.3);
    const units = Math.max(6, Math.min(8, Math.round(h) + 4));
    for (let i = 0; i < units; i += 1) texts.push({ point: project(...front(0.2, 0.15 + (i + 0.25) * 0.76 / units)), text: 'U' + (i + 1), fill: tones.top, available: h * 0.5 / units });
  }
  if (part.detail === 'tower') {
    for (let i = 0; i < 7; i += 1) rect(front, 0.18 + i * 0.095, 0.15, 0.205 + i * 0.095, 0.55, 'face-tower-vent', tones.edge, 0.65);
    for (const v of [0.65, 0.79]) rect(front, 0.16, v, 0.84, v + 0.09, 'face-drive', tones.edge, 0.48);
    rect(side, 0.3, 0.7, 0.47, 0.82, 'face-badge', tones.top, 0.7);
  }
  if (part.detail === 'switch') {
    for (let row = 0; row < 2; row += 1) for (let i = 0; i < 8; i += 1) {
      const u = 0.08 + i * 0.108;
      rect(front, u, 0.18 + row * 0.29, u + 0.074, 0.38 + row * 0.29, 'face-port', tones.edge, 0.8);
      if (!row) poly(iso_circlePlane('y', y + d, x + (u + 0.035) * w, z + h * 0.8, Math.min(w / 130, h / 15)), 'face-port-led', TOKENS[theme][i % 2 ? 'amber' : 'green'].top);
    }
  }
  if (part.detail === 'crate') {
    for (const face of [front, side]) {
      line([face(0.12, 0.12), face(0.88, 0.88)], 'face-brace', 0.65, 1.4);
      line([face(0.12, 0.88), face(0.88, 0.12)], 'face-brace', 0.65, 1.4);
      line([face(0.12, 0.12), face(0.88, 0.12), face(0.88, 0.88), face(0.12, 0.88), face(0.12, 0.12)], 'face-crate-frame', 0.45, 1);
    }
  }
  if (part.detail === 'pallet') {
    for (let i = 1; i < 6; i += 1) line([[x + w * i / 6, y + 0.05, z + h], [x + w * i / 6, y + d - 0.05, z + h]], 'face-slat', 0.6, 1.5);
    for (const u of [0.12, 0.62]) rect(front, u, 0.1, u + 0.25, 0.55, 'face-fork-pocket', tones.edge, 0.7);
  }
  if (part.detail === 'concrete') {
    for (let i = 0; i < 2 + seed % 2; i += 1) {
      const hash = iso_hash(seed, i);
      const u = 0.15 + (hash % 550) / 1000;
      const v = 0.15 + ((hash >>> 10) % 550) / 1000;
      line([[x + w * u, y + d * v, z + h], [x + w * (u + 0.04), y + d * (v + 0.025), z + h], [x + w * (u + 0.065), y + d * (v + 0.01), z + h], [x + w * (u + 0.1), y + d * (v + 0.04), z + h]], 'face-crack', 0.08, 0.55, ink);
    }
    for (let xx = Math.ceil((x + 0.1) / 4) * 4; xx < x + w - 0.1; xx += 4) line([[xx, y + 0.1, z + h], [xx, y + d - 0.1, z + h]], 'face-joint', 0.14, 0.6, ink);
    for (let yy = Math.ceil((y + 0.1) / 4) * 4; yy < y + d - 0.1; yy += 4) line([[x + 0.1, yy, z + h], [x + w - 0.1, yy, z + h]], 'face-joint', 0.14, 0.6, ink);
    let cells = 0;
    for (let ix = Math.floor(x); ix < x + w && cells < 1200; ix += 2) for (let iy = Math.floor(y); iy < y + d && cells < 1200; iy += 2) {
      cells += 1;
      const hash = iso_hash(ix, iy);
      for (let dot = 0; dot < hash % 3; dot += 1) {
        const xx = ix + ((hash >>> (dot * 5)) % 100) / 55;
        const yy = iy + ((hash >>> (dot * 5 + 8)) % 100) / 55;
        if (xx > x + 0.15 && xx < x + w - 0.15 && yy > y + 0.15 && yy < y + d - 0.15) {
          const r = 0.018 + (hash % 4) * 0.012;
          poly([[xx - r, yy, z + h], [xx, yy - r, z + h], [xx + r, yy, z + h], [xx, yy + r, z + h]], 'face-mottle', ink, 0.04 + (hash % 3) * 0.01);
        }
      }
    }
    line([[x + 0.12, y + 0.12, z + h], [x + w - 0.12, y + 0.12, z + h], [x + w - 0.12, y + d - 0.12, z + h], [x + 0.12, y + d - 0.12, z + h], [x + 0.12, y + 0.12, z + h]], 'face-wear', 0.42, 0.7, tones.top);
    line([[x + 0.5, y + d / 2, z + h], [x + w - 0.5, y + d / 2, z + h]], 'face-lane', 0.1, 0.8, ink);
    paths[paths.length - 1].dash = [1.2, 1.2];
  }
  return { polygons, paths, texts };
}

function iso_material(solid, part, theme) {
  const tones = TOKENS[theme][part.color];
  const finish = iso_finish(part.color);
  solid.polygons = solid.polygons.flatMap((face) => {
    const match = /face-(top|left|right|body|cap)$/.exec(face.cls || '');
    if (!match) return [face];
    return [face, { points: face.points, fill: 'url(#' + iso_textureRef(finish, match[1]) + ')', opacity: finish === 'matte' ? 0.04 : 0.025, stroke: 'none', cls: 'face face-texture' }];
  });
  const top = solid.polygons.find((p) => p.cls === 'face face-top');
  if (top) {
    solid.polygons.push({ points: top.points, fill: 'none', stroke: iso_lighten(tones.top, 0.3), strokeWidth: 1, vectorEffect: true, cls: 'face face-rim' });
    if (['blue', 'green', 'plum', 'amber'].includes(part.color)) solid.polygons.push({ points: top.points, fill: 'url(#iso-sheen)', stroke: 'none', cls: 'face face-sheen' });
  }
  if (part.kind !== 'cylinder') {
    const [x, y, z] = part.at;
    const [w, d, h] = iso_prismSize(part);
    const c = Math.min(ISO_CHAMFER_MAX, Math.min(w, d, h) / 6);
    const points = [project(x + c, y + d, z + 0.05), project(x + c, y + d, z + h - c)];
    solid.paths.push({ points, d: iso_pathData(points), stroke: tones.top, width: 1, opacity: 0.7, cls: 'face face-rim-vertical' });
  }
  return solid;
}

function iso_boxDecor(part, tones, theme) {
  const polygons = [];
  const paths = [];
  const [x, y, z] = part.at;
  const [width, depth, height] = iso_prismSize(part);
  const base = tones.left;
  const c = Math.min(ISO_CHAMFER_MAX, Math.min(width, depth, height) / 6);
  const south = y + depth;
  const east = x + width;

  if (part.vents === true) {
    const count = Math.max(4, Math.min(6, Math.round(height) + 2));
    const x0 = x + 0.3 * width;
    const x1 = x + 0.7 * width;
    const z0 = z + 0.18 * height;
    const z1 = z + 0.82 * height;
    const slot = (z1 - z0) / count;
    for (let index = 0; index < count; index += 1) {
      const za = z0 + index * slot + slot * 0.28;
      const zb = za + slot * 0.44;
      const points = [[x0, south, za], [x1, south, za], [x1, south, zb], [x0, south, zb]]
        .map((point) => project(point[0], point[1], point[2]));
      const even = index % 2 === 0;
      polygons.push({
        points,
        fill: even ? iso_darken(base, 0.3) : iso_lighten(base, 0.12),
        stroke: even ? iso_lighten(base, 0.28) : iso_darken(base, 0.22),
        strokeWidth: 0.5,
        vectorEffect: true,
        cls: 'face face-vent'
      });
    }
  }

  if (part.detail === 'rack') {
    const count = Math.max(6, Math.min(8, Math.round(height) + 4));
    const x0 = x + 0.12 * width;
    const x1 = x + 0.88 * width;
    const z0 = z + 0.12 * height;
    const z1 = z + 0.88 * height;
    const slot = (z1 - z0) / count;
    for (let index = 0; index < count; index += 1) {
      const za = z0 + index * slot + slot * 0.14;
      const zb = za + slot * 0.72;
      const points = [[x0, south, za], [x1, south, za], [x1, south, zb], [x0, south, zb]]
        .map((point) => project(point[0], point[1], point[2]));
      polygons.push({
        points,
        fill: index % 2 === 0 ? iso_darken(base, 0.16) : iso_lighten(base, 0.08),
        stroke: 'none',
        cls: 'face face-rack'
      });
    }
    const pz = z + 0.5 * height;
    const stripA = [[east, y + 0.16 * depth, pz - 0.03], [east, y + 0.84 * depth, pz - 0.03],
      [east, y + 0.84 * depth, pz + 0.03], [east, y + 0.16 * depth, pz + 0.03]]
      .map((point) => project(point[0], point[1], point[2]));
    polygons.push({
      points: stripA,
      fill: iso_darken(base, 0.24),
      stroke: iso_lighten(base, 0.24),
      strokeWidth: 0.4,
      vectorEffect: true,
      cls: 'face face-power'
    });
  }

  if (part.detail === 'tray') {
    const inner = c;
    const x0 = x + inner + 0.1 * (width - 2 * inner);
    const x1 = x + width - inner - 0.1 * (width - 2 * inner);
    for (let index = 1; index <= 3; index += 1) {
      const yy = y + inner + (depth - 2 * inner) * (index / 4);
      const points = [[x0, yy, z + height], [x1, yy, z + height]]
        .map((point) => project(point[0], point[1], point[2]));
      paths.push({
        points,
        d: iso_pathData(points),
        stroke: iso_darken(base, 0.28),
        width: 0.5,
        opacity: 0.65,
        vectorEffect: true,
        cls: 'face face-tray'
      });
    }
  }

  if (Number.isInteger(part.leds) && part.leds > 0) {
    const count = Math.min(6, part.leds);
    const zLed = z + height - Math.min(0.4, height * 0.2);
    for (let index = 0; index < count; index += 1) {
      const t = count === 1 ? 0.5 : (index + 0.5) / count;
      const yy = y + depth * (0.25 + 0.5 * t);
      const color = ISO_LED_RING[index % ISO_LED_RING.length];
      const led = iso_token(color, theme).left;
      polygons.push({
        points: iso_circlePlane('x', east + 0.004, yy, zLed, part.accent ? ISO_LED_GLOW * 2.5 : ISO_LED_GLOW)
          .map((point) => project(point[0], point[1], point[2])),
        fill: led,
        opacity: 0.5,
        stroke: 'none',
        cls: 'face face-led-glow'
      });
      polygons.push({
        points: iso_circlePlane('x', east + 0.008, yy, zLed, ISO_LED_RADIUS)
          .map((point) => project(point[0], point[1], point[2])),
        fill: iso_lighten(led, 0.22),
        stroke: iso_darken(led, 0.4),
        strokeWidth: 0.4,
        vectorEffect: true,
        cls: 'face face-led'
      });
    }
  }

  return { polygons, paths };
}

function iso_prism(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('box/plate requires an options object');
  }
  if (!Array.isArray(opts.at)) {
    throw new Error('part requires "at" [x,y,z]');
  }
  const [x, y, z] = opts.at;
  const [width, depth, height] = iso_prismSize(opts);
  const tones = iso_token(opts.color, opts.theme);
  const theme = iso_resolveTheme(opts.theme);
  const accent = opts.accent === true;
  const toScreen = (point) => project(point[0], point[1], point[2]);
  const c = Math.min(ISO_CHAMFER_MAX, Math.min(width, depth, height) / 6);
  const k = c;
  const center = [x + width / 2, y + depth / 2, z + height / 2];
  const ink = iso_token('ink', theme).left;
  const polygons = [];
  const paths = [];

  if (accent) {
    const footprint = iso_octagon(x, y, width, depth, 0, k, z).map(toScreen);
    polygons.push({
      points: iso_expand(footprint, ISO_GLOW_SCALE),
      fill: tones.left,
      stroke: 'none',
      opacity: ISO_GLOW_OPACITY,
      cls: 'face glow'
    });
  }

  for (const face of iso_chamferedFaces(x, y, z, width, depth, height, c, k)) {
    const normal = iso_outwardNormal(face.pts, center);
    if (iso_dot2(normal, ISO_VIEW) <= 1e-9) continue;
    if (face.kind === 'top') {
      polygons.push({
        points: face.pts.map(toScreen),
        fill: 'url(#' + iso_gradientId(opts.color, accent ? 'rim' : 'top') + ')',
        stroke: iso_lighten(tones.left, 0.52),
        strokeWidth: 0.6,
        vectorEffect: true,
        cls: 'face face-top'
      });
    } else if (face.kind === 'chamfer') {
      polygons.push({
        points: face.pts.map(toScreen),
        fill: 'url(#' + iso_gradientId(opts.color, 'rim') + ')',
        stroke: 'none',
        cls: 'face face-chamfer'
      });
    } else {
      const right = normal[0] >= normal[1];
      polygons.push({
        points: face.pts.map(toScreen),
        fill: 'url(#' + iso_gradientId(opts.color, right ? 'right' : 'left') + ')',
        stroke: tones.edge,
        strokeWidth: 0.7,
        vectorEffect: true,
        cls: 'face ' + (right ? 'face-right' : 'face-left')
      });
      const shoulder = [face.pts[2], face.pts[3]].map(toScreen);
      paths.push({
        points: shoulder,
        d: iso_pathData(shoulder),
        stroke: ink,
        width: 0.5,
        opacity: 0.28,
        vectorEffect: true,
        cls: 'face face-seam'
      });
    }
  }

  const extra = iso_detail(opts, tones, theme);
  polygons.push(...extra.polygons);
  paths.push(...extra.paths);
  const decor = iso_boxDecor(opts, tones, theme);
  for (const polygon of decor.polygons) polygons.push(polygon);
  for (const path of decor.paths) paths.push(path);

  return {
    id: opts.id,
    cls: opts.cls || 'part',
    depthKey: x + y + z,
    texts: extra.texts,
    polygons,
    paths,
    attrs: iso_partAttributes(opts)
  };
}

export function box(opts) {
  return iso_prism(opts);
}

export function plate(opts) {
  return iso_prism(opts);
}

function iso_hull(points) {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (list) => {
    const out = [];
    for (const point of list) {
      while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], point) <= 0) out.pop();
      out.push(point);
    }
    return out.slice(0, -1);
  };
  return half(sorted).concat(half(sorted.slice().reverse()));
}

function iso_ringPoint(basis, at, offset, radius, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    at[0] + basis.along[0] * offset + radius * (cos * basis.u[0] + sin * basis.v[0]),
    at[1] + basis.along[1] * offset + radius * (cos * basis.u[1] + sin * basis.v[1]),
    at[2] + basis.along[2] * offset + radius * (cos * basis.u[2] + sin * basis.v[2])
  ];
}

function iso_frontArc(basis, at, offset, radius) {
  const projected = [];
  for (let index = 0; index <= ISO_SEGMENTS; index += 1) {
    const angle = -Math.PI / 4 + (index / ISO_SEGMENTS) * Math.PI;
    projected.push(project(...iso_ringPoint(basis, at, offset, radius, angle)));
  }
  return projected;
}

export function cylinder(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('cylinder requires an options object');
  }
  if (!Array.isArray(opts.at)) {
    throw new Error('part requires "at" [x,y,z]');
  }
  const radius = Number(opts.radius);
  const height = Number(opts.h);
  if (!(radius > 0)) throw new Error('cylinder requires radius > 0');
  if (!(height > 0)) throw new Error('cylinder requires h > 0');
  const axis = opts.axis == null ? 'z' : opts.axis;
  const basis = iso_axisBasis(axis);
  const tones = iso_token(opts.color, opts.theme);
  const accent = opts.accent === true;
  const [x, y, z] = opts.at;
  const at = [x, y, z];
  const ring = (offset, factor) => {
    const points = [];
    for (let index = 0; index < ISO_SEGMENTS; index += 1) {
      const angle = (index / ISO_SEGMENTS) * Math.PI * 2;
      points.push(project(...iso_ringPoint(basis, at, offset, radius * factor, angle)));
    }
    return points;
  };
  const bottom = ring(0, 1);
  const top = ring(height, 1);
  const band = iso_hull(bottom.concat(top));
  const polygons = [];
  const paths = [];

  if (accent) {
    polygons.push({
      points: iso_expand(bottom, ISO_GLOW_SCALE),
      fill: tones.left,
      stroke: 'none',
      opacity: ISO_GLOW_OPACITY,
      cls: 'face glow'
    });
  }

  polygons.push({ points: band, fill: 'url(#' + iso_gradientId(opts.color, 'left') + ')', stroke: 'none', cls: 'face face-body' });

  for (let index = 0; index < ISO_SEGMENTS; index += 1) {
    const next = (index + 1) % ISO_SEGMENTS;
    const midAngle = ((index + 0.5) / ISO_SEGMENTS) * Math.PI * 2;
    const cos = Math.cos(midAngle);
    const sin = Math.sin(midAngle);
    const direction = [
      cos * basis.u[0] + sin * basis.v[0],
      cos * basis.u[1] + sin * basis.v[1],
      cos * basis.u[2] + sin * basis.v[2]
    ];
    if (project(direction[0], direction[1], direction[2])[0] > 0) {
      polygons.push({
        points: [bottom[index], bottom[next], top[next], top[index]],
        fill: 'url(#' + iso_gradientId(opts.color, 'right') + ')',
        stroke: 'none',
        cls: 'face face-right'
      });
    }
  }

  paths.push({
    points: iso_frontArc(basis, at, 0, radius),
    d: iso_pathData(iso_frontArc(basis, at, 0, radius)),
    stroke: tones.edge,
    width: 0.7,
    opacity: 0.9,
    vectorEffect: true,
    cls: 'face face-base'
  });

  for (const fraction of [1 / 3, 2 / 3]) {
    const offset = height * fraction;
    const highlight = iso_frontArc(basis, at, offset + 0.025, radius);
    const shadow = iso_frontArc(basis, at, offset - 0.025, radius);
    paths.push({
      points: highlight,
      d: iso_pathData(highlight),
      stroke: iso_lighten(tones.left, 0.35),
      width: 0.6,
      opacity: 0.7,
      vectorEffect: true,
      cls: 'face face-ring-lite'
    });
    paths.push({
      points: shadow,
      d: iso_pathData(shadow),
      stroke: iso_darken(tones.left, 0.3),
      width: 0.6,
      opacity: 0.7,
      vectorEffect: true,
      cls: 'face face-ring-dark'
    });
  }

  polygons.push({
    points: top,
    fill: 'url(#' + iso_gradientId(opts.color, accent ? 'rim' : 'top') + ')',
    stroke: tones.edge,
    strokeWidth: 0.7,
    vectorEffect: true,
    cls: 'face face-top'
  });
  polygons.push({
    points: ring(height, 0.88),
    fill: 'url(#' + iso_gradientId(opts.color, 'rim') + ')',
    stroke: iso_lighten(tones.left, 0.2),
    strokeWidth: 0.5,
    vectorEffect: true,
    cls: 'face face-cap'
  });

  if (opts.detail === 'tank' || opts.detail === 'coil') {
    const addLine = (points, cls, width = 0.8, stroke = tones.edge) => paths.push({ points, d: iso_pathData(points), stroke, width, opacity: 0.8, vectorEffect: true, cls: 'face ' + cls });
    if (opts.detail === 'coil') {
      for (const factor of [0.48, 0.7]) {
        const points = ring(height + 0.015, factor);
        addLine(points.concat([points[0]]), 'face-coil', 1.2);
      }
    } else {
      for (const lift of [0.08, 0.25]) {
        const points = ring(height + lift, 0.9);
        addLine(points.concat([points[0]]), 'face-tank-rail', 0.8, tones.top);
      }
      const local = (u, v, zz) => project(...iso_ringPoint(basis, at, zz, radius * u, v));
      for (const angle of [0.93, 1.22]) addLine([local(1.03, angle, 0.15), local(1.03, angle, height + 0.22)], 'face-ladder', 1.2);
      for (let step = 0.25; step < height; step += 0.3) addLine([local(1.04, 0.93, step), local(1.04, 1.22, step)], 'face-ladder-rung');
      const gauge = [local(1.015, 0.18, height * 0.2), local(1.015, 0.34, height * 0.2), local(1.015, 0.34, height * 0.78), local(1.015, 0.18, height * 0.78)];
      polygons.push({ points: gauge, fill: tones.edge, opacity: 0.65, cls: 'face face-gauge' });
      addLine([local(1.03, 0.18, height * 0.48), local(1.03, 0.34, height * 0.48)], 'face-gauge-level', 1, TOKENS[iso_resolveTheme(opts.theme)].amber.top);
      const knob = ring(height + 0.1, 0.13);
      polygons.push({ points: knob, fill: tones.edge, cls: 'face face-valve' });
      addLine([project(...iso_ringPoint(basis, at, height + 0.13, radius * 0.19, 0)), project(...iso_ringPoint(basis, at, height + 0.13, radius * 0.19, Math.PI))], 'face-valve-handle', 1.5, tones.top);
    }
  }

  return {
    id: opts.id,
    cls: opts.cls || 'part',
    depthKey: x + y + z + height / 2,
    polygons,
    paths,
    attrs: iso_partAttributes(opts)
  };
}

function iso_segmentNormal(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy) || 1;
  return [-dy / length, dx / length];
}

function iso_offsetPolyline(points, distance) {
  if (points.length < 2) return points.map((point) => point.slice());
  const offset = [];
  for (let index = 0; index < points.length; index += 1) {
    let nx = 0;
    let ny = 0;
    if (index > 0) {
      const normal = iso_segmentNormal(points[index - 1][0], points[index - 1][1], points[index][0], points[index][1]);
      nx += normal[0];
      ny += normal[1];
    }
    if (index < points.length - 1) {
      const normal = iso_segmentNormal(points[index][0], points[index][1], points[index + 1][0], points[index + 1][1]);
      nx += normal[0];
      ny += normal[1];
    }
    const length = Math.hypot(nx, ny) || 1;
    offset.push([points[index][0] + (nx / length) * distance, points[index][1] + (ny / length) * distance]);
  }
  return offset;
}

export function linkPoints(points, kind) {
  if (!Array.isArray(points) || points.length !== 2 || kind !== 'cable') {
    return points.map((point) => point.slice());
  }
  const [a, b] = points;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const length = Math.hypot(dx, dy, dz);
  const sag = Math.min(ISO_CABLE_SAG_MAX, length * ISO_CABLE_SAG_RATIO);
  const control = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 - sag];
  const sampled = [];
  for (let index = 0; index <= ISO_CABLE_SEGMENTS; index += 1) {
    const t = index / ISO_CABLE_SEGMENTS;
    const mt = 1 - t;
    sampled.push([
      mt * mt * a[0] + 2 * mt * t * control[0] + t * t * b[0],
      mt * mt * a[1] + 2 * mt * t * control[1] + t * t * b[1],
      mt * mt * a[2] + 2 * mt * t * control[2] + t * t * b[2]
    ]);
  }
  return sampled;
}

export function tube(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('tube requires an options object');
  }
  if (!Array.isArray(opts.points) || opts.points.length < 2) {
    throw new Error('tube requires at least two points');
  }
  const tones = iso_token(opts.color, opts.theme);
  const isCable = opts.kind === 'cable';
  const half = typeof opts.radius === 'number' && opts.radius > 0 ? opts.radius : (isCable ? 0.03 : 0.05);
  const width = half * 2 * (isCable ? 0.62 : 1);
  const scale = typeof opts.scale === 'number' && opts.scale > 0 ? opts.scale : 1;
  const world = linkPoints(opts.points, isCable ? 'cable' : 'tube');
  const projected = world.map((point) => project(point[0], point[1], point[2]));
  const outlineWidth = width * 2;
  const specular = projected.map((point) => [
    point[0] - ISO_LINK_SPECULAR_PX / scale,
    point[1] - ISO_LINK_SPECULAR_PX / scale
  ]);
  const dash = isCable ? [width * 2.4, width * 1.8] : null;
  const baseCls = isCable ? 'link-path link-cable' : 'link-path link-tube';
  const paths = [
    {
      points: projected,
      d: iso_pathData(projected),
      stroke: tones.edge,
      width: outlineWidth,
      opacity: 0.85,
      cls: baseCls + ' link-outline',
      dash,
      vectorEffect: false
    },
    {
      points: projected,
      d: iso_pathData(projected),
      stroke: tones.left,
      width,
      opacity: 1,
      cls: baseCls,
      dash,
      vectorEffect: false
    },
    {
      points: specular,
      d: iso_pathData(specular),
      stroke: iso_lighten(tones.left, 0.5),
      width: width * 0.25,
      opacity: 0.9,
      cls: 'link-highlight',
      dash,
      vectorEffect: false
    }
  ];
  let sum = 0;
  for (const point of world) sum += point[0] + point[1] + point[2];
  return {
    id: opts.id,
    cls: opts.cls || 'link',
    depthKey: sum / world.length,
    polygons: [],
    paths,
    attrs: opts.attrs || iso_partAttributes(opts)
  };
}

function iso_buildPart(part, theme) {
  const opts = Object.assign({}, part, { theme });
  if (part.kind === 'box') return iso_material(box(opts), part, theme);
  if (part.kind === 'plate') return iso_material(plate(opts), part, theme);
  if (part.kind === 'cylinder') return iso_material(cylinder(opts), part, theme);
  throw new Error('unknown part kind: ' + String(part.kind));
}

function iso_center(ports) {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const keys = Object.keys(ports);
  for (const key of keys) {
    cx += ports[key][0];
    cy += ports[key][1];
    cz += ports[key][2];
  }
  const count = keys.length || 1;
  return [cx / count, cy / count, cz / count];
}

function iso_distanceSquared(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function iso_pickPort(ports, requested, target, field) {
  if (requested != null) {
    if (!Object.prototype.hasOwnProperty.call(ports, requested)) {
      throw new Error('unknown ' + field + ': ' + String(requested));
    }
    return ports[requested];
  }
  let best = null;
  let bestDistance = Infinity;
  for (const key of Object.keys(ports)) {
    const distance = iso_distanceSquared(ports[key], target);
    if (distance < bestDistance - 1e-12) {
      bestDistance = distance;
      best = ports[key];
    }
  }
  return best;
}

function iso_footprintCorners(part) {
  const [x, y, z] = part.at;
  if (part.kind === 'box' || part.kind === 'plate') {
    const [width, depth] = iso_prismSize(part);
    return [[x, y, z], [x + width, y, z], [x + width, y + depth, z], [x, y + depth, z]];
  }
  const radius = Number(part.radius);
  const axis = part.axis == null ? 'z' : part.axis;
  const basis = iso_axisBasis(axis);
  const points = [];
  if (axis !== 'z') {
    const h = Number(part.h);
    for (let index = 0; index < 16; index += 1) {
      const angle = index / 16 * Math.PI * 2;
      points.push(axis === 'x'
        ? [x + h / 2 + h / 2 * Math.cos(angle), y + radius * Math.sin(angle), z - radius]
        : [x + radius * Math.cos(angle), y + h / 2 + h / 2 * Math.sin(angle), z - radius]);
    }
    return points;
  }
  for (let index = 0; index < ISO_SEGMENTS; index += 1) {
    const angle = (index / ISO_SEGMENTS) * Math.PI * 2;
    points.push(iso_ringPoint(basis, part.at, 0, radius, angle));
  }
  return points;
}

function iso_projectedBase(part) {
  const corners = iso_footprintCorners(part).map((point) => project(point[0], point[1], point[2]));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of corners) {
    if (point[0] < minX) minX = point[0];
    if (point[1] < minY) minY = point[1];
    if (point[0] > maxX) maxX = point[0];
    if (point[1] > maxY) maxY = point[1];
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    rx: Math.max((maxX - minX) / 2, 0.05),
    ry: Math.max((maxY - minY) / 2, 0.05)
  };
}

function iso_ellipsePoints(cx, cy, rx, ry) {
  const points = [];
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2;
    points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }
  return points;
}

function iso_isSlab(part) {
  if (!part || part.kind !== 'plate') return false;
  if (!Array.isArray(part.at) || Number(part.at[2]) > 0) return false;
  const [width, depth] = iso_prismSize(part);
  return width * depth >= 40 || part.detail === 'concrete';
}

function iso_slabDecor(part, tones) {
  const [x, y, z] = part.at;
  const [width, depth, height] = iso_prismSize(part);
  const c = Math.min(ISO_CHAMFER_MAX, Math.min(width, depth, height) / 6);
  const inset = c;
  const dark = iso_darken(tones.left, 0.42);
  const toScreen = (points) => points.map((point) => project(point[0], point[1], point[2]));
  const southFace = (u0, u1, za, zb) => toScreen([
    [x + u0, y + depth, z + za],
    [x + u1, y + depth, z + za],
    [x + u1, y + depth, z + zb],
    [x + u0, y + depth, z + zb]
  ]);
  const eastFace = (v0, v1, za, zb) => toScreen([
    [x + width, y + v0, z + za],
    [x + width, y + v1, z + za],
    [x + width, y + v1, z + zb],
    [x + width, y + v0, z + zb]
  ]);
  const polygons = [];
  const paths = [];
  const band = { fill: dark, opacity: 0.5, stroke: 'none', cls: 'face face-strata' };
  polygons.push(Object.assign({ points: southFace(inset, width - inset, 0, height * 0.5), fill: 'url(#iso-slab-ao)', stroke: 'none', cls: 'face face-slab-ao' }));
  polygons.push(Object.assign({ points: eastFace(inset, depth - inset, 0, height * 0.5), fill: 'url(#iso-slab-ao)', stroke: 'none', cls: 'face face-slab-ao' }));
  polygons.push(Object.assign({}, band, { points: southFace(inset, width - inset, 0, height * 0.34) }));
  polygons.push(Object.assign({}, band, { points: eastFace(inset, depth - inset, 0, height * 0.34) }));
  for (const [fraction, opacity] of [[0.3, 0.18], [0.56, 0.12], [0.8, 0.18]]) {
    const za = z + height * fraction;
    const south = toScreen([[x + inset, y + depth, za], [x + width - inset, y + depth, za]]);
    const east = toScreen([[x + width, y + inset, za], [x + width, y + depth - inset, za]]);
    paths.push({ points: south, d: iso_pathData(south), stroke: dark, width: 0.7, opacity, vectorEffect: true, cls: 'face face-strata-line' });
    paths.push({ points: east, d: iso_pathData(east), stroke: dark, width: 0.7, opacity, vectorEffect: true, cls: 'face face-strata-line' });
  }
  const top = iso_octagon(x, y, width, depth, c, c, z + height);
  const sheen = toScreen([top[2], top[3], top[4], top[5], top[6]]);
  paths.push({ points: sheen, d: iso_pathData(sheen), stroke: iso_lighten(tones.top, 0.5), width: 1, opacity: 0.5, vectorEffect: true, cls: 'face face-slab-rim' });
  return { polygons, paths };
}

function iso_slabUndershadow(part) {
  const base = iso_projectedBase(part);
  const ellipse = {
    cx: base.cx,
    cy: base.cy + base.ry * 0.28,
    rx: base.rx * 1.6,
    ry: base.ry * 1.6,
    fill: 'url(#iso-slab-void)'
  };
  return {
    cls: 'ground slab-void',
    depthKey: -1e9,
    polygons: [],
    paths: [],
    ellipses: [ellipse]
  };
}

function iso_partDepthKey(part) {
  const [x, y, z] = part.at;
  return x + y + z + (part.kind === 'cylinder' ? Number(part.h) / 2 : 0);
}

function iso_shadowSolid(part, theme) {
  if (!Array.isArray(part.at)) return null;
  const base = iso_projectedBase(part);
  const footprint = iso_footprintCorners(part).map((point) => project(...point));
  const height = part.kind === 'cylinder' ? (part.axis && part.axis !== 'z' ? part.radius * 2 : part.h) : iso_prismSize(part)[2];
  const sunk = theme === 'dark';
  const polygons = [1.6, 1].map((spread) => {
    const near = iso_expand(footprint, spread === 1 ? 1 : 1 + Math.min(0.12, height * 0.12 / Math.max(base.rx, base.ry)));
    const far = near.map(([x, y]) => [x + height * 0.3 * spread, y + height * 0.45 * spread]);
    const opacity = spread === 1 ? (sunk ? 0.72 : 1) : (sunk ? 0.26 : 0.45);
    return { points: iso_hull(near.concat(far)), fill: 'url(#iso-shadow-directional)', opacity, cls: 'shadow-directional' };
  });
  if (!sunk) {
    const near = iso_expand(footprint, 1);
    const far = near.map(([x, y]) => [x - height * 0.15, y - height * 0.225]);
    polygons.push({ points: iso_hull(near.concat(far)), fill: 'url(#iso-shadow-bounce)', cls: 'shadow-bounce' });
  }
  const ao = Math.max(0.55, Math.min(1.1, Math.sqrt(base.rx * base.ry) / 2.2));
  const offsetX = base.rx * ISO_SHADOW_OFFSET;
  const offsetY = base.ry * ISO_SHADOW_OFFSET;
  const soft = {
    cx: base.cx + offsetX,
    cy: base.cy + offsetY,
    rx: base.rx * ISO_SHADOW_SOFT,
    ry: base.ry * ISO_SHADOW_SOFT,
    fill: 'url(#iso-shadow-soft)'
  };
  const contact = {
    cx: base.cx,
    cy: base.cy,
    rx: base.rx * ISO_SHADOW_CONTACT,
    ry: base.ry * ISO_SHADOW_CONTACT,
    fill: 'url(#iso-shadow-contact)',
    opacity: ao
  };
  return {
    id: part.id,
    cls: 'ground',
    depthKey: iso_partDepthKey(part),
    polygons,
    paths: [],
    ellipses: [soft, contact, { cx: base.cx + 0.15, cy: base.cy + 0.08, rx: base.rx * 1.12, ry: base.ry * 0.82, fill: 'url(#iso-shadow-soft)', opacity: (sunk ? 0.14 : 0.24) * ao }, { cx: base.cx, cy: base.cy + base.ry * 0.5, rx: base.rx * 0.83, ry: base.ry * 0.18, fill: 'url(#iso-shadow-contact)', opacity: 0.7 * ao }],
    extentPoints: iso_ellipsePoints(soft.cx, soft.cy, soft.rx, soft.ry)
  };
}

function iso_worldExtent(parts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const part of parts) {
    if (!Array.isArray(part.at)) continue;
    const [x, y] = part.at;
    if (part.kind === 'box' || part.kind === 'plate') {
      const [width, depth] = iso_prismSize(part);
      include(x, y);
      include(x + width, y + depth);
    } else if (part.kind === 'cylinder') {
      const radius = Number(part.radius);
      const height = Number(part.h);
      const axis = part.axis == null ? 'z' : part.axis;
      if (axis === 'x') {
        include(x, y - radius);
        include(x + height, y + radius);
      } else if (axis === 'y') {
        include(x - radius, y);
        include(x + radius, y + height);
      } else {
        include(x - radius, y - radius);
        include(x + radius, y + radius);
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function iso_gridSolid(parts, bounds, theme) {
  const extent = iso_worldExtent(parts);
  if (!extent || !bounds) return null;
  const ink = iso_token('ink', theme).left;
  const circles = [];
  const startX = Math.ceil(extent.minX / ISO_DOT_SPACING) * ISO_DOT_SPACING;
  const startY = Math.ceil(extent.minY / ISO_DOT_SPACING) * ISO_DOT_SPACING;
  for (let wx = startX; wx <= extent.maxX; wx += ISO_DOT_SPACING) {
    for (let wy = startY; wy <= extent.maxY; wy += ISO_DOT_SPACING) {
      const point = project(wx, wy, 0);
      if (point[0] < bounds.minX - 1e-6 || point[0] > bounds.maxX + 1e-6) continue;
      if (point[1] < bounds.minY - 1e-6 || point[1] > bounds.maxY + 1e-6) continue;
      circles.push({ cx: point[0], cy: point[1], r: ISO_DOT_RADIUS, fill: ink, opacity: ISO_DOT_OPACITY });
      if (circles.length > ISO_DOT_LIMIT) return { cls: 'grid', polygons: [], paths: [], circles: [] };
    }
  }
  const concrete = parts.some((p) => p.kind === 'plate' && p.detail === 'concrete') ? { polygons: [], paths: [] } : iso_detail({ at: [extent.minX, extent.minY, -0.02], size: [extent.maxX - extent.minX, extent.maxY - extent.minY, 0.02], detail: 'concrete' }, TOKENS[theme].paper, theme);
  const inside = ([x, y]) => x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  return { cls: 'grid', polygons: concrete.polygons.filter((p) => p.points.every(inside)), paths: concrete.paths.filter((p) => p.points.every(inside)), circles };
}

function iso_bounds(solids) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (point) => {
    if (point[0] < minX) minX = point[0];
    if (point[1] < minY) minY = point[1];
    if (point[0] > maxX) maxX = point[0];
    if (point[1] > maxY) maxY = point[1];
  };
  for (const solid of solids) {
    for (const polygon of solid.polygons || []) {
      for (const point of polygon.points) include(point);
    }
    for (const path of solid.paths || []) {
      for (const point of path.points || []) include(point);
    }
    for (const point of solid.extentPoints || []) include(point);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  return { minX, minY, maxX, maxY };
}

function iso_fit(bounds, width, height, hasTitle) {
  const contentWidth = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const contentHeight = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const titleSpace = hasTitle ? ISO_TITLE_SPACE : 0;
  const availableWidth = Math.max(width - ISO_MARGIN * 2, 1);
  const availableHeight = Math.max(height - ISO_MARGIN * 2 - titleSpace, 1);
  const scale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight);
  const tx = ISO_MARGIN + (availableWidth - contentWidth * scale) / 2 - bounds.minX * scale;
  const ty = ISO_MARGIN + titleSpace + (availableHeight - contentHeight * scale) / 2 - bounds.minY * scale;
  const fill = (contentWidth * scale * contentHeight * scale) / (availableWidth * availableHeight);
  return { scale, tx, ty, fill };
}

function iso_solidMarkup(solid, scale = 1) {
  let attributes = ' class="' + iso_escape(solid.cls || '') + '"';
  if (solid.attrs) {
    for (const key of Object.keys(solid.attrs)) {
      attributes += ' ' + key + '="' + iso_escape(solid.attrs[key]) + '"';
    }
  }
  const markup = [];
  for (const polygon of solid.polygons || []) {
    let element = '<polygon points="' + iso_points(polygon.points) + '" fill="' + iso_escape(polygon.fill || 'none') + '"';
    if (polygon.stroke && polygon.stroke !== 'none') {
      const strokeWidth = polygon.strokeWidth == null ? 1 : polygon.strokeWidth;
      element += ' stroke="' + iso_escape(polygon.stroke) + '" stroke-width="' + iso_format(strokeWidth) + '"';
      if (polygon.vectorEffect !== false) element += ' vector-effect="non-scaling-stroke"';
      element += ' stroke-linejoin="round"';
    } else {
      element += ' stroke="none"';
    }
    if (polygon.opacity != null) element += ' fill-opacity="' + iso_format(polygon.opacity) + '"';
    if (polygon.cls) element += ' class="' + iso_escape(polygon.cls) + '"';
    element += '/>';
    markup.push(element);
  }
  for (const path of solid.paths || []) {
    let element = '<path d="' + path.d + '" fill="none" stroke="' + iso_escape(path.stroke) + '" stroke-width="' + iso_format(path.width) + '" stroke-linecap="round" stroke-linejoin="round"';
    if (path.dash) element += ' stroke-dasharray="' + path.dash.map(iso_format).join(' ') + '"';
    if (path.vectorEffect !== false) element += ' vector-effect="non-scaling-stroke"';
    if (path.opacity != null) element += ' stroke-opacity="' + iso_format(path.opacity) + '"';
    if (path.cls) element += ' class="' + iso_escape(path.cls) + '"';
    element += '/>';
    markup.push(element);
  }
  for (const ellipse of solid.ellipses || []) {
    let element = '<ellipse cx="' + iso_format(ellipse.cx) + '" cy="' + iso_format(ellipse.cy) + '" rx="' + iso_format(ellipse.rx) + '" ry="' + iso_format(ellipse.ry) + '" fill="' + iso_escape(ellipse.fill) + '"';
    if (ellipse.opacity != null) element += ' fill-opacity="' + iso_format(ellipse.opacity) + '"';
    element += '/>';
    markup.push(element);
  }
  for (const circle of solid.circles || []) {
    let element = '<circle cx="' + iso_format(circle.cx) + '" cy="' + iso_format(circle.cy) + '" r="' + iso_format(circle.r) + '" fill="' + iso_escape(circle.fill) + '"';
    if (circle.opacity != null) element += ' fill-opacity="' + iso_format(circle.opacity) + '"';
    element += '/>';
    markup.push(element);
  }
  for (const text of solid.texts || []) {
    if (text.available * scale < 4) continue;
    markup.push('<text class="face face-unit-label" x="' + iso_format(text.point[0]) + '" y="' + iso_format(text.point[1]) + '" font-size="' + iso_format(4.5 / scale) + '" fill="' + text.fill + '" opacity="0.55">' + iso_escape(text.text) + '</text>');
  }
  return '<g' + attributes + '>' + markup.join('') + '</g>';
}

function iso_labelMarkup(parts, fit, theme) {
  const tones = TOKENS[theme];
  const ink = tones.ink.left;
  const paper = tones.paper.left;
  const fontSize = ISO_LABEL_PX / fit.scale;
  const baseChipHeight = fontSize + 9 / fit.scale;
  const radius = 3 / fit.scale;
  const border = 1 / fit.scale;
  const shadowOffset = 1 / fit.scale;
  let markup = '';
  for (const part of parts) {
    if (!part.label) continue;
    const [x, y, z] = anchors(part).top;
    const [screenX, screenY] = project(x, y, z);
    const text = String(part.label);
    const chipHeight = baseChipHeight + (part.sublabel ? 12 / fit.scale : 0);
    const chipWidth = Math.max(0.62 * fontSize * text.length, part.sublabel ? 0.62 * 9 / fit.scale * part.sublabel.length : 0) + 10 / fit.scale;
    const chipX = screenX - chipWidth / 2;
    const chipY = screenY - ISO_LABEL_LIFT_PX / fit.scale - chipHeight;
    markup += '<rect x="' + iso_format(chipX + shadowOffset) + '" y="' + iso_format(chipY + shadowOffset) + '" width="' + iso_format(chipWidth) + '" height="' + iso_format(chipHeight) + '" rx="' + iso_format(radius) + '" fill="' + iso_escape(ink) + '" fill-opacity="0.12" stroke="none"/>';
    markup += '<rect class="label-chip" x="' + iso_format(chipX) + '" y="' + iso_format(chipY) + '" width="' + iso_format(chipWidth) + '" height="' + iso_format(chipHeight) + '" rx="' + iso_format(radius) + '" fill="' + iso_escape(paper) + '" stroke="' + iso_escape(ink) + '" stroke-opacity="0.4" stroke-width="' + iso_format(border) + '"/>';
    if (ISO_LABEL_LIFT_PX / fit.scale > 1.5) markup += '<path class="label-leader" d="M ' + iso_format(screenX) + ' ' + iso_format(screenY) + ' L ' + iso_format(screenX) + ' ' + iso_format(chipY + chipHeight) + '" stroke="' + ink + '" stroke-opacity="0.4" stroke-width="' + iso_format(1 / fit.scale) + '"/>';
    if (part.sublabel) markup += '<text class="label label-sublabel" x="' + iso_format(screenX) + '" y="' + iso_format(chipY + chipHeight - 4 / fit.scale) + '" text-anchor="middle" font-size="' + iso_format(9 / fit.scale) + '" fill="' + ink + '" opacity="0.6">' + iso_escape(part.sublabel) + '</text>';
    const baseline = chipY + baseChipHeight / 2 + fontSize * 0.34;
    markup += '<text class="label" x="' + iso_format(screenX) + '" y="' + iso_format(baseline) + '"'
      + ' text-anchor="middle" font-size="' + iso_format(fontSize) + '" fill="' + iso_escape(ink) + '">'
      + iso_escape(text) + '</text>';
  }
  return markup;
}

function iso_reflections(parts, solids, theme) {
  let markup = '<g class="reflections">';
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.kind === 'plate') continue;
    const footprint = iso_footprintCorners(part);
    const supported = parts.some((floor) => floor.kind === 'plate' && floor.at[2] <= 0 && Math.abs(floor.at[2] + iso_prismSize(floor)[2] - part.at[2]) < 0.01 && footprint.every((p) => p[0] >= floor.at[0] && p[0] <= floor.at[0] + floor.size[0] && p[1] >= floor.at[1] && p[1] <= floor.at[1] + floor.size[1]));
    if (!supported) continue;
    const base = iso_projectedBase(part);
    const faces = solids[index].polygons.filter((p) => /face-(top|left|right|body)$/.test(p.cls || ''));
    const reflected = faces.map((face) => ({ points: face.points.map(([xx, yy]) => [xx, base.cy + (base.cy - yy) * 0.35]), fill: TOKENS[theme][part.color].top, stroke: 'none' }));
    markup += iso_solidMarkup({ cls: 'reflection', attrs: { opacity: theme === 'dark' ? '0.08' : '0.055', mask: 'url(#iso-reflection-mask)' }, polygons: reflected });
  }
  return markup + '</g>';
}

function iso_connectors(specs, partsById, theme) {
  const polygons = [];
  for (const spec of specs) {
    const points = spec.points.map((p) => project(...p));
    const cable = spec.kind === 'cable';
    const width = (cable ? 0.0372 : 0.1) * 1.6;
    const endpoints = [[0, 1, spec.link.from], [points.length - 1, points.length - 2, spec.link.to]];
    for (const [index, next, id] of endpoints) {
      const p = points[index];
      const q = points[next];
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const dx = (q[0] - p[0]) / length;
      const dy = (q[1] - p[1]) / length;
      const local = (u, v) => [p[0] + dx * u - dy * v, p[1] + dy * u + dx * v];
      const fill = TOKENS[theme][partsById.get(id).color].edge;
      const ring = [];
      if (cable) ring.push(local(0, -width), local(width * 2, -width * 0.7), local(width * 2, width * 0.7), local(0, width));
      else for (let i = 0; i < 16; i += 1) ring.push(local(Math.cos(i * Math.PI / 8) * width * 0.5, Math.sin(i * Math.PI / 8) * width));
      polygons.push({ points: ring, fill, cls: cable ? 'link-plug' : 'link-collar' });
      if (!cable && Math.sqrt(iso_distanceSquared(spec.points[0], spec.points[spec.points.length - 1])) > 3) polygons.push({ points: ring.map(([xx, yy]) => [xx + dx * width, yy + dy * width]), fill: 'none', stroke: TOKENS[theme][partsById.get(id).color].top, strokeWidth: 0.025, vectorEffect: false, cls: 'link-flange' });
    }
    if (cable) for (const fraction of [1 / 3, 2 / 3]) {
      const i = Math.floor((points.length - 1) * fraction);
      const [nx, ny] = iso_segmentNormal(...points[i], ...points[i + 1]);
      const [xx, yy] = points[i];
      polygons.push({ points: [[xx + nx * width, yy + ny * width], [xx - nx * width, yy - ny * width], [xx - nx * width - ny * 0.05, yy - ny * width + nx * 0.05], [xx + nx * width - ny * 0.05, yy + ny * width + nx * 0.05]], fill: TOKENS[theme].steel.top, cls: 'link-tie' });
    }
  }
  return { cls: 'link-hardware', polygons };
}

export function renderSVG(scene) {
  if (!scene || typeof scene !== 'object') {
    throw new Error('renderSVG requires a scene object');
  }
  if (!Array.isArray(scene.parts)) {
    throw new Error('scene.parts must be an array');
  }
  const theme = iso_resolveTheme(scene.theme);
  const [width, height] = iso_resolveSize(scene.size);
  const partsById = new Map();
  const partSolids = [];
  const groundSolids = [];
  let primarySlab = null;
  scene.parts.forEach((part, index) => {
    if (!part || typeof part !== 'object') {
      throw new Error('part at index ' + index + ' must be an object');
    }
    if (typeof part.id !== 'string' || part.id.length === 0) {
      throw new Error('part at index ' + index + ' is missing an id');
    }
    if (partsById.has(part.id)) {
      throw new Error('duplicate part id: ' + part.id);
    }
    partsById.set(part.id, part);
    const solid = iso_buildPart(part, theme);
    if (iso_isSlab(part)) {
      const decor = iso_slabDecor(part, TOKENS[theme][part.color]);
      solid.polygons.push(...decor.polygons);
      solid.paths.push(...decor.paths);
      const [slabWidth, slabDepth] = iso_prismSize(part);
      const area = slabWidth * slabDepth;
      if (!primarySlab || area > primarySlab.area) primarySlab = { area, part };
    }
    partSolids.push(solid);
    const shadow = iso_shadowSolid(part, theme);
    if (shadow) groundSolids.push(shadow);
  });
  const voidSolid = primarySlab ? iso_slabUndershadow(primarySlab.part) : null;

  const linkSpecs = [];
  const links = Array.isArray(scene.links) ? scene.links : [];
  links.forEach((link, index) => {
    if (!link || typeof link !== 'object') {
      throw new Error('link at index ' + index + ' must be an object');
    }
    const source = partsById.get(link.from);
    const target = partsById.get(link.to);
    if (!source) throw new Error('link at index ' + index + ' references unknown part: ' + String(link.from));
    if (!target) throw new Error('link at index ' + index + ' references unknown part: ' + String(link.to));
    const sourcePorts = anchors(source);
    const targetPorts = anchors(target);
    const from = iso_pickPort(sourcePorts, link.fromPort, iso_center(targetPorts), 'fromPort');
    const to = iso_pickPort(targetPorts, link.toPort, iso_center(sourcePorts), 'toPort');
    const kind = link.kind === 'cable' ? 'cable' : 'tube';
    linkSpecs.push({
      link,
      kind,
      points: linkPoints([from, to], kind)
    });
  });

  const fitBounds = iso_bounds(partSolids.concat(groundSolids.map((solid) => ({ polygons: solid.polygons }))));
  for (const spec of linkSpecs) {
    for (const point of spec.points) {
      const projected = project(point[0], point[1], point[2]);
      if (projected[0] < fitBounds.minX) fitBounds.minX = projected[0];
      if (projected[1] < fitBounds.minY) fitBounds.minY = projected[1];
      if (projected[0] > fitBounds.maxX) fitBounds.maxX = projected[0];
      if (projected[1] > fitBounds.maxY) fitBounds.maxY = projected[1];
    }
  }
  const fit = iso_fit(fitBounds, width, height, Boolean(scene.title));

  const linkSolids = linkSpecs.map((spec) => tube({
    points: spec.points,
    radius: spec.kind === 'cable' ? 0.03 : 0.05,
    color: spec.link.color,
    kind: spec.kind,
    theme,
    scale: fit.scale,
    cls: 'link',
    attrs: { 'data-from': spec.link.from, 'data-to': spec.link.to }
  }));

  linkSolids.forEach((solid, index) => { solid.polygons.push(...iso_connectors([linkSpecs[index]], partsById, theme).polygons); });
  const floorIds = new Set(scene.parts.filter((part) => part.kind === 'plate' && part.at[2] <= 0 && iso_prismSize(part)[2] <= 1.2).map((part) => part.id));
  const floorSolids = partSolids.filter((solid) => floorIds.has(solid.id)).sort((a, b) => a.depthKey - b.depthKey);
  const objects = partSolids.filter((solid) => !floorIds.has(solid.id));
  const ranked = objects.slice().sort((a, b) => a.depthKey - b.depthKey);
  ranked.forEach((solid, index) => {
    const percentile = ranked.length <= 1 ? 1 : index / (ranked.length - 1);
    if (percentile >= 0.5) return;
    const faces = solid.polygons.filter((p) => /face-(top|left|right|body)$/.test(p.cls || ''));
    solid.polygons.push(...faces.map((face) => ({ points: face.points, fill: TOKENS[theme].paper.left, opacity: 0.04 + (0.5 - percentile) * 0.1, cls: 'face face-fog' })));
  });
  const bodies = objects.concat(linkSolids).sort((a, b) => a.depthKey - b.depthKey);
  const grounds = groundSolids.sort((a, b) => a.depthKey - b.depthKey);
  const grid = iso_gridSolid(scene.parts, fitBounds, theme);

  const voidMarkup = voidSolid ? iso_solidMarkup(voidSolid) : '';
  const gridMarkup = grid ? iso_solidMarkup(grid) : '';
  const floorMarkup = floorSolids.map((solid) => iso_solidMarkup({ ...grounds.find((shadow) => shadow.id === solid.id), cls: 'ground floor-shadow' }, fit.scale) + iso_solidMarkup(solid, fit.scale)).join('');
  const groundMarkup = grounds.filter((solid) => !floorIds.has(solid.id)).map((solid) => iso_solidMarkup(solid, fit.scale)).join('');
  const reflections = iso_reflections(scene.parts, partSolids, theme);
  const body = bodies.map((solid) => {
    const part = partsById.get(solid.id);
    let occlusion = '';
    const supported = part && scene.parts.some((floor) => floor.kind === 'plate' && floor.id !== part.id && Math.abs(floor.at[2] + iso_prismSize(floor)[2] - part.at[2]) < 0.01 && iso_footprintCorners(part).every(([x, y]) => x >= floor.at[0] && x <= floor.at[0] + floor.size[0] && y >= floor.at[1] && y <= floor.at[1] + floor.size[1]));
    if (part && part.kind !== 'plate' && (part.at[2] > 0 || supported)) {
      const contact = iso_shadowSolid(part, theme);
      contact.cls = 'surface-occlusion';
      contact.polygons = [];
      const base = iso_projectedBase(part);
      contact.ellipses = [contact.ellipses[1], { cx: base.cx, cy: base.cy, rx: base.rx * 1.15, ry: base.ry * 1.15, fill: 'url(#iso-contact-grime)' }];
      occlusion = iso_solidMarkup(contact);
    }
    return occlusion + iso_solidMarkup(solid, fit.scale);
  }).join('');
  const labels = iso_labelMarkup(scene.parts, fit, theme);
  const title = scene.title ? String(scene.title) : 'Isometric diagram';
  const sentence = (value) => /[.!?]$/.test(value) ? value : value + '.';
  const partName = (part) => part && part.label ? String(part.label) : String(part && part.id);
  const summary = [sentence(title)];
  if (scene.subtitle) summary.push(sentence(String(scene.subtitle)));
  summary.push('Parts: ' + scene.parts.map(partName).join(', ') + '.');
  if (links.length > 0) {
    summary.push('Links: ' + links.map((link) => partName(partsById.get(link.from)) + ' to ' + partName(partsById.get(link.to))).join(', ') + '.');
  }
  const descId = 'diorama-desc';
  const desc = iso_escape(summary.join(' '));
  const label = iso_escape(title);
  return '<svg xmlns="http://www.w3.org/2000/svg" class="diorama" viewBox="0 0 ' + iso_format(width) + ' ' + iso_format(height) + '"'
    + ' width="' + iso_format(width) + '" height="' + iso_format(height) + '"'
    + ' preserveAspectRatio="xMidYMid meet"'
    + ' data-fill="' + iso_format(fit.fill) + '" role="img" aria-label="' + label + '" aria-describedby="' + descId + '">'
    + '<title>' + label + '</title>'
    + '<desc id="' + descId + '">' + desc + '</desc>'
    + iso_defs(theme, scene.parts)
    + '<g transform="translate(' + iso_format(fit.tx) + ',' + iso_format(fit.ty) + ') scale(' + iso_format(fit.scale) + ')">'
    + gridMarkup + voidMarkup + floorMarkup + groundMarkup + reflections + body + labels
    + '</g></svg>';
}
