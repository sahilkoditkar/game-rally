// Dustline — game shell: renderer, loop, states, players (solo / split-screen duel), camera, dust, HUD, menu, input.
import * as THREE from 'three';
import { STAGES, Stage, STEP, clamp, smoothstep, mulberry } from './track.js';
import { Car, PAINTS, autopilot } from './car.js';
import { Sound } from './audio.js';

// ---------------------------------------------------------------- utilities
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const FIXED = 1 / 120;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
function fmt(t) {
  if (!(t >= 0)) return '-:--.---';
  const ms = Math.floor(t * 1000), m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, r = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
function fmtDelta(d) { return (d < 0 ? '−' : '+') + Math.abs(d).toFixed(3); }
const deltaClass = (d) => (d == null ? 'd-none' : d < 0 ? 'd-good' : 'd-bad');
const bestKey = (def) => `dustline.best.${def.id}`;
const getBest = (def) => { const b = store.get(bestKey(def), null); return b && typeof b.t === 'number' ? b : null; };

// stage length without building geometry: run only the path builder with flat noise
function stageLength(def) {
  try {
    const o = Object.create(Stage.prototype);
    o.def = def; o.R = mulberry(def.seed); o.n1 = o.n2 = () => 0;
    o.buildPath();
    return o.length;
  } catch { return 0; }
}
const LENGTHS = STAGES.map(stageLength);

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.7);
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 320 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.06;
scene.add(hemi, sun, sun.target);
const sunDir = new THREE.Vector3(0.6, 0.7, 0.3).normalize();

function skyTexture(top, horizon) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(0.72, horizon); gr.addColorStop(1, horizon);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- dust (one pool shared by all cars)
const DUST_N = 280, DUST_MAX = 1.45; // max puff radius (m)
class Dust {
  constructor() {
    this.mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false, flatShading: true });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), this.mat, DUST_N);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.p = new Float32Array(DUST_N * 3); this.v = new Float32Array(DUST_N * 3);
    this.age = new Float32Array(DUST_N).fill(2); this.life = new Float32Array(DUST_N).fill(1);
    this.size = new Float32Array(DUST_N); this.rot = new Float32Array(DUST_N * 3);
    const col = new THREE.Color();
    for (let i = 0; i < DUST_N; i++) this.mesh.setColorAt(i, col.setScalar(0.88 + Math.random() * 0.12));
    this.next = 0;
    this.o = new THREE.Object3D();
  }
  // emissive lift keeps puffs reading as airy dust (not rocks) on their shadow side
  setColor(hex) { this.mat.color.set(hex); this.mat.emissive.set(hex).multiplyScalar(0.62); }
  clear() { this.age.fill(2); this.life.fill(1); }
  emit(x, y, z, vx, vy, vz, size, life) {
    const i = this.next; this.next = (this.next + 1) % DUST_N;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size;
    this.rot[i * 3] = Math.random() * 6; this.rot[i * 3 + 1] = Math.random() * 6; this.rot[i * 3 + 2] = Math.random() * 6;
  }
  step(dt) { // simulation, once per frame
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < DUST_N; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const k = i * 3;
      this.v[k] *= drag; this.v[k + 2] *= drag; this.v[k + 1] = this.v[k + 1] * drag + 0.25 * dt;
      this.p[k] += this.v[k] * dt; this.p[k + 1] += this.v[k + 1] * dt; this.p[k + 2] += this.v[k + 2] * dt;
    }
  }
  layout(cp) { // instance matrices for one viewpoint (puffs near that lens fade out)
    const o = this.o;
    for (let i = 0; i < DUST_N; i++) {
      const t = this.age[i] / this.life[i];
      if (t >= 1) { o.scale.setScalar(0); o.position.set(0, -999, 0); o.updateMatrix(); this.mesh.setMatrixAt(i, o.matrix); continue; }
      const k = i * 3;
      let s = Math.min(DUST_MAX, this.size[i] * (0.45 + 1.35 * smoothstep(0, 0.3, t))) * (1 - smoothstep(0.35, 1, t));
      const dx = this.p[k] - cp.x, dy = this.p[k + 1] - cp.y, dz = this.p[k + 2] - cp.z;
      s *= smoothstep(5, 10, Math.sqrt(dx * dx + dy * dy + dz * dz));
      o.position.set(this.p[k], this.p[k + 1], this.p[k + 2]);
      o.rotation.set(this.rot[k] + t, this.rot[k + 1] + t * 0.7, this.rot[k + 2]);
      o.scale.set(s, s * 0.8, s);
      o.updateMatrix();
      this.mesh.setMatrixAt(i, o.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
const dust = new Dust();
scene.add(dust.mesh);
const _w = new THREE.Vector3();
function emitDust(p, dt) {
  const car = p.car;
  if (!car.grounded || car.speed < 1.5) { p.carry[0] = p.carry[1] = 0; return; }
  const sp = car.speed, slip = car.slip || 0, off = car.offroad || 0;
  // straight-line driving leaves a light trail; sliding (slip) and verges throw much more
  const rate = (sp * 0.45 + slip * slip * 0.9 + slip * 4) * (0.55 + off * 1.1) * (1 + 0.8 * (car.drift || 0)) * smoothstep(1.5, 6, sp); // puffs / s per wheel
  for (let w = 0; w < 2; w++) {
    p.carry[w] += rate * dt;
    while (p.carry[w] >= 1) {
      p.carry[w] -= 1;
      car.wheelWorld(2 + w, _w);
      const r = () => Math.random() - 0.5;
      const big = 1 + Math.min(slip, 10) * 0.04 + off * 0.25;
      dust.emit(_w.x + r() * 0.5, _w.y + 0.25, _w.z + r() * 0.5,
        car.vx * 0.22 + r() * 2.4, 0.3 + Math.random() * 0.8, car.vz * 0.22 + r() * 2.4,
        (0.45 + Math.random() * 0.35) * big, 0.75 + Math.random() * 0.5);
    }
  }
}

// ---------------------------------------------------------------- sound (one centred instance solo, two panned in duel)
let muted = !!store.get('dustline.muted', false);
const soundBank = {};
function soundFor(key, opts) {
  if (!soundBank[key]) { soundBank[key] = new Sound(opts); soundBank[key].setMuted(muted); }
  return soundBank[key];
}
const allSounds = () => Object.values(soundBank);
const resumeAudio = () => { for (const s of allSounds()) s.resume(); };
const modeSounds = () => (racers.length === 2
  ? [soundFor('l', { pan: -0.5, gain: 0.85 }), soundFor('r', { pan: 0.5, gain: 0.85 })]
  : [soundFor('c', { pan: 0, gain: 1 })]);
const beepAll = (f, d) => { for (const s of modeSounds()) s.beep(f, d); };
soundFor('c', { pan: 0, gain: 1 });

// ---------------------------------------------------------------- players
const CAMS = [
  { name: 'CHASE', dist: 13, h: 7.5, look: 6 },
  { name: 'HIGH', dist: 22, h: 15, look: 8 },
  { name: 'TOP', dist: 4.5, h: 27, look: 3 },
];
const PANE_HTML = `
  <div class="hud-tl">
    <div class="hud-stage"><b class="pl-tag"></b><span class="st-name"></span></div>
    <div class="hud-time">0:00.000</div>
    <div class="hud-gap"></div>
    <div class="hud-split"></div>
  </div>
  <div class="hud-progress"><div class="prog"><div class="prog-fill"></div><div class="prog-ticks"></div><div class="prog-cars"></div></div></div>
  <div class="hud-br">
    <div class="speed"><span class="spd">0</span><small>km/h</small></div>
    <div class="gearrow"><span class="gear">1</span><div class="rpm"><div class="rpm-fill"></div></div></div>
  </div>
  <div class="pane-msg hidden"><div class="pm-kicker"></div><div class="pm-time"></div><div class="pm-wait"></div></div>
  <div class="notice"></div>`;

class Player {
  constructor(i) {
    this.i = i;
    this.name = 'P' + (i + 1);
    this.car = new Car();
    scene.add(this.car.group);
    this.cam = new THREE.PerspectiveCamera(50, 1, 0.3, 420);
    this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3();
    this.camYaw = 0; this.camSnap = true; this.camMode = 0; this.shake = 0; this.orbitA = i * 2.1;
    this.view = { x: 0, y: 0, w: 1, h: 1 };
    this.carry = [0, 0];
    const el = document.createElement('div');
    el.className = 'pane'; el.dataset.p = String(i); el.innerHTML = PANE_HTML;
    $('panes').appendChild(el);
    const q = (s) => el.querySelector(s);
    this.ui = {
      el, tag: q('.pl-tag'), stage: q('.st-name'), time: q('.hud-time'), gap: q('.hud-gap'), split: q('.hud-split'),
      fill: q('.prog-fill'), ticks: q('.prog-ticks'), cars: q('.prog-cars'), speed: q('.spd'), gear: q('.gear'), rpm: q('.rpm-fill'),
      msg: q('.pane-msg'), msgK: q('.pm-kicker'), msgT: q('.pm-time'), msgW: q('.pm-wait'), notice: q('.notice'),
      last: '', gapTxt: '', markers: [],
    };
    this.setPaint(clamp(store.get(i ? 'dustline.paint2' : 'dustline.paint', i ? 1 : 0) | 0, 0, PAINTS.length - 1));
    this.resetRun();
  }
  get paint() { return PAINTS[this.paintIdx]; }
  setPaint(idx) {
    this.paintIdx = idx; this.car.setPaint(this.paint.hex);
    this.ui.tag.style.background = this.paint.hex;
    this.ui.el.style.setProperty('--pc', this.paint.hex);
  }
  resetRun() { this.time = 0; this.splits = []; this.nextSplit = 0; this.done = false; this.doneT = 0; this.stuckT = 0; }
  // car.reset puts the car on the centreline; lat (+ = left) shifts it sideways along the road normal
  place(idx, lat = 0) {
    const c = this.car;
    idx = clamp(Math.round(idx), 0, stage.n - 1);
    c.reset(stage, idx);
    if (lat) {
      c.x += stage.tz[idx] * lat; c.z -= stage.tx[idx] * lat; c.y = stage.height(c.x, c.z);
      if (c._prev) Object.assign(c._prev, { x: c.x, y: c.y, z: c.z, yaw: c.yaw }); // no interpolated slide from the centreline
      c.updateVisual(0);
    }
    c.impact = 0; this.camSnap = true; this.stuckT = 0; this.carry[0] = this.carry[1] = 0;
  }
}

// ---------------------------------------------------------------- stage
const stages = [];
let stage = null, stageIdx = -1;
function loadStage(i) {
  if (i === stageIdx && stage) return;
  if (stage) scene.remove(stage.group);
  stage = stages[i] || (stages[i] = new Stage(STAGES[i]));
  stageIdx = i;
  scene.add(stage.group);
  const d = stage.def;
  if (scene.background) scene.background.dispose();
  scene.background = skyTexture(d.sky[0], d.sky[1]);
  scene.fog = new THREE.Fog(d.fog, d.fogRange[0], d.fogRange[1]);
  hemi.color.set(d.ambient[0]); hemi.groundColor.set(d.ambient[1]);
  sun.color.set(d.sun);
  sunDir.set(d.sunPos[0], d.sunPos[1], d.sunPos[2]).normalize();
  dust.setColor(d.dust);
  dust.clear();
}

// ---------------------------------------------------------------- state
const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const hasFinePointer = window.matchMedia && window.matchMedia('(any-pointer: fine)').matches;
if (isTouch) document.body.classList.add('touch');
const players = [new Player(0), new Player(1)];
let racers = [players[0]];
let state = 'boot', paused = false;
let auto = params.get('auto') === '1';
let mode = 'solo';
let sel = 0, cdT = 0, cdShown = null, finishT = 0, lastRun = null, hintsT = 0;

const connectedPads = () => [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter((g) => g && g.connected);
// split-screen needs two sets of controls: a keyboard, or two gamepads
const duelAvailable = () => !isTouch || hasFinePointer || connectedPads().length >= 2;

function setMode(m) {
  mode = m === 'duel' && duelAvailable() ? 'duel' : 'solo';
  store.set('dustline.mode', mode);
  if (state === 'menu') renderMenu();
}

function setScreen() {
  const racing = state === 'countdown' || state === 'race' || state === 'finish';
  const duel = racers.length === 2, showResults = state === 'finish' && finishT > 1.1;
  document.body.classList.toggle('duel', duel && racing);
  $('menu').classList.toggle('hidden', state !== 'menu');
  $('hud').classList.toggle('hidden', !racing);
  $('pause').classList.toggle('hidden', !paused);
  $('finish').classList.toggle('hidden', !(showResults && !duel));
  $('duelFinish').classList.toggle('hidden', !(showResults && duel));
  $('touch').classList.toggle('hidden', !(isTouch && !duel && (state === 'countdown' || state === 'race') && !paused));
  players[1].car.group.visible = duel && racing;
  for (const p of players) {
    p.ui.el.classList.toggle('hidden', !racers.includes(p));
    p.ui.msg.classList.toggle('hidden', !(duel && p.done && !showResults));
  }
  layout();
}

// viewports: one full-screen pane, or two side by side (landscape) / stacked (portrait)
function layout() {
  const W = window.innerWidth, H = window.innerHeight, duel = racers.length === 2;
  const pr = Math.min(window.devicePixelRatio || 1, duel ? 1.5 : 2);
  if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
  renderer.setSize(W, H);
  const land = W >= H;
  if (!duel) players[0].view = { x: 0, y: 0, w: W, h: H };
  else if (land) { const a = Math.floor(W / 2); players[0].view = { x: 0, y: 0, w: a, h: H }; players[1].view = { x: a, y: 0, w: W - a, h: H }; }
  else { const a = Math.floor(H / 2); players[0].view = { x: 0, y: 0, w: W, h: a }; players[1].view = { x: 0, y: a, w: W, h: H - a }; }
  const div = $('divider');
  div.classList.toggle('hidden', !duel || state === 'menu');
  div.className = 'divider' + (land ? ' v' : ' h') + (!duel || state === 'menu' ? ' hidden' : '');
  document.body.classList.toggle('stacked', duel && !land);
  for (const p of racers) {
    const v = p.view, c = p.cam, s = p.ui.el.style;
    s.left = v.x + 'px'; s.top = v.y + 'px'; s.width = v.w + 'px'; s.height = v.h + 'px';
    c.aspect = v.w / v.h;
    c.fov = c.aspect < 0.8 ? 62 : c.aspect < 1.1 ? 56 : 50;
    // solo menu / results: nudge the car out from under the panel (right on wide screens, up on portrait)
    const side = !duel && (state === 'menu' || (state === 'finish' && finishT > 1.1));
    if (side && W > 720) c.setViewOffset(W, H, -Math.min(W * 0.2, 300), 0, W, H);
    else if (!duel && state === 'menu') c.setViewOffset(W, H, 0, H * 0.12, W, H);
    else c.clearViewOffset();
    c.updateProjectionMatrix();
  }
}
window.addEventListener('resize', layout);

function startStage(i) {
  i = ((i | 0) % STAGES.length + STAGES.length) % STAGES.length;
  withLoading(i, () => {
    sel = i;
    loadStage(i);
    racers = mode === 'duel' ? players : [players[0]];
    racers.forEach((p, k) => {
      p.resetRun();
      p.place(stage.startIdx, racers.length === 2 ? (k === 0 ? 1.6 : -1.6) : 0); // P1 on the left, P2 on the right
      p.ui.stage.textContent = stage.def.name;
      p.ui.tag.textContent = racers.length === 2 ? p.name : '';
      p.ui.split.classList.remove('show');
      p.ui.gap.textContent = ''; p.ui.gapTxt = '';
      hideNotice(p);
    });
    buildProgress();
    dust.clear();
    state = 'countdown'; paused = false;
    cdT = -0.5; cdShown = null; finishT = 0; hintsT = 0;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    setScreen();
  });
}

function toMenu() {
  paused = false;
  state = 'menu';
  racers = [players[0]];
  $('countdown').textContent = '';
  if (stageIdx !== sel) loadStage(sel);
  players[0].place(stage.startIdx);
  dust.clear();
  renderMenu();
  setScreen();
}

function setPaused(p) {
  if (!(state === 'countdown' || state === 'race')) p = false;
  paused = p;
  if (p) { $('pauseStage').textContent = stage.def.name; keys.clear(); }
  setScreen();
}

function resetPlayer(p, notice) {
  p.place(clamp(p.car.idx | 0, 0, stage.n - 1));
  if (notice) showNotice(p, notice, 1.4);
}

function showSplit(p, k) {
  let d = null;
  if (racers.length === 1) { const b = getBest(stage.def); if (b && b.s && b.s[k] != null) d = p.time - b.s[k]; }
  else { const o = racers[1 - p.i]; if (o.splits[k] != null) d = p.time - o.splits[k]; }
  const el = p.ui.split, vs = racers.length === 2 && d != null ? ` <span class="lbl">vs ${racers[1 - p.i].name}</span>` : '';
  el.innerHTML = `<span class="lbl">SPLIT ${k + 1}</span><span class="${deltaClass(d)}">${d == null ? fmt(p.time) : fmtDelta(d)}</span>${vs}`;
  el.classList.add('show');
  clearTimeout(p.splitTm);
  p.splitTm = setTimeout(() => el.classList.remove('show'), 3200);
  modeSounds()[racers.length === 2 ? p.i : 0].beep(740, 0.12);
}

function checkProgress(p) {
  while (p.nextSplit < stage.splits.length && p.car.idx >= stage.splits[p.nextSplit]) {
    p.splits[p.nextSplit] = p.time;
    showSplit(p, p.nextSplit);
    p.nextSplit++;
  }
  if (p.car.idx >= stage.finishIdx) playerFinish(p);
}

function playerFinish(p) {
  p.done = true; p.doneT = 0;
  const snd = modeSounds()[racers.length === 2 ? p.i : 0];
  snd.beep(988, 0.25); setTimeout(() => snd.beep(1318, 0.4), 160);
  showNotice(p, 'FINISH', 1.2, 'alt');
  if (racers.length === 1) {
    const def = stage.def, prev = getBest(def), t = p.time, s = p.splits.slice(0, 2);
    const isBest = !prev || t < prev.t;
    if (isBest) store.set(bestKey(def), { t, s });
    lastRun = { t, s, prev, isBest };
    renderFinish();
  } else {
    for (const q of racers) {
      if (!q.done) continue;
      const o = racers[1 - q.i];
      q.ui.msgK.textContent = `${q.name} finished`;
      q.ui.msgT.textContent = fmt(q.time);
      q.ui.msgW.textContent = o.done ? '' : `waiting for ${o.name}…`;
    }
  }
  if (racers.every((q) => q.done)) {
    state = 'finish'; finishT = 0;
    if (racers.length === 2) renderDuelResults();
  }
  setScreen();
}

// ---------------------------------------------------------------- input
const keys = new Set();
const touchState = { left: false, right: false, gas: false, brake: false, hand: false };
const mkPad = () => ({ steer: 0, throttle: 0, brake: 0, hand: false, btn: [] });
const pads = [mkPad(), mkPad()];
const HOLD = { steer: 0, throttle: 0, brake: 0, hand: true }; // brake>0 at rest would engage reverse
const KEYSETS = {
  solo: { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], hand: ['Space'] },
  p1: { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'], hand: ['ShiftLeft', 'Space'] },
  p2: { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'], hand: ['ShiftRight', 'Enter', 'NumpadEnter'] },
};

function readInput(p) {
  const solo = racers.length === 1;
  const ks = solo ? KEYSETS.solo : p.i ? KEYSETS.p2 : KEYSETS.p1, pad = pads[solo ? 0 : p.i];
  const k = (arr) => arr.some((x) => keys.has(x));
  let steer = (k(ks.left) ? 1 : 0) - (k(ks.right) ? 1 : 0) + pad.steer;
  if (solo) steer += (touchState.left ? 1 : 0) - (touchState.right ? 1 : 0);
  return {
    steer: clamp(steer, -1, 1),
    throttle: Math.max(k(ks.up) ? 1 : 0, solo && touchState.gas ? 1 : 0, pad.throttle),
    brake: Math.max(k(ks.down) ? 1 : 0, solo && touchState.brake ? 1 : 0, pad.brake),
    hand: k(ks.hand) || (solo && touchState.hand) || pad.hand,
  };
}

// gamepad 0 -> P1, gamepad 1 -> P2 (in solo, the first pad drives)
function pollPads() {
  const list = connectedPads();
  for (let k = 0; k < 2; k++) {
    const pad = pads[k], gp = list[k];
    if (!gp) { pad.steer = pad.throttle = pad.brake = 0; pad.hand = false; pad.btn = []; continue; }
    const ax = gp.axes[0] || 0, b = (i) => gp.buttons[i] || { value: 0, pressed: false };
    pad.steer = Math.abs(ax) > 0.15 ? -Math.sign(ax) * (Math.abs(ax) - 0.15) / 0.85 : 0;
    pad.throttle = b(7).value; pad.brake = b(6).value; pad.hand = b(0).pressed;
    const was = pad.btn; pad.btn = gp.buttons.map((x) => x.pressed);
    const edge = (i) => pad.btn[i] && !was[i];
    if (edge(9)) onAction(state === 'menu' || state === 'finish' ? 'confirm' : 'pause');
    if (state === 'menu') { if (edge(0)) onAction('confirm'); if (edge(14)) select(sel - 1); if (edge(15)) select(sel + 1); }
    if (edge(3)) onAction('reset', k);
    if (edge(1) && state === 'finish') onAction('retry');
  }
}

function onAction(a, who = 0) {
  resumeAudio();
  if (a === 'mute') {
    muted = !muted; for (const s of allSounds()) s.setMuted(muted);
    store.set('dustline.muted', muted); renderMute(); return;
  }
  if (a === 'camera') {
    const p = racers[who];
    if (state !== 'menu' && p) { p.camMode = (p.camMode + 1) % CAMS.length; showNotice(p, CAMS[p.camMode].name + ' CAM', 0.9, 'alt'); }
    return;
  }
  if (state === 'menu') {
    if (a === 'left') select(sel - 1);
    else if (a === 'right') select(sel + 1);
    else if (a === 'confirm') startStage(sel);
    else if (a === 'solo' || a === 'duel') setMode(a);
  } else if (paused) {
    if (a === 'pause') setPaused(false);
  } else if (state === 'countdown' || state === 'race') {
    if (a === 'pause') setPaused(true);
    else if (a === 'reset' && state === 'race' && racers[who] && !racers[who].done) resetPlayer(racers[who]);
  } else if (state === 'finish') {
    if (a === 'retry' || (a === 'reset' && who === 0)) startStage(stageIdx);
    else if (a === 'next') startStage(stageIdx + 1);
    else if (a === 'confirm' || a === 'pause') toMenu();
  }
}

const KEYMAP = {
  KeyM: 'mute', KeyC: 'camera', Escape: 'pause', KeyP: 'pause', KeyR: 'reset', KeyN: 'next', Enter: 'confirm', NumpadEnter: 'confirm',
};
const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash', 'Backspace']);
window.addEventListener('keydown', (e) => {
  if (PREVENT.has(e.code)) e.preventDefault();
  const onBtn = e.target && e.target.closest && e.target.closest('button');
  if (onBtn && (e.code === 'Enter' || e.code === 'NumpadEnter')) return; // let the focused button act
  keys.add(e.code);
  if (e.repeat) return;
  let a = KEYMAP[e.code], who = 0;
  const racing = state === 'countdown' || state === 'race';
  if (racers.length === 2 && racing) {
    if (e.code === 'Slash' || e.code === 'Backspace') { a = 'reset'; who = 1; }
    if (e.code === 'Period') { a = 'camera'; who = 1; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') a = null; // P2 handbrake
  }
  if (state === 'menu') {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'ArrowUp') a = 'left';
    if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'ArrowDown') a = 'right';
    if (e.code === 'Space') a = 'confirm';
    if (e.code === 'Digit1') a = 'solo';
    if (e.code === 'Digit2') a = 'duel';
  }
  if (a) onAction(a, who);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); for (const k in touchState) touchState[k] = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden && (state === 'race' || state === 'countdown')) setPaused(true); });
window.addEventListener('pointerdown', resumeAudio, { passive: true });
window.addEventListener('gamepadconnected', () => { if (state === 'menu') renderMenu(); });
window.addEventListener('gamepaddisconnected', () => { if (state === 'menu') { if (!duelAvailable()) setMode('solo'); renderMenu(); } });
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && e.detail > 0) b.blur(); });

// touch (solo only): each control tracks its own set of pointers, so multi-touch works
for (const el of document.querySelectorAll('#touch [data-ctl]')) {
  const ctl = el.dataset.ctl, ids = new Set();
  const sync = () => { const on = ids.size > 0; el.classList.toggle('on', on); if (ctl in touchState) touchState[ctl] = on; };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); resumeAudio();
    ids.add(e.pointerId); sync();
    if (ctl === 'reset') onAction('reset');
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, (e) => { ids.delete(e.pointerId); sync(); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------------------------------------------------------------- camera
const _v = new THREE.Vector3(), _l = new THREE.Vector3();
// interpolated render pose (between the last two physics steps); falls back to the physics pose
const _pose = { x: 0, y: 0, z: 0, yaw: 0 };
function pose(car) {
  _pose.x = car.rx ?? car.x; _pose.y = car.ry ?? car.y; _pose.z = car.rz ?? car.z; _pose.yaw = car.ryaw ?? car.yaw;
  return _pose;
}
function updateCamera(p, dt) {
  const cam = p.cam, phys = p.car, car = pose(phys);
  const orbit = state === 'menu' || (p.done && p.doneT > 1.1);
  if (orbit) {
    // side-on orbit (never straight behind, where the dust plume trails), high enough to look over it
    p.orbitA += dt * 0.12;
    const a = car.yaw + Math.PI * 0.55 + Math.sin(p.orbitA) * 0.85;
    const R = state === 'menu' ? 17 : 14, H = state === 'menu' ? 9.5 : 6.5;
    _v.set(car.x + Math.sin(a) * R, car.y + H, car.z + Math.cos(a) * R);
    _l.set(car.x, car.y + 0.8, car.z);
    p.camYaw = car.yaw;
  } else {
    const c = CAMS[p.camMode], sp = phys.speed;
    let fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    if (sp > 3) {
      const w = 0.6 * smoothstep(3, 10, sp);
      fx = fx * (1 - w) + (phys.vx / sp) * w; fz = fz * (1 - w) + (phys.vz / sp) * w;
    }
    const target = Math.atan2(fx, fz);
    p.camYaw = p.camSnap ? target : p.camYaw + angDiff(target, p.camYaw) * damp(3.2, dt);
    const sk = clamp(sp / 40, 0, 1), dist = c.dist * (1 + sk * 0.2), h = c.h * (1 + sk * 0.06);
    const sx = Math.sin(p.camYaw), sz = Math.cos(p.camYaw);
    _v.set(car.x - sx * dist, car.y + h, car.z - sz * dist);
    _l.set(car.x + sx * c.look, car.y + 0.8, car.z + sz * c.look);
  }
  if (p.camSnap) { p.camPos.copy(_v); p.camLook.copy(_l); p.camSnap = false; }
  else { p.camPos.lerp(_v, damp(orbit ? 2 : 6, dt)); p.camLook.lerp(_l, damp(orbit ? 4 : 10, dt)); }
  const gy = stage.height(p.camPos.x, p.camPos.z) + 1.6;
  if (p.camPos.y < gy) p.camPos.y = gy;
  cam.position.copy(p.camPos);
  if (p.shake > 0.001) {
    const s = p.shake * 0.45;
    cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s; cam.position.z += (Math.random() - 0.5) * s;
    p.shake *= Math.exp(-6 * dt);
  }
  cam.lookAt(p.camLook);
}
// shadow frustum follows the car of the pane being rendered, centred a little ahead in view direction
function aimSun(p) {
  const car = pose(p.car), cx = car.x + Math.sin(p.camYaw) * 14, cz = car.z + Math.cos(p.camYaw) * 14;
  sun.target.position.set(cx, car.y, cz);
  sun.position.set(cx + sunDir.x * 150, car.y + sunDir.y * 150, cz + sunDir.z * 150);
  sun.target.updateMatrixWorld();
}

// ---------------------------------------------------------------- HUD
const cdEl = $('countdown'), hintsEl = $('hints');
function showNotice(p, text, dur = 1.4, cls = '') {
  const n = p.ui.notice;
  n.textContent = text; n.className = 'notice show ' + cls;
  clearTimeout(p.noticeTm);
  p.noticeTm = setTimeout(() => hideNotice(p), dur * 1000);
}
function hideNotice(p) { p.ui.notice.classList.remove('show'); }
function buildProgress() {
  const span = stage.finishIdx - stage.startIdx;
  const ticks = stage.splits.map((i) => `<i style="left:${((i - stage.startIdx) / span) * 100}%"></i>`).join('') + '<i class="end" style="left:100%"></i>';
  for (const p of racers) {
    p.ui.ticks.innerHTML = ticks;
    // one marker per racer in their paint; this pane's own car sits on top
    p.ui.cars.innerHTML = racers.map((q) => `<i class="${q === p ? 'me' : ''}" style="background:${q.paint.hex}"></i>`).join('');
    p.ui.markers = [...p.ui.cars.children];
  }
}
const progressOf = (p) => clamp((p.car.idx - stage.startIdx) / (stage.finishIdx - stage.startIdx), 0, 1);
function updateHUD(dt) {
  if (state === 'menu' || state === 'boot') return;
  const duel = racers.length === 2;
  for (const p of racers) {
    const u = p.ui, car = p.car;
    const txt = fmt(state === 'countdown' ? 0 : p.time);
    if (txt !== u.last) { u.time.textContent = txt; u.last = txt; }
    u.speed.textContent = Math.round(Math.abs(car.vf != null ? car.vf : car.speed) * 3.6);
    u.gear.textContent = car.gear === 0 ? 'R' : String(car.gear | 0 || 1);
    u.rpm.style.width = (clamp(car.rpm, 0, 1) * 100).toFixed(1) + '%';
    u.fill.style.width = (progressOf(p) * 100).toFixed(2) + '%';
    racers.forEach((q, k) => { if (u.markers[k]) u.markers[k].style.left = (progressOf(q) * 100).toFixed(2) + '%'; });
    if (duel) {
      // live gap: distance along the road to the other car (cheap and stable)
      const o = racers[1 - p.i];
      let g = '';
      if (state === 'race' && !p.done) {
        if (o.done) g = `<span class="lbl">${o.name}</span> ${fmt(o.time)}`;
        else {
          const d = Math.round((car.idx - o.car.idx) * STEP);
          g = `<span class="lbl">GAP</span><span class="${d > 0 ? 'd-good' : d < 0 ? 'd-bad' : 'd-none'}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)} m</span>`;
        }
      }
      if (g !== u.gapTxt) { u.gap.innerHTML = g; u.gapTxt = g; u.gap.classList.toggle('show', !!g); }
    }
  }
  if (state === 'race' && !paused) hintsT += dt;
  hintsEl.classList.toggle('show', state === 'race' && !duel && hintsT < 6);
}

function updateCountdown(dt) {
  cdT += dt;
  const n = cdT < 0 ? null : cdT < 3 ? 3 - Math.floor(cdT) : 'GO';
  if (n !== cdShown) {
    cdShown = n;
    cdEl.textContent = n == null ? '' : n;
    cdEl.className = 'countdown' + (n === 'GO' ? ' go' : '');
    void cdEl.offsetWidth; // restart animation
    if (n != null) cdEl.classList.add('pop');
    if (n === 'GO') {
      beepAll(880, 0.35);
      state = 'race'; hintsT = 0;
      for (const p of racers) p.time = 0;
      setTimeout(() => { if (cdShown === 'GO') cdEl.textContent = ''; }, 700);
      setScreen();
    } else if (n != null) beepAll(440, 0.12);
  }
}

// ---------------------------------------------------------------- menu & panels
function paintRow(el, p, key) {
  el.innerHTML = PAINTS.map((c, i) => `<button class="swatch${i === p.paintIdx ? ' sel' : ''}" data-i="${i}" style="background:${c.hex}" aria-label="${p.name} ${c.name}" title="${c.name}"></button>`).join('');
  for (const b of el.children) b.addEventListener('click', () => { p.setPaint(+b.dataset.i); store.set(key, p.paintIdx); renderMenu(); });
}
function renderMenu() {
  $('cards').innerHTML = STAGES.map((d, i) => {
    const b = getBest(d), km = LENGTHS[i] ? (LENGTHS[i] / 1000).toFixed(1) + ' km' : '';
    return `<button class="card${i === sel ? ' sel' : ''}" data-i="${i}">
      <span class="card-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="card-name">${d.name}</span>
      <span class="card-tag">${d.tag}</span>
      <span class="card-meta"><b>${km}</b><span class="${b ? 'has-best' : ''}">${b ? fmt(b.t) : 'no time'}</span></span>
    </button>`;
  }).join('');
  for (const el of $('cards').children) el.addEventListener('click', () => { const i = +el.dataset.i; if (i === sel) startStage(i); else select(i); });
  paintRow($('paints'), players[0], 'dustline.paint');
  paintRow($('paints2'), players[1], 'dustline.paint2');
  const duel = mode === 'duel', avail = duelAvailable();
  $('paintName').textContent = duel ? `${players[0].paint.name} vs ${players[1].paint.name}` : players[0].paint.name;
  $('menu').classList.toggle('duel', duel);
  for (const b of document.querySelectorAll('.seg-btn')) {
    b.classList.toggle('sel', b.dataset.mode === mode);
    b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  }
  const db = document.querySelector('.seg-btn[data-mode="duel"]');
  db.disabled = !avail;
  $('modeNote').textContent = avail ? (duel ? 'split screen, one keyboard' : 'time trial') : 'Duel needs a keyboard or two gamepads';
  renderMute();
}
function renderMute() {
  const b = $('muteBtn');
  b.textContent = muted ? 'Sound off' : 'Sound on';
  b.setAttribute('aria-pressed', String(muted));
}
function select(i) {
  i = (i + STAGES.length) % STAGES.length;
  if (i === sel && stageIdx === i) return;
  sel = i; store.set('dustline.stage', sel);
  renderMenu();
  withLoading(i, () => { if (state === 'menu' && sel === i) { loadStage(i); players[0].place(stage.startIdx); } });
}
// build a stage behind a small loading veil (first visit only; built stages are cached)
function withLoading(i, fn) {
  if (stages[i]) { fn(); return; }
  const l = $('loading');
  l.classList.remove('fade'); if (state !== 'boot') l.classList.add('soft');
  requestAnimationFrame(() => setTimeout(() => { fn(); l.classList.add('fade'); }, 30));
}

function renderFinish() {
  const { t, s, prev, isBest } = lastRun;
  $('finStage').textContent = stage.def.name + ' · complete';
  $('finTime').textContent = fmt(t);
  $('finBest').innerHTML = isBest
    ? `<span class="newbest">NEW BEST</span>${prev ? ` &nbsp;${fmtDelta(t - prev.t)} on ${fmt(prev.t)}` : ''}`
    : `Best ${fmt(prev.t)} &nbsp;<span style="color:var(--bad)">${fmtDelta(t - prev.t)}</span>`;
  const rows = [['Split 1', s[0], prev && prev.s ? prev.s[0] : null], ['Split 2', s[1], prev && prev.s ? prev.s[1] : null], ['Finish', t, prev ? prev.t : null]];
  $('finSplits').innerHTML = rows.map(([n, v, b]) => {
    const d = v != null && b != null ? v - b : null;
    return `<tr><td>${n}</td><td>${fmt(v)}</td><td class="${deltaClass(d)}">${d == null ? '—' : fmtDelta(d)}</td></tr>`;
  }).join('');
  $('nextBtn').innerHTML = `Next: ${STAGES[(stageIdx + 1) % STAGES.length].name}<span class="btn-key">N</span>`;
}

function renderDuelResults() {
  const [a, b] = racers, gap = Math.abs(a.time - b.time), tie = gap < 0.0005;
  const w = a.time <= b.time ? a : b;
  $('dfStage').textContent = stage.def.name + ' · duel';
  const win = $('dfWinner');
  win.style.setProperty('--pc', tie ? 'var(--mustard)' : w.paint.hex);
  win.innerHTML = tie ? '<span class="w-name">DEAD HEAT</span>' : `<span class="w-chip"></span><span class="w-name">${w.name} WINS</span><span class="w-paint">${w.paint.name}</span>`;
  $('dfGap').textContent = tie ? 'identical to the millisecond' : `by ${gap.toFixed(3)} s`;
  const chip = (p) => `<span class="pchip" style="background:${p.paint.hex}"></span>${p.name}`;
  const rows = [['Split 1', a.splits[0], b.splits[0]], ['Split 2', a.splits[1], b.splits[1]], ['Finish', a.time, b.time]];
  $('dfTable').innerHTML = `<tr class="hd"><td></td><td>${chip(a)}</td><td>${chip(b)}</td><td>Gap</td></tr>` + rows.map(([n, x, y]) => {
    const both = x != null && y != null, fa = both && x < y, fb = both && y < x;
    return `<tr><td>${n}</td><td class="${fa ? 'win' : ''}">${fmt(x)}</td><td class="${fb ? 'win' : ''}">${fmt(y)}</td><td>${both ? Math.abs(x - y).toFixed(3) : '—'}</td></tr>`;
  }).join('');
  $('dfNext').innerHTML = `Next: ${STAGES[(stageIdx + 1) % STAGES.length].name}<span class="btn-key">N</span>`;
}

$('startBtn').addEventListener('click', () => onAction('confirm'));
$('muteBtn').addEventListener('click', () => onAction('mute'));
$('pauseBtn').addEventListener('click', () => onAction('pause'));
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('restartBtn').addEventListener('click', () => startStage(stageIdx));
$('pMenuBtn').addEventListener('click', toMenu);
$('retryBtn').addEventListener('click', () => startStage(stageIdx));
$('nextBtn').addEventListener('click', () => startStage(stageIdx + 1));
$('fMenuBtn').addEventListener('click', toMenu);
$('dfRematch').addEventListener('click', () => startStage(stageIdx));
$('dfNext').addEventListener('click', () => startStage(stageIdx + 1));
$('dfMenu').addEventListener('click', toMenu);
for (const b of document.querySelectorAll('.seg-btn')) b.addEventListener('click', () => onAction(b.dataset.mode));

// ---------------------------------------------------------------- simulation
function stepPhysics(dt) {
  for (const p of racers) {
    const car = p.car;
    let input;
    if (state === 'menu') input = autopilot(car, stage);
    else if (state === 'countdown') input = HOLD;
    else if (p.done) input = { ...autopilot(car, stage), throttle: 0, brake: car.vf > 1 ? 0.55 : 0, hand: car.vf <= 1 }; // stop, never reverse
    else if (auto) { input = autopilot(car, stage); if (p.i === 1) input = { ...input, throttle: input.throttle * 0.86 }; }
    else input = readInput(p);
    car.step(dt, input, stage);
    if (state === 'race' && !p.done) { p.time += dt; checkProgress(p); }
  }
}

function watchdog(p, dt) {
  if (state === 'countdown') return;
  const car = p.car;
  if (car.roadDist > 60 || !Number.isFinite(car.x) || car.y < -200) {
    if (state === 'menu') p.place(stage.startIdx);
    else resetPlayer(p, 'OFF COURSE');
    return;
  }
  if (state === 'menu') {
    if (car.idx >= stage.finishIdx) p.place(stage.startIdx); // attract mode loops the stage
    p.stuckT = car.speed < 1 ? p.stuckT + dt : 0;
    if (p.stuckT > 4) p.place(Math.min(car.idx + 6, stage.finishIdx - 1));
  }
}

function render() {
  const H = window.innerHeight;
  if (racers.length === 1) {
    const p = racers[0];
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, H);
    aimSun(p); dust.layout(p.cam.position);
    renderer.render(scene, p.cam);
    return;
  }
  renderer.setScissorTest(true);
  for (const p of racers) {
    const v = p.view, y = H - v.y - v.h; // three.js viewports start bottom-left
    renderer.setViewport(v.x, y, v.w, v.h);
    renderer.setScissor(v.x, y, v.w, v.h);
    aimSun(p); dust.layout(p.cam.position);
    renderer.render(scene, p.cam);
  }
  renderer.setScissorTest(false);
}

let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
  if (!stage) return;
  pollPads();
  const running = !paused && state !== 'boot';
  if (running) {
    if (state === 'countdown') updateCountdown(dt);
    acc += dt;
    while (acc >= FIXED) { stepPhysics(FIXED); acc -= FIXED; }
    if (state === 'finish') { const was = finishT; finishT += dt; if (was <= 1.1 && finishT > 1.1) setScreen(); }
    for (const p of racers) {
      if (p.done) p.doneT += dt;
      watchdog(p, dt);
      p.car.updateVisual(dt);
      emitDust(p, dt);
    }
    dust.step(dt);
  } else acc = 0;
  const snds = modeSounds();
  racers.forEach((p, k) => {
    const car = p.car;
    if (car.impact > 0) {
      if (state !== 'menu') { snds[k].impact(car.impact); p.shake = Math.min(1.2, p.shake + car.impact / 10); }
      car.impact = 0;
    }
    updateCamera(p, dt);
  });
  updateHUD(dt);
  const active = state !== 'menu' && state !== 'boot' && !paused;
  for (const s of allSounds()) {
    const k = snds.indexOf(s), car = k >= 0 ? racers[k].car : players[0].car;
    s.update(dt, {
      rpm: car.rpm, throttle: car.throttle, speed: car.speed, slip: car.slip, offroad: car.offroad, grounded: car.grounded,
      active: active && k >= 0,
    });
  }
  render();
}

// ---------------------------------------------------------------- boot
window.__game = {
  get state() { return paused ? 'paused' : state; },
  get mode() { return mode; },
  car: players[0].car,
  get cars() { return racers.map((p) => p.car); },
  get stage() { return stage; },
  startStage,
  setMode,
  get time() { return players[0].time; },
  get times() { return racers.map((p) => p.time); },
  setAuto(b) { auto = !!b; },
};

function boot() {
  const ps = params.get('stage');
  let i = store.get('dustline.stage', 0) | 0;
  if (ps != null) {
    const byId = STAGES.findIndex((d) => d.id === ps);
    i = byId >= 0 ? byId : parseInt(ps, 10) || 0;
  }
  sel = clamp(i, 0, STAGES.length - 1);
  mode = (params.get('mode') || store.get('dustline.mode', 'solo')) === 'duel' && duelAvailable() ? 'duel' : 'solo';
  loadStage(sel);
  players[0].place(stage.startIdx);
  if (params.get('start') === '1') startStage(sel);
  else toMenu();
  $('loading').classList.add('fade');
  requestAnimationFrame(frame);
}
requestAnimationFrame(() => setTimeout(boot, 30));
