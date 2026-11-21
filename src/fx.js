// Visual effects: dust / spray puffs, rain streaks, night headlights.
import * as THREE from 'three';
import { smoothstep } from './track.js';

// ---------------------------------------------------------------- dust (one pool shared by all cars)
const DUST_N = 280, DUST_MAX = 1.45; // max puff radius (m)
export class Dust {
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
    this.lift = 1; this.lifeK = 1;
    this.o = new THREE.Object3D();
  }
  // style per conditions: emissive lift keeps puffs airy by day; at night they dim, in rain they become darker, low spray
  setStyle(hex, { night = false, rain = false } = {}) {
    this.mat.color.set(hex);
    if (rain) this.mat.color.multiplyScalar(0.72);
    const em = night ? 0.12 : rain ? 0.3 : 0.62;
    this.mat.emissive.set(hex).multiplyScalar(em);
    this.mat.opacity = night ? 0.2 : rain ? 0.3 : 0.28;
    this.lift = rain ? 0.35 : 1;
    this.lifeK = rain ? 0.7 : 1;
  }
  clear() { this.age.fill(2); this.life.fill(1); }
  emit(x, y, z, vx, vy, vz, size, life, shade = 0.88 + Math.random() * 0.12) {
    const i = this.next; this.next = (this.next + 1) % DUST_N;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy * this.lift; this.v[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life * this.lifeK; this.size[i] = size;
    this.mesh.setColorAt(i, _c.setScalar(shade)); this.mesh.instanceColor.needsUpdate = true;
    this.rot[i * 3] = Math.random() * 6; this.rot[i * 3 + 1] = Math.random() * 6; this.rot[i * 3 + 2] = Math.random() * 6;
  }
  // rear-wheel emission for one car; carry is that car's [left, right] fractional puff counters
  // rough (0..1): deep rough throws more, bigger and darker clods
  emitFrom(car, carry, dt, rough = 0) {
    if (!car.grounded || car.speed < 1.5) { carry[0] = carry[1] = 0; return; }
    const sp = car.speed, slip = car.slip || 0, off = car.offroad || 0;
    // straight-line driving leaves a light trail; sliding (slip, drift) and verges throw much more
    const rate = (sp * 0.45 + slip * slip * 0.9 + slip * 4) * (0.55 + off * 1.1) * (1 + 0.8 * (car.drift || 0)) * (1 + 1.6 * rough) * smoothstep(1.5, 6, sp);
    for (let w = 0; w < 2; w++) {
      carry[w] += rate * dt;
      while (carry[w] >= 1) {
        carry[w] -= 1;
        car.wheelWorld(2 + w, _w);
        const big = 1 + Math.min(slip, 10) * 0.04 + off * 0.25 + rough * 0.3;
        this.emit(_w.x + rnd() * 0.5, _w.y + 0.25, _w.z + rnd() * 0.5,
          car.vx * 0.22 + rnd() * 2.4, 0.3 + Math.random() * 0.8, car.vz * 0.22 + rnd() * 2.4,
          (0.45 + Math.random() * 0.35) * big, 0.75 + Math.random() * 0.5, rough > 0.2 ? 0.5 + Math.random() * 0.15 : undefined);
      }
    }
  }
  step(dt) { // simulation, once per frame
    const drag = Math.exp(-2.2 * dt), up = 0.25 * this.lift;
    for (let i = 0; i < DUST_N; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const k = i * 3;
      this.v[k] *= drag; this.v[k + 2] *= drag; this.v[k + 1] = this.v[k + 1] * drag + up * dt;
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
const _w = new THREE.Vector3(), _c = new THREE.Color();
const rnd = () => Math.random() - 0.5;

// ---------------------------------------------------------------- rain
// ~600 slanted streaks with fixed world-space columns; each view wraps them into a box around its camera,
// so drops keep parallax as the camera moves. Re-laid out per pane before rendering.
const RAIN_N = 600, BOX = 44, BOX_H = 26, FALL = 26, WIND_X = 2.2, WIND_Z = 1.1, STREAK = 0.075;
export class Rain {
  constructor() {
    this.x0 = new Float32Array(RAIN_N); this.z0 = new Float32Array(RAIN_N); this.y0 = new Float32Array(RAIN_N); this.sp = new Float32Array(RAIN_N);
    for (let i = 0; i < RAIN_N; i++) { this.x0[i] = Math.random() * BOX; this.z0[i] = Math.random() * BOX; this.y0[i] = Math.random() * BOX_H; this.sp[i] = 0.85 + Math.random() * 0.3; }
    this.pos = new Float32Array(RAIN_N * 6);
    const g = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attr);
    this.mat = new THREE.LineBasicMaterial({ color: 0xd4dde8, transparent: true, opacity: 0.5, depthWrite: false, fog: true });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.t = 0;
  }
  setEnabled(on, night = false) { this.mesh.visible = on; this.mat.color.set(night ? 0x7d8aa0 : 0xd4dde8); this.mat.opacity = night ? 0.4 : 0.5; }
  step(dt) { this.t += dt; }
  layout(cp) {
    if (!this.mesh.visible) return;
    const p = this.pos, t = this.t, mod = (v, m) => ((v % m) + m) % m;
    const bx = cp.x - BOX / 2, bz = cp.z - BOX / 2, by = cp.y - BOX_H * 0.6;
    for (let i = 0; i < RAIN_N; i++) {
      const fall = t * FALL * this.sp[i];
      const y = mod(this.y0[i] - fall - by, BOX_H) + by;
      const x = mod(this.x0[i] + fall * WIND_X / FALL - bx, BOX) + bx, z = mod(this.z0[i] + fall * WIND_Z / FALL - bz, BOX) + bz;
      const k = i * 6;
      p[k] = x; p[k + 1] = y; p[k + 2] = z;
      p[k + 3] = x - WIND_X * STREAK; p[k + 4] = y + FALL * STREAK * this.sp[i]; p[k + 5] = z - WIND_Z * STREAK;
    }
    this.attr.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- headlights (night)
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c); glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
// warm spot lights + glow sprites parented to the car group (local +Z is forward, Y up, ground at 0)
// lights stat of the stock build (from car.js when it provides buildStats); stock == today's lamps
export let STOCK_LIGHTS = 0.5;
export const setStockLights = (v) => { if (typeof v === 'number' && v > 0) STOCK_LIGHTS = v; };
export class Headlights {
  // lamp and tail positions come from the car's own model bounds; `lights` (buildStats().lights, 0..1) scales
  // reach and brightness relative to the stock car, so a stock build looks exactly as before
  constructor(car, lights = STOCK_LIGHTS) {
    this.group = new THREE.Group();
    this.group.visible = false;
    car.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(car.body), inv = new THREE.Matrix4().copy(car.group.matrixWorld).invert();
    box.applyMatrix4(inv);
    const front = box.max.z, rear = box.min.z, half = Math.max(0.5, box.max.x - 0.25), top = box.max.y;
    const lampY = Math.min(0.85, Math.max(0.55, top * 0.45));
    this.lengthM = front - rear;
    const warm = 0xffe2b0;
    // mounted a little above the roof with no distance falloff (decay 0, soft cutoff at 72 m): real lamp height
    // would leave the far road black and burn a hotspot right at the bumper
    const k = Math.max(-0.5, (lights ?? STOCK_LIGHTS) - STOCK_LIGHTS);
    this.reach = 72 * (1 + 1.1 * k);
    for (const sx of [-1, 1]) {
      const s = new THREE.SpotLight(warm, 5 * (1 + 2.6 * k), this.reach, Math.min(0.8, 0.5 * (1 + 0.6 * k)), 0.7, 0);
      s.position.set(sx * 0.5, top + 0.8, front - 1.4);
      s.target.position.set(sx * 1.6 * (1 + 1.2 * k), 0, front + 24 * (1 + 0.6 * k));
      s.castShadow = false;
      this.group.add(s, s.target);
    }
    const sprite = (hex, size, x, y, z, op) => {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: hex, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.scale.set(size, size, 1); m.position.set(x, y, z); this.group.add(m);
    };
    for (const sx of [-1, 1]) {
      sprite(0xffe9c4, 0.75, sx * half * 0.78, lampY, front + 0.04, 0.7); // lamp halo
      sprite(0xff2a1a, 0.75, sx * half * 0.8, lampY + 0.1, rear - 0.04, 0.8); // tail glow
    }
    car.group.add(this.group);
  }
  setEnabled(on) { this.group.visible = on; }
  dispose() {
    this.group.traverse((o) => { if (o.material) o.material.dispose(); if (o.dispose && o.isLight) o.dispose(); });
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
