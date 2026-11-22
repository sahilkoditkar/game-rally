// Stage rules: mandatory gates and time penalties, plus the in-world "next gate" marker.
// Stage time = clock + penalties: penalties are added straight onto Player.time, so splits, finish, medals,
// best times, ghosts, rally totals and duel results all include them without special cases.
import * as THREE from 'three';
import { ROAD_HALF, smoothstep } from './track.js';

export const GATE_PENALTY = 5.0;   // s, per missed gate
export const RESET_PENALTY = 2.0;  // s, per manual or automatic reset
export const RESET_GRACE = 3.0;    // s after GO during which resets are free
export const RESET_DEDUPE = 1.5;   // s: one incident never charges two reset penalties
const JUMP = 8;
const POLE_OUT = 0.4;               // poles stand this far outside the valid opening (matches track.js)                    // samples: crossing a gate this far behind the car means it was skipped, not driven through

// ---------------------------------------------------------------- gates (track.js provides stage.gates; fallback until it does)
export function stageGates(stage) {
  if (Array.isArray(stage.gates) && stage.gates.length) return stage.gates;
  if (stage._gatesFB) return stage._gatesFB;
  // fallback: ~16 evenly spaced gates with simple poles, so the rules work before track.js ships its own
  const a = stage.startIdx + 15, b = stage.finishIdx - 10, n = Math.max(4, Math.min(18, Math.round((b - a) / 55)));
  const gates = [];
  for (let k = 0; k < n; k++) {
    const idx = Math.round(a + ((b - a) * (k + 0.5)) / n);
    gates.push({ idx, x: stage.sx[idx], y: stage.sy[idx], z: stage.sz[idx], tx: stage.tx[idx], tz: stage.tz[idx], half: 6.2 });
  }
  const g = new THREE.Group(), geo = new THREE.CylinderGeometry(0.09, 0.11, 3.2, 6), mat = new THREE.MeshLambertMaterial({ color: '#f4efe2' });
  const flag = new THREE.BoxGeometry(0.05, 0.6, 0.9), fmat = new THREE.MeshLambertMaterial({ color: '#e2472f' });
  for (const gt of gates) for (const s of [-1, 1]) {
    const x = gt.x + gt.tz * gt.half * s, z = gt.z - gt.tx * gt.half * s, y = stage.height(x, z);
    const pole = new THREE.Mesh(geo, mat); pole.position.set(x, y + 1.6, z); g.add(pole);
    const f = new THREE.Mesh(flag, fmat); f.position.set(x, y + 2.8, z + 0); f.rotation.y = Math.atan2(gt.tx, gt.tz); f.translateZ(-0.45); g.add(f);
  }
  stage.group.add(g); // disposed with the stage
  stage._gatesFB = gates;
  return gates;
}
export const gateLat = (g, x, z) => (x - g.x) * g.tz - (z - g.z) * g.tx;

// rough: car.js provides car.rough (0..1); fallback derived from distance off the road
export const roughOf = (car) => (typeof car.rough === 'number' ? car.rough : smoothstep(ROAD_HALF + 6, ROAD_HALF + 14, car.roadDist || 0));

// ---------------------------------------------------------------- per-player tracker
export class Rules {
  constructor(stage) {
    this.gates = stageGates(stage);
    this.next = 0; this.passed = 0; this.missed = 0; this.resets = 0; this.pen = 0;
    this.lastReset = -99;
    this.results = []; // per gate: 'pass' | 'miss'
  }
  get total() { return this.gates.length; }
  get nextGate() { return this.gates[this.next] || null; }
  // per physics step while racing; returns events [{ type: 'pass' | 'miss', gate, i }]
  update(car) {
    const ev = [];
    while (this.next < this.gates.length && car.idx >= this.gates[this.next].idx) {
      const g = this.gates[this.next];
      const jumped = car.idx - g.idx > JUMP;
      const ok = !jumped && Math.abs(gateLat(g, car.x, car.z)) <= g.half;
      ev.push(this.mark(ok ? 'pass' : 'miss'));
    }
    return ev;
  }
  mark(type) {
    const i = this.next, g = this.gates[i];
    this.results[i] = type; this.next++;
    if (type === 'pass') this.passed++; else { this.missed++; this.pen += GATE_PENALTY; }
    return { type, gate: g, i, pen: type === 'miss' ? GATE_PENALTY : 0 };
  }
  // a reset placing the car at newIdx: unpassed gates up to there are missed; returns [events], charge (s)
  reset(newIdx, clock, car, auto) {
    const ev = [];
    while (this.next < this.gates.length && this.gates[this.next].idx <= newIdx) ev.push(this.mark('miss'));
    const pointless = !auto && car.speed < 2 / 3.6 && (car.roadDist || 0) < 2;
    let charge = 0;
    if (clock >= RESET_GRACE && !pointless && clock - this.lastReset >= RESET_DEDUPE) { charge = RESET_PENALTY; this.resets++; this.pen += charge; }
    if (charge) this.lastReset = clock;
    return { ev, charge };
  }
  summary() { return { total: Math.round(this.pen * 1000) / 1000, gates: { passed: this.passed, missed: this.missed, total: this.gates.length }, resets: this.resets }; }
}

// "Penalties +7.0 s · 1 missed gate · 1 reset" or null for a clean run
export function penaltyText(s) {
  if (!s || !(s.total > 0)) return null;
  const parts = [`Penalties +${s.total.toFixed(1)} s`];
  if (s.gates.missed) parts.push(`${s.gates.missed} missed gate${s.gates.missed > 1 ? 's' : ''}`);
  if (s.resets) parts.push(`${s.resets} reset${s.resets > 1 ? 's' : ''}`);
  return parts.join(' · ');
}
export const penaltyHtml = (s) => { const t = penaltyText(s); return t ? `<div class="pen-line">${t}</div>` : '<div class="pen-line clean"><span class="clean-badge">CLEAN RUN</span></div>'; };

// ---------------------------------------------------------------- next-gate marker (one per player; shown only in that player's pane)
let glow = null;
function glowTex() {
  if (glow) return glow;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glow = new THREE.CanvasTexture(c); glow.colorSpace = THREE.SRGBColorSpace; return glow;
}
const ACCENT = new THREE.Color('#f2b632'), GREEN = new THREE.Color('#4fd27e'), RED = new THREE.Color('#ff4a32'), INK = new THREE.Color('#24252d');
const GEM_MIN_PX = 0.028;  // the gem never shrinks below ~this fraction of the view height (scale grows with distance)
const BURST_T = 0.4;       // s: the pass / miss pulse
export class GateMarker {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.visible = false;
    // the gem: mustard with a dark rim so it reads against bright sky and snow; drawn on top so it is
    // visible through trees from a distance (it is a waypoint, not scenery)
    this.gemWrap = new THREE.Group(); this.group.add(this.gemWrap);
    const geo = new THREE.OctahedronGeometry(0.7, 0);
    this.mat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false });
    this.gem = new THREE.Mesh(geo, this.mat);
    this.gem.scale.set(1, 1.5, 1); this.gem.renderOrder = 11;
    this.rimMat = new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, side: THREE.BackSide });
    this.rim = new THREE.Mesh(geo, this.rimMat);
    this.rim.scale.set(1.32, 1.32 * 1.5, 1.32); this.rim.renderOrder = 10;
    this.gemWrap.add(this.rim, this.gem);
    // the next gate's two poles: a mustard sleeve and a soft glow on top (the poles themselves are track.js's)
    this.glowMat = new THREE.SpriteMaterial({ map: glowTex(), color: ACCENT, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glows = [-1, 1].map(() => { const s = new THREE.Sprite(this.glowMat); s.scale.set(2.2, 2.2, 1); this.group.add(s); return s; });
    this.sleeveMat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.5, depthWrite: false });
    const sg = new THREE.CylinderGeometry(0.13, 0.15, 3.0, 6);
    this.sleeves = [-1, 1].map(() => { const m = new THREE.Mesh(sg, this.sleeveMat); this.group.add(m); return m; });
    // pass / miss: a brief small pulse on the two pole tops of the gate just crossed (never around the car)
    this.burst = new THREE.Group(); this.burst.visible = false;
    this.burstMat = new THREE.SpriteMaterial({ map: glowTex(), color: GREEN, transparent: true, opacity: 0, depthWrite: false });
    this.bursts = [-1, 1].map(() => { const s = new THREE.Sprite(this.burstMat); this.burst.add(s); return s; });
    scene.add(this.group, this.burst);
    this.t = 0; this.bt = 1; this._v = new THREE.Vector3();
    this.emphT = 0; // s left of the first-run emphasis (bigger, brighter marker while the gates tip is up)
  }
  emphasise(sec) { this.emphT = Math.max(this.emphT, sec); }
  setGate(g, stage) {
    this.gate = g;
    this.group.visible = !!g;
    if (!g) return;
    const y = g.y ?? stage.sy[g.idx];
    this.base = new THREE.Vector3(g.x, y + 4.6, g.z);
    this.group.position.copy(this.base);
    this.group.rotation.y = Math.atan2(g.tx, g.tz);
    // on the actual poles (track.js puts them GATE_POLE_OUT = 0.4 m outside the opening), sleeves on the ground there
    [1, -1].forEach((side, k) => {
      const off = (g.half + POLE_OUT) * side;
      const px = g.x + g.tz * off, pz = g.z - g.tx * off;
      let gy = y;
      try { if (typeof stage.height === 'function') gy = stage.height(px, pz, true) - 0.05; } catch { gy = y; }
      if (!Number.isFinite(gy)) gy = y;
      this.glows[k].position.set(off, gy - this.base.y + 3.25, 0);
      this.sleeves[k].position.set(off, gy - this.base.y + 1.55, 0);
    });
  }
  flash(g, stage, ok) {
    if (!g) return;
    this.burstMat.color.copy(ok ? GREEN : RED);
    const y = g.y ?? stage.sy[g.idx];
    this.burst.position.set(g.x, y, g.z);
    this.burst.rotation.set(0, Math.atan2(g.tx, g.tz), 0);
    [1, -1].forEach((side, k) => this.bursts[k].position.set((g.half + POLE_OUT) * side, 3.1, 0));
    this.burst.visible = true; this.bt = 0;
  }
  // keep the gem readable from far away: scale it up with distance so it never drops below GEM_MIN_PX of the view
  fit(cam) {
    if (!this.group.visible || !cam) return;
    const d = cam.position.distanceTo(this.gemWrap.getWorldPosition(this._v));
    const px = (1.05 * 2) / (2 * d * Math.tan(((cam.fov || 50) * Math.PI) / 360)); // gem height / view height at scale 1
    const e = this.emphT > 0 ? 1 + 0.55 * Math.min(1, this.emphT) * (0.75 + 0.25 * Math.sin(this.t * 7)) : 1;
    this.gemWrap.scale.setScalar(Math.max(1, GEM_MIN_PX / Math.max(px, 1e-4)) * e);
  }
  update(dt) {
    this.t += dt;
    if (this.group.visible) {
      this.gem.rotation.y = this.rim.rotation.y = this.t * 1.6;
      this.gemWrap.position.y = Math.sin(this.t * 2.4) * 0.25;
      const e = Math.min(1, Math.max(0, this.emphT));
      this.glowMat.opacity = 0.6 + 0.25 * Math.sin(this.t * 3.1) + 0.3 * e;
      this.sleeveMat.opacity = 0.42 + 0.18 * Math.sin(this.t * 3.1) + 0.4 * e;
      for (const g of this.glows) g.scale.setScalar(2.2 * (1 + 0.8 * e));
    }
    if (this.emphT > 0) this.emphT -= dt;
    if (this.bt < BURST_T) { // advances even while the other pane is being drawn (duel)
      this.bt += dt;
      const k = this.bt / BURST_T;
      if (k >= 1) this.burst.visible = false;
      else { const sc = 0.7 + k * 1.1; for (const s of this.bursts) s.scale.set(sc, sc, 1); this.burstMat.opacity = 0.95 * (1 - k); }
    }
  }
  show(on) { this.group.visible = on && !!this.gate; if (!on) this.burst.visible = false; }
  setVisibleFor(on) { this.group.visible = on && !!this.gate && this.active; this.burst.visible = on && this.bt < BURST_T; }
  dispose(scene) { scene.remove(this.group, this.burst); }
}
