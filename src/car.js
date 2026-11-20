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
const POWER = 11, VMAX = 52, BRAKE = 17, REV_ACC = 6, REV_MAX = 9, HAND_DEC = 5;
const GRIP = 10.5, GRAV = 20, WB = 2.5;
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

const _v = new THREE.Vector3();

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
    this.aLat = 0; this.aLong = 0;
    this._stage = null;
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
    this.speed = this.vf = this.slip = 0; this.steer = 0;
    this.idx = idx; this.roadDist = 0; this.offroad = 0; this.grounded = true;
    this.impact = 0; this.rpm = 0.25; this.gear = 1; this.throttle = 0;
    this.aLat = this.aLong = 0;
    this._bRoll = this._bRollV = this._bPitch = this._bPitchV = this._bob = this._bobV = 0;
    this._poseFromGround(true);
  }

  step(dt, input, stage) {
    this._stage = stage;
    this.time += dt;
    const thr = clamp(input.throttle || 0, 0, 1), brk = clamp(input.brake || 0, 0, 1);
    const hand = !!input.hand, sIn = clamp(input.steer || 0, -1, 1);
    this.throttle = thr;

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
    const slope = (hF - hB) / 3;
    const vSurf = vf * slope;
    const contact = this.grounded || this.y - h < 0.15;

    // steering
    const maxSteer = 0.55 - 0.40 * Math.min(1, speed / 42);
    this.steer += (sIn * maxSteer - this.steer) * Math.min(1, 7 * dt);

    const grip = stage.def.grip;
    const maxLatNH = GRIP * grip * (1 - 0.25 * off);
    let aLong = 0, aLat = 0;
    if (contact) {
      // longitudinal
      let drive = 0, decel = 0;
      if (vf > -1) drive += thr * POWER * Math.max(0, 1 - vf / VMAX);
      else drive += thr * 14;
      if (brk > 0) {
        if (vf > 1) decel += brk * BRAKE;
        else if (vf > -REV_MAX) drive -= brk * REV_ACC * Math.min(1, (vf + REV_MAX) / 2);
      }
      if (hand) decel += HAND_DEC;
      decel += 0.25 + Math.abs(vf) * (0.03 + 0.33 * off);
      drive -= 9.81 * slope * 0.7;
      const v0 = vf;
      vf += drive * dt;
      const s = Math.sign(vf), m = Math.abs(vf) - decel * dt;
      // only let decel bring vf to zero (don't flip direction), unless drive pushes through
      vf = m > 0 ? s * m : 0;
      aLong = (vf - v0) / dt;

      // lateral grip
      const maxLat = maxLatNH * (hand ? 0.4 : 1) * (thr > 0.5 && Math.abs(vl) > 1.5 ? 0.85 : 1);
      aLat = clamp(-vl * 14, -maxLat, maxLat);
      vl += aLat * dt;

      // yaw
      let w = vf * Math.tan(this.steer) / WB * (hand ? 1.35 : 1);
      const lim = 1.8 * maxLatNH / Math.max(Math.abs(vf), 4);
      w = clamp(w, -lim, lim);
      const beta = Math.atan2(vl, Math.abs(vf) + 2);
      const target = w + beta * 1.5 * Math.min(1, speed / 3);
      this.yawRate += (target - this.yawRate) * Math.min(1, 9 * dt);
    } else {
      this.yawRate *= 1 - 0.4 * dt;
    }
    this.aLong = aLong; this.aLat = aLat;

    // recompose with pre-yaw axes
    this.vx = fx * vf + lx * vl;
    this.vz = fz * vf + lz * vl;
    this.yaw += this.yawRate * dt;
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2; else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // obstacles
    stage.collide(this.x, this.z, 1.1, (o, dx, dz, rr) => {
      const d = Math.hypot(dx, dz) || 1e-3, nx = dx / d, nz = dz / d;
      const pen = rr - d;
      this.x += nx * pen; this.z += nz * pen;
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) {
        const before = Math.hypot(this.vx, this.vz);
        this.vx -= 1.3 * vn * nx; this.vz -= 1.3 * vn * nz;
        const scrub = 1 - 0.4 * Math.min(1, -vn / 4);
        this.vx *= scrub; this.vz *= scrub;
        const lost = before - Math.hypot(this.vx, this.vz);
        // a little spin from glancing blows
        const cross = fx * nz - fz * nx;
        this.yawRate += clamp(cross * -vn * 0.15, -1.5, 1.5);
        if (lost > 0.5) this.impact = Math.max(this.impact, lost);
      }
    });

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

    // guard
    if (!Number.isFinite(this.x + this.z + this.y + this.vx + this.vz + this.vy + this.yaw + this.yawRate)) {
      this.reset(stage, this.idx);
      return;
    }

    // derived
    this.speed = Math.hypot(this.vx, this.vz);
    const f2x = Math.sin(this.yaw), f2z = Math.cos(this.yaw);
    this.vf = this.vx * f2x + this.vz * f2z;
    this.slip = Math.abs(this.vx * f2z - this.vz * f2x);

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

  _poseFromGround(snap) {
    const st = this._stage; if (!st) return;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    for (let i = 0; i < 4; i++) {
      const [ax, az] = this.wheelLocal[i];
      this._wheelH[i] = st.height(this.x + cy * ax + sy * az, this.z - sy * ax + cy * az);
    }
    const [hFL, hFR, hRL, hRR] = this._wheelH;
    const pitch = Math.atan2((hRL + hRR) - (hFL + hFR), 2 * 2 * WZ);
    const roll = Math.atan2((hFL + hRL) - (hFR + hRR), 2 * 2 * WX);
    if (snap) { this._pitch = pitch; this._roll = roll; }
    return [pitch, roll];
  }

  updateVisual(dt) {
    dt = Math.min(dt, 0.1);
    const k = Math.min(1, 12 * dt);
    if (this.grounded) {
      const pr = this._poseFromGround(false);
      if (pr) { this._pitch += (pr[0] - this._pitch) * k; this._roll += (pr[1] - this._roll) * k; }
    } else {
      // in the air the nose slowly drops
      this._pitch = clamp(this._pitch + 0.25 * dt, -0.5, 0.35);
      this._roll *= 1 - 1.5 * dt;
    }
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.set(this._pitch, this.yaw, this._roll);

    // cosmetic body motion: damped springs
    const rT = clamp(this.aLat * 0.011, -0.085, 0.085);
    const pT = clamp(-this.aLong * 0.006, -0.06, 0.07);
    const ks = 160, kd = 16;
    this._bRollV += ((rT - this._bRoll) * ks - this._bRollV * kd) * dt;
    this._bRoll += this._bRollV * dt;
    this._bPitchV += ((pT - this._bPitch) * ks - this._bPitchV * kd) * dt;
    this._bPitch += this._bPitchV * dt;
    if (this._land > 0) { this._bobV -= Math.min(this._land, 12) * 0.25; this._land = 0; }
    const rough = this.speed * (0.004 + 0.02 * this.offroad);
    this._bobV += ((-this._bob) * 220 - this._bobV * 14) * dt + (Math.random() - 0.5) * rough;
    this._bob = clamp(this._bob + this._bobV * dt, -0.12, 0.08);
    this.body.rotation.set(this._bPitch, 0, this._bRoll);
    this.body.position.y = BODY_PIVOT + this._bob;

    // wheels
    const spin = this.grounded ? this.vf / WHEEL_R : this.throttle * 40;
    for (let i = 0; i < 4; i++) {
      this.wheels[i].rotation.x += spin * dt;
      if (i < 2) this.wheelPivots[i].rotation.y = this.steer;
    }
  }

  wheelWorld(i, target = new THREE.Vector3()) {
    const [ax, az] = this.wheelLocal[i];
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const h = this.grounded ? this._wheelH[i] || this.y : this.y;
    return target.set(this.x + cy * ax + sy * az, this.grounded ? h : this.y, this.z - sy * ax + cy * az);
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
