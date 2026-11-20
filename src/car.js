import * as THREE from 'three';
import { ROAD_HALF, STEP, clamp, smoothstep, part, merge } from './track.js';

// ---------------------------------------------------------------------------
// Dustline car: an original chunky low-poly rally hatchback + arcade physics.
// Conventions: Y up, yaw 0 faces +Z, forward f = (sin yaw, cos yaw),
// left l = (cos yaw, -sin yaw), positive yaw rate / steer = turn LEFT.
// ---------------------------------------------------------------------------

export const PAINTS = [
  { name: 'Ember', hex: '#e2472f' },
  { name: 'Glacier', hex: '#3d7fc4' },
  { name: 'Marigold', hex: '#f2b632' },
  { name: 'Fern', hex: '#3f9a63' },
  { name: 'Chalk', hex: '#ece7da' },
  { name: 'Plum', hex: '#7c4bb0' },
];

// tuning
const POWER = 13, VMAX = 52, BRAKE = 17, REV_ACC = 6, REV_MAX = 9, HAND_DEC = 4;
const GRIP = 10.5, GRAV = 20, WB = 2.5;
const FIXED_DT = 1 / 120;
const MAX_ROLL = 0.105, MAX_PITCH = 0.07; // cosmetic body lean limits (~6 deg, ~4 deg)
const WHEEL_R = 0.36, WX = 0.82, WZ = 1.25;
const GEAR_TOP = [0, 11, 19, 27, 36, 46];
const BODY_PIVOT = 0.45;

const C = {
  dark: '#2b2c33', trim: '#3a3c45', glass: '#26313d', glassHi: '#3a4a5a', light: '#fff4d6', lamp: '#fff8e6',
  tail: '#d8252b', amber: '#f39a2b', stripe: '#f3efe4', tyre: '#1f2024', hub: '#d8d4c8', flap: '#c62c2c',
  skid: '#8a8d94', number: '#22232a',
};

// remap a unit box's top vertices to make a tapered frustum (cabin)
function frustum(wb, lb, wt, lt, h, topOffZ = 0) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    const sx = Math.sign(p.getX(i)), sz = Math.sign(p.getZ(i));
    p.setXYZ(i, sx * (top ? wt : wb) / 2, top ? h : 0, sz * (top ? lt : lb) / 2 + (top ? topOffZ : 0));
  }
  g.computeVertexNormals();
  return g;
}

function box(w, h, l) { return new THREE.BoxGeometry(w, h, l); }
function cylX(r, w, seg = 12) { const g = new THREE.CylinderGeometry(r, r, w, seg); g.rotateZ(Math.PI / 2); return g; }
function cylZ(r, l, seg = 12) { const g = new THREE.CylinderGeometry(r, r, l, seg); g.rotateX(Math.PI / 2); return g; }

function buildShell() {
  // side profile (z, y) of the lower body, extruded across the car's width
  const s = new THREE.Shape();
  const prof = [
    [-1.9, 0.42], [1.86, 0.42], [1.96, 0.56], [1.93, 0.78], [1.05, 0.93],
    [-1.62, 0.98], [-1.9, 0.9], [-1.95, 0.6],
  ];
  s.moveTo(prof[0][0], prof[0][1]);
  for (let i = 1; i < prof.length; i++) s.lineTo(prof[i][0], prof[i][1]);
  s.closePath();
  const W = 1.6, BV = 0.07;
  const body = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: true, bevelThickness: BV, bevelSize: BV, bevelSegments: 1, curveSegments: 1 });
  body.translate(0, 0, -W / 2);
  body.rotateY(-Math.PI / 2); // shape x -> world z, extrusion -> world x
  const paint = [];
  paint.push(part(body, '#fff'));

  // flared wheel arches: thick half-annulus fender lips over each wheel
  const arch = new THREE.Shape();
  arch.absarc(0, 0, 0.54, 0, Math.PI, false);
  arch.absarc(0, 0, 0.43, Math.PI, 0, true);
  const archG = new THREE.ExtrudeGeometry(arch, { depth: 0.16, bevelEnabled: false, curveSegments: 5 });
  archG.rotateY(-Math.PI / 2); // depth now spans x in [-0.16, 0]
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const g = archG.clone(); g.translate(sx > 0 ? 0.16 : 0, 0, 0);
    paint.push(part(g, '#fff', sx * 0.82, WHEEL_R + 0.02, sz * WZ));
  }

  // roof panel on the cabin
  const roof = frustum(1.36, 1.72, 1.24, 1.5, 0.07, -0.05);
  paint.push(part(roof, '#fff', 0, 1.5, -0.72));
  // rear wing plate (paint) + roof-edge spoiler lip
  paint.push(part(box(1.66, 0.06, 0.42), '#fff', 0, 1.7, -1.72));
  // door mirrors
  for (const sx of [-1, 1]) paint.push(part(box(0.12, 0.1, 0.16), '#fff', sx * 0.9, 1.06, 0.74));

  // ---- detail mesh (vertex colours) ----
  const d = [];
  // cabin glass: tapered, set back, windscreen raked
  d.push(part(frustum(1.6, 2.7, 1.3, 1.72, 0.55, -0.22), C.glass, 0, 0.95, -0.4));
  // body-colour pillars hint: thin light strip at the bottom edge of the glass
  d.push(part(box(1.62, 0.04, 2.64), C.trim, 0, 0.97, -0.4));
  // bumpers
  d.push(part(box(1.86, 0.26, 0.3), C.dark, 0, 0.47, 1.95));
  d.push(part(box(1.86, 0.28, 0.28), C.dark, 0, 0.5, -1.98));
  // front skid plate
  d.push(part(box(1.3, 0.06, 0.6), C.skid, 0, 0.36, 1.7));
  // grille
  d.push(part(box(0.7, 0.16, 0.06), C.dark, 0, 0.7, 2.0));
  // headlights
  for (const sx of [-1, 1]) {
    d.push(part(box(0.38, 0.17, 0.06), C.light, sx * 0.58, 0.7, 2.0));
    d.push(part(box(0.18, 0.08, 0.05), C.amber, sx * 0.62, 0.57, 2.1));
  }
  // taillights
  for (const sx of [-1, 1]) d.push(part(box(0.34, 0.18, 0.06), C.tail, sx * 0.6, 0.82, -2.02));
  // rear hatch glass
  d.push(part(box(1.2, 0.04, 0.3), C.glass, 0, 0.99, -1.72));
  // exhaust
  d.push(part(cylZ(0.06, 0.25, 8), C.skid, 0.55, 0.4, -2.05));
  // dark wheel wells on the body flanks (fake cut-outs behind the tyres)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const well = new THREE.CylinderGeometry(0.44, 0.44, 0.02, 10, 1, false, 0, Math.PI);
    well.rotateZ(Math.PI / 2);
    d.push(part(well, '#17181c', sx * 0.885, WHEEL_R + 0.02, sz * WZ));
  }
  // sills (dark side skirts)
  for (const sx of [-1, 1]) d.push(part(box(0.06, 0.16, 1.4), C.dark, sx * 0.9, 0.5, 0));

  // hood light pod with 4 round lamps
  const hoodY = (z) => 0.78 + (1.93 - z) / (1.93 - 1.05) * (0.93 - 0.78) + 0.07;
  const podZ = 1.62;
  const pod = box(1.16, 0.2, 0.2);
  d.push(part(pod, C.dark, 0, hoodY(podZ) + 0.1, podZ));
  for (let k = 0; k < 4; k++) {
    const lx = -0.42 + k * 0.28;
    d.push(part(cylZ(0.1, 0.06, 10), C.lamp, lx, hoodY(podZ) + 0.11, podZ + 0.12));
  }

  // twin racing stripes: hood (follows rake), roof, rear deck
  const hoodAng = Math.atan2(0.15, 1.93 - 1.05);
  for (const sx of [-1, 1]) {
    const hs = box(0.16, 0.02, 0.62); hs.rotateX(hoodAng);
    d.push(part(hs, C.stripe, sx * 0.16, hoodY(1.22) + 0.005, 1.22));
    d.push(part(box(0.16, 0.02, 1.52), C.stripe, sx * 0.16, 1.585, -0.77));
    const ws = box(0.16, 0.02, 0.42); d.push(part(ws, C.stripe, sx * 0.16, 1.735, -1.72));
  }

  // door number roundels
  for (const sx of [-1, 1]) {
    const x = sx * 0.94;
    d.push(part(cylX(0.27, 0.02, 16), C.stripe, x, 0.7, -0.1));
    // a bold "7" from two bars
    const top = box(0.02, 0.06, 0.24); d.push(part(top, C.number, x + sx * 0.012, 0.8, -0.1));
    const diag = box(0.02, 0.3, 0.07); diag.rotateX(-sx * 0.45); d.push(part(diag, C.number, x + sx * 0.012, 0.66, -0.1 - sx * 0.05));
  }

  // rear wing struts + end plates
  for (const sx of [-1, 1]) {
    d.push(part(box(0.06, 0.2, 0.12), C.dark, sx * 0.5, 1.6, -1.66));
    d.push(part(box(0.04, 0.2, 0.46), C.dark, sx * 0.84, 1.7, -1.72));
  }

  // mud flaps behind each wheel
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    d.push(part(box(0.3, 0.3, 0.03), C.flap, sx * WX, 0.27, sz * WZ - 0.5));
  }
  return { paint: merge(paint), detail: merge(d) };
}

function buildWheel(side) {
  const parts = [];
  parts.push(part(cylX(WHEEL_R, 0.26, 14), C.tyre));
  parts.push(part(cylX(WHEEL_R * 0.92, 0.28, 14), C.tyre)); // sidewall shoulder
  parts.push(part(cylX(0.21, 0.04, 10), C.hub, 0.13, 0, 0));
  parts.push(part(box(0.03, 0.36, 0.06), C.dark, 0.155, 0, 0));
  parts.push(part(box(0.03, 0.06, 0.36), C.dark, 0.155, 0, 0));
  parts.push(part(cylX(0.06, 0.05, 8), C.hub, 0.16, 0, 0));
  const g = merge(parts);
  if (side < 0) g.rotateY(Math.PI); // hub faces outward on the right-hand wheels
  return g;
}

export class Car {
  constructor() {
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.body = new THREE.Group();
    this.body.position.y = BODY_PIVOT;
    this.group.add(this.body);

    const shell = buildShell();
    this.paintMat = new THREE.MeshLambertMaterial({ color: PAINTS[0].hex, flatShading: true, side: THREE.DoubleSide });
    this.detailMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    shell.paint.translate(0, -BODY_PIVOT, 0);
    shell.detail.translate(0, -BODY_PIVOT, 0);
    const pm = new THREE.Mesh(shell.paint, this.paintMat);
    const dm = new THREE.Mesh(shell.detail, this.detailMat);
    pm.castShadow = dm.castShadow = true;
    pm.receiveShadow = dm.receiveShadow = true;
    this.body.add(pm, dm);

    const wl = buildWheel(1), wr = buildWheel(-1);
    this.wheels = [];
    this.wheelPivots = [];
    const pos = [[WX, WZ], [-WX, WZ], [WX, -WZ], [-WX, -WZ]];
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      pivot.position.set(pos[i][0], WHEEL_R, pos[i][1]);
      const m = new THREE.Mesh(pos[i][0] > 0 ? wl : wr, this.detailMat);
      m.castShadow = true;
      pivot.add(m);
      this.group.add(pivot);
      this.wheels.push(m);
      this.wheelPivots.push(pivot);
    }
    this.wheelLocal = pos;

    this.x = 0; this.y = 0; this.z = 0; this.yaw = 0;
    this.vx = 0; this.vz = 0; this.vy = 0; this.yawRate = 0;
    this.speed = 0; this.vf = 0; this.slip = 0; this.steer = 0;
    this.idx = 0; this.roadDist = 0; this.offroad = 0; this.grounded = true;
    this.impact = 0; this.rpm = 0.25; this.gear = 1; this.throttle = 0;
    this.time = 0;
    this.aLat = 0; this.aLong = 0;   // low-passed accelerations (m/s^2), lateral +left
    this.drift = 0;                  // 0..1 player-initiated slide state
    this.driftAngle = 0;             // signed angle velocity vs heading (rad)
    // interpolated render pose (what the group shows; use for cameras for jitter-free motion)
    this.rx = 0; this.ry = 0; this.rz = 0; this.ryaw = 0;
    this._stage = null;
    this._sIn = 0;                   // smoothed normalised steering -1..1
    this._thrAvg = 0;
    this._prev = { x: 0, y: 0, z: 0, yaw: 0 };
    this._vt = 0; this._lastDt = FIXED_DT;
    this._pitch = 0; this._roll = 0;
    this._bRoll = 0; this._bRollV = 0; this._bPitch = 0; this._bPitchV = 0; this._bob = 0; this._bobV = 0;
    this._wheelH = [0, 0, 0, 0];
    this._land = 0;
  }

  setPaint(hex) { this.paintMat.color.set(hex); }

  reset(stage, idx) {
    this._stage = stage;
    idx = clamp(Math.round(idx), 0, stage.n - 1);
    this.x = stage.sx[idx]; this.z = stage.sz[idx];
    this.yaw = Math.atan2(stage.tx[idx], stage.tz[idx]);
    this.y = stage.height(this.x, this.z);
    this.vx = this.vz = this.vy = 0; this.yawRate = 0;
    this.speed = this.vf = this.slip = 0; this.steer = 0; this._sIn = 0;
    this.idx = idx; this.roadDist = 0; this.offroad = 0; this.grounded = true;
    this.impact = 0; this.rpm = 0.25; this.gear = 1; this.throttle = 0; this._thrAvg = 0;
    this.aLat = this.aLong = 0; this.drift = 0; this.driftAngle = 0;
    this._bRoll = this._bRollV = this._bPitch = this._bPitchV = this._bob = this._bobV = 0;
    this._prev.x = this.x; this._prev.y = this.y; this._prev.z = this.z; this._prev.yaw = this.yaw;
    this._vt = this.time;
    this._poseFromGround(this.x, this.z, this.yaw, true);
    this._writePose(1);
  }

  step(dt, input, stage) {
    this._stage = stage;
    const P = this._prev; P.x = this.x; P.y = this.y; P.z = this.z; P.yaw = this.yaw;
    this.time += dt; this._lastDt = dt;
    const thr = clamp(input.throttle || 0, 0, 1), brk = clamp(input.brake || 0, 0, 1);
    const hand = !!input.hand, sIn = clamp(input.steer || 0, -1, 1);
    const prevThr = this._thrAvg;
    this.throttle = thr;
    this._thrAvg += (thr - this._thrAvg) * Math.min(1, 4 * dt);

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const fx = sy, fz = cy, lx = cy, lz = -sy;
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * lx + this.vz * lz;
    const speed = Math.hypot(this.vx, this.vz);

    const n = stage.nearest(this.x, this.z, this.idx);
    if (n) { this.idx = n.i; this.roadDist = n.d; } else this.roadDist = 99;
    const off = this.offroad = smoothstep(ROAD_HALF + 0.5, ROAD_HALF + 5, this.roadDist);

    // ground
    const h = stage.height(this.x, this.z);
    const hF = stage.height(this.x + fx * 1.5, this.z + fz * 1.5);
    const hB = stage.height(this.x - fx * 1.5, this.z - fz * 1.5);
    const slope = clamp((hF - hB) / 3, -0.6, 0.6);
    const vSurf = vf * slope;
    const contact = this.grounded || this.y - h < 0.15;

    // steering: normalised input ramps in smoothly (slower at speed), returns to centre quickly
    const sp01 = Math.min(1, speed / 40);
    const s0 = this._sIn;
    const into = sIn !== 0 && Math.sign(sIn) === Math.sign(s0 || sIn) && Math.abs(sIn) >= Math.abs(s0);
    const rate = into ? 5.5 - 2.5 * sp01 : 9;
    this._sIn += clamp(sIn - s0, -rate * dt, rate * dt);
    const sN = this._sIn;
    const maxSteer = 0.55 - 0.40 * Math.min(1, speed / 42);
    this.steer = sN * maxSteer;

    const grip = stage.def.grip;
    const baseLat = GRIP * grip * (1 - 0.25 * off);
    let aLong = 0, aLat = 0;
    let beta = Math.atan2(vl, Math.abs(vf) + 1.5);
    if (contact) {
      // ---- longitudinal ----
      let drive = 0, decel = 0;
      if (vf > -1) drive += thr * POWER * Math.max(0, 1 - vf / VMAX);
      else drive += thr * 14;
      if (brk > 0) {
        if (vf > 1) decel += brk * BRAKE;
        else if (vf > -REV_MAX) drive -= brk * REV_ACC * Math.min(1, (vf + REV_MAX) / 2);
      }
      if (hand) decel += HAND_DEC;
      if (thr < 0.05 && vf > 2) decel += 1.1 + 0.025 * vf; // engine braking
      decel += 0.25 + Math.abs(vf) * (0.03 + 0.17 * off) + off * 1.2;
      drive -= 9.81 * slope * 0.7;
      const v0 = vf;
      vf += drive * dt;
      const sg = Math.sign(vf), m = Math.abs(vf) - decel * dt;
      vf = m > 0 ? sg * m : 0;
      const longUse = Math.abs(vf - v0) / dt;

      // ---- drift state: only the player's actions start a slide ----
      const fast = clamp((speed - 9) / 6, 0, 1);
      const turning = Math.abs(sN) > 0.4;
      let d = this.drift;
      if (prevThr > 0.6 && thr < 0.2 && turning) d = Math.max(d, 0.55 * fast);       // lift-off oversteer
      if (brk > 0.3 && vf > 1 && turning) d += (0.5 * brk * fast - d) * Math.min(1, 3 * dt) * (d < 0.5 * brk * fast ? 1 : 0); // trail-brake rotation
      if (hand && speed > 4) d += (1 - d) * Math.min(1, 6 * dt);                        // handbrake
      if (thr > 0.8 && turning && speed > 7) d += thr * (1.1 - grip) * (this.gear <= 2 ? 1.4 : 0.7) * dt; // power oversteer on loose surfaces
      const holding = thr > 0.4 && Math.abs(beta) > 0.1 && turning && Math.sign(sN) === Math.sign(this.yawRate);
      if (holding && !hand) d = Math.max(d, Math.min(this.drift, 0.6)) - 0.08 * dt;
      else if (!hand) d *= Math.exp(-(sN === 0 ? 2.8 : 1.6) * dt);
      this.drift = d = clamp(d, 0, 1);

      // ---- lateral grip with traction circle ----
      const use = Math.min(1, longUse / (13 * grip));
      let maxLat = baseLat * (1 - 0.3 * use * use) * (1 - 0.2 * d);
      if (hand) maxLat *= 0.45;
      if (thr > 0.5 && Math.abs(vl) > 1.5) maxLat *= 0.9;
      aLat = clamp(-vl * 14, -maxLat, maxLat);
      vl += aLat * dt;

      // ---- yaw: proportional to steering, speed-limited near the grip limit ----
      const av = Math.max(Math.abs(vf), 4);
      const wKin = Math.abs(vf) * Math.tan(maxSteer) / WB;
      const wGrip = baseLat / av * (1.06 + 0.95 * d + (hand ? 0.6 : 0));
      const wMax = Math.min(wKin * (hand ? 1.35 : 1), wGrip);
      let target = sN * wMax * Math.sign(vf || 1);
      // self-aligning toward the velocity; weaker while the slide is held on throttle,
      // stronger (counter-steer assist) when the player isn't steering into the slide
      const intoSlide = sN !== 0 && Math.sign(sN) === -Math.sign(beta);
      let align = 1.6 - 0.7 * d * thr;
      if (!intoSlide) align += 1.2;
      target += beta * align * Math.min(1, speed / 3);
      // anti-spin: hard limit on slide angle
      const bLim = hand ? 1.2 : 0.75;
      if (Math.abs(beta) > bLim) target += Math.sign(beta) * (Math.abs(beta) - bLim) * 6;
      this.yawRate += (target - this.yawRate) * Math.min(1, 10 * dt);
      aLong = (vf - v0) / dt;
    } else {
      this.yawRate *= 1 - 0.4 * dt;
      this.drift *= Math.exp(-1 * dt);
    }
    this.aLong += (aLong - this.aLong) * Math.min(1, 6 * dt);
    this.aLat += (aLat - this.aLat) * Math.min(1, 6 * dt);

    // recompose with pre-yaw axes
    this.vx = fx * vf + lx * vl;
    this.vz = fz * vf + lz * vl;
    this.yaw += this.yawRate * dt;
    if (this.yaw > Math.PI) { this.yaw -= Math.PI * 2; P.yaw -= Math.PI * 2; }
    else if (this.yaw < -Math.PI) { this.yaw += Math.PI * 2; P.yaw += Math.PI * 2; }
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this._collide(stage);

    // vertical
    const h2 = stage.height(this.x, this.z);
    if (this.grounded) {
      const yFree = this.y + this.vy * dt - GRAV * dt * dt;
      if (h2 < yFree - 0.004 && speed > 12) {
        this.grounded = false;
        this.y = yFree; this.vy -= GRAV * dt;
      } else {
        this.y = h2; this.vy = vSurf;
      }
    } else {
      this.vy -= GRAV * dt;
      this.y += this.vy * dt;
      if (this.y <= h2) {
        const hit = vSurf - this.vy;
        this.y = h2;
        this.vy = vSurf;
        this.grounded = true;
        if (hit > 4) {
          this.impact = Math.max(this.impact, hit * 0.5);
          const k = 1 - Math.min(0.15, (hit - 4) * 0.015);
          this.vx *= k; this.vz *= k;
        }
        this._land = Math.max(this._land, hit);
      }
    }

    if (!Number.isFinite(this.x + this.z + this.y + this.vx + this.vz + this.vy + this.yaw + this.yawRate)) {
      this.reset(stage, this.idx);
      return;
    }

    // derived
    this.speed = Math.hypot(this.vx, this.vz);
    const f2x = Math.sin(this.yaw), f2z = Math.cos(this.yaw);
    this.vf = this.vx * f2x + this.vz * f2z;
    const vl2 = this.vx * f2z - this.vz * f2x;
    this.slip = Math.abs(vl2);
    this.driftAngle = this.speed > 2 ? Math.atan2(vl2, Math.abs(this.vf)) : 0;

    // fake gearbox
    const v = Math.abs(this.vf);
    if (this.vf < -0.5 && brk > 0 && thr < 0.1) this.gear = 0;
    else {
      if (this.gear === 0) this.gear = 1;
      while (this.gear < 5 && v > GEAR_TOP[this.gear]) this.gear++;
      while (this.gear > 1 && v < GEAR_TOP[this.gear - 1] - 2.5) this.gear--;
    }
    let rpmT;
    if (this.gear === 0) rpmT = 0.25 + 0.75 * Math.min(1, v / REV_MAX);
    else {
      const lo = this.gear === 1 ? 0 : GEAR_TOP[this.gear - 1] - 2.5, hi = GEAR_TOP[this.gear];
      rpmT = 0.25 + 0.75 * clamp((v - lo) / (hi - lo), 0, 1);
    }
    if (!contact || this.slip > 4) rpmT = Math.max(rpmT, 0.3 + 0.6 * thr);
    if (this.gear === 1 && v < 4) rpmT = Math.max(rpmT, 0.25 + 0.45 * thr);
    this.rpm += (rpmT - this.rpm) * Math.min(1, 14 * dt);
  }

  // two circles (front / rear axle) against the stage's round obstacles
  _collide(stage) {
    for (let k = 0; k < 2; k++) {
      const arm = k === 0 ? 1.15 : -1.15;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const cx = this.x + fx * arm, cz = this.z + fz * arm;
      stage.collide(cx, cz, 0.95, (o, dx, dz, rr) => {
        const d = Math.hypot(dx, dz) || 1e-3, nx = dx / d, nz = dz / d;
        const pen = rr - d;
        this.x += nx * pen; this.z += nz * pen;
        // velocity of the contact point (includes rotation)
        const pvx = this.vx + this.yawRate * fz * arm, pvz = this.vz - this.yawRate * fx * arm;
        const vn = pvx * nx + pvz * nz;
        if (vn >= 0) return;
        const before = Math.hypot(this.vx, this.vz);
        const head = clamp(-vn / Math.max(before, 1), 0, 1); // 1 = head-on, 0 = grazing
        // remove the normal component with a small bounce
        const jn = -(1 + 0.25) * vn;
        this.vx += jn * nx; this.vz += jn * nz;
        // scrub the tangential part: little when grazing, a lot head-on
        const tvn = this.vx * nx + this.vz * nz;
        const tx = this.vx - tvn * nx, tz = this.vz - tvn * nz;
        const keep = 1 - 0.85 * head * head - 0.06;
        this.vx = tvn * nx + tx * keep; this.vz = tvn * nz + tz * keep;
        // yaw from the off-centre hit, bounded
        const cross = (fx * arm) * nz - (fz * arm) * nx; // r x n (y component sign)
        this.yawRate = clamp(this.yawRate - cross * jn * 0.12, -2.5, 2.5);
        this.drift *= 0.5;
        const lost = before - Math.hypot(this.vx, this.vz);
        if (lost > 0.5) this.impact = Math.max(this.impact, lost);
      });
    }
  }

  _poseFromGround(x, z, yaw, snap) {
    const st = this._stage; if (!st) return null;
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    for (let i = 0; i < 4; i++) {
      const [ax, az] = this.wheelLocal[i];
      this._wheelH[i] = st.height(x + cy * ax + sy * az, z - sy * ax + cy * az);
    }
    const [hFL, hFR, hRL, hRR] = this._wheelH;
    const pitch = clamp(Math.atan2((hRL + hRR) - (hFL + hFR), 2 * 2 * WZ), -0.4, 0.4);
    const roll = clamp(Math.atan2((hFL + hRL) - (hFR + hRR), 2 * 2 * WX), -0.4, 0.4);
    if (snap) { this._pitch = pitch; this._roll = roll; }
    return [pitch, roll];
  }

  _writePose(alpha) {
    const P = this._prev;
    let dy = this.yaw - P.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.rx = P.x + (this.x - P.x) * alpha;
    this.ry = P.y + (this.y - P.y) * alpha;
    this.rz = P.z + (this.z - P.z) * alpha;
    this.ryaw = P.yaw + dy * alpha;
    this.group.position.set(this.rx, this.ry, this.rz);
    this.group.rotation.set(this._pitch, this.ryaw, this._roll);
  }

  updateVisual(dt) {
    dt = clamp(dt || 0, 0, 0.1);
    // interpolate between the last two physics states (render lags physics by < 1 step)
    this._vt = clamp(this._vt + dt, this.time - this._lastDt, this.time);
    const alpha = clamp(1 - (this.time - this._vt) / this._lastDt, 0, 1);

    // integrate the cosmetic springs in small fixed sub-steps so low frame rates stay stable
    const rT = clamp(this.aLat * 0.009, -MAX_ROLL, MAX_ROLL);
    const pT = clamp(-this.aLong * 0.005, -MAX_PITCH, MAX_PITCH);
    if (this._land > 0) { this._bobV -= Math.min(this._land, 12) * 0.2; this._land = 0; }
    const rough = this.speed * (0.0015 + 0.008 * this.offroad);
    const subs = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / subs;
    for (let i = 0; i < subs; i++) {
      this._bRollV += ((rT - this._bRoll) * 110 - this._bRollV * 15) * h;
      this._bRoll += this._bRollV * h;
      this._bPitchV += ((pT - this._bPitch) * 110 - this._bPitchV * 15) * h;
      this._bPitch += this._bPitchV * h;
      this._bobV += (-this._bob * 220 - this._bobV * 16) * h;
      this._bob += this._bobV * h;
    }
    this._bobV += (Math.random() - 0.5) * rough * Math.min(1, dt * 60);
    this._bRoll = clamp(this._bRoll, -MAX_ROLL, MAX_ROLL);
    this._bPitch = clamp(this._bPitch, -MAX_PITCH, MAX_PITCH);
    this._bob = clamp(this._bob, -0.1, 0.06);
    if (!Number.isFinite(this._bRoll + this._bRollV + this._bPitch + this._bPitchV + this._bob + this._bobV)) {
      this._bRoll = this._bRollV = this._bPitch = this._bPitchV = this._bob = this._bobV = 0;
    }

    // terrain pitch/roll from the four wheel contact heights
    const P = this._prev;
    const ix = P.x + (this.x - P.x) * alpha, iz = P.z + (this.z - P.z) * alpha;
    let dy = this.yaw - P.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const k = 1 - Math.exp(-14 * dt);
    if (this.grounded) {
      const pr = this._poseFromGround(ix, iz, P.yaw + dy * alpha, false);
      if (pr) { this._pitch += (pr[0] - this._pitch) * k; this._roll += (pr[1] - this._roll) * k; }
    } else {
      this._pitch = clamp(this._pitch + 0.2 * dt, -0.4, 0.3);
      this._roll *= Math.exp(-1.5 * dt);
    }
    this._writePose(alpha);
    this.body.rotation.set(this._bPitch, 0, this._bRoll);
    this.body.position.y = BODY_PIVOT + this._bob;

    // wheels
    const spin = this.grounded ? this.vf / WHEEL_R : this.throttle * 40;
    for (let i = 0; i < 4; i++) {
      this.wheels[i].rotation.x = (this.wheels[i].rotation.x + spin * dt) % (Math.PI * 2);
      if (i < 2) this.wheelPivots[i].rotation.y = this.steer;
    }
  }

  wheelWorld(i, target = new THREE.Vector3()) {
    const [ax, az] = this.wheelLocal[i];
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const h = this.grounded ? this._wheelH[i] || this.y : this.y;
    return target.set(this.x + cy * ax + sy * az, h, this.z - sy * ax + cy * az);
  }
}

// ---------------------------------------------------------------------------
// Autopilot: pure pursuit + curvature-based speed planning
// ---------------------------------------------------------------------------
export function autopilot(car, stage) {
  const st = car._ap || (car._ap = { slowSince: -1, startT: car.time, lastT: car.time });
  // detect a fresh reset / large time discontinuity
  if (car.time < st.lastT) { st.startT = car.time; st.slowSince = -1; }
  st.lastT = car.time;

  // recovery
  if (car.roadDist > 25) { car.reset(stage, car.idx); st.startT = car.time; st.slowSince = -1; car._resets = (car._resets || 0) + 1; }
  if (car.speed < 1 && car.time - st.startT > 1.5) {
    if (st.slowSince < 0) st.slowSince = car.time;
    else if (car.time - st.slowSince > 3) {
      car.reset(stage, Math.min(stage.n - 1, car.idx + 2));
      st.startT = car.time; st.slowSince = -1; car._resets = (car._resets || 0) + 1;
    }
  } else st.slowSince = -1;

  const _ai = { steer: 0, throttle: 0, brake: 0, hand: false };
  const speed = car.speed, i0 = car.idx, N = stage.n;
  const look = clamp(6 + speed * 0.55, 8, 40);
  const j = Math.min(N - 1, i0 + Math.round(look / STEP));
  const ang = Math.atan2(stage.sx[j] - car.x, stage.sz[j] - car.z);
  let diff = ang - car.yaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  _ai.steer = clamp(diff * 2.2, -1, 1);

  // speed plan: allowed speed at each upcoming sample, relaxed by braking distance
  const maxLat = GRIP * stage.def.grip;
  const span = Math.round((15 + speed * 1.6) / STEP);
  let vT = 60;
  for (let k = 0; k <= span; k++) {
    const i = Math.min(N - 1, i0 + k);
    const c = Math.abs(stage.curv[i]);
    const vc = c > 1e-4 ? Math.sqrt(maxLat * 0.75 / c) : 60;
    const v = Math.sqrt(vc * vc + 2 * 9 * k * STEP);
    if (v < vT) vT = v;
  }
  // get back onto the road gently when off it
  if (car.roadDist > ROAD_HALF + 1) vT = Math.min(vT, 18);
  vT = Math.max(vT, 7);

  if (speed < vT) { _ai.throttle = clamp((vT - speed) * 0.6 + 0.3, 0, 1); _ai.brake = 0; }
  else if (speed > vT + 2) { _ai.throttle = 0; _ai.brake = clamp((speed - vT - 2) * 0.35, 0.2, 1); }
  else { _ai.throttle = 0.25; _ai.brake = 0; }
  if (car.idx >= stage.finishIdx + 3) { _ai.throttle = 0; _ai.brake = 1; }
  _ai.hand = false;
  return _ai;
}
