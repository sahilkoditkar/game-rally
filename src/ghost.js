// Ghost car: record the player's rendered pose during a solo run, store the best run per stage compactly,
// and replay it as a translucent car with a live time delta.
import { makeCar, DEFAULT_BUILD } from './carapi.js';
import { smoothstep } from './track.js';
import { localDateStr } from './catalog.js';

export const GHOST_HZ = 10;
const KEY = (id) => `dustline.ghost.${id}`;
const PREFIX = 'dustline.ghost.';
export const GHOST_ON_KEY = 'dustline.ghost.on';

// ---------------------------------------------------------------- codec
// Per sample (11 bytes): dt ms (u8), dx dz (i8, 5 cm), dy (i8, 2 cm), yaw (i16), pitch roll steer (i8), idx (u16).
// Positions are delta-coded against the *reconstructed* previous sample (error feedback), so rounding never
// accumulates; a jump larger than one step (a reset) is caught up over the next few samples.
const STRIDE = 11, QXZ = 0.05, QY = 0.02, QA = 0.004;
const i8 = (v) => Math.max(-127, Math.min(127, Math.round(v)));

export function encodeSamples(s) {
  const n = s.length, buf = new ArrayBuffer(n * STRIDE), dv = new DataView(buf);
  let px = s[0].x, py = s[0].y, pz = s[0].z, pt = 0;
  for (let k = 0; k < n; k++) {
    const a = s[k], o = k * STRIDE;
    const dt = Math.max(0, Math.min(255, Math.round((a.t - pt) * 1000)));
    pt += dt / 1000;
    const dx = i8((a.x - px) / QXZ), dy = i8((a.y - py) / QY), dz = i8((a.z - pz) / QXZ);
    px += dx * QXZ; py += dy * QY; pz += dz * QXZ;
    dv.setUint8(o, dt); dv.setInt8(o + 1, dx); dv.setInt8(o + 2, dz); dv.setInt8(o + 3, dy);
    dv.setInt16(o + 4, Math.round((Math.atan2(Math.sin(a.yaw), Math.cos(a.yaw)) / Math.PI) * 32767), true);
    dv.setInt8(o + 6, i8(a.pitch / QA)); dv.setInt8(o + 7, i8(a.roll / QA)); dv.setInt8(o + 8, i8(a.steer * 200));
    dv.setUint16(o + 9, Math.max(0, Math.min(65535, a.idx | 0)), true);
  }
  let bin = '';
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return { x0: s[0].x, y0: s[0].y, z0: s[0].z, n, data: btoa(bin) };
}

export function decodeSamples(rec) {
  const bin = atob(rec.data), n = rec.n, dv = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) dv.setUint8(i, bin.charCodeAt(i));
  const S = { n, t: new Float32Array(n), x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    yaw: new Float32Array(n), pitch: new Float32Array(n), roll: new Float32Array(n), steer: new Float32Array(n), idx: new Float32Array(n) };
  let x = rec.x0, y = rec.y0, z = rec.z0, t = 0;
  for (let k = 0; k < n; k++) {
    const o = k * STRIDE;
    t += dv.getUint8(o) / 1000;
    x += dv.getInt8(o + 1) * QXZ; z += dv.getInt8(o + 2) * QXZ; y += dv.getInt8(o + 3) * QY;
    S.t[k] = t; S.x[k] = x; S.y[k] = y; S.z[k] = z;
    S.yaw[k] = (dv.getInt16(o + 4, true) / 32767) * Math.PI;
    S.pitch[k] = dv.getInt8(o + 6) * QA; S.roll[k] = dv.getInt8(o + 7) * QA; S.steer[k] = dv.getInt8(o + 8) / 200;
    S.idx[k] = dv.getUint16(o + 9, true);
  }
  // running max of idx, so "ghost time at track position" is a binary search even if the ghost was reset
  S.idxMax = new Float32Array(n);
  let m = 0;
  for (let k = 0; k < n; k++) { m = Math.max(m, S.idx[k]); S.idxMax[k] = m; }
  return S;
}

// ---------------------------------------------------------------- storage
export function loadGhost(stageId) {
  try {
    const raw = localStorage.getItem(KEY(stageId));
    if (!raw) return null;
    const g = JSON.parse(raw);
    // v1: no penalties; v2: sample times are the RAW race clock, pens = [[tRaw, cumulativePenalty], ...]
    if (!g || (g.v !== 1 && g.v !== 2) || !g.samples || !(g.time > 0)) return null;
    return g;
  } catch { return null; }
}

const dailyGhostKeys = () => {
  const out = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PREFIX + 'daily-')) out.push(k); } } catch { /* ignore */ }
  return out.sort(); // dated keys sort oldest first
};

// save; on a quota error drop the oldest daily ghosts and retry, then give up silently
export function saveGhost(stageId, rec) {
  const json = JSON.stringify(rec);
  const tryWrite = () => { try { localStorage.setItem(KEY(stageId), json); return true; } catch { return false; } };
  if (tryWrite()) return json.length;
  for (const k of dailyGhostKeys()) {
    if (k === KEY(stageId)) continue;
    try { localStorage.removeItem(k); } catch { /* ignore */ }
    if (tryWrite()) return json.length;
  }
  return 0;
}

// remove ghosts of past daily stages (called on boot)
export function pruneDailyGhosts(today = localDateStr()) {
  for (const k of dailyGhostKeys()) if (k !== PREFIX + 'daily-' + today) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
}

// ---------------------------------------------------------------- recording
const _pose = {};
export class GhostRecorder {
  constructor() { this.samples = []; this.next = 0; this.pens = []; }
  reset() { this.samples = []; this.next = 0; this.pens = []; }
  // a penalty landed at raw clock tRaw; cum = the run's total penalty so far
  penalty(tRaw, cum) { this.pens.push([Math.round(tRaw * 1000) / 1000, Math.round(cum * 1000) / 1000]); }
  // call once per rendered frame while racing, after car.updateVisual; t = RAW race clock (no penalties)
  sample(t, car, force = false) {
    if (!force && t < this.next) return;
    const p = car.getPose ? car.getPose(_pose) : { x: car.x, y: car.y, z: car.z, yaw: car.yaw, pitch: 0, roll: 0, steer: 0 };
    this.samples.push({ t, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch || 0, roll: p.roll || 0, steer: p.steer || 0, idx: car.idx });
    this.next = t + 1 / GHOST_HZ;
  }
  build(meta) {
    if (this.samples.length < 2) return null;
    // meta.time stays the stage time incl. penalties (= the best time); samples run on the raw clock
    return { v: 2, ...meta, hz: GHOST_HZ, pens: this.pens.slice(), samples: encodeSamples(this.samples) };
  }
}

// ---------------------------------------------------------------- playback
const lerpAng = (a, b, f) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * f;
export class GhostPlayer {
  constructor(rec, scene) {
    this.rec = rec;
    this.S = decodeSamples(rec.samples);
    // new records carry the recording build; older ones (carId only) replay as the default build in their paint
    this.car = makeCar(rec.build ? rec.build : { ...DEFAULT_BUILD, paint: rec.paint || DEFAULT_BUILD.paint });
    if (!rec.build && rec.paint) this.car.setPaint(rec.paint);
    if (this.car.setGhost) this.car.setGhost(true);
    this.car.group.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
    this.scene = scene;
    scene.add(this.car.group);
    this.k = 0; this.spin = 0; this.lastX = this.S.x[0]; this.lastZ = this.S.z[0];
    this.opacity = 1; this.visible = true;
    this.mats = [];
    this.car.group.traverse((o) => { if (o.material && o.material.transparent && !this.mats.includes(o.material)) this.mats.push(o.material); });
    this.baseOpacity = this.mats.length ? this.mats[0].opacity : 0.35;
    this.place(0);
  }
  get time() { return this.rec.time; }
  // cumulative ghost penalty at its raw clock time tRaw (old v1 records have none)
  penAt(tRaw) {
    let pen = 0;
    for (const [t, c] of this.rec.pens || []) { if (t <= tRaw + 1e-6) pen = c; else break; }
    return pen;
  }
  // the ghost's stage time (raw + its penalties) when it reached track sample idx, or null
  totalAtIdx(idx) { const t = this.timeAtIdx(idx); return t == null ? null : t + this.penAt(t); }
  setVisible(v) { this.visible = v; this.car.group.visible = v && this.opacity > 0.01; }
  // pose at RAW race clock t (holds the final pose after the ghost finished, fades out ~3 s later)
  place(t, playerPos = null) {
    const S = this.S, n = S.n;
    if (t <= S.t[0]) this.k = 0;
    while (this.k < n - 2 && S.t[this.k + 1] <= t) this.k++;
    while (this.k > 0 && S.t[this.k] > t) this.k--;
    const a = this.k, b = Math.min(n - 1, a + 1), span = S.t[b] - S.t[a];
    const f = span > 1e-6 ? Math.max(0, Math.min(1, (t - S.t[a]) / span)) : 1;
    const L = (arr) => arr[a] + (arr[b] - arr[a]) * f;
    const x = L(S.x), y = L(S.y), z = L(S.z);
    this.spin += Math.hypot(x - this.lastX, z - this.lastZ) / ((this.car.dims && this.car.dims.wheelR) || 0.36);
    this.lastX = x; this.lastZ = z;
    this.car.setPose(x, y, z, lerpAng(S.yaw[a], S.yaw[b], f), L(S.pitch), L(S.roll), L(S.steer), this.spin);
    // fade: after the ghost's finish, and when the camera car sits inside it (e.g. the shared start line)
    const tEnd = S.t[n - 1];
    let op = 1 - smoothstep(tEnd + 1.5, tEnd + 3.5, t);
    if (playerPos) op *= 0.25 + 0.75 * smoothstep(1.8, 4.5, Math.hypot(x - playerPos.x, z - playerPos.z));
    this.opacity = op;
    for (const m of this.mats) m.opacity = this.baseOpacity * op;
    this.car.group.visible = this.visible && op > 0.01;
  }
  // the ghost's clock time when it reached track sample idx (null if it never got there)
  timeAtIdx(idx) {
    const S = this.S, n = S.n, M = S.idxMax;
    if (idx > M[n - 1]) return null;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (M[mid] >= idx) hi = mid; else lo = mid + 1; }
    if (lo === 0) return S.t[0];
    const i0 = M[lo - 1], i1 = M[lo], f = i1 > i0 ? (idx - i0) / (i1 - i0) : 1;
    return S.t[lo - 1] + (S.t[lo] - S.t[lo - 1]) * f;
  }
  dispose() {
    this.scene.remove(this.car.group);
    this.car.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    for (const m of this.car._meshes || []) if (m.userData.mat) m.userData.mat.dispose();
  }
}
