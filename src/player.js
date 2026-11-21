// A racer: car, chase camera, viewport, timing and HUD pane. Solo is one Player, duel is two.
import * as THREE from 'three';
import { clamp, smoothstep } from './track.js';
import { makeCar, applyBuild, normalizeBuild, buildStats, DEFAULT_BUILD, paintName } from './carapi.js';
import { angDiff, damp } from './util.js';
import { createPane } from './hud.js';
import { Headlights } from './fx.js';

export const CAMS = [
  { name: 'CHASE', dist: 13, h: 7.5, look: 6 },
  { name: 'HIGH', dist: 22, h: 15, look: 8 },
  // low, close action cam: aims well down the road, wider and a little wider still with speed, leans into slides
  { name: 'ACTION', dist: 6.5, h: 2.4, look: 13.5, action: true, fov: 8, fovSpeed: 5, pullBack: 0.28 },
];
// every player drives the Rook; a player's look/performance is a build (see carapi.js / economy.js)
export class Player {
  constructor(i, scene, panesEl) {
    this.i = i;
    this.name = 'P' + (i + 1);
    this.scene = scene;
    this.build = normalizeBuild(DEFAULT_BUILD);
    this.car = makeCar(this.build);
    scene.add(this.car.group);
    this.lights = new Headlights(this.car, buildStats(this.build).lights);
    this.camScale = 1;
    this.cam = new THREE.PerspectiveCamera(50, 1, 0.3, 420);
    this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3();
    this.camYaw = 0; this.camSnap = true; this.camMode = 0; this.shake = 0; this.orbitA = i * 2.1;
    this.view = { x: 0, y: 0, w: 1, h: 1 };
    this.carry = [0, 0];
    this.ui = createPane(i, panesEl);
    this.syncPaintUi();
    this.resetRun();
  }
  get paint() { return { hex: this.build.paint, name: paintName(this.build.paint) }; }
  get carId() { return this.car.carId || 'rook'; }
  // show `build` on this player's car (model, handling, paint); headlights are re-fitted to the new body
  setBuild(build) {
    const b = normalizeBuild(build);
    const key = JSON.stringify(b);
    if (key === this._buildKey) return false;
    this._buildKey = key;
    this.build = b;
    applyBuild(this.car, b);
    const on = this.lights.group.visible;
    this.lights.dispose();
    this.lights = new Headlights(this.car, buildStats(b).lights);
    this.lights.setEnabled(on);
    this.syncPaintUi();
    return true;
  }
  syncPaintUi() {
    this.ui.tag.style.background = this.build.paint;
    this.ui.el.style.setProperty('--pc', this.build.paint);
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
    // garage: a close, slow full turntable around the parked car
    const garage = orbitMode === 'garage';
    p.orbitA += dt * (garage ? 0.22 : 0.12);
    const a = garage ? car.yaw + 0.9 + p.orbitA : car.yaw + Math.PI * 0.55 + Math.sin(p.orbitA) * 0.85;
    const R = garage ? 9 : orbitMode === 'menu' ? 17 : 14, H = garage ? 2.9 : orbitMode === 'menu' ? 9.5 : 6.5;
    _v.set(car.x + Math.sin(a) * R, car.y + H, car.z + Math.cos(a) * R);
    _l.set(car.x, car.y + (garage ? 0.7 : 0.8), car.z);
    p.camYaw = car.yaw;
  } else {
    const c = CAMS[p.camMode] || CAMS[0], sp = phys.speed;
    let fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    if (sp > 3) {
      // follow the velocity direction only when rolling forwards (reversing would swing the camera round)
      const w = 0.6 * smoothstep(3, 10, sp) * smoothstep(0, 3, phys.vf ?? sp);
      fx = fx * (1 - w) + (phys.vx / sp) * w; fz = fz * (1 - w) + (phys.vz / sp) * w;
    }
    const target = Math.atan2(fx, fz);
    p.camYaw = p.camSnap ? target : p.camYaw + angDiff(target, p.camYaw) * damp(3.2, dt);
    const sk = clamp(sp / 40, 0, 1), cs = p.camScale || 1, h = c.h * cs * (1 + sk * 0.06);
    // reversing towards a close camera: back off with reverse speed so the smoothing lag can't crop the car
    const dist = c.dist * cs * (1 + sk * (c.pullBack ?? 0.2)) + (c.action ? Math.max(0, -(phys.vf ?? 0)) * 0.35 : 0);
    const sx = Math.sin(p.camYaw), sz = Math.cos(p.camYaw);
    // the low cam follows a smoothed copy of the car's rendered height, so crests and jumps don't pogo it
    if (p.camSnap || p.camCarY == null) p.camCarY = car.y;
    else p.camCarY += (car.y - p.camCarY) * damp(c.action ? 4 : 30, dt);
    const cy = c.action ? p.camCarY : car.y;
    _v.set(car.x - sx * dist, cy + h, car.z - sz * dist);
    _l.set(car.x + sx * c.look, cy + 0.8, car.z + sz * c.look);
  }
  // per-preset field of view on top of the pane's base (set in layout), eased; the action cam widens with speed
  const preset = !orbitMode ? CAMS[p.camMode] || CAMS[0] : null;
  const baseFov = cam.userData.baseFov || cam.fov;
  const fovT = baseFov + (preset ? (preset.fov || 0) + (preset.fovSpeed || 0) * clamp(phys.speed / 40, 0, 1) : 0);
  if (cam.userData.baseFov == null) cam.userData.baseFov = cam.fov;
  const fov = p.camSnap ? fovT : cam.fov + (fovT - cam.fov) * damp(4, dt);
  if (Math.abs(fov - cam.fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
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
  // action cam: lean gently into the turn / slide (roll from the yaw rate), smoothed
  const leanT = preset && preset.action ? clamp(-(phys.yawRate || 0) * 0.045, -0.07, 0.07) : 0;
  p.camLean = (p.camLean || 0) + (leanT - (p.camLean || 0)) * damp(5, dt);
  if (Math.abs(p.camLean) > 1e-4) cam.rotateZ(p.camLean);
}

// shadow frustum follows the car of the pane being rendered, centred a little ahead in view direction
export function aimSun(p, sun, sunDir) {
  const car = pose(p.car), cx = car.x + Math.sin(p.camYaw) * 14, cz = car.z + Math.cos(p.camYaw) * 14;
  sun.target.position.set(cx, car.y, cz);
  sun.position.set(cx + sunDir.x * 150, car.y + sunDir.y * 150, cz + sunDir.z * 150);
  sun.target.updateMatrixWorld();
}
