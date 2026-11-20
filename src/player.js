// A racer: car, chase camera, viewport, timing and HUD pane. Solo is one Player, duel is two.
import * as THREE from 'three';
import { clamp, smoothstep } from './track.js';
import { Car, CARS, PAINTS } from './car.js';
import { angDiff, damp } from './util.js';
import { store } from './storage.js';
import { createPane } from './hud.js';
import { Headlights } from './fx.js';

export const CAMS = [
  { name: 'CHASE', dist: 13, h: 7.5, look: 6 },
  { name: 'HIGH', dist: 22, h: 15, look: 8 },
  { name: 'TOP', dist: 4.5, h: 27, look: 3 },
];
export const paintKey = (i) => (i ? 'dustline.paint2' : 'dustline.paint');
export const carKey = (i) => (i ? 'dustline.car2' : 'dustline.car');
export const carDef = (id) => CARS.find((c) => c.id === id) || null;

export class Player {
  constructor(i, scene, panesEl) {
    this.i = i;
    this.name = 'P' + (i + 1);
    this.scene = scene;
    this.car = new Car();
    scene.add(this.car.group);
    this.lights = new Headlights(this.car);
    this.camScale = 1;
    this.cam = new THREE.PerspectiveCamera(50, 1, 0.3, 420);
    this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3();
    this.camYaw = 0; this.camSnap = true; this.camMode = 0; this.shake = 0; this.orbitA = i * 2.1;
    this.view = { x: 0, y: 0, w: 1, h: 1 };
    this.carry = [0, 0];
    this.ui = createPane(i, panesEl);
    this.setPaint(clamp(store.get(paintKey(i), i ? 1 : 0) | 0, 0, PAINTS.length - 1));
    this.resetRun();
  }
  get paint() { return PAINTS[this.paintIdx]; }
  get carId() { return this.car.carId; }
  // swap the car model + handling, keeping paint, headlight state and pose; returns true if it changed
  setCar(id) {
    const def = carDef(id) || CARS[0];
    if (def.id === this.car.carId) return false;
    const old = this.car, lightsOn = this.lights.group.visible, vis = old.group.visible;
    this.lights.dispose();
    this.scene.remove(old.group);
    old.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    this.car = new Car(def.id);
    this.car.group.visible = vis;
    this.scene.add(this.car.group);
    this.lights = new Headlights(this.car);
    this.lights.setEnabled(lightsOn);
    // camera distance scales gently with the car's length (Rook ~4.1 m is the reference)
    this.camScale = clamp(this.lights.lengthM / 4.1, 0.9, 1.12);
    this.car.setPaint(this.paint.hex);
    return true;
  }
  setPaint(idx) {
    this.paintIdx = idx; this.car.setPaint(this.paint.hex);
    this.ui.tag.style.background = this.paint.hex;
    this.ui.el.style.setProperty('--pc', this.paint.hex);
  }
  resetRun() { this.time = 0; this.splits = []; this.nextSplit = 0; this.done = false; this.doneT = 0; this.stuckT = 0; }
  // car.reset puts the car on the centreline; lat (+ = left) shifts it sideways along the road normal
  place(stage, idx, lat = 0) {
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

// interpolated render pose (between the last two physics steps); falls back to the physics pose
const _pose = { x: 0, y: 0, z: 0, yaw: 0 };
export function pose(car) {
  _pose.x = car.rx ?? car.x; _pose.y = car.ry ?? car.y; _pose.z = car.rz ?? car.z; _pose.yaw = car.ryaw ?? car.yaw;
  return _pose;
}

const _v = new THREE.Vector3(), _l = new THREE.Vector3();
// orbit: menu attract (wide, high) or after this player finished; otherwise the elevated chase cam
export function updateCamera(p, dt, stage, orbitMode) {
  const cam = p.cam, phys = p.car, car = pose(phys);
  if (orbitMode) {
    // side-on orbit (never straight behind, where the dust plume trails), high enough to look over it
    p.orbitA += dt * 0.12;
    const a = car.yaw + Math.PI * 0.55 + Math.sin(p.orbitA) * 0.85;
    const R = orbitMode === 'menu' ? 17 : 14, H = orbitMode === 'menu' ? 9.5 : 6.5;
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
    const sk = clamp(sp / 40, 0, 1), cs = p.camScale || 1, dist = c.dist * cs * (1 + sk * 0.2), h = c.h * cs * (1 + sk * 0.06);
    const sx = Math.sin(p.camYaw), sz = Math.cos(p.camYaw);
    _v.set(car.x - sx * dist, car.y + h, car.z - sz * dist);
    _l.set(car.x + sx * c.look, car.y + 0.8, car.z + sz * c.look);
  }
  if (p.camSnap) { p.camPos.copy(_v); p.camLook.copy(_l); p.camSnap = false; }
  else { p.camPos.lerp(_v, damp(orbitMode ? 2 : 6, dt)); p.camLook.lerp(_l, damp(orbitMode ? 4 : 10, dt)); }
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
export function aimSun(p, sun, sunDir) {
  const car = pose(p.car), cx = car.x + Math.sin(p.camYaw) * 14, cz = car.z + Math.cos(p.camYaw) * 14;
  sun.target.position.set(cx, car.y, cz);
  sun.position.set(cx + sunDir.x * 150, car.y + sunDir.y * 150, cz + sunDir.z * 150);
  sun.target.updateMatrixWorld();
}
