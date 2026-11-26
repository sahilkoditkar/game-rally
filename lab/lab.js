// lab.js — drive the handling model on a small test course.
import * as THREE from '../vendor/three.module.js';
import { PARAMS, PRESETS, PRESET_INFO, createCar, resetCar, stepCar } from './handling.js';
import { buildTrack, locate, HALF, ROAD_WIDTH } from './track.js';

const DT = 1 / 120;
const SURFACES = {
  hardpack: { grip: 1.08, road: 0x9a7b5a, ground: 0x6f8f4e, skid: 0x4a3a2a, dust: 0xc9b08a },
  gravel:   { grip: 1.0,  road: 0xb8a07c, ground: 0x7a9a55, skid: 0x6b5a45, dust: 0xd9c4a0 },
  wet:      { grip: 0.85, road: 0x6e6152, ground: 0x587a43, skid: 0x2e2820, dust: 0x8f8a80 },
  snow:     { grip: 0.72, road: 0xe9eef2, ground: 0xf4f7fa, skid: 0x9aa6b0, dust: 0xffffff },
};
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('handlingLab.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('handlingLab.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ------------------------------------------------------------------ state
const track = buildTrack(1);
const state = {
  preset: store.get('preset', 'flow'),
  surface: store.get('surface', 'gravel'),
  autoAccel: store.get('autoAccel', false),
  cam: store.get('cam', 'chase'),
  overrides: store.get('overrides', {}),       // { presetName: { key: value } }
  lapStart: null, lastLap: null, best: store.get('best', {}),
  progress: -15, hint: 0, lat: 0, offroad: 0, frames: 0, laps: 0,
};
if (!PRESETS[state.preset]) state.preset = 'flow';
if (!SURFACES[state.surface]) state.surface = 'gravel';
const paramsFor = (name) => ({ ...PRESETS[name], ...(state.overrides[name] || {}) });
const car = createCar(paramsFor(state.preset));

function placeAtS(s) {
  const n = track.pts.length; let i = Math.round(((s % track.length) + track.length) % track.length) % n;
  const p = track.pts[i];
  resetCar(car, p.x, p.z, p.h);
  state.hint = i;
}
placeAtS(track.length - 15);

// ------------------------------------------------------------------ scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
$('view').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc3dc);
scene.fog = new THREE.Fog(0x9cc3dc, 180, 520);
const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1200);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a4a35, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-60, 120, -40); scene.add(sun);

const groundMat = new THREE.MeshLambertMaterial({ color: SURFACES.gravel.ground, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), groundMat);
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.06; scene.add(ground);

// road ribbon (+ edge lines) from the centreline
function ribbon(offA, offB, y, step = 2) {
  const P = track.pts, pos = [], idx = [];
  const n = Math.floor(P.length / step);
  for (let j = 0; j <= n; j++) {
    const p = P[(j * step) % P.length], lx = Math.cos(p.h), lz = -Math.sin(p.h);
    pos.push(p.x + lx * offA, y, p.z + lz * offA, p.x + lx * offB, y, p.z + lz * offB);
    if (j < n) { const a = j * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const roadMat = new THREE.MeshLambertMaterial({ color: SURFACES.gravel.road, side: THREE.DoubleSide });
scene.add(new THREE.Mesh(ribbon(HALF, -HALF, 0.0), roadMat));
const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
scene.add(new THREE.Mesh(ribbon(HALF - 0.05, HALF - 0.3, 0.04), lineMat));
scene.add(new THREE.Mesh(ribbon(-HALF + 0.3, -HALF + 0.05, 0.04), lineMat));

// edge posts every 20 m, both sides (red on the left, white on the right)
{
  const geo = new THREE.BoxGeometry(0.18, 1.0, 0.18);
  const posts = [];
  for (let s = 0; s < track.length; s += 20) { const p = track.pts[Math.floor(s) % track.pts.length]; posts.push([p, 1], [p, -1]); }
  for (const [side, color] of [[1, 0xe03a2f], [-1, 0xffffff]]) {
    const list = posts.filter((q) => q[1] === side);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), list.length);
    const m = new THREE.Matrix4();
    list.forEach(([p], i) => { const o = side * (HALF + 0.8); m.makeTranslation(p.x + Math.cos(p.h) * o, 0.5, p.z - Math.sin(p.h) * o); im.setMatrixAt(i, m); });
    scene.add(im);
  }
}
// apex cones on the inside of each bend, plus a pole with the corner name position
{
  const cone = new THREE.ConeGeometry(0.3, 0.75, 8); cone.translate(0, 0.375, 0);
  const im = new THREE.InstancedMesh(cone, new THREE.MeshLambertMaterial({ color: 0xff7a1a }), track.apexes.length * 3);
  const m = new THREE.Matrix4(); let k = 0;
  for (const a of track.apexes) for (const d of [-4, 0, 4]) {
    const o = a.side * (HALF + 0.5), hx = Math.sin(a.h), hz = Math.cos(a.h);
    m.makeTranslation(a.x + Math.cos(a.h) * o + hx * d, 0, a.z - Math.sin(a.h) * o + hz * d); im.setMatrixAt(k++, m);
  }
  scene.add(im);
  const pole = new THREE.CylinderGeometry(0.08, 0.08, 3, 6); pole.translate(0, 1.5, 0);
  const pm = new THREE.InstancedMesh(pole, new THREE.MeshLambertMaterial({ color: 0x2255ff }), track.apexes.length);
  track.apexes.forEach((a, i) => { const o = a.side * (HALF + 1.6); m.makeTranslation(a.x + Math.cos(a.h) * o, 0, a.z - Math.sin(a.h) * o); pm.setMatrixAt(i, m); });
  scene.add(pm);
}
// start/finish: chequered strip + gantry
{
  const p = track.pts[0];
  const c = document.createElement('canvas'); c.width = 64; c.height = 8; const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * 4, j * 4, 4, 4); }
  const tex = new THREE.CanvasTexture(c); tex.magFilter = THREE.NearestFilter;
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, 1.2), new THREE.MeshBasicMaterial({ map: tex }));
  strip.rotation.x = -Math.PI / 2; strip.rotation.z = p.h; strip.position.set(p.x, 0.06, p.z); scene.add(strip);
  const mat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  for (const s of [1, -1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 0.3), mat); post.position.set(p.x + Math.cos(p.h) * s * (HALF + 1), 2.5, p.z - Math.sin(p.h) * s * (HALF + 1)); scene.add(post); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH + 2.3, 0.6, 0.3), new THREE.MeshLambertMaterial({ color: 0xffb020 }));
  beam.position.set(p.x, 5, p.z); beam.rotation.y = p.h; scene.add(beam);
}
// low-poly trees for depth cues, kept away from the road
{
  const R = (() => { let s = 99; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const spots = [];
  for (let i = 0; i < 400 && spots.length < 220; i++) {
    const x = -250 + R() * 750, z = -250 + R() * 850;
    const l = locate(track, x, z, -1); if (Math.abs(l.lat) > 14) spots.push([x, z, 0.7 + R() * 0.8]);
  }
  const cone = new THREE.ConeGeometry(2.2, 6, 6); cone.translate(0, 4.5, 0);
  const trunk = new THREE.CylinderGeometry(0.3, 0.35, 1.6, 5); trunk.translate(0, 0.8, 0);
  const t1 = new THREE.InstancedMesh(cone, new THREE.MeshLambertMaterial({ color: 0x2f5d34 }), spots.length);
  const t2 = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x5b4030 }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z, s], i) => { m.makeScale(s, s, s).setPosition(x, 0, z); t1.setMatrixAt(i, m); t2.setMatrixAt(i, m); });
  scene.add(t1, t2);
}

// ------------------------------------------------------------------ car (boxes)
const carG = new THREE.Group(); scene.add(carG);
const body = new THREE.Group(); carG.add(body);
const paint = new THREE.MeshLambertMaterial({ color: 0x1e6fd9 });
const dark = new THREE.MeshLambertMaterial({ color: 0x1a1d22 });
const glass = new THREE.MeshLambertMaterial({ color: 0x9fd0ef });
const add = (geo, mat, x, y, z, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
add(new THREE.BoxGeometry(1.8, 0.62, 4.0), paint, 0, 0.62, 0);
add(new THREE.BoxGeometry(1.6, 0.6, 2.1), paint, 0, 1.2, -0.35);
add(new THREE.BoxGeometry(1.62, 0.42, 1.4), glass, 0, 1.2, 0.05);
add(new THREE.BoxGeometry(1.75, 0.08, 0.35), dark, 0, 1.55, -1.45);           // roof spoiler
add(new THREE.BoxGeometry(1.84, 0.22, 0.2), dark, 0, 0.45, 2.02);             // front bumper
add(new THREE.BoxGeometry(0.4, 0.16, 0.06), new THREE.MeshBasicMaterial({ color: 0xfff6c0 }), 0.58, 0.72, 2.02);
add(new THREE.BoxGeometry(0.4, 0.16, 0.06), new THREE.MeshBasicMaterial({ color: 0xfff6c0 }), -0.58, 0.72, 2.02);
add(new THREE.BoxGeometry(0.4, 0.14, 0.06), new THREE.MeshBasicMaterial({ color: 0xff3020 }), 0.6, 0.75, -2.02);
add(new THREE.BoxGeometry(0.4, 0.14, 0.06), new THREE.MeshBasicMaterial({ color: 0xff3020 }), -0.6, 0.75, -2.02);
add(new THREE.BoxGeometry(0.3, 0.03, 4.02), new THREE.MeshLambertMaterial({ color: 0xffffff }), 0.35, 0.94, 0);  // stripes
add(new THREE.BoxGeometry(0.3, 0.03, 4.02), new THREE.MeshLambertMaterial({ color: 0xffffff }), -0.35, 0.94, 0);
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.4), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.09; carG.add(shadow);
const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12); wheelGeo.rotateZ(Math.PI / 2);
const hubGeo = new THREE.BoxGeometry(0.27, 0.12, 0.4);
const wheels = [];
for (const [x, z, front] of [[0.86, 1.25, true], [-0.86, 1.25, true], [0.86, -1.25, false], [-0.86, -1.25, false]]) {
  const pivot = new THREE.Group(); pivot.position.set(x, 0.34, z); carG.add(pivot);
  const w = new THREE.Mesh(wheelGeo, dark); pivot.add(w);
  const hub = new THREE.Mesh(hubGeo, new THREE.MeshLambertMaterial({ color: 0xbfc5cc })); w.add(hub);
  wheels.push({ pivot, w, front, x, z });
}

// ------------------------------------------------------------------ skid marks + dust
const SKID_N = 3000;
const skidPos = new Float32Array(SKID_N * 4 * 3), skidAlpha = new Float32Array(SKID_N * 4);
const skidGeo = new THREE.BufferGeometry();
skidGeo.setAttribute('position', new THREE.BufferAttribute(skidPos, 3));
skidGeo.setAttribute('alpha', new THREE.BufferAttribute(skidAlpha, 1));
{ const idx = new Uint32Array(SKID_N * 6); for (let i = 0; i < SKID_N; i++) { const a = i * 4; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6); } skidGeo.setIndex(new THREE.BufferAttribute(idx, 1)); }
const skidMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, uniforms: { color: { value: new THREE.Color(SURFACES.gravel.skid) } },
  vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color, vA); }',
});
const skidMesh = new THREE.Mesh(skidGeo, skidMat); skidMesh.frustumCulled = false; scene.add(skidMesh);
let skidHead = 0; const lastMark = [null, null];
function addSkid(i, x, z, a, hx, hz) {
  const prev = lastMark[i]; lastMark[i] = { x, z };
  if (!prev || Math.hypot(x - prev.x, z - prev.z) > 3) return;
  const k = skidHead++ % SKID_N; const w = 0.14;
  const px = -hz * w, pz = hx * w;  // perpendicular to heading
  skidPos.set([prev.x + px, 0.07, prev.z + pz, prev.x - px, 0.07, prev.z - pz, x + px, 0.07, z + pz, x - px, 0.07, z - pz], k * 12);
  skidAlpha.set([a, a, a, a], k * 4);
  skidGeo.attributes.position.needsUpdate = true; skidGeo.attributes.alpha.needsUpdate = true;
}
const DUST_N = 90;
const dustTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.5, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const dustMat = new THREE.SpriteMaterial({ map: dustTex, color: SURFACES.gravel.dust, transparent: true, opacity: 0.5, depthWrite: false });
const dust = [];
for (let i = 0; i < DUST_N; i++) { const s = new THREE.Sprite(dustMat.clone()); s.visible = false; scene.add(s); dust.push({ s, life: 0, vx: 0, vz: 0 }); }
let dustHead = 0;
function puff(x, z, vx, vz, strength) {
  const d = dust[dustHead++ % DUST_N]; d.life = 1; d.vx = vx; d.vz = vz;
  d.s.position.set(x, 0.5, z); d.s.scale.setScalar(1 + 1.2 * strength); d.s.visible = true; d.s.material.opacity = 0.3 * strength + 0.08;
}
function updateDust(dt) {
  for (const d of dust) {
    if (!d.s.visible) continue;
    d.life -= dt * 0.9; if (d.life <= 0) { d.s.visible = false; continue; }
    d.s.position.x += d.vx * dt; d.s.position.z += d.vz * dt; d.s.position.y += dt * 0.8;
    d.vx *= 1 - dt * 2; d.vz *= 1 - dt * 2;
    d.s.scale.multiplyScalar(1 + dt * 1.6); d.s.material.opacity = Math.max(0, d.s.material.opacity - dt * 0.35);
  }
}

// ------------------------------------------------------------------ input
const keys = new Set();
const touch = { left: false, right: false, brake: false, hand: false, gas: false };
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'brake', KeyS: 'brake', Space: 'hand' };
addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') && !KEYMAP[e.code]) return;
  if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); }
  if (e.repeat) return;
  if (e.code === 'KeyR') resetToRoad();
  if (e.code === 'KeyC') toggleCam();
  if (e.code === 'KeyT') toggleTune();
});
addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); });
addEventListener('blur', () => { keys.clear(); for (const k in touch) touch[k] = false; document.querySelectorAll('.tb.down').forEach((b) => b.classList.remove('down')); });

function bindButton(id, name) {
  const el = $(id); const ids = new Set();
  const set = () => { touch[name] = ids.size > 0; el.classList.toggle('down', touch[name]); };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); ids.add(e.pointerId); try { el.setPointerCapture(e.pointerId); } catch { /* ok */ } set(); });
  const up = (e) => { ids.delete(e.pointerId); set(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
bindButton('bLeft', 'left'); bindButton('bRight', 'right'); bindButton('bBrake', 'brake'); bindButton('bHand', 'hand'); bindButton('bGas', 'gas');
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || new URLSearchParams(location.search).has('touch');
if (isTouch) document.body.classList.add('touch');
addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });
document.addEventListener('touchmove', (e) => { if (!e.target.closest || !e.target.closest('#sliders, #copyOut')) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

function readInput() {
  const L = keys.has('left') || touch.left, R = keys.has('right') || touch.right;
  let steer = (L ? 1 : 0) - (R ? 1 : 0);
  let throttle = keys.has('gas') || touch.gas ? 1 : 0;
  let brake = keys.has('brake') || touch.brake ? 1 : 0;
  let hand = keys.has('hand') || touch.hand;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.12) steer = -Math.sign(ax) * (Math.abs(ax) - 0.12) / 0.88;
    if (gp.buttons[7]) throttle = Math.max(throttle, gp.buttons[7].value);
    if (gp.buttons[6]) brake = Math.max(brake, gp.buttons[6].value);
    if (gp.buttons[0] && gp.buttons[0].pressed) hand = true;
  }
  if (state.autoAccel && brake < 0.1) throttle = 1;
  if (state.autoAccel && brake >= 0.1) throttle = 0;
  return { steer, throttle, brake, hand };
}

// ------------------------------------------------------------------ UI
const presetSel = $('preset');
for (const name of Object.keys(PRESETS)) { const o = document.createElement('option'); o.value = name; o.textContent = name[0].toUpperCase() + name.slice(1); presetSel.appendChild(o); }
presetSel.value = state.preset; $('surface').value = state.surface;
presetSel.addEventListener('change', () => { state.preset = presetSel.value; store.set('preset', state.preset); car.p = paramsFor(state.preset); buildSliders(); presetSel.blur(); });
$('surface').addEventListener('change', () => { state.surface = $('surface').value; store.set('surface', state.surface); applySurface(); $('surface').blur(); });
function setAuto(v) { state.autoAccel = v; store.set('autoAccel', v); $('auto').classList.toggle('on', v); $('auto').setAttribute('aria-pressed', String(v)); $('bGas').classList.toggle('hidden', v); }
$('auto').addEventListener('click', () => { setAuto(!state.autoAccel); $('auto').blur(); });
setAuto(state.autoAccel);
function toggleCam() { state.cam = state.cam === 'chase' ? 'low' : 'chase'; store.set('cam', state.cam); $('cam').textContent = state.cam === 'chase' ? 'Cam: chase' : 'Cam: low'; }
$('cam').textContent = state.cam === 'chase' ? 'Cam: chase' : 'Cam: low';
$('cam').addEventListener('click', () => { toggleCam(); $('cam').blur(); });
$('reset').addEventListener('click', () => { resetToRoad(); $('reset').blur(); });
function toggleTune(force) { const open = force ?? !$('tune').classList.contains('open'); $('tune').classList.toggle('open', open); }
$('tuneBtn').addEventListener('click', () => { toggleTune(); $('tuneBtn').blur(); });
$('closeT').addEventListener('click', () => toggleTune(false));
function applySurface() {
  const s = SURFACES[state.surface];
  roadMat.color.setHex(s.road); groundMat.color.setHex(s.ground); skidMat.uniforms.color.value.setHex(s.dust === 0xffffff ? 0x8796a3 : s.skid);
  for (const d of dust) d.s.material.color.setHex(s.dust);
}
applySurface();

const fmtVal = (meta, v) => (meta.step >= 1 ? v.toFixed(0) : meta.step >= 0.1 ? v.toFixed(1) : v.toFixed(meta.step >= 0.01 ? 2 : 3)) + (meta.unit ? ' ' + meta.unit : '');
function settingsJSON() {
  const o = { preset: state.preset };
  for (const m of PARAMS) o[m.key] = +car.p[m.key].toFixed(4);
  return JSON.stringify(o);
}
function buildSliders() {
  const box = $('sliders'); box.innerHTML = '';
  $('desc').textContent = PRESET_INFO[state.preset];
  let group = '';
  for (const meta of PARAMS) {
    if (meta.group !== group) { group = meta.group; const h = document.createElement('h4'); h.textContent = group; box.appendChild(h); }
    const wrap = document.createElement('div'); wrap.className = 'sl';
    const lab = document.createElement('div'); lab.className = 'lab';
    const name = document.createElement('span'); name.textContent = meta.label;
    const val = document.createElement('span');
    lab.append(name, val);
    const inp = document.createElement('input'); inp.type = 'range'; inp.min = meta.min; inp.max = meta.max; inp.step = meta.step; inp.value = car.p[meta.key];
    inp.dataset.key = meta.key; inp.setAttribute('aria-label', meta.label);
    const show = () => { val.textContent = fmtVal(meta, car.p[meta.key]); lab.classList.toggle('changed', Math.abs(car.p[meta.key] - PRESETS[state.preset][meta.key]) > 1e-9); };
    inp.addEventListener('input', () => {
      car.p[meta.key] = +inp.value;
      const ov = state.overrides[state.preset] || (state.overrides[state.preset] = {});
      ov[meta.key] = +inp.value; store.set('overrides', state.overrides);
      show(); $('copyOut').value = settingsJSON();
    });
    show(); wrap.append(lab, inp); box.appendChild(wrap);
  }
  $('copyOut').value = settingsJSON();
}
buildSliders();
$('resetP').addEventListener('click', () => { delete state.overrides[state.preset]; store.set('overrides', state.overrides); car.p = paramsFor(state.preset); buildSliders(); toast('Reset to ' + state.preset); });
$('copyP').addEventListener('click', async () => {
  const txt = settingsJSON(); $('copyOut').value = txt;
  try { await navigator.clipboard.writeText(txt); toast('Settings copied'); }
  catch { $('copyOut').focus(); $('copyOut').select(); try { document.execCommand('copy'); toast('Settings copied'); } catch { toast('Select the text below and copy it'); } }
});
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, 1400); }

function resetToRoad() {
  const l = locate(track, car.x, car.z, -1);
  const p = l.p; resetCar(car, p.x, p.z, p.h); state.hint = l.i;
}

// ------------------------------------------------------------------ simulation + render loop
const camState = { x: 0, y: 8, z: -13, dir: car.yaw, init: false };
let acc = 0, last = performance.now(), simTime = 0;
const fpsHist = [];
function frame(now) {
  const frameDt = Math.min(0.25, Math.max(0, (now - last) / 1000)); last = now;
  fpsHist.push(frameDt); if (fpsHist.length > 30) fpsHist.shift();
  const input = readInput();                     // one input per rendered frame, used for every sub-step
  state.lastInput = input;
  acc += frameDt;
  const surf = SURFACES[state.surface].grip;
  let skidAmt = 0;
  while (acc >= DT) {
    acc -= DT;
    const l = locate(track, car.x, car.z, state.hint); state.hint = l.i; state.lat = l.lat;
    state.offroad = Math.max(0, Math.min(1, (Math.abs(l.lat) - HALF) / 4));
    stepCar(car, input, { grip: surf, offroad: state.offroad }, DT);
    simTime += DT;
    skidAmt = Math.max(skidAmt, car.skid);
    // lap progress (signed, so driving backwards does not count)
    let ds = l.s - (state.lastS ?? l.s); if (ds < -track.length / 2) ds += track.length; if (ds > track.length / 2) ds -= track.length;
    state.lastS = l.s; const before = Math.floor(state.progress / track.length); state.progress += ds;
    const after = Math.floor(state.progress / track.length);
    if (after > before && after >= 0) {
      if (state.lapStart !== null && after > state.laps) {
        state.lastLap = simTime - state.lapStart;
        const key = state.preset + '/' + state.surface;
        if (!state.best[key] || state.lastLap < state.best[key]) { state.best[key] = state.lastLap; store.set('best', state.best); }
      }
      if (after > state.laps) { state.laps = after; state.lapStart = simTime; }
      if (state.lapStart === null) state.lapStart = simTime;
    }
  }
  render(frameDt, skidAmt);
  state.frames++;
  requestAnimationFrame(frame);
}

function render(dt, skidAmt) {
  // car pose
  carG.position.set(car.x, 0, car.z);
  carG.rotation.y = car.yaw;
  const latA = car.yawRate * car.speed;          // cosmetic body roll and pitch
  body.rotation.z = THREE.MathUtils.clamp(-latA * 0.006, -0.07, 0.07);
  body.rotation.x = THREE.MathUtils.clamp((car.brakeOut - car.throttleOut * 0.4) * 0.03, -0.03, 0.04);
  for (const w of wheels) {
    if (w.front) w.pivot.rotation.y = car.steerVis;
    w.w.rotation.x += car.vf * dt / 0.34;
  }
  // skid marks and dust from the rear wheels
  const hx = Math.sin(car.yaw), hz = Math.cos(car.yaw), lx = hz, lz = -hx;
  const skid = Math.max(skidAmt, car.skid);
  for (let i = 0; i < 2; i++) {
    const s = i ? -1 : 1, wx = car.x + lx * s * 0.86 - hx * 1.25, wz = car.z + lz * s * 0.86 - hz * 1.25;
    if (skid > 0.15 && car.speed > 3) {
      addSkid(i, wx, wz, Math.min(0.55, skid * 0.6), hx, hz);
      if (Math.random() < Math.min(1, 14 * skid * dt)) puff(wx, wz, car.vx * 0.3 + (Math.random() - 0.5) * 2, car.vz * 0.3 + (Math.random() - 0.5) * 2, skid);
    } else lastMark[i] = null;
    if (car.speed > 12 && Math.random() < 2.5 * dt * Math.min(1, car.speed / 30)) puff(wx, wz, car.vx * 0.2, car.vz * 0.2, 0.25); // light gravel dust
  }
  updateDust(dt);

  // camera: follows a smoothed blend of travel direction and heading, so drifts show the car sideways
  const travel = car.speed > 4 && car.vf > 0 ? Math.atan2(car.vx, car.vz) : car.yaw;
  let target = travel;
  const low = state.cam === 'low';
  if (!camState.init) { camState.dir = car.yaw; camState.init = true; }
  let dd = target - camState.dir; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI;
  camState.dir += dd * (1 - Math.exp(-dt * (low ? 5 : 3.2)));
  const back = low ? 6 : 13, up = low ? 1.7 : 7.5, ahead = low ? 12 : 10;
  const cx = car.x - Math.sin(camState.dir) * back, cz = car.z - Math.cos(camState.dir) * back;
  const k = 1 - Math.exp(-dt * 12);
  camState.x += (cx - camState.x) * k; camState.z += (cz - camState.z) * k; camState.y += (up - camState.y) * k;
  if (Math.hypot(camState.x - cx, camState.z - cz) > 30) { camState.x = cx; camState.z = cz; }
  camera.position.set(camState.x, camState.y, camState.z);
  camera.lookAt(car.x + Math.sin(camState.dir) * ahead, low ? 1.0 : 0.5, car.z + Math.cos(camState.dir) * ahead);
  renderer.render(scene, camera);

  // HUD
  $('speed').firstChild.nodeValue = Math.round(car.speed * 3.6) + ' ';
  $('lapT').textContent = state.lapStart !== null ? (simTime - state.lapStart).toFixed(1) + ' s' : '–';
  $('lastT').textContent = state.lastLap ? state.lastLap.toFixed(2) + ' s' : '–';
  const best = state.best[state.preset + '/' + state.surface];
  $('bestT').textContent = best ? best.toFixed(2) + ' s' : '–';
  const slipDeg = car.slipAngle * 180 / Math.PI;
  $('slip').textContent = (car.speed > 2 ? slipDeg.toFixed(0) : '0') + '°' + (car.reverse ? ' R' : '');
  const fill = $('slipfill'), frac = Math.min(1, Math.abs(slipDeg) / 45) * 50;
  fill.style.width = frac + '%'; fill.style.left = slipDeg >= 0 ? (50 - frac) + '%' : '50%';
  $('driftTag').style.visibility = car.drifting ? 'visible' : 'hidden';
  $('offTag').style.visibility = state.offroad > 0 ? 'visible' : 'hidden';
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  camera.fov = w < h ? 75 : 60; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });

// for automated tests
window.__lab = { car, track, state, touch, keys, PRESETS, fps: () => 1 / (fpsHist.reduce((a, b) => a + b, 0) / Math.max(1, fpsHist.length)) };
