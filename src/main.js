// Dustline — game shell: renderer, loop, states, camera, dust, HUD, menu, input.
import * as THREE from 'three';
import { STAGES, Stage, clamp, smoothstep, mulberry } from './track.js';
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
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.3, 420);
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

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 0.8 ? 62 : 50; // portrait phones see a bit more
  applyViewOffset();
  camera.updateProjectionMatrix();
}
function applyViewOffset() {
  const w = window.innerWidth, h = window.innerHeight;
  // in the menu, nudge the car out from under the panel (right on wide screens, up on portrait)
  if (state === 'menu' && w > 720) camera.setViewOffset(w, h, -Math.min(w * 0.2, 300), 0, w, h);
  else if (state === 'menu') camera.setViewOffset(w, h, 0, h * 0.12, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

// ---------------------------------------------------------------- dust
const DUST_N = 160;
class Dust {
  constructor() {
    this.mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, flatShading: true });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), this.mat, DUST_N);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.p = new Float32Array(DUST_N * 3); this.v = new Float32Array(DUST_N * 3);
    this.age = new Float32Array(DUST_N); this.life = new Float32Array(DUST_N).fill(1);
    this.size = new Float32Array(DUST_N); this.rot = new Float32Array(DUST_N * 3);
    this.age.fill(2);
    const col = new THREE.Color();
    for (let i = 0; i < DUST_N; i++) this.mesh.setColorAt(i, col.setScalar(0.88 + Math.random() * 0.12));
    this.next = 0; this.carry = [0, 0];
    this.o = new THREE.Object3D();
    this.clear();
  }
  setColor(hex) { this.mat.color.set(hex); }
  clear() { this.age.fill(2); this.life.fill(1); this.update(0); }
  emit(x, y, z, vx, vy, vz, size, life) {
    const i = this.next; this.next = (this.next + 1) % DUST_N;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size;
    this.rot[i * 3] = Math.random() * 6; this.rot[i * 3 + 1] = Math.random() * 6; this.rot[i * 3 + 2] = Math.random() * 6;
  }
  update(dt) {
    const o = this.o, drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < DUST_N; i++) {
      const t = this.age[i] / this.life[i];
      if (t >= 1) { o.scale.setScalar(0); o.position.set(0, -999, 0); o.updateMatrix(); this.mesh.setMatrixAt(i, o.matrix); continue; }
      this.age[i] += dt;
      const k = i * 3;
      this.v[k] *= drag; this.v[k + 2] *= drag; this.v[k + 1] = this.v[k + 1] * drag + 0.25 * dt;
      this.p[k] += this.v[k] * dt; this.p[k + 1] += this.v[k + 1] * dt; this.p[k + 2] += this.v[k + 2] * dt;
      const s = this.size[i] * (0.35 + 1.65 * smoothstep(0, 0.4, t)) * (1 - smoothstep(0.5, 1, t));
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
function emitDust(dt) {
  if (!car.grounded || car.speed < 1.5) { dust.carry[0] = dust.carry[1] = 0; return; }
  const sp = car.speed, slip = car.slip || 0, off = car.offroad || 0;
  const rate = (sp * 0.75 + slip * 6) * (0.45 + off * 1.3) * smoothstep(1.5, 6, sp); // puffs / s per wheel
  for (let w = 0; w < 2; w++) {
    dust.carry[w] += rate * dt;
    while (dust.carry[w] >= 1) {
      dust.carry[w] -= 1;
      car.wheelWorld(2 + w, _w);
      const r = () => Math.random() - 0.5;
      const big = 1 + Math.min(slip, 12) * 0.05 + off * 0.35;
      dust.emit(_w.x + r() * 0.5, _w.y + 0.25, _w.z + r() * 0.5,
        car.vx * 0.28 + r() * 2.2, 0.6 + Math.random() * 1.1, car.vz * 0.28 + r() * 2.2,
        (0.42 + Math.random() * 0.4) * big, 1.1 + Math.random() * 0.9);
    }
  }
}

// ---------------------------------------------------------------- car / stage / sound
const car = new Car();
scene.add(car.group);
let paintIdx = clamp(store.get('dustline.paint', 0) | 0, 0, PAINTS.length - 1);
car.setPaint(PAINTS[paintIdx].hex);
const sound = new Sound();
sound.setMuted(!!store.get('dustline.muted', false));

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
  buildProgressTicks();
}
function placeCar(idx) { car.reset(stage, idx); car.impact = 0; dust.clear(); camSnap = true; stuckT = 0; }

// ---------------------------------------------------------------- state
let state = 'boot', paused = false;
let auto = params.get('auto') === '1';
let sel = 0, raceTime = 0, cdT = 0, cdShown = null, finishT = 0, stuckT = 0;
let splitTimes = [], nextSplit = 0, lastRun = null;

function setScreen() {
  const racing = state === 'countdown' || state === 'race' || state === 'finish';
  $('menu').classList.toggle('hidden', state !== 'menu');
  $('hud').classList.toggle('hidden', !racing);
  $('pause').classList.toggle('hidden', !paused);
  $('finish').classList.toggle('hidden', !(state === 'finish' && finishT > 1.1));
  $('touch').classList.toggle('hidden', !(isTouch && (state === 'countdown' || state === 'race') && !paused));
  applyViewOffset();
}

function startStage(i) {
  i = ((i | 0) % STAGES.length + STAGES.length) % STAGES.length;
  sound.resume();
  withLoading(i, () => {
    sel = i;
    loadStage(i);
    placeCar(stage.startIdx);
    state = 'countdown'; paused = false;
    cdT = -0.5; cdShown = null; raceTime = 0; finishT = 0;
    splitTimes = []; nextSplit = 0;
    $('hudStage').textContent = stage.def.name;
    $('hudSplit').classList.remove('show');
    hideNotice();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    setScreen();
  });
}

function toMenu() {
  paused = false;
  state = 'menu';
  $('countdown').textContent = '';
  hideNotice();
  if (stageIdx !== sel) loadStage(sel);
  placeCar(stage.startIdx);
  renderMenu();
  setScreen();
}

function setPaused(p) {
  if (!(state === 'countdown' || state === 'race')) p = false;
  paused = p;
  if (p) { $('pauseStage').textContent = stage.def.name; keys.clear(); }
  setScreen();
}

function resetCar(notice) {
  placeCar(clamp(car.idx | 0, 0, stage.n - 1));
  if (notice) showNotice(notice, 1.4);
}

function finishRace() {
  state = 'finish'; finishT = 0;
  const def = stage.def, prev = getBest(def);
  const t = raceTime, s = splitTimes.slice(0, 2);
  const isBest = !prev || t < prev.t;
  if (isBest) store.set(bestKey(def), { t, s });
  lastRun = { t, s, prev, isBest };
  sound.beep(988, 0.25); setTimeout(() => sound.beep(1318, 0.4), 160);
  showNotice('FINISH', 1.2, 'alt');
  renderFinish();
  setScreen();
}

function checkProgress() {
  while (nextSplit < stage.splits.length && car.idx >= stage.splits[nextSplit]) {
    splitTimes[nextSplit] = raceTime;
    const prev = getBest(stage.def), b = prev && prev.s ? prev.s[nextSplit] : null;
    const d = b != null ? raceTime - b : null;
    const el = $('hudSplit');
    el.innerHTML = `<span class="lbl">SPLIT ${nextSplit + 1}</span><span class="${deltaClass(d)}">${d == null ? fmt(raceTime) : fmtDelta(d)}</span>`;
    el.classList.add('show');
    clearTimeout(checkProgress.tm);
    checkProgress.tm = setTimeout(() => el.classList.remove('show'), 3200);
    sound.beep(740, 0.12);
    nextSplit++;
  }
  if (car.idx >= stage.finishIdx) finishRace();
}

// ---------------------------------------------------------------- input
const keys = new Set();
const touchState = { left: false, right: false, gas: false, brake: false, hand: false };
const pad = { steer: 0, throttle: 0, brake: 0, hand: false, btn: [] };
const HOLD = { steer: 0, throttle: 0, brake: 1, hand: false };
const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('touch');

function readInput() {
  const k = (...c) => c.some((x) => keys.has(x));
  let steer = (k('ArrowLeft', 'KeyA') ? 1 : 0) - (k('ArrowRight', 'KeyD') ? 1 : 0);
  steer += (touchState.left ? 1 : 0) - (touchState.right ? 1 : 0) + pad.steer;
  return {
    steer: clamp(steer, -1, 1),
    throttle: Math.max(k('ArrowUp', 'KeyW') ? 1 : 0, touchState.gas ? 1 : 0, pad.throttle),
    brake: Math.max(k('ArrowDown', 'KeyS') ? 1 : 0, touchState.brake ? 1 : 0, pad.brake),
    hand: k('Space') || touchState.hand || pad.hand,
  };
}

function pollPad() {
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const g of gps || []) if (g && g.connected) { gp = g; break; }
  if (!gp) { pad.steer = pad.throttle = pad.brake = 0; pad.hand = false; return; }
  const ax = gp.axes[0] || 0, b = (i) => gp.buttons[i] || { value: 0, pressed: false };
  pad.steer = Math.abs(ax) > 0.15 ? -Math.sign(ax) * (Math.abs(ax) - 0.15) / 0.85 : 0;
  pad.throttle = b(7).value; pad.brake = b(6).value; pad.hand = b(0).pressed;
  const was = pad.btn; pad.btn = gp.buttons.map((x) => x.pressed);
  const edge = (i) => pad.btn[i] && !was[i];
  if (edge(9)) onAction(state === 'menu' || state === 'finish' ? 'confirm' : 'pause');
  if (state === 'menu') { if (edge(0)) onAction('confirm'); if (edge(14)) select(sel - 1); if (edge(15)) select(sel + 1); }
  if (edge(3)) onAction('reset');
  if (edge(1) && state === 'finish') onAction('retry');
}

function onAction(a) {
  sound.resume();
  if (a === 'mute') { sound.setMuted(!sound.muted); store.set('dustline.muted', sound.muted); renderMute(); return; }
  if (a === 'camera') { if (state !== 'menu') { camMode = (camMode + 1) % CAMS.length; showNotice(CAMS[camMode].name + ' CAM', 0.9, 'alt'); } return; }
  if (state === 'menu') {
    if (a === 'left') select(sel - 1);
    else if (a === 'right') select(sel + 1);
    else if (a === 'confirm') startStage(sel);
  } else if (paused) {
    if (a === 'pause') setPaused(false);
  } else if (state === 'countdown' || state === 'race') {
    if (a === 'pause') setPaused(true);
    else if (a === 'reset' && state === 'race') resetCar();
  } else if (state === 'finish') {
    if (a === 'retry' || a === 'reset') startStage(stageIdx);
    else if (a === 'next') startStage(stageIdx + 1);
    else if (a === 'confirm' || a === 'pause') toMenu();
  }
}

const KEYMAP = {
  KeyM: 'mute', KeyC: 'camera', Escape: 'pause', KeyP: 'pause', KeyR: 'reset', KeyN: 'next', Enter: 'confirm',
};
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  const onBtn = e.target && e.target.closest && e.target.closest('button');
  if (onBtn && (e.code === 'Enter' || e.code === 'NumpadEnter')) return; // let the focused button act
  keys.add(e.code);
  if (e.repeat) return;
  let a = KEYMAP[e.code];
  if (e.code === 'NumpadEnter') a = 'confirm';
  if (state === 'menu') {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'ArrowUp') a = 'left';
    if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'ArrowDown') a = 'right';
    if (e.code === 'Space') a = 'confirm';
  }
  if (a) onAction(a);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); for (const k in touchState) touchState[k] = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden && (state === 'race' || state === 'countdown')) setPaused(true); });
window.addEventListener('pointerdown', () => sound.resume(), { passive: true });
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && e.detail > 0) b.blur(); });

// touch: each control tracks its own set of pointers, so multi-touch works
for (const el of document.querySelectorAll('#touch [data-ctl]')) {
  const ctl = el.dataset.ctl, ids = new Set();
  const sync = () => { const on = ids.size > 0; el.classList.toggle('on', on); if (ctl in touchState) touchState[ctl] = on; };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); sound.resume();
    ids.add(e.pointerId); sync();
    if (ctl === 'reset') onAction('reset');
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, (e) => { ids.delete(e.pointerId); sync(); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------------------------------------------------------------- camera
const CAMS = [
  { name: 'CHASE', dist: 13, h: 7.5, look: 6 },
  { name: 'HIGH', dist: 22, h: 15, look: 8 },
  { name: 'TOP', dist: 4.5, h: 27, look: 3 },
];
let camMode = 0, camSnap = true, camYaw = 0, shake = 0, orbitA = 0;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), _v = new THREE.Vector3(), _l = new THREE.Vector3();

function updateCamera(dt) {
  if (state === 'menu') {
    orbitA += dt * 0.12;
    const a = car.yaw + Math.PI * 0.75 + Math.sin(orbitA) * 1.3;
    _v.set(car.x + Math.sin(a) * 15, car.y + 5.5, car.z + Math.cos(a) * 15);
    _l.set(car.x, car.y + 1.0, car.z);
    camYaw = car.yaw;
  } else {
    const p = CAMS[camMode], sp = car.speed;
    let fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    if (sp > 3) {
      const w = 0.6 * smoothstep(3, 10, sp);
      fx = fx * (1 - w) + (car.vx / sp) * w; fz = fz * (1 - w) + (car.vz / sp) * w;
    }
    const target = Math.atan2(fx, fz);
    camYaw = camSnap ? target : camYaw + angDiff(target, camYaw) * damp(3.2, dt);
    const sk = clamp(sp / 40, 0, 1), dist = p.dist * (1 + sk * 0.2), h = p.h * (1 + sk * 0.06);
    const sx = Math.sin(camYaw), sz = Math.cos(camYaw);
    _v.set(car.x - sx * dist, car.y + h, car.z - sz * dist);
    _l.set(car.x + sx * p.look, car.y + 0.8, car.z + sz * p.look);
  }
  if (camSnap) { camPos.copy(_v); camLook.copy(_l); camSnap = false; }
  else { camPos.lerp(_v, damp(state === 'menu' ? 2.5 : 6, dt)); camLook.lerp(_l, damp(10, dt)); }
  const gy = stage.height(camPos.x, camPos.z) + 1.6;
  if (camPos.y < gy) camPos.y = gy;
  camera.position.copy(camPos);
  if (shake > 0.001) {
    const s = shake * 0.45;
    camera.position.x += (Math.random() - 0.5) * s; camera.position.y += (Math.random() - 0.5) * s; camera.position.z += (Math.random() - 0.5) * s;
    shake *= Math.exp(-6 * dt);
  }
  camera.lookAt(camLook);

  // shadow frustum follows the car, centred a little ahead in view direction
  const cx = car.x + Math.sin(camYaw) * 14, cz = car.z + Math.cos(camYaw) * 14;
  sun.target.position.set(cx, car.y, cz);
  sun.position.set(cx + sunDir.x * 150, car.y + sunDir.y * 150, cz + sunDir.z * 150);
}

// ---------------------------------------------------------------- HUD
const hud = {
  time: $('hudTime'), speed: $('hudSpeed'), gear: $('hudGear'), rpm: $('hudRpm'),
  fill: $('progFill'), car: $('progCar'), cd: $('countdown'), notice: $('notice'), hints: $('hints'),
};
let noticeTm = 0, hintsT = 0;
function showNotice(text, dur = 1.4, cls = '') {
  hud.notice.textContent = text;
  hud.notice.className = 'notice show ' + cls;
  clearTimeout(noticeTm);
  noticeTm = setTimeout(hideNotice, dur * 1000);
}
function hideNotice() { hud.notice.classList.remove('show'); }
function buildProgressTicks() {
  const span = stage.finishIdx - stage.startIdx;
  $('progTicks').innerHTML = stage.splits.map((i) => `<i style="left:${((i - stage.startIdx) / span) * 100}%"></i>`).join('') + '<i class="end" style="left:100%"></i>';
}
let lastHud = '';
function updateHUD(dt) {
  if (state === 'menu' || state === 'boot') return;
  const t = state === 'countdown' ? 0 : raceTime;
  const txt = fmt(t);
  if (txt !== lastHud) { hud.time.textContent = txt; lastHud = txt; }
  hud.speed.textContent = Math.round(Math.abs(car.vf != null ? car.vf : car.speed) * 3.6);
  hud.gear.textContent = car.gear === 0 ? 'R' : String(car.gear | 0 || 1);
  hud.rpm.style.width = (clamp(car.rpm, 0, 1) * 100).toFixed(1) + '%';
  const f = clamp((car.idx - stage.startIdx) / (stage.finishIdx - stage.startIdx), 0, 1);
  hud.fill.style.width = hud.car.style.left = (f * 100).toFixed(2) + '%';
  if (state === 'race' && !paused) { hintsT += dt; hud.hints.classList.toggle('show', hintsT < 6); }
}

function updateCountdown(dt) {
  cdT += dt;
  const n = cdT < 0 ? null : cdT < 3 ? 3 - Math.floor(cdT) : 'GO';
  if (n !== cdShown) {
    cdShown = n;
    hud.cd.textContent = n == null ? '' : n;
    hud.cd.className = 'countdown' + (n === 'GO' ? ' go' : '');
    void hud.cd.offsetWidth; // restart animation
    if (n != null) hud.cd.classList.add('pop');
    if (n === 'GO') {
      sound.beep(880, 0.35);
      state = 'race'; raceTime = 0; hintsT = 0;
      setTimeout(() => { if (cdShown === 'GO') hud.cd.textContent = ''; }, 700);
      setScreen();
    } else if (n != null) sound.beep(440, 0.12);
  }
}

// ---------------------------------------------------------------- menu & panels
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
  $('paints').innerHTML = PAINTS.map((p, i) => `<button class="swatch${i === paintIdx ? ' sel' : ''}" data-i="${i}" style="background:${p.hex}" aria-label="${p.name}" title="${p.name}"></button>`).join('');
  for (const el of $('paints').children) el.addEventListener('click', () => {
    paintIdx = +el.dataset.i; car.setPaint(PAINTS[paintIdx].hex); store.set('dustline.paint', paintIdx); renderMenu();
  });
  $('paintName').textContent = PAINTS[paintIdx].name;
  renderMute();
}
function renderMute() {
  const b = $('muteBtn');
  b.textContent = sound.muted ? 'Sound off' : 'Sound on';
  b.setAttribute('aria-pressed', String(sound.muted));
}
function select(i) {
  i = (i + STAGES.length) % STAGES.length;
  if (i === sel && stageIdx === i) return;
  sel = i; store.set('dustline.stage', sel);
  renderMenu();
  withLoading(i, () => { if (state === 'menu' && sel === i) { loadStage(i); placeCar(stage.startIdx); } });
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

$('startBtn').addEventListener('click', () => onAction('confirm'));
$('muteBtn').addEventListener('click', () => onAction('mute'));
$('pauseBtn').addEventListener('click', () => onAction('pause'));
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('restartBtn').addEventListener('click', () => startStage(stageIdx));
$('pMenuBtn').addEventListener('click', toMenu);
$('retryBtn').addEventListener('click', () => startStage(stageIdx));
$('nextBtn').addEventListener('click', () => startStage(stageIdx + 1));
$('fMenuBtn').addEventListener('click', toMenu);

// ---------------------------------------------------------------- simulation
function stepPhysics(dt) {
  let input;
  if (state === 'menu') input = autopilot(car, stage);
  else if (state === 'countdown') input = HOLD;
  else if (state === 'race') input = auto ? autopilot(car, stage) : readInput();
  else input = { ...autopilot(car, stage), throttle: 0, brake: 0.55, hand: false }; // finish: roll to a stop
  car.step(dt, input, stage);
  if (state === 'race') { raceTime += dt; checkProgress(); }
}

function watchdog(dt) {
  if (state === 'countdown') return;
  if (car.roadDist > 60 || !Number.isFinite(car.x) || car.y < -200) {
    if (state === 'menu') placeCar(stage.startIdx);
    else resetCar('OFF COURSE');
    return;
  }
  if (state === 'menu') {
    if (car.idx >= stage.finishIdx) placeCar(stage.startIdx); // attract mode loops the stage
    stuckT = car.speed < 1 ? stuckT + dt : 0;
    if (stuckT > 4) placeCar(Math.min(car.idx + 6, stage.finishIdx - 1));
  }
}

let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
  if (!stage) return;
  pollPad();
  const running = !paused && state !== 'boot';
  if (running) {
    if (state === 'countdown') updateCountdown(dt);
    acc += dt;
    while (acc >= FIXED) { stepPhysics(FIXED); acc -= FIXED; }
    if (state === 'finish') { const was = finishT; finishT += dt; if (was <= 1.1 && finishT > 1.1) setScreen(); }
    watchdog(dt);
    car.updateVisual(dt);
    emitDust(dt);
  } else acc = 0;
  if (car.impact > 0) {
    if (state !== 'menu') { sound.impact(car.impact); shake = Math.min(1.2, shake + car.impact / 10); }
    car.impact = 0;
  }
  dust.update(running ? dt : 0);
  updateCamera(dt);
  updateHUD(dt);
  sound.update(dt, {
    rpm: car.rpm, throttle: car.throttle, speed: car.speed, slip: car.slip, offroad: car.offroad, grounded: car.grounded,
    active: state !== 'menu' && state !== 'boot' && !paused,
  });
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- boot
window.__game = {
  get state() { return paused ? 'paused' : state; },
  car,
  get stage() { return stage; },
  startStage,
  get time() { return raceTime; },
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
  loadStage(sel);
  placeCar(stage.startIdx);
  onResize();
  if (params.get('start') === '1') startStage(sel);
  else toMenu();
  $('loading').classList.add('fade');
  requestAnimationFrame(frame);
}
requestAnimationFrame(() => setTimeout(boot, 30));
