// Stage rules: mandatory gates and time penalties, plus the in-world "next gate" marker.
// Stage time = clock + penalties: penalties are added straight onto Player.time, so splits, finish, medals,
// best times, ghosts, rally totals and duel results all include them without special cases.
import * as THREE from 'three';
import { ROAD_HALF, smoothstep } from './track.js';

export const GATE_PENALTY = 5.0;   // s, per missed gate
export const RESET_PENALTY = 2.0;  // s, per manual or automatic reset
export const RESET_GRACE = 3.0;    // s after GO during which resets are free
export const RESET_DEDUPE = 1.5;   // s: one incident never charges two reset penalties
const JUMP = 8;                    // samples: crossing a gate this far behind the car means it was skipped, not driven through

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
const ACCENT = new THREE.Color('#f2b632'), GREEN = new THREE.Color('#4fd27e'), RED = new THREE.Color('#ff4a32');
export class GateMarker {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.visible = false;
    this.mat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, depthWrite: false });
    this.gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), this.mat);
    this.gem.scale.set(1, 1.5, 1);
    this.group.add(this.gem);
    this.glowMat = new THREE.SpriteMaterial({ map: glowTex(), color: ACCENT, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    this.glows = [-1, 1].map(() => { const s = new THREE.Sprite(this.glowMat); s.scale.set(1.6, 1.6, 1); this.group.add(s); return s; });
    // burst: an expanding ring at a gate just passed (green) or missed (red)
    this.burstMat = new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    this.burst = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.16, 6, 28), this.burstMat);
    this.burst.visible = false;
    scene.add(this.group, this.burst);
    this.t = 0; this.bt = 1;
  }
  setGate(g, stage) {
    this.gate = g;
    this.group.visible = !!g;
    if (!g) return;
    const y = g.y ?? stage.sy[g.idx];
    this.base = new THREE.Vector3(g.x, y + 4.6, g.z);
    this.group.position.copy(this.base);
    this.group.rotation.y = Math.atan2(g.tx, g.tz);
    this.glows[0].position.set(g.half, -1.8, 0); this.glows[1].position.set(-g.half, -1.8, 0);
  }
  flash(g, stage, ok) {
    if (!g) return;
    this.burstMat.color.copy(ok ? GREEN : RED);
    this.burst.position.set(g.x, (g.y ?? stage.sy[g.idx]) + 2.2, g.z);
    this.burst.rotation.set(0, Math.atan2(g.tx, g.tz), 0);
    this.burst.visible = true; this.bt = 0;
  }
  update(dt) {
    this.t += dt;
    if (this.group.visible) {
      this.gem.rotation.y = this.t * 1.6;
      this.gem.position.y = Math.sin(this.t * 2.4) * 0.25;
      this.glowMat.opacity = 0.4 + 0.2 * Math.sin(this.t * 3.1);
    }
    if (this.burst.visible) {
      this.bt += dt;
      const k = this.bt / 0.6;
      if (k >= 1) this.burst.visible = false;
      else { this.burst.scale.setScalar(1 + k * 1.6); this.burstMat.opacity = 0.85 * (1 - k); }
    }
  }
  show(on) { this.group.visible = on && !!this.gate; if (!on) this.burst.visible = false; }
  setVisibleFor(on) { this.group.visible = on && !!this.gate && this.active; this.burst.visible = on && this.bt < 0.6; }
  dispose(scene) { scene.remove(this.group, this.burst); }
}
