import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const audit_dir = dirname(fileURLToPath(import.meta.url));
let audit_iso = null;
let audit_scene = null;
if (existsSync(join(audit_dir, 'iso.mjs'))) {
  try {
    audit_iso = await import('./iso.mjs');
    audit_scene = await import('./scene.mjs');
  } catch (error) {
    audit_iso = null;
    audit_scene = null;
  }
}

const audit_ANCHOR_TOLERANCE = 1e-3;
const audit_ENDPOINT_MARGIN = 1e-2;

function audit_structural(scene) {
  const violations = [];
  if (scene === null || typeof scene !== 'object' || Array.isArray(scene)) {
    violations.push({ code: 'EMPTY_SCENE', message: 'scene must be an object' });
    return violations;
  }
  const parts = Array.isArray(scene.parts) ? scene.parts : [];
  if (parts.length === 0) {
    violations.push({ code: 'EMPTY_SCENE', message: 'scene declares no parts' });
  }
  const seen = new Set();
  const partIds = new Set();
  parts.forEach((part, index) => {
    const id = part && part.id;
    if (typeof id !== 'string' || id === '') {
      violations.push({ code: 'UNKNOWN_REFERENCE', message: `parts[${index}] has no usable id` });
      return;
    }
    if (seen.has(id)) {
      violations.push({ code: 'DUPLICATE_ID', message: `duplicate part id "${id}"`, pair: [id, id] });
    }
    seen.add(id);
    partIds.add(id);
  });
  const links = Array.isArray(scene.links) ? scene.links : [];
  links.forEach((link, index) => {
    if (!link || typeof link !== 'object') return;
    if (typeof link.from !== 'string' || !partIds.has(link.from)) {
      violations.push({
        code: 'LINK_OFF_ANCHOR',
        message: `links[${index}].from references unknown part "${link.from}"`,
        pair: [link.from, link.to]
      });
    }
    if (typeof link.to !== 'string' || !partIds.has(link.to)) {
      violations.push({
        code: 'LINK_OFF_ANCHOR',
        message: `links[${index}].to references unknown part "${link.to}"`,
        pair: [link.from, link.to]
      });
    }
  });
  const flows = Array.isArray(scene.flows) ? scene.flows : [];
  flows.forEach((flow, index) => {
    const path = flow && Array.isArray(flow.path) ? flow.path : [];
    path.forEach((id, step) => {
      if (!partIds.has(id)) {
        violations.push({
          code: 'UNKNOWN_REFERENCE',
          message: `flows[${index}].path[${step}] references unknown part "${id}"`,
          pair: [id, id]
        });
      }
    });
  });
  const notes = Array.isArray(scene.notes) ? scene.notes : [];
  notes.forEach((note, index) => {
    if (note && typeof note.at === 'string' && !partIds.has(note.at)) {
      violations.push({
        code: 'UNKNOWN_REFERENCE',
        message: `notes[${index}].at references unknown part "${note.at}"`,
        pair: [note.at, note.at]
      });
    }
  });
  return violations;
}

function audit_nearAnyAnchor(point, ports) {
  for (const name of Object.keys(ports)) {
    const anchor = ports[name];
    if (!Array.isArray(anchor)) continue;
    const distance = Math.hypot(
      point[0] - anchor[0],
      point[1] - anchor[1],
      point[2] - anchor[2]
    );
    if (distance <= audit_ANCHOR_TOLERANCE) return true;
  }
  return false;
}

function audit_links(scene, byId, violations) {
  const links = Array.isArray(scene.links) ? scene.links : [];
  links.forEach((link, index) => {
    const fromPart = byId.get(link.from);
    const toPart = byId.get(link.to);
    if (!fromPart || !toPart) return;
    const fromPorts = audit_iso.anchors(fromPart);
    const toPorts = audit_iso.anchors(toPart);
    if (link.fromPort !== undefined && !fromPorts[link.fromPort]) {
      violations.push({
        code: 'LINK_OFF_ANCHOR',
        message: `links[${index}].fromPort "${link.fromPort}" is not an anchor of part "${link.from}"`,
        pair: [link.from, link.to]
      });
    }
    if (link.toPort !== undefined && !toPorts[link.toPort]) {
      violations.push({
        code: 'LINK_OFF_ANCHOR',
        message: `links[${index}].toPort "${link.toPort}" is not an anchor of part "${link.to}"`,
        pair: [link.from, link.to]
      });
    }
  });

  let resolved;
  try {
    resolved = audit_scene.resolveLinks(scene);
  } catch (error) {
    resolved = [];
  }
  for (const edge of resolved) {
    const fromPart = byId.get(edge.from);
    const toPart = byId.get(edge.to);
    if (!fromPart || !toPart) continue;
    const points = edge.points || [];
    if (points.length < 2) continue;
    const start = points[0];
    const end = points[points.length - 1];
    if (!audit_nearAnyAnchor(start, audit_iso.anchors(fromPart))) {
      violations.push({
        code: 'LINK_OFF_ANCHOR',
        message: `link ${edge.from} -> ${edge.to}: start point is not on an anchor`,
        pair: [edge.from, edge.to]
      });
    }
    if (!audit_nearAnyAnchor(end, audit_iso.anchors(toPart))) {
      violations.push({
        code: 'LINK_OFF_ANCHOR',
        message: `link ${edge.from} -> ${edge.to}: end point is not on an anchor`,
        pair: [edge.from, edge.to]
      });
    }
  }
}

function audit_solidAABB(part) {
  if (!part || !Array.isArray(part.at)) return null;
  const [x, y, z] = part.at;
  if (part.kind === 'box' || part.kind === 'plate') {
    if (!Array.isArray(part.size)) return null;
    const [w, d, h] = part.size;
    return { min: [x, y, z], max: [x + w, y + d, z + h] };
  }
  if (part.kind === 'cylinder') {
    const r = part.radius;
    const h = part.h;
    if (!(r > 0) || !(h > 0)) return null;
    if (part.axis === 'x') return { min: [x, y - r, z - r], max: [x + h, y + r, z + r] };
    if (part.axis === 'y') return { min: [x - r, y, z - r], max: [x + r, y + h, z + r] };
    return { min: [x - r, y - r, z], max: [x + r, y + r, z + h] };
  }
  return null;
}

function audit_segmentAABB(p0, p1, min, max) {
  let t0 = 0;
  let t1 = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = p1[axis] - p0[axis];
    if (Math.abs(delta) < 1e-12) {
      if (p0[axis] < min[axis] || p0[axis] > max[axis]) return null;
      continue;
    }
    let near = (min[axis] - p0[axis]) / delta;
    let far = (max[axis] - p0[axis]) / delta;
    if (near > far) {
      const swap = near;
      near = far;
      far = swap;
    }
    if (near > t0) t0 = near;
    if (far < t1) t1 = far;
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

function audit_tubes(scene, violations) {
  let resolved;
  try {
    resolved = audit_scene.resolveLinks(scene);
  } catch (error) {
    return;
  }
  const solids = [];
  for (const part of scene.parts || []) {
    const aabb = audit_solidAABB(part);
    if (aabb) solids.push({ id: part.id, min: aabb.min, max: aabb.max });
  }
  if (solids.length === 0) return;
  for (const edge of resolved) {
    const points = edge.points || [];
    if (points.length < 2) continue;
    const segLens = [];
    let total = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const length = Math.hypot(
        points[index + 1][0] - points[index][0],
        points[index + 1][1] - points[index][1],
        points[index + 1][2] - points[index][2]
      );
      segLens.push(length);
      total += length;
    }
    if (total <= 2 * audit_ENDPOINT_MARGIN) continue;
    let offset = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const p0 = points[index];
      const p1 = points[index + 1];
      const length = segLens[index];
      if (length > 1e-9) {
        for (const solid of solids) {
          const hit = audit_segmentAABB(p0, p1, solid.min, solid.max);
          if (!hit) continue;
          const low = Math.max(offset + hit[0] * length, audit_ENDPOINT_MARGIN);
          const high = Math.min(offset + hit[1] * length, total - audit_ENDPOINT_MARGIN);
          if (high - low > 1e-9) {
            violations.push({
              code: 'TUBE_THROUGH_SOLID',
              message: `link ${edge.from} -> ${edge.to} passes through solid "${solid.id}"`,
              pair: [edge.from, solid.id]
            });
          }
        }
      }
      offset += length;
    }
  }
}

function audit_depth(scene, violations) {
  const boxes = [];
  for (const part of scene.parts || []) {
    const aabb = audit_solidAABB(part);
    if (!aabb) continue;
    const corners = [];
    for (const x of [aabb.min[0], aabb.max[0]]) {
      for (const y of [aabb.min[1], aabb.max[1]]) {
        for (const z of [aabb.min[2], aabb.max[2]]) corners.push([x, y, z]);
      }
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const corner of corners) {
      const [sx, sy] = audit_iso.project(corner[0], corner[1], corner[2]);
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }
    const cx = (aabb.min[0] + aabb.max[0]) / 2;
    const cy = (aabb.min[1] + aabb.max[1]) / 2;
    const cz = (aabb.min[2] + aabb.max[2]) / 2;
    boxes.push({ id: part.id, minX, minY, maxX, maxY, depthKey: cx + cy + cz });
  }
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      const first = boxes[a];
      const second = boxes[b];
      const overlaps = first.minX < second.maxX && second.minX < first.maxX &&
        first.minY < second.maxY && second.minY < first.maxY;
      if (!overlaps) continue;
      if (Math.abs(first.depthKey - second.depthKey) < 1e-9) {
        violations.push({
          code: 'DEPTH_INVERSION',
          message: `overlapping solids "${first.id}" and "${second.id}" share depth key ${first.depthKey}; paint order is ambiguous`,
          pair: [first.id, second.id]
        });
      }
    }
  }
}

export function audit(scene) {
  const violations = audit_structural(scene);
  if (scene === null || typeof scene !== 'object' || Array.isArray(scene)) {
    return { ok: false, violations };
  }
  if (!audit_iso || !audit_scene) {
    violations.push({
      code: 'AUDIT_PARTIAL',
      message: 'kit/iso.mjs unavailable; geometry checks (LINK_OFF_ANCHOR, TUBE_THROUGH_SOLID, DEPTH_INVERSION) were skipped'
    });
    return { ok: violations.length === 0, violations };
  }
  const byId = new Map();
  for (const part of scene.parts || []) {
    if (part && typeof part.id === 'string' && part.id !== '') byId.set(part.id, part);
  }
  audit_links(scene, byId, violations);
  audit_tubes(scene, violations);
  audit_depth(scene, violations);
  return { ok: violations.length === 0, violations };
}

const audit_isMain = Boolean(process.argv[1]) &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (audit_isMain) {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: node kit/audit.mjs <scene.json>');
    process.exit(2);
  }
  try {
    const scene = JSON.parse(readFileSync(target, 'utf8'));
    const result = audit(scene);
    if (result.ok) {
      console.log('OK');
      process.exit(0);
    }
    for (const violation of result.violations) {
      console.log(`${violation.code}: ${violation.message}`);
    }
    process.exit(1);
  } catch (error) {
    console.error(`audit failed: ${error.message}`);
    process.exit(2);
  }
}
