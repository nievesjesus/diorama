import { renderSVG } from './iso.mjs';
import { validateScene } from './scene.mjs';
import { audit } from './audit.mjs';

const layout_COS = 0.8660254037844386;
const layout_FOOT = 3;
const layout_AIR = 2.5;
const layout_GAPS = [5, 9, 14];
const layout_ROW = layout_FOOT + layout_AIR;
const layout_CLEAR = 0.6;
const layout_GROUND_H = 0.4;
const layout_TIER_H = 0.3;
const layout_MARGIN = 3;
const layout_TIER_PAD = 1.2;
const layout_LABEL_PX = 12;
const layout_LIFT_PX = 10;
const layout_CHIP_PAD_PX = 3;
const layout_MAX_PASSES = 14;
const layout_MIN_SCALE = 3;
const layout_DEFAULT_SIZE = [1280, 960];
const layout_TOKENS = new Set(['ink', 'paper', 'steel', 'slate', 'amber', 'copper', 'blue', 'green', 'brick', 'plum', 'sand', 'cloud']);
const layout_FLOW_KINDS = new Set(['request', 'job', 'packet']);

const layout_KINDS = {
  box: { kind: 'box', h: 2.2, color: 'steel' },
  service: { kind: 'box', h: 2.2, color: 'steel' },
  server: { kind: 'box', h: 2.6, color: 'steel', vents: true },
  plate: { kind: 'plate', h: 0.6, color: 'cloud' },
  cylinder: { kind: 'cylinder', h: 2.6, color: 'amber' },
  database: { kind: 'cylinder', h: 2.8, color: 'amber' },
  tank: { kind: 'cylinder', h: 2.8, color: 'amber', detail: 'tank' },
  coil: { kind: 'cylinder', h: 1, color: 'copper', detail: 'coil' },
  rack: { kind: 'box', h: 3.2, color: 'slate', detail: 'rack' },
  tower: { kind: 'box', h: 3.6, color: 'blue', detail: 'tower' },
  crate: { kind: 'box', h: 1.6, color: 'sand', detail: 'crate' },
  pallet: { kind: 'plate', h: 0.6, color: 'sand', detail: 'pallet' },
  switch: { kind: 'box', h: 0.9, color: 'cloud', detail: 'switch' },
  tray: { kind: 'plate', h: 0.8, color: 'copper', detail: 'tray' }
};

export const LAYOUT_KINDS = Object.keys(layout_KINDS);

function layout_round(value) {
  return Math.round(value * 1000) / 1000;
}

function layout_fail(message) {
  throw new Error('layoutScene: ' + message);
}

function layout_isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function layout_normalize(draft) {
  if (!layout_isObject(draft)) layout_fail('draft must be an object');
  if (typeof draft.title !== 'string' || draft.title.trim() === '') layout_fail('draft.title must be a non-empty string');
  if (!Array.isArray(draft.parts) || draft.parts.length === 0) layout_fail('draft.parts must be a non-empty array');
  const parts = [];
  const byId = new Map();
  draft.parts.forEach((raw, index) => {
    if (!layout_isObject(raw)) layout_fail(`parts[${index}] must be an object`);
    if (typeof raw.id !== 'string' || raw.id.trim() === '') layout_fail(`parts[${index}].id must be a non-empty string`);
    if (byId.has(raw.id)) layout_fail(`parts[${index}].id duplicates "${raw.id}"`);
    const kindName = raw.kind === undefined ? 'box' : raw.kind;
    const spec = layout_KINDS[kindName];
    if (!spec) layout_fail(`parts[${index}].kind "${kindName}" is not one of ${LAYOUT_KINDS.join(', ')}`);
    if (raw.color !== undefined && !layout_TOKENS.has(raw.color)) layout_fail(`parts[${index}].color "${raw.color}" is not a color token`);
    if (raw.label !== undefined && typeof raw.label !== 'string') layout_fail(`parts[${index}].label must be a string`);
    if (raw.sublabel !== undefined && typeof raw.sublabel !== 'string') layout_fail(`parts[${index}].sublabel must be a string`);
    if (raw.accent !== undefined && typeof raw.accent !== 'boolean') layout_fail(`parts[${index}].accent must be a boolean`);
    if (raw.tier !== undefined && typeof raw.tier !== 'number' && typeof raw.tier !== 'string') layout_fail(`parts[${index}].tier must be a number or a string`);
    let h = spec.h;
    if (raw.height !== undefined) {
      if (typeof raw.height !== 'number' || !(raw.height >= 0.6 && raw.height <= 8)) layout_fail(`parts[${index}].height must be a number in 0.6..8`);
      h = raw.height;
    }
    const part = { id: raw.id, index, raw, spec, h, tier: raw.tier, col: 0, y: 0 };
    parts.push(part);
    byId.set(raw.id, part);
  });
  const links = [];
  const linkIds = new Map();
  const rawLinks = draft.links === undefined ? [] : draft.links;
  if (!Array.isArray(rawLinks)) layout_fail('draft.links must be an array');
  rawLinks.forEach((raw, index) => {
    if (!layout_isObject(raw)) layout_fail(`links[${index}] must be an object`);
    if (!byId.has(raw.from)) layout_fail(`links[${index}].from must reference a part id`);
    if (!byId.has(raw.to)) layout_fail(`links[${index}].to must reference a part id`);
    if (raw.from === raw.to) layout_fail(`links[${index}] connects "${raw.from}" to itself`);
    const kind = raw.kind === undefined ? 'tube' : raw.kind;
    if (kind !== 'tube' && kind !== 'cable') layout_fail(`links[${index}].kind must be "tube" or "cable"`);
    if (raw.color !== undefined && !layout_TOKENS.has(raw.color)) layout_fail(`links[${index}].color "${raw.color}" is not a color token`);
    if (raw.label !== undefined && typeof raw.label !== 'string') layout_fail(`links[${index}].label must be a string`);
    if (raw.id !== undefined) {
      if (typeof raw.id !== 'string' || raw.id === '') layout_fail(`links[${index}].id must be a non-empty string`);
      if (linkIds.has(raw.id)) layout_fail(`links[${index}].id duplicates "${raw.id}"`);
      linkIds.set(raw.id, index);
    }
    links.push({ index, raw, from: byId.get(raw.from), to: byId.get(raw.to), kind });
  });
  return { parts, byId, links, linkIds };
}

function layout_tierKeys(parts) {
  const numbers = [];
  const strings = [];
  for (const part of parts) {
    if (typeof part.tier === 'number') {
      if (!numbers.includes(part.tier)) numbers.push(part.tier);
    } else if (typeof part.tier === 'string') {
      if (!strings.includes(part.tier)) strings.push(part.tier);
    }
  }
  numbers.sort((a, b) => a - b);
  return numbers.concat(strings);
}

function layout_assignColumns(model) {
  const { parts, links } = model;
  const keys = layout_tierKeys(parts);
  const tiered = keys.length > 0;
  const tierIndex = (part) => (part.tier === undefined ? 0 : keys.indexOf(part.tier));
  for (const part of parts) part.tierIndex = tiered ? tierIndex(part) : 0;
  const tierCount = tiered ? keys.length : 1;
  let offset = 0;
  const tierCols = [];
  for (let tier = 0; tier < tierCount; tier += 1) {
    const members = parts.filter((part) => part.tierIndex === tier);
    const succ = new Map(members.map((part) => [part, []]));
    for (const link of links) {
      if (link.from.tierIndex === tier && link.to.tierIndex === tier) succ.get(link.from).push(link.to);
    }
    const state = new Map();
    const edges = [];
    const visit = (start) => {
      const stack = [[start, 0]];
      state.set(start, 1);
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const [node, cursor] = frame;
        const next = succ.get(node);
        if (cursor >= next.length) {
          state.set(node, 2);
          stack.pop();
          continue;
        }
        frame[1] = cursor + 1;
        const target = next[cursor];
        const mark = state.get(target) || 0;
        if (mark === 1) {
          edges.push([target, node]);
        } else {
          edges.push([node, target]);
          if (mark === 0) {
            state.set(target, 1);
            stack.push([target, 0]);
          }
        }
      }
    };
    for (const part of members) if (!state.get(part)) visit(part);
    const preds = new Map(members.map((part) => [part, []]));
    const outs = new Map(members.map((part) => [part, []]));
    for (const [a, b] of edges) {
      preds.get(b).push(a);
      outs.get(a).push(b);
    }
    const layer = new Map();
    const indegree = new Map(members.map((part) => [part, preds.get(part).length]));
    const ready = members.filter((part) => indegree.get(part) === 0);
    const order = [];
    while (ready.length > 0) {
      ready.sort((a, b) => a.index - b.index);
      const node = ready.shift();
      order.push(node);
      let value = 0;
      for (const p of preds.get(node)) value = Math.max(value, layer.get(p) + 1);
      layer.set(node, value);
      for (const o of outs.get(node)) {
        indegree.set(o, indegree.get(o) - 1);
        if (indegree.get(o) === 0) ready.push(o);
      }
    }
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const node = order[i];
      if (preds.get(node).length > 0 || outs.get(node).length === 0) continue;
      let low = Infinity;
      for (const o of outs.get(node)) low = Math.min(low, layer.get(o));
      layer.set(node, Math.max(layer.get(node), low - 1));
    }
    let width = 0;
    for (const part of members) {
      part.col = offset + layer.get(part);
      width = Math.max(width, layer.get(part) + 1);
    }
    tierCols.push([offset, offset + Math.max(width, 1) - 1]);
    offset += Math.max(width, 1);
  }
  model.tiered = tiered;
  model.tierKeys = keys;
  model.tierCols = tierCols;
  model.columns = offset;
}

function layout_chipSize(part, scale) {
  const font = layout_LABEL_PX / scale;
  const text = String(part.raw.label);
  const sub = part.raw.sublabel;
  const height = font + 9 / scale + (sub ? 12 / scale : 0);
  const width = Math.max(0.62 * font * text.length, sub ? 0.62 * 9 / scale * sub.length : 0) + 10 / scale;
  return { width, height };
}

function layout_chipRect(model, part, y, base, scale) {
  const cx = part.col * model.pitch + layout_FOOT / 2;
  const sx = (cx - y) * layout_COS;
  const sy = (cx + y) / 2 - (base + part.h);
  const { width, height } = layout_chipSize(part, scale);
  const pad = layout_CHIP_PAD_PX / scale;
  const bottom = sy - layout_LIFT_PX / scale;
  return { x0: sx - width / 2 - pad, x1: sx + width / 2 + pad, y0: bottom - height - pad, y1: bottom + pad };
}

function layout_forbidden(model, part, placed, base, scale) {
  const intervals = [];
  const col = part.col;
  for (const other of placed) {
    if (other.col === col) intervals.push([other.y - layout_ROW, other.y + layout_ROW]);
  }
  for (const link of model.links) {
    const near = link.from.placed && link.from.col < col && link.to.col > col ? link.from
      : link.to.placed && link.to.col < col && link.from.col > col ? link.to : null;
    if (near) intervals.push([near.y - layout_FOOT - layout_CLEAR, near.y + layout_FOOT + layout_CLEAR]);
  }
  const xe = col * model.pitch;
  for (const link of model.links) {
    let other = null;
    if (link.from === part) other = link.to;
    else if (link.to === part) other = link.from;
    if (!other || !other.placed || other.col >= col) continue;
    const xs = other.col * model.pitch + layout_FOOT;
    const span = xe - xs;
    for (const block of placed) {
      if (block.col <= other.col || block.col >= col) continue;
      const left = block.col * model.pitch;
      const t1 = (left - xs) / span;
      const t2 = (left + layout_FOOT - xs) / span;
      const lo = block.y - layout_FOOT / 2 - layout_CLEAR - other.y;
      const hi = block.y + layout_FOOT / 2 + layout_CLEAR - other.y;
      intervals.push([
        other.y + Math.min(lo / t1, lo / t2),
        other.y + Math.max(hi / t1, hi / t2)
      ]);
    }
  }
  if (part.raw.label && Number.isFinite(scale)) {
    const cx = col * model.pitch + layout_FOOT / 2;
    const probe = layout_chipRect(model, part, 0, base, scale);
    const halfW = (probe.x1 - probe.x0) / 2;
    const lift = (cx / 2 - (base + part.h)) - probe.y1;
    const tall = probe.y1 - probe.y0;
    for (const other of placed) {
      if (!other.raw.label) continue;
      const rect = layout_chipRect(model, other, other.y, base, scale);
      const xa = cx - (rect.x1 + halfW) / layout_COS;
      const xb = cx - (rect.x0 - halfW) / layout_COS;
      const ya = 2 * (rect.y0 + lift + base + part.h) - cx;
      const yb = 2 * (rect.y1 + lift + tall + base + part.h) - cx;
      const lo = Math.max(xa, ya);
      const hi = Math.min(xb, yb);
      if (lo < hi) intervals.push([lo, hi]);
    }
  }
  return intervals;
}

function layout_pick(intervals, desired) {
  const allowed = (y) => intervals.every(([lo, hi]) => y <= lo - 1e-6 || y >= hi + 1e-6);
  const candidates = [Math.round(desired * 100) / 100];
  for (const [lo, hi] of intervals) {
    candidates.push(Math.floor((lo - 0.01) * 100) / 100);
    candidates.push(Math.ceil((hi + 0.01) * 100) / 100);
  }
  let best = null;
  for (const candidate of candidates) {
    if (!allowed(candidate)) continue;
    const distance = Math.abs(candidate - desired);
    if (best === null || distance < best.distance - 1e-9 || (Math.abs(distance - best.distance) <= 1e-9 && candidate < best.y)) {
      best = { y: candidate, distance };
    }
  }
  return best.y;
}

function layout_place(model, base, scale) {
  const { parts, links } = model;
  for (const part of parts) {
    part.placed = false;
    part.y = 0;
  }
  const placed = [];
  for (let col = 0; col < model.columns; col += 1) {
    const members = parts.filter((part) => part.col === col);
    const wish = new Map();
    for (const part of members) {
      let sum = 0;
      let count = 0;
      for (const link of links) {
        const other = link.from === part ? link.to : link.to === part ? link.from : null;
        if (other && other.placed) {
          sum += other.y;
          count += 1;
        }
      }
      wish.set(part, count > 0 ? sum / count : null);
    }
    members.sort((a, b) => {
      const wa = wish.get(a);
      const wb = wish.get(b);
      if (wa === null && wb !== null) return 1;
      if (wb === null && wa !== null) return -1;
      if (wa !== null && wb !== null && wa !== wb) return wa - wb;
      return a.index - b.index;
    });
    for (const part of members) {
      let desired = wish.get(part);
      if (desired === null) {
        const column = placed.filter((other) => other.col === col);
        desired = column.length > 0 ? Math.max(...column.map((other) => other.y)) + layout_ROW : 0;
      }
      part.y = layout_pick(layout_forbidden(model, part, placed, base, scale), desired);
      part.placed = true;
      placed.push(part);
    }
  }
}

function layout_aabb(part) {
  const [x, y, z] = part.at;
  if (part.kind === 'cylinder') return { min: [x - part.radius, y - part.radius, z], max: [x + part.radius, y + part.radius, z + part.h] };
  return { min: [x, y, z], max: [x + part.size[0], y + part.size[1], z + part.size[2]] };
}

function layout_depthKey(part) {
  const box = layout_aabb(part);
  return (box.min[0] + box.max[0]) / 2 + (box.min[1] + box.max[1]) / 2 + (box.min[2] + box.max[2]) / 2;
}

function layout_freeId(taken, wanted) {
  let id = wanted;
  let n = 2;
  while (taken.has(id)) {
    id = wanted + '-' + n;
    n += 1;
  }
  taken.add(id);
  return id;
}

function layout_flowPath(flow, index, model) {
  if (!layout_isObject(flow) || !Array.isArray(flow.path) || flow.path.length === 0) {
    layout_fail(`flows[${index}].path must be a non-empty array`);
  }
  const steps = flow.path.map((step, at) => {
    if (typeof step === 'string' && model.linkIds.has(step)) {
      const link = model.links[model.linkIds.get(step)];
      return { edge: [link.from.id, link.to.id] };
    }
    if (Array.isArray(step) && step.length === 2 && model.byId.has(step[0]) && model.byId.has(step[1])) {
      return { edge: [step[0], step[1]] };
    }
    if (typeof step === 'string' && model.byId.has(step)) return { node: step };
    return layout_fail(`flows[${index}].path[${at}] is neither a link id, a part pair nor a part id`);
  });
  const sequence = [];
  steps.forEach((step, at) => {
    if (step.node) {
      if (sequence[sequence.length - 1] !== step.node) sequence.push(step.node);
      return;
    }
    const [a, b] = step.edge;
    if (sequence.length === 0) {
      const next = steps[at + 1];
      const touches = (id) => next && (next.node === id || (next.edge && next.edge.includes(id)));
      if (touches(a) && !touches(b)) sequence.push(b, a);
      else sequence.push(a, b);
      return;
    }
    const last = sequence[sequence.length - 1];
    if (a === last) sequence.push(b);
    else if (b === last) sequence.push(a);
    else layout_fail(`flows[${index}].path[${at}] does not continue from "${last}"`);
  });
  if (sequence.length < 2) layout_fail(`flows[${index}].path must cover at least two parts`);
  return sequence;
}

function layout_linkColor(link) {
  if (link.raw.color) return link.raw.color;
  return link.from.raw.color || link.from.spec.color;
}

function layout_build(model, draft, settings, base) {
  const { parts, links } = model;
  const taken = new Set(parts.map((part) => part.id));
  const groundId = layout_freeId(taken, 'ground');
  const out = [];
  for (const part of parts) {
    const raw = part.raw;
    const spec = part.spec;
    const x0 = part.col * model.pitch;
    const y = layout_round(part.y);
    const scenePart = { id: part.id, kind: spec.kind };
    if (raw.label !== undefined) scenePart.label = raw.label;
    if (raw.sublabel !== undefined) scenePart.sublabel = raw.sublabel;
    if (spec.kind === 'cylinder') {
      scenePart.at = [layout_round(x0 + layout_FOOT / 2), y, base];
      scenePart.radius = layout_FOOT / 2;
      scenePart.h = part.h;
      scenePart.axis = 'z';
    } else {
      scenePart.at = [x0, layout_round(y - layout_FOOT / 2), base];
      scenePart.size = [layout_FOOT, layout_FOOT, part.h];
    }
    scenePart.color = raw.color || spec.color;
    if (spec.detail) scenePart.detail = spec.detail;
    if (spec.vents) scenePart.vents = true;
    if (raw.accent !== undefined) scenePart.accent = raw.accent;
    out.push(scenePart);
  }
  let minY = Infinity;
  let maxY = -Infinity;
  for (const part of parts) {
    minY = Math.min(minY, part.y);
    maxY = Math.max(maxY, part.y);
  }
  const plates = [];
  const ground = {
    id: groundId,
    kind: 'plate',
    at: [-layout_MARGIN, layout_round(minY - layout_FOOT / 2 - layout_MARGIN), 0],
    size: [
      layout_round((model.columns - 1) * model.pitch + layout_FOOT + 2 * layout_MARGIN),
      layout_round(maxY - minY + layout_FOOT + 2 * layout_MARGIN),
      layout_GROUND_H
    ],
    color: settings.theme === 'dark' ? 'slate' : 'paper',
    detail: 'concrete'
  };
  plates.push(ground);
  if (model.tiered) {
    model.tierCols.forEach(([first, last], tier) => {
      const members = parts.filter((part) => part.tierIndex === tier);
      if (members.length === 0) return;
      let low = Infinity;
      let high = -Infinity;
      for (const part of members) {
        low = Math.min(low, part.y);
        high = Math.max(high, part.y);
      }
      plates.push({
        id: layout_freeId(taken, 'tier-' + (tier + 1)),
        kind: 'plate',
        at: [
          layout_round(first * model.pitch - layout_TIER_PAD),
          layout_round(low - layout_FOOT / 2 - layout_TIER_PAD),
          layout_GROUND_H
        ],
        size: [
          layout_round((last - first) * model.pitch + layout_FOOT + 2 * layout_TIER_PAD),
          layout_round(high - low + layout_FOOT + 2 * layout_TIER_PAD),
          layout_TIER_H
        ],
        color: settings.theme === 'dark' ? 'steel' : 'slate'
      });
    });
  }
  const solids = plates.concat(out);
  for (const plate of plates) {
    for (let guard = 0; guard < 200; guard += 1) {
      const key = layout_depthKey(plate);
      const clash = solids.some((other) => other !== plate && Math.abs(layout_depthKey(other) - key) < 1e-6);
      if (!clash) break;
      plate.size[1] = layout_round(plate.size[1] + 0.05);
    }
  }
  const sceneLinks = links.map((link) => {
    const forward = link.from.col < link.to.col;
    const entry = {
      from: link.from.id,
      to: link.to.id,
      fromPort: forward ? 'east' : 'west',
      toPort: forward ? 'west' : 'east',
      kind: link.kind,
      color: layout_linkColor(link)
    };
    if (link.raw.label !== undefined) entry.label = link.raw.label;
    return entry;
  });
  const scene = { version: 1, title: draft.title };
  if (draft.subtitle !== undefined) scene.subtitle = draft.subtitle;
  scene.theme = settings.theme;
  scene.size = settings.size.slice();
  if (draft.hint !== undefined) scene.hint = draft.hint;
  scene.parts = plates.concat(out);
  scene.links = sceneLinks;
  if (Array.isArray(draft.flows) && draft.flows.length > 0) {
    scene.flows = draft.flows.map((flow, index) => {
      const path = layout_flowPath(flow, index, model);
      let color = flow.color;
      if (color === undefined) {
        const first = sceneLinks.find((link) => (link.from === path[0] && link.to === path[1]) || (link.from === path[1] && link.to === path[0]));
        color = first ? first.color : 'blue';
      }
      const speed = typeof flow.speed === 'number' ? Math.min(24, Math.max(6, flow.speed)) : 12;
      const count = Number.isInteger(flow.count) ? Math.min(6, Math.max(2, flow.count)) : 3;
      return { path, kind: layout_FLOW_KINDS.has(flow.kind) ? flow.kind : 'request', color, speed, count };
    });
  }
  if (draft.readout !== undefined) scene.readout = draft.readout;
  if (draft.notes !== undefined) scene.notes = draft.notes;
  return scene;
}

function layout_scaleOf(scene) {
  const svg = renderSVG(scene);
  const match = /<g transform="translate\([^)]*\) scale\(([^)]+)\)">/.exec(svg);
  return match ? Number(match[1]) : NaN;
}

export function solveLayout(draft, opts = {}) {
  const model = layout_normalize(draft);
  const theme = opts.theme || draft.theme || 'light';
  if (theme !== 'light' && theme !== 'dark') layout_fail('theme must be "light" or "dark"');
  const size = opts.size || draft.size || layout_DEFAULT_SIZE;
  const settings = { theme, size };
  layout_assignColumns(model);
  const base = model.tiered ? layout_GROUND_H + layout_TIER_H : layout_GROUND_H;
  let scene = null;
  let reason = '';
  for (const gap of layout_GAPS) {
    model.pitch = layout_FOOT + gap;
    let guess = Infinity;
    for (let pass = 0; pass < layout_MAX_PASSES; pass += 1) {
      layout_place(model, base, guess);
      const candidate = layout_build(model, draft, settings, base);
      const actual = layout_scaleOf(candidate);
      if (!Number.isFinite(actual)) layout_fail('could not read the render scale');
      if (actual < layout_MIN_SCALE) {
        reason = `the layout needs a render scale of ${actual.toFixed(2)} px per world unit, under the readable floor of ${layout_MIN_SCALE}`;
        break;
      }
      if (actual >= guess) {
        scene = candidate;
        break;
      }
      guess = actual * 0.97;
      reason = 'label spacing did not settle';
    }
    if (scene) break;
  }
  if (!scene) {
    layout_fail(`no readable layout for ${model.parts.length} parts and ${model.links.length} links: ${reason}. Straight links between distant columns force the parts apart until the labels no longer fit; split the draft into smaller scenes or drop secondary links`);
  }
  const checked = validateScene(scene);
  if (!checked.ok) layout_fail('produced an invalid scene:\n' + checked.errors.join('\n'));
  const result = audit(scene);
  if (!result.ok) {
    layout_fail('audit failed:\n' + result.violations.map((v) => `${v.code}: ${v.message}`).join('\n'));
  }
  return { scene, audit: result };
}

export function layoutScene(draft, opts = {}) {
  return solveLayout(draft, opts).scene;
}
