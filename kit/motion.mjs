import { project, renderSVG, TOKENS } from './iso.mjs';
import { resolveFlows, sampleFlowPoint } from './scene.mjs';

const motion_NS = 'http://www.w3.org/2000/svg';
const motion_RAF = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
const motion_TRAIL_SPAN = 0.19;
const motion_TRAIL_LEAD = 0.042;
const motion_TRAIL_WIDTH = 0.11;
const motion_TRAIL_OPACITY = 0.55;
const motion_LIGHT_GLOW = 0.07;
const motion_WAVE_CYCLES = 3;
const motion_SPARK_NORMAL_BASE = 0.08;
const motion_SPARK_NORMAL_WAVE = 0.06;
const motion_SPARK_ALONG_WAVE = 0.05;
const motion_SPARK_ALPHA = 0.5;
const motion_SPARK_ALPHA_MAX = 0.55;
const motion_HOT_SAMPLES = 8;
const motion_HOT_WAVE_MIN = 0.92;
const motion_HOT_WAVE_AMP = 0.08;
const motion_PARALLAX_LERP = 0.07;
const motion_PARALLAX_X = 6;
const motion_PARALLAX_Y = 4;

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

function motion_parseScene(world) {
  const raw = typeof world.getAttribute === 'function'
    ? world.getAttribute('data-scene')
    : world.dataset && world.dataset.scene;
  if (!raw) throw new Error('mount: .world is missing data-scene');
  return JSON.parse(raw);
}

function motion_query(search, name) {
  if (typeof search !== 'string') return null;
  const params = new URLSearchParams(search);
  if (!params.has(name)) return null;
  return params.get(name);
}

function motion_frameMode() {
  if (typeof location === 'undefined' || !location) return false;
  const raw = motion_query(location.search, 'frame');
  return raw !== null && raw !== '0' && raw !== 'false';
}

export function applyFrameMode(doc) {
  if (!motion_frameMode()) return false;
  const body = doc && doc.body;
  if (!body || !body.classList || typeof body.classList.add !== 'function') return false;
  body.classList.add('frame');
  return true;
}

export function seedParallax(svg, seek = null) {
  if (seek !== null && seek !== undefined) return null;
  if (motion_prefersReduced()) return null;
  if (!svg || typeof svg.querySelector !== 'function') return null;
  if (typeof document === 'undefined' || typeof document.createElementNS !== 'function') return null;
  const fit = svg.querySelector('g[transform]');
  if (!fit) return null;
  const parent = fit.parentNode;
  if (!parent || typeof parent.insertBefore !== 'function' || typeof parent.appendChild !== 'function') return null;
  const wrap = document.createElementNS(motion_NS, 'g');
  wrap.setAttribute('class', 'parallax');
  wrap.setAttribute('transform', 'translate(0,0)');
  parent.insertBefore(wrap, fit);
  wrap.appendChild(fit);
  const state = { wrap, tx: 0, ty: 0, cx: 0, cy: 0 };
  const onMove = (event) => {
    const width = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1;
    const height = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 1;
    state.tx = ((event.clientX / width) - 0.5) * motion_PARALLAX_X * 2;
    state.ty = ((event.clientY / height) - 0.5) * motion_PARALLAX_Y * 2;
  };
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('mousemove', onMove);
  }
  state.step = () => {
    state.cx += (state.tx - state.cx) * motion_PARALLAX_LERP;
    state.cy += (state.ty - state.cy) * motion_PARALLAX_LERP;
    wrap.setAttribute('transform', 'translate(' + motion_round(state.cx) + ',' + motion_round(state.cy) + ')');
  };
  state.stop = () => {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('mousemove', onMove);
    }
  };
  return state;
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

function motion_glowAlpha(theme) {
  return motion_round(theme === 'dark' ? motion_TRAIL_OPACITY : motion_TRAIL_OPACITY + motion_LIGHT_GLOW);
}

function motion_seedTrailGradient(defs, token, theme) {
  const id = motion_trailGradientId(token);
  if (defs.querySelector && defs.querySelector('radialGradient[id="' + id + '"]')) return;
  const gradient = document.createElementNS(motion_NS, 'radialGradient');
  gradient.setAttribute('id', id);
  for (const [offset, opacity] of [[0, motion_glowAlpha(theme)], [1, 0]]) {
    const stop = document.createElementNS(motion_NS, 'stop');
    stop.setAttribute('offset', String(offset));
    stop.setAttribute('stop-color', TOKENS[theme][token].left);
    stop.setAttribute('stop-opacity', String(opacity));
    gradient.appendChild(stop);
  }
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

function motion_makeTrail(flowIndex, color) {
  const trail = document.createElementNS(motion_NS, 'g');
  trail.setAttribute('class', 'packet-trail');
  trail.setAttribute('data-flow', String(flowIndex));
  for (let i = 0; i < 7; i += 1) {
    const piece = document.createElementNS(motion_NS, 'polyline');
    piece.setAttribute('class', 'packet-hot');
    piece.setAttribute('fill', 'none');
    piece.setAttribute('stroke', color);
    piece.setAttribute('stroke-width', String(motion_round(motion_TRAIL_WIDTH * (1 - i / 9))));
    piece.setAttribute('stroke-opacity', String(motion_round(motion_HOT[i])));
    piece.setAttribute('stroke-linecap', 'round');
    trail.appendChild(piece);
  }
  return trail;
}

const motion_HOT = [1, 0.86, 0.69, 0.52, 0.36, 0.22, 0.1];

function motion_mix(color, target, amount) {
  return '#' + [1, 3, 5].map((offset) => Math.round(parseInt(color.slice(offset, offset + 2), 16) * (1 - amount) + target * amount).toString(16).padStart(2, '0')).join('');
}

function motion_bright(color) {
  return motion_mix(color, 255, 0.82);
}

function motion_core(color) {
  return motion_mix(color, 255, 0.93);
}

function motion_rim(color) {
  return motion_mix(color, 0, 0.42);
}

function motion_makePacket(flowIndex, ring) {
  const packet = document.createElementNS(motion_NS, 'circle');
  packet.setAttribute('class', 'packet');
  packet.setAttribute('data-flow', String(flowIndex));
  packet.setAttribute('r', '0.215');
  packet.setAttribute('fill', motion_core(ring));
  packet.setAttribute('stroke', motion_rim(ring));
  packet.setAttribute('stroke-width', '1');
  packet.setAttribute('vector-effect', 'non-scaling-stroke');
  return packet;
}

export function seedPackets(svg, scene) {
  const group = motion_packetGroup(svg);
  if (motion_prefersReduced()) return group;
  if (group.querySelector('circle.packet')) return group;
  const theme = scene.theme === 'dark' ? 'dark' : 'light';
  const flows = Array.isArray(scene.flows) ? scene.flows : [];
  const defs = motion_defs(svg);
  flows.forEach((flow, index) => {
    const count = Number.isInteger(flow.count) && flow.count > 0 ? flow.count : 0;
    const token = motion_flowToken(flow);
    const color = TOKENS[theme][token].left;
    if (count > 0) motion_seedTrailGradient(defs, token, theme);
    for (let slot = 0; slot < count; slot += 1) {
      const packet = motion_makePacket(index, color);
      const aura = document.createElementNS(motion_NS, 'circle');
      aura.setAttribute('class', 'packet-aura');
      aura.setAttribute('data-flow', String(index));
      aura.setAttribute('r', '0.56');
      aura.setAttribute('fill', 'url(#' + motion_trailGradientId(token) + ')');
      packet.motion_aura = aura;
      packet.motion_sparks = [];
      group.appendChild(motion_makeTrail(index, color));
      group.appendChild(aura);
      group.appendChild(packet);
      for (let sparkIndex = 0; sparkIndex < 3; sparkIndex += 1) {
        const spark = document.createElementNS(motion_NS, 'circle');
        spark.setAttribute('class', 'packet-spark');
        spark.setAttribute('data-flow', String(index));
        spark.setAttribute('fill', motion_bright(color));
        spark.setAttribute('r', String(0.06 + sparkIndex * 0.02));
        packet.motion_sparks.push(spark);
        group.appendChild(spark);
      }
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

function motion_startLoop(state, parallax) {
  if (!motion_RAF) return;
  let start = null;
  const frame = (timestamp) => {
    if (start === null) start = timestamp;
    tick(state.scene, state.svg, (timestamp - start) / 1000);
    if (parallax) parallax.step();
    state.frame = motion_RAF(frame);
  };
  state.frame = motion_RAF(frame);
}

export function tick(scene, svgElement, timeSeconds) {
  if (!svgElement || typeof svgElement.querySelectorAll !== 'function') return;
  const packets = svgElement.querySelectorAll('circle.packet');
  if (!packets || packets.length === 0) return;
  const trails = typeof svgElement.querySelectorAll === 'function'
    ? svgElement.querySelectorAll('g.packet-trail')
    : [];
  const groups = resolveFlows(scene);
  const glow = scene && scene.theme === 'dark' ? 1 : 1 + motion_LIGHT_GLOW;
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
      if (packet.motion_aura) {
        packet.motion_aura.setAttribute('cx', String(motion_round(sx)));
        packet.motion_aura.setAttribute('cy', String(motion_round(sy)));
      }
      const ahead = sampleFlowPoint(entry.edges, Math.min(1, u + 0.01));
      const [ax, ay] = project(ahead[0], ahead[1], ahead[2]);
      const run = Math.hypot(ax - sx, ay - sy) || 1;
      const nx = -(ay - sy) / run;
      const ny = (ax - sx) / run;
      (packet.motion_sparks || []).forEach((spark, index) => {
        const normal = motion_SPARK_NORMAL_BASE + motion_SPARK_NORMAL_WAVE * Math.sin(2 * Math.PI * (motion_WAVE_CYCLES * u + index / 3));
        const along = motion_SPARK_ALONG_WAVE * Math.sin(2 * Math.PI * (5 * u + index / 2));
        spark.setAttribute('cx', String(motion_round(sx + nx * normal + (ax - sx) / run * along)));
        spark.setAttribute('cy', String(motion_round(sy + ny * normal + (ay - sy) / run * along)));
        const alpha = motion_SPARK_ALPHA * (0.5 + 0.5 * Math.sin(2 * Math.PI * (2 * u + index / 3)));
        spark.setAttribute('opacity', String(motion_round(Math.max(0, Math.min(motion_SPARK_ALPHA_MAX, alpha)))));
      });
      const trail = flowTrails[slot];
      if (!trail) return;
      Array.from(trail.children).forEach((piece, index) => {
        const head = Math.min(1, Math.max(0, u + motion_TRAIL_LEAD - motion_TRAIL_SPAN * index / 7));
        const tail = Math.min(1, Math.max(0, u + motion_TRAIL_LEAD - motion_TRAIL_SPAN * (index + 1) / 7));
        const points = [];
        for (let step = 0; step < motion_HOT_SAMPLES; step += 1) {
          const fraction = step / (motion_HOT_SAMPLES - 1);
          points.push(sampleFlowPoint(entry.edges, tail + (head - tail) * fraction));
        }
        piece.setAttribute('points', points.map((point) => project(...point).map(motion_round).join(',')).join(' '));
        const wave = motion_HOT_WAVE_MIN + motion_HOT_WAVE_AMP * Math.cos((u * motion_WAVE_CYCLES - index / 7) * Math.PI * 2);
        piece.setAttribute('stroke-opacity', String(motion_round(Math.min(1, motion_HOT[index] * wave * glow))));
      });
    });
  });
}

export function mount(root = document) {
  try {
    if (!root || typeof root.querySelector !== 'function') {
      throw new Error('mount: invalid root');
    }
    applyFrameMode(root);
    const world = root.querySelector('.world');
    if (!world) throw new Error('mount: .world not found');
    const scene = motion_parseScene(world);
    const stage = world.querySelector('.stage');
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
      parallax: null,
      stop() {
        if (motion_RAF && state.frame) cancelAnimationFrame(state.frame);
        state.frame = 0;
        if (state.parallax) state.parallax.stop();
      }
    };
    const seek = motion_seekTime();
    if (seek !== null) {
      tick(scene, svg, seek);
      return state;
    }
    state.parallax = seedParallax(svg, seek);
    motion_startLoop(state, state.parallax);
    return state;
  } catch (error) {
    console.error('diorama motion: mount failed:', error && error.message ? error.message : error);
    return null;
  }
}
