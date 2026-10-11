import { project, renderSVG, TOKENS } from './iso.mjs';
import { resolveFlows, sampleFlowPoint } from './scene.mjs';

const motion_NS = 'http://www.w3.org/2000/svg';
const motion_RAF = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
const motion_TRAIL_SPAN = 0.22;
const motion_TRAIL_WIDTH = 0.3;
const motion_TRAIL_OPACITY = 0.45;

function motion_round(value) {
  return Math.round(value * 1000) / 1000;
}

function motion_prefersReduced() {
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch (error) {
    return false;
  }
}

function motion_seekTime() {
  if (typeof location === 'undefined' || !location || typeof location.search !== 'string') {
    return null;
  }
  const params = new URLSearchParams(location.search);
  if (!params.has('t')) return null;
  const raw = params.get('t');
  if (raw === null || raw === 'live' || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function motion_parseScene(card) {
  const raw = typeof card.getAttribute === 'function'
    ? card.getAttribute('data-scene')
    : card.dataset && card.dataset.scene;
  if (!raw) throw new Error('mount: .card is missing data-scene');
  return JSON.parse(raw);
}

function motion_packetGroup(svg) {
  const existing = svg.querySelector('g.packets');
  if (existing) return existing;
  const group = document.createElementNS(motion_NS, 'g');
  group.setAttribute('class', 'packets');
  const fit = svg.querySelector('g[transform]');
  (fit || svg).appendChild(group);
  return group;
}

function motion_flowToken(flow) {
  return flow && typeof flow.color === 'string' && TOKENS.light[flow.color] ? flow.color : 'green';
}

function motion_trailGradientId(token) {
  return 'diorama-trail-' + token;
}

function motion_seedTrailGradient(defs, token, theme) {
  const id = motion_trailGradientId(token);
  const existing = defs.querySelector ? defs.querySelector('linearGradient[id="' + id + '"]') : null;
  if (existing) return;
  const color = TOKENS[theme][token] ? TOKENS[theme][token].left : TOKENS[theme].ink.left;
  const gradient = document.createElementNS(motion_NS, 'linearGradient');
  gradient.setAttribute('id', id);
  gradient.setAttribute('x1', '1');
  gradient.setAttribute('y1', '0');
  gradient.setAttribute('x2', '0');
  gradient.setAttribute('y2', '0');
  const head = document.createElementNS(motion_NS, 'stop');
  head.setAttribute('offset', '0');
  head.setAttribute('stop-color', color);
  head.setAttribute('stop-opacity', String(motion_TRAIL_OPACITY));
  const tail = document.createElementNS(motion_NS, 'stop');
  tail.setAttribute('offset', '1');
  tail.setAttribute('stop-color', color);
  tail.setAttribute('stop-opacity', '0');
  gradient.appendChild(head);
  gradient.appendChild(tail);
  defs.appendChild(gradient);
}

function motion_defs(svg) {
  const existing = svg.querySelector('defs');
  if (existing) return existing;
  const defs = document.createElementNS(motion_NS, 'defs');
  if (typeof svg.insertBefore === 'function' && svg.firstChild) svg.insertBefore(defs, svg.firstChild);
  else svg.appendChild(defs);
  return defs;
}

function motion_makeTrail(flowIndex, token) {
  const trail = document.createElementNS(motion_NS, 'polygon');
  trail.setAttribute('class', 'packet-trail');
  trail.setAttribute('data-flow', String(flowIndex));
  trail.setAttribute('points', '0,0');
  trail.setAttribute('fill', 'url(#' + motion_trailGradientId(token) + ')');
  return trail;
}

function motion_makePacket(flowIndex, ring) {
  const packet = document.createElementNS(motion_NS, 'circle');
  packet.setAttribute('class', 'packet');
  packet.setAttribute('data-flow', String(flowIndex));
  packet.setAttribute('r', '0.35');
  packet.setAttribute('stroke', ring);
  packet.setAttribute('stroke-width', '0.6');
  packet.setAttribute('vector-effect', 'non-scaling-stroke');
  return packet;
}

export function seedPackets(svg, scene) {
  const group = motion_packetGroup(svg);
  if (motion_prefersReduced()) return group;
  if (group.querySelector('circle.packet')) return group;
  const theme = scene.theme === 'dark' ? 'dark' : 'light';
  const flows = Array.isArray(scene.flows) ? scene.flows : [];
  const ring = TOKENS[theme].ink.edge;
  const defs = motion_defs(svg);
  flows.forEach((flow, index) => {
    const count = Number.isInteger(flow.count) && flow.count > 0 ? flow.count : 0;
    const token = motion_flowToken(flow);
    if (count > 0) motion_seedTrailGradient(defs, token, theme);
    for (let slot = 0; slot < count; slot += 1) {
      group.appendChild(motion_makeTrail(index, token));
      group.appendChild(motion_makePacket(index, ring));
    }
  });
  return group;
}

function motion_flowTouches(scene) {
  const flows = Array.isArray(scene.flows) ? scene.flows : [];
  return flows.map((flow) => new Set(Array.isArray(flow.path) ? flow.path : []));
}

function motion_clearActive(svg) {
  svg.querySelectorAll('.part.active, .link.active, .packet.active').forEach((element) => {
    element.classList.remove('active');
  });
}

function motion_applyHighlight(svg, flowTouches, id) {
  motion_clearActive(svg);
  if (id === null || id === undefined) return;
  const part = svg.querySelector(`.part[data-id="${id}"]`);
  if (part) part.classList.add('active');
  svg.querySelectorAll('.link').forEach((link) => {
    const from = link.getAttribute('data-from');
    const to = link.getAttribute('data-to');
    if (from === id || to === id) link.classList.add('active');
  });
  svg.querySelectorAll('.packet').forEach((packet) => {
    const flowIndex = Number(packet.getAttribute('data-flow'));
    const touches = flowTouches[flowIndex];
    if (touches && touches.has(id)) packet.classList.add('active');
  });
}

function motion_wireInteraction(svg, scene) {
  const flowTouches = motion_flowTouches(scene);
  let pinned = null;
  svg.querySelectorAll('.part').forEach((part) => {
    const id = part.getAttribute('data-id');
    if (!id) return;
    part.addEventListener('mouseenter', () => {
      if (pinned === null) motion_applyHighlight(svg, flowTouches, id);
    });
    part.addEventListener('mouseleave', () => {
      if (pinned === null) motion_applyHighlight(svg, flowTouches, null);
    });
    part.addEventListener('click', () => {
      if (pinned === id) {
        pinned = null;
        motion_applyHighlight(svg, flowTouches, null);
      } else {
        pinned = id;
        motion_applyHighlight(svg, flowTouches, id);
      }
    });
  });
}

function motion_startLoop(state) {
  if (!motion_RAF) return;
  let start = null;
  const frame = (timestamp) => {
    if (start === null) start = timestamp;
    tick(state.scene, state.svg, (timestamp - start) / 1000);
    state.frame = motion_RAF(frame);
  };
  state.frame = motion_RAF(frame);
}

export function tick(scene, svgElement, timeSeconds) {
  if (!svgElement || typeof svgElement.querySelectorAll !== 'function') return;
  const packets = svgElement.querySelectorAll('circle.packet');
  if (!packets || packets.length === 0) return;
  const trails = typeof svgElement.querySelectorAll === 'function'
    ? svgElement.querySelectorAll('polygon.packet-trail')
    : [];
  const groups = resolveFlows(scene);
  const byFlow = new Map();
  packets.forEach((packet) => {
    const flowIndex = Number(packet.getAttribute('data-flow'));
    if (!byFlow.has(flowIndex)) byFlow.set(flowIndex, []);
    byFlow.get(flowIndex).push(packet);
  });
  const trailsByFlow = new Map();
  Array.prototype.forEach.call(trails || [], (trail) => {
    const flowIndex = Number(trail.getAttribute('data-flow'));
    if (!trailsByFlow.has(flowIndex)) trailsByFlow.set(flowIndex, []);
    trailsByFlow.get(flowIndex).push(trail);
  });
  byFlow.forEach((list, flowIndex) => {
    const entry = groups[flowIndex];
    if (!entry || !entry.edges || entry.edges.length === 0) return;
    const speed = Number.isFinite(entry.flow.speed) ? entry.flow.speed : 6;
    const loopsPerSecond = speed / 60;
    const flowTrails = trailsByFlow.get(flowIndex) || [];
    list.forEach((packet, slot) => {
      const u = (((timeSeconds * loopsPerSecond + slot / list.length) % 1) + 1) % 1;
      const world = sampleFlowPoint(entry.edges, u);
      const [sx, sy] = project(world[0], world[1], world[2]);
      packet.setAttribute('cx', String(motion_round(sx)));
      packet.setAttribute('cy', String(motion_round(sy)));
      const trail = flowTrails[slot];
      if (!trail) return;
      const tailParam = Math.max(0, u - motion_TRAIL_SPAN);
      const tail = sampleFlowPoint(entry.edges, tailParam);
      const [tx, ty] = project(tail[0], tail[1], tail[2]);
      const dx = tx - sx;
      const dy = ty - sy;
      const length = Math.hypot(dx, dy);
      if (length < 1e-4) {
        trail.setAttribute('points', '0,0');
        trail.setAttribute('transform', 'translate(' + motion_round(sx) + ',' + motion_round(sy) + ')');
        return;
      }
      const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
      const mid = -length / 2;
      const shoulder = motion_TRAIL_WIDTH * 0.55;
      trail.setAttribute('points',
        '0,' + motion_round(-motion_TRAIL_WIDTH) +
        ' 0,' + motion_round(motion_TRAIL_WIDTH) +
        ' ' + motion_round(mid) + ',' + motion_round(shoulder) +
        ' ' + motion_round(-length) + ',0' +
        ' ' + motion_round(mid) + ',' + motion_round(-shoulder));
      trail.setAttribute('transform',
        'translate(' + motion_round(sx) + ',' + motion_round(sy) + ') rotate(' + motion_round(degrees) + ')');
    });
  });
}

export function mount(root = document) {
  try {
    if (!root || typeof root.querySelector !== 'function') {
      throw new Error('mount: invalid root');
    }
    const card = root.querySelector('.card');
    if (!card) throw new Error('mount: .card not found');
    const scene = motion_parseScene(card);
    const stage = card.querySelector('.stage');
    if (!stage) throw new Error('mount: .stage not found');
    let svg = stage.querySelector('svg');
    if (!svg) {
      stage.innerHTML = renderSVG(scene);
      svg = stage.querySelector('svg');
    }
    if (!svg) throw new Error('mount: svg unavailable');
    seedPackets(svg, scene);
    motion_wireInteraction(svg, scene);
    const state = {
      scene,
      svg,
      frame: 0,
      stop() {
        if (motion_RAF && state.frame) cancelAnimationFrame(state.frame);
        state.frame = 0;
      }
    };
    const seek = motion_seekTime();
    if (seek !== null) {
      tick(scene, svg, seek);
      return state;
    }
    motion_startLoop(state);
    return state;
  } catch (error) {
    console.error('diorama motion: mount failed:', error && error.message ? error.message : error);
    return null;
  }
}
