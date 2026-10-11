import { anchors, linkPoints } from './iso.mjs';

const scene_isNode = typeof process !== 'undefined' &&
  Boolean(process.versions) && Boolean(process.versions.node);

let scene_fs = null;
if (scene_isNode) {
  try {
    scene_fs = await import('node:fs');
  } catch (error) {
    scene_fs = null;
  }
}

const scene_PORTS = ['top', 'bottom', 'north', 'south', 'east', 'west'];
const scene_PORT_SET = new Set(scene_PORTS);
const scene_TOKEN_SET = new Set([
  'ink', 'paper', 'steel', 'slate', 'amber', 'copper',
  'blue', 'green', 'brick', 'plum', 'sand', 'cloud'
]);
const scene_PART_KINDS = new Set(['box', 'plate', 'cylinder']);
const scene_DETAIL_SET = new Set(['rack', 'tray', 'tower', 'switch', 'tank', 'crate', 'pallet', 'coil', 'concrete', 'none']);
const scene_LINK_KINDS = new Set(['tube', 'cable']);
const scene_FLOW_KINDS = new Set(['request', 'job', 'packet']);
const scene_AXIS_SET = new Set(['x', 'y', 'z']);
const scene_MAX_SIZE = 4096;

function scene_isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function scene_isPositive(value) {
  return scene_isFiniteNumber(value) && value > 0;
}

function scene_isVec3(value) {
  return Array.isArray(value) && value.length === 3 && value.every(scene_isFiniteNumber);
}

function scene_isToken(value) {
  return typeof value === 'string' && scene_TOKEN_SET.has(value);
}

export function validateScene(input) {
  const errors = [];
  const at = (path, message) => errors.push(`${path}: ${message}`);

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['$: scene must be an object'] };
  }

  if (input.version !== 1) at('version', 'required and must equal 1');
  if (typeof input.title !== 'string' || input.title.trim() === '') {
    at('title', 'required non-empty string');
  }
  if (input.theme !== 'light' && input.theme !== 'dark') {
    at('theme', 'must be "light" or "dark"');
  }
  if (input.subtitle !== undefined && typeof input.subtitle !== 'string') {
    at('subtitle', 'must be a string when present');
  }
  if (input.hint !== undefined && typeof input.hint !== 'string') {
    at('hint', 'must be a string when present');
  }

  if (input.size !== undefined) {
    const sizeOk = Array.isArray(input.size) && input.size.length === 2 &&
      input.size.every((n) => Number.isInteger(n) && n > 0 && n <= scene_MAX_SIZE);
    if (!sizeOk) {
      at('size', `must be [width, height] integers in 1..${scene_MAX_SIZE}`);
    }
  }

  const partIds = new Set();

  if (!Array.isArray(input.parts)) {
    at('parts', 'required array');
  } else {
    input.parts.forEach((part, index) => {
      const base = `parts[${index}]`;
      if (part === null || typeof part !== 'object' || Array.isArray(part)) {
        at(base, 'must be an object');
        return;
      }
      if (typeof part.id !== 'string' || part.id.trim() === '') {
        at(`${base}.id`, 'required non-empty string');
      } else if (partIds.has(part.id)) {
        at(`${base}.id`, `duplicate id "${part.id}"`);
      } else {
        partIds.add(part.id);
      }
      if (!scene_PART_KINDS.has(part.kind)) {
        at(`${base}.kind`, 'must be "box", "plate" or "cylinder"');
      }
      if (part.label !== undefined && typeof part.label !== 'string') {
        at(`${base}.label`, 'must be a string when present');
      }
      if (part.accent !== undefined && typeof part.accent !== 'boolean') {
        at(`${base}.accent`, 'must be a boolean when present');
      }
      if (!scene_isVec3(part.at)) {
        at(`${base}.at`, 'required [x, y, z] finite numbers');
      }
      if (!scene_isToken(part.color)) {
        at(`${base}.color`, 'must be a known color token');
      }
      if (part.kind === 'box' || part.kind === 'plate') {
        const sizeOk = Array.isArray(part.size) && part.size.length === 3 &&
          part.size.every(scene_isPositive);
        if (!sizeOk) at(`${base}.size`, 'required [w, d, h] positive numbers');
      }
      if (part.kind === 'cylinder') {
        if (!scene_isPositive(part.radius)) at(`${base}.radius`, 'required positive number');
        if (!scene_isPositive(part.h)) at(`${base}.h`, 'required positive number');
        if (!scene_AXIS_SET.has(part.axis)) at(`${base}.axis`, 'must be "x", "y" or "z"');
      }
      if (part.detail !== undefined && !scene_DETAIL_SET.has(part.detail)) {
        at(`${base}.detail`, 'must be "rack", "tray", "tower", "switch", "tank", "crate", "pallet", "coil", "concrete" or "none"');
      }
      for (const field of ['panels', 'hazard']) {
        if (part[field] !== undefined && typeof part[field] !== 'boolean') at(`${base}.${field}`, 'must be a boolean when present');
      }
      if (part.sublabel !== undefined && typeof part.sublabel !== 'string') at(`${base}.sublabel`, 'must be a string when present');
      if (part.vents !== undefined && typeof part.vents !== 'boolean') {
        at(`${base}.vents`, 'must be a boolean when present');
      }
      if (part.leds !== undefined && !(Number.isInteger(part.leds) && part.leds >= 0 && part.leds <= 6)) {
        at(`${base}.leds`, 'must be an integer in 0..6');
      }
    });
  }

  if (input.links !== undefined && !Array.isArray(input.links)) {
    at('links', 'must be an array when present');
  } else if (Array.isArray(input.links)) {
    input.links.forEach((link, index) => {
      const base = `links[${index}]`;
      if (link === null || typeof link !== 'object' || Array.isArray(link)) {
        at(base, 'must be an object');
        return;
      }
      if (typeof link.from !== 'string' || !partIds.has(link.from)) {
        at(`${base}.from`, 'must reference an existing part id');
      }
      if (typeof link.to !== 'string' || !partIds.has(link.to)) {
        at(`${base}.to`, 'must reference an existing part id');
      }
      if (link.fromPort !== undefined && !scene_PORT_SET.has(link.fromPort)) {
        at(`${base}.fromPort`, 'must be a known port name');
      }
      if (link.toPort !== undefined && !scene_PORT_SET.has(link.toPort)) {
        at(`${base}.toPort`, 'must be a known port name');
      }
      if (!scene_LINK_KINDS.has(link.kind)) {
        at(`${base}.kind`, 'must be "tube" or "cable"');
      }
      if (!scene_isToken(link.color)) {
        at(`${base}.color`, 'must be a known color token');
      }
      if (link.label !== undefined && typeof link.label !== 'string') {
        at(`${base}.label`, 'must be a string when present');
      }
    });
  }

  if (input.flows !== undefined && !Array.isArray(input.flows)) {
    at('flows', 'must be an array when present');
  } else if (Array.isArray(input.flows)) {
    input.flows.forEach((flow, index) => {
      const base = `flows[${index}]`;
      if (flow === null || typeof flow !== 'object' || Array.isArray(flow)) {
        at(base, 'must be an object');
        return;
      }
      if (!Array.isArray(flow.path) || flow.path.length < 2) {
        at(`${base}.path`, 'required array of at least two part ids');
      } else {
        flow.path.forEach((id, step) => {
          if (typeof id !== 'string' || !partIds.has(id)) {
            at(`${base}.path[${step}]`, 'must reference an existing part id');
          }
        });
      }
      if (!scene_FLOW_KINDS.has(flow.kind)) {
        at(`${base}.kind`, 'must be "request", "job" or "packet"');
      }
      if (!scene_isToken(flow.color)) {
        at(`${base}.color`, 'must be a known color token');
      }
      if (!scene_isFiniteNumber(flow.speed) || flow.speed < 6 || flow.speed > 24) {
        at(`${base}.speed`, 'required number of loops per minute in 6..24');
      }
      if (!Number.isInteger(flow.count) || flow.count < 2 || flow.count > 6) {
        at(`${base}.count`, 'required integer in 2..6');
      }
    });
  }

  if (input.readout !== undefined && !Array.isArray(input.readout)) {
    at('readout', 'must be an array when present');
  } else if (Array.isArray(input.readout)) {
    if (input.readout.length > 4) {
      at('readout', 'must contain at most 4 entries');
    }
    input.readout.forEach((entry, index) => {
      const base = `readout[${index}]`;
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        at(base, 'must be an object');
        return;
      }
      if (typeof entry.label !== 'string') at(`${base}.label`, 'required string');
      if (typeof entry.value !== 'string') at(`${base}.value`, 'required string');
    });
  }

  if (input.notes !== undefined && !Array.isArray(input.notes)) {
    at('notes', 'must be an array when present');
  } else if (Array.isArray(input.notes)) {
    input.notes.forEach((note, index) => {
      const base = `notes[${index}]`;
      if (note === null || typeof note !== 'object' || Array.isArray(note)) {
        at(base, 'must be an object');
        return;
      }
      if (typeof note.text !== 'string' || note.text.trim() === '') {
        at(`${base}.text`, 'required non-empty string');
      }
      if (typeof note.at !== 'string' || !partIds.has(note.at)) {
        at(`${base}.at`, 'must reference an existing part id');
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

export function loadScene(path) {
  if (!scene_fs) throw new Error('loadScene requires a node runtime with node:fs available');
  let parsed;
  try {
    parsed = JSON.parse(scene_fs.readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`scene parse error for ${path}: ${error.message}`);
  }
  const result = validateScene(parsed);
  if (!result.ok) {
    throw new Error(`invalid scene ${path}:\n${result.errors.join('\n')}`);
  }
  return parsed;
}

function scene_samePoint(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function scene_dist2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function scene_dist(a, b) {
  return Math.sqrt(scene_dist2(a, b));
}

function scene_centerOf(ports) {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let count = 0;
  for (const name of scene_PORTS) {
    const point = ports[name];
    if (!point) continue;
    cx += point[0];
    cy += point[1];
    cz += point[2];
    count += 1;
  }
  if (count === 0) return [0, 0, 0];
  return [cx / count, cy / count, cz / count];
}

function scene_nearestPort(ports, target) {
  let best = scene_PORTS[0];
  let bestDistance = Infinity;
  for (const name of scene_PORTS) {
    const point = ports[name];
    if (!point) continue;
    const distance = scene_dist2(point, target);
    if (distance < bestDistance - 1e-12) {
      bestDistance = distance;
      best = name;
    }
  }
  return best;
}

export function resolveLinks(scene) {
  const byId = new Map((scene.parts || []).map((part) => [part.id, part]));
  const links = Array.isArray(scene.links) ? scene.links : [];
  const resolved = [];
  for (const link of links) {
    const fromPart = byId.get(link.from);
    const toPart = byId.get(link.to);
    if (!fromPart || !toPart) continue;
    const fromPorts = anchors(fromPart);
    const toPorts = anchors(toPart);
    const fromCenter = scene_centerOf(fromPorts);
    const toCenter = scene_centerOf(toPorts);
    const fromPort = link.fromPort && fromPorts[link.fromPort]
      ? link.fromPort
      : scene_nearestPort(fromPorts, toCenter);
    const toPort = link.toPort && toPorts[link.toPort]
      ? link.toPort
      : scene_nearestPort(toPorts, fromCenter);
    const pointA = fromPorts[fromPort].slice();
    const pointB = toPorts[toPort].slice();
    const kind = link.kind === 'cable' ? 'cable' : 'tube';
    resolved.push({
      from: link.from,
      to: link.to,
      fromPort,
      toPort,
      kind,
      points: linkPoints([pointA, pointB], kind)
    });
  }
  return resolved;
}

function scene_directEdge(byId, fromId, toId) {
  const fromPorts = anchors(byId.get(fromId));
  const toPorts = anchors(byId.get(toId));
  const fromCenter = scene_centerOf(fromPorts);
  const toCenter = scene_centerOf(toPorts);
  const fromPort = scene_nearestPort(fromPorts, toCenter);
  const toPort = scene_nearestPort(toPorts, fromCenter);
  return {
    from: fromId,
    to: toId,
    fromPort,
    toPort,
    points: [fromPorts[fromPort].slice(), toPorts[toPort].slice()]
  };
}

function scene_orientEdge(edge, fromId) {
  if (edge.from === fromId) return edge;
  return {
    from: edge.to,
    to: edge.from,
    fromPort: edge.toPort,
    toPort: edge.fromPort,
    points: edge.points.slice().reverse()
  };
}

export function resolveFlows(scene) {
  const byId = new Map((scene.parts || []).map((part) => [part.id, part]));
  const links = resolveLinks(scene);
  const flows = Array.isArray(scene.flows) ? scene.flows : [];
  return flows.map((flow) => {
    const edges = [];
    const path = Array.isArray(flow.path) ? flow.path : [];
    for (let step = 0; step < path.length - 1; step += 1) {
      const fromId = path[step];
      const toId = path[step + 1];
      const link = links.find((candidate) => (
        (candidate.from === fromId && candidate.to === toId) ||
        (candidate.from === toId && candidate.to === fromId)
      ));
      if (link) {
        edges.push(scene_orientEdge(link, fromId));
      } else if (byId.has(fromId) && byId.has(toId)) {
        edges.push(scene_directEdge(byId, fromId, toId));
      }
    }
    return { flow, edges };
  });
}

function scene_polyline(edges) {
  const points = [];
  for (const edge of edges || []) {
    for (const point of edge.points || []) {
      const last = points[points.length - 1];
      if (last && scene_samePoint(last, point)) continue;
      points.push(point);
    }
  }
  return points;
}

export function sampleFlowPoint(edges, u) {
  const polyline = scene_polyline(edges);
  if (polyline.length === 0) return [0, 0, 0];
  if (polyline.length === 1) return polyline[0].slice();
  const segments = [];
  let total = 0;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const a = polyline[index];
    const b = polyline[index + 1];
    const length = scene_dist(a, b);
    segments.push({ a, b, length });
    total += length;
  }
  if (total === 0) return polyline[0].slice();
  const wrapped = ((u % 1) + 1) % 1;
  let remaining = wrapped * total;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (remaining <= segment.length || index === segments.length - 1) {
      const fraction = segment.length === 0
        ? 0
        : Math.max(0, Math.min(1, remaining / segment.length));
      return [
        segment.a[0] + (segment.b[0] - segment.a[0]) * fraction,
        segment.a[1] + (segment.b[1] - segment.a[1]) * fraction,
        segment.a[2] + (segment.b[2] - segment.a[2]) * fraction
      ];
    }
    remaining -= segment.length;
  }
  return polyline[polyline.length - 1].slice();
}

export function sampleFlowPose(edges, u) {
  const pos = sampleFlowPoint(edges, u);
  const ahead = sampleFlowPoint(edges, u + 0.001);
  let dx = ahead[0] - pos[0];
  let dy = ahead[1] - pos[1];
  let dz = ahead[2] - pos[2];
  let length = Math.hypot(dx, dy, dz);
  if (length < 1e-9) {
    const behind = sampleFlowPoint(edges, u - 0.001);
    dx = pos[0] - behind[0];
    dy = pos[1] - behind[1];
    dz = pos[2] - behind[2];
    length = Math.hypot(dx, dy, dz);
  }
  const dir = length < 1e-9 ? [1, 0, 0] : [dx / length, dy / length, dz / length];
  return { pos, dir };
}
