import * as THREE from 'three';
import { ROAD_HALF, STEP, clamp, smoothstep, part, merge } from './track.js';

// ---------------------------------------------------------------------------
// Dustline cars: four original chunky low-poly rally cars sharing one arcade
// physics model, each driven by its own parameter block.
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

// shared constants
const REV_ACC = 6, REV_MAX = 9, GRIP = 10.5, GRAV = 20;
const FIXED_DT = 1 / 120;
const MAX_ROLL = 0.105, MAX_PITCH = 0.07; // cosmetic body lean limits (~6 deg, ~4 deg)

// ---------------------------------------------------------------------------
// Handling blocks. Every number is consumed by the same physics code in Car.step.
// ---------------------------------------------------------------------------
const BASE = {
  power: 13,        // m/s^2 drive at standstill, falls linearly to 0 at vmax
  vmax: 52,         // m/s, drive cut-off (real top speed is lower because of drag)
  brake: 17,        // m/s^2
  handDec: 4,       // handbrake decel m/s^2
  grip: 1,          // multiplies GRIP * stage grip
  latStiff: 14,     // how hard the tyres pull the velocity back to the heading (1/s)
  wb: 2.5,          // physics wheelbase (kinematic yaw)
  lock0: 0.55, lockDrop: 0.40,         // max steer angle = lock0 - lockDrop * min(1, v/42)
  steerIn: 5.5, steerInDrop: 2.5, steerOut: 9, // normalised steering ramp rates (1/s)
  yawMargin: 1.06,  // yaw authority beyond the grip limit with no slide (1 = pure carve)
  driftYaw: 1.5,    // extra yaw authority per unit of drift state
  handYaw: 1.8, handLat: 0.55, // handbrake yaw bonus / lateral grip factor
  liftOff: 0.7, liftRate: 2.2, // lift-off oversteer target and build rate
  trail: 0.4,       // trail-brake rotation target
  powerOS: 0,       // power-oversteer added on top of the loose-surface term
  holdMax: 0.6,     // drift state that throttle + steer can sustain
  driftLatLoss: 0.2,// lateral grip lost per unit drift
  alignBase: 1.45, alignHold: 0.8, assist: 1.2, // self-aligning / counter-steer assist
  betaLim: 0.75,    // slide angle where the anti-spin pull-back starts (rad)
  betaLimDrift: 0,  // extra slide angle allowed per unit drift state (eases handbrake exits)
  yawResp: 10,      // yaw-rate response (1/s)
  mass: 1,          // collision response: lighter bounces/spins more, heavier ploughs on
  gears: [0, 11, 19, 27, 36, 46],
};
const H = (o) => Object.freeze({ ...BASE, ...o });

// stats are derived from measured behaviour (flat test surface, grip 1):
//   speed = (top km/h - 120) / 90, accel = (4.2 - 0-100 s) / 2.2,
//   grip = (full-lock lateral g - 0.8) / 0.5, nudged by power-on rear slip / forgiveness,
//   drift = held-drift angle / 60 deg blended with lift-off angle; rounded to 0.05
export const CARS = [
  {
    id: 'rook', name: 'Rook R7',
    blurb: 'The all-rounder. Planted, honest and happy to slide when you ask it to.',
    stats: { speed: 0.5, accel: 0.4, grip: 0.45, drift: 0.3 }, unlock: 0,
    handling: H({}),
    dims: { wheelR: 0.36, wheelW: 0.26, wx: 0.82, wz: 1.25, wzR: 1.25, pivot: 0.45 },
    build: buildRook,
  },
  {
    id: 'pip', name: 'Pip 66',
    blurb: 'A tiny boxy city runabout. Darts into hairpins, sticks like glue, shrugs off mistakes.',
    stats: { speed: 0.2, accel: 0.2, grip: 0.55, drift: 0.1 }, unlock: 6,
    handling: H({
      power: 13.5, vmax: 42, brake: 18, grip: 1.05, latStiff: 16, wb: 2.05,
      lock0: 0.6, lockDrop: 0.42, steerIn: 7, steerInDrop: 3, steerOut: 11,
      yawMargin: 1.03, driftYaw: 1.0, handYaw: 1.9, handLat: 0.62,
      liftOff: 0.3, liftRate: 1.4, trail: 0.2, powerOS: -0.2, holdMax: 0.35,
      driftLatLoss: 0.12, alignBase: 1.9, alignHold: 0.5, assist: 1.7, betaLim: 0.55, betaLimDrift: 0.7, yawResp: 13,
      mass: 0.75, gears: [0, 10, 17, 24, 31, 39],
    }),
    dims: { wheelR: 0.3, wheelW: 0.22, wx: 0.68, wz: 1.0, wzR: 1.0, pivot: 0.42 },
    build: buildPip,
  },
  {
    id: 'halvard', name: 'Halvard Longtail',
    blurb: 'Long, low and rear-driven. Fast on the straights, loose in the tail. Bring counter-steer.',
    stats: { speed: 0.8, accel: 0.5, grip: 0.4, drift: 0.9 }, unlock: 14,
    handling: H({
      power: 13, vmax: 62, brake: 16, grip: 0.98, latStiff: 11, wb: 2.9,
      lock0: 0.5, lockDrop: 0.38, steerIn: 4.2, steerInDrop: 2, steerOut: 7.5,
      yawMargin: 1.1, driftYaw: 1.9, handYaw: 1.8, handLat: 0.5,
      liftOff: 0.85, liftRate: 2.8, trail: 0.5, powerOS: 0.45, holdMax: 0.8,
      driftLatLoss: 0.25, alignBase: 1.05, alignHold: 0.4, assist: 0.55, betaLim: 0.9, yawResp: 7,
      mass: 1.1, gears: [0, 13, 22, 31, 41, 52],
    }),
    dims: { wheelR: 0.37, wheelW: 0.28, wx: 0.84, wz: 1.5, wzR: 1.4, pivot: 0.42 },
    build: buildHalvard,
  },
  {
    id: 'grendel', name: 'Grendel S',
    blurb: 'A wide-arched, winged monster. Savage pace and huge grip, but it bites hard past the limit.',
    stats: { speed: 0.95, accel: 0.9, grip: 0.85, drift: 0.65 }, unlock: 24,
    handling: H({
      power: 17.5, vmax: 64, brake: 19, grip: 1.14, latStiff: 15, wb: 2.6,
      lock0: 0.55, lockDrop: 0.36, steerIn: 7.5, steerInDrop: 2.5, steerOut: 10,
      yawMargin: 1.12, driftYaw: 1.7, handYaw: 1.8, handLat: 0.5,
      liftOff: 0.8, liftRate: 3.0, trail: 0.5, powerOS: 0.2, holdMax: 0.7,
      driftLatLoss: 0.35, alignBase: 1.25, alignHold: 0.8, assist: 0.8, betaLim: 0.85, yawResp: 14,
      mass: 1.3, gears: [0, 14, 24, 34, 44, 55],
    }),
    dims: { wheelR: 0.4, wheelW: 0.3, wx: 0.9, wz: 1.3, wzR: 1.3, pivot: 0.48 },
    build: buildGrendel,
  },
];
const carDef = (id) => CARS.find((c) => c.id === id) || CARS[0];

const C = {
  dark: '#2b2c33', trim: '#3a3c45', glass: '#26313d', glassHi: '#3a4a5a', light: '#fff4d6', lamp: '#fff8e6',
  tail: '#d8252b', amber: '#f39a2b', stripe: '#f3efe4', tyre: '#1f2024', hub: '#d8d4c8', flap: '#c62c2c',
  skid: '#8a8d94', number: '#22232a', well: '#17181c',
};

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------
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
// side profile (z, y) extruded across width W (centred on x = 0)
function profileBody(prof, W, BV = 0.07) {
  const s = new THREE.Shape();
  s.moveTo(prof[0][0], prof[0][1]);
  for (let i = 1; i < prof.length; i++) s.lineTo(prof[i][0], prof[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: BV > 0, bevelThickness: BV, bevelSize: BV, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -W / 2);
  g.rotateY(-Math.PI / 2); // shape x -> world z, extrusion -> world x
  return g;
}
// thick half-annulus fender lips over each wheel (paint) + dark wells on the flank (detail)
function roundArches(paint, d, dm, rOut, rIn, depth, xIn, wellX) {
  const arch = new THREE.Shape();
  arch.absarc(0, 0, rOut, 0, Math.PI, false);
  arch.absarc(0, 0, rIn, Math.PI, 0, true);
  const archG = new THREE.ExtrudeGeometry(arch, { depth, bevelEnabled: false, curveSegments: 5 });
  archG.rotateY(-Math.PI / 2); // depth spans x in [-depth, 0]
  for (const sx of [-1, 1]) for (const [sz, wz] of [[1, dm.wz], [-1, dm.wzR]]) {
    const g = archG.clone(); g.translate(sx > 0 ? depth : 0, 0, 0);
    paint.push(part(g, '#fff', sx * xIn, dm.wheelR + 0.02, sz * wz));
    const well = new THREE.CylinderGeometry(rIn + 0.01, rIn + 0.01, 0.02, 10, 1, false, 0, Math.PI);
    well.rotateZ(Math.PI / 2);
    d.push(part(well, C.well, sx * wellX, dm.wheelR + 0.02, sz * wz));
  }
}
function mudFlaps(d, dm, w = 0.3, h = 0.3) {
  for (const sx of [-1, 1]) for (const [sz, wz] of [[1, dm.wz], [-1, dm.wzR]]) {
    d.push(part(box(w, h, 0.03), C.flap, sx * dm.wx, h * 0.5 + 0.12, sz * wz - dm.wheelR - 0.14));
  }
}
function roundel(d, x, y, z, sx, r = 0.27) {
  d.push(part(cylX(r, 0.02, 16), C.stripe, x, y, z));
  const k = r / 0.27;
  d.push(part(box(0.02, 0.06 * k, 0.24 * k), C.number, x + sx * 0.012, y + 0.1 * k, z));
  const diag = box(0.02, 0.3 * k, 0.07 * k); diag.rotateX(-sx * 0.45);
  d.push(part(diag, C.number, x + sx * 0.012, y - 0.04 * k, z - sx * 0.05 * k));
}

// ---- 1. Rook R7: the original chunky rally hatchback --------------------------
function buildRook(dm) {
  const paint = [], d = [];
  paint.push(part(profileBody([
    [-1.9, 0.42], [1.86, 0.42], [1.96, 0.56], [1.93, 0.78], [1.05, 0.93],
    [-1.62, 0.98], [-1.9, 0.9], [-1.95, 0.6],
  ], 1.6), '#fff'));
  roundArches(paint, d, dm, 0.54, 0.43, 0.16, 0.82, 0.885);
  paint.push(part(frustum(1.36, 1.72, 1.24, 1.5, 0.07, -0.05), '#fff', 0, 1.5, -0.72)); // roof panel
  paint.push(part(box(1.66, 0.06, 0.42), '#fff', 0, 1.7, -1.72));                      // wing plate
  for (const sx of [-1, 1]) paint.push(part(box(0.12, 0.1, 0.16), '#fff', sx * 0.9, 1.06, 0.74));

  d.push(part(frustum(1.6, 2.7, 1.3, 1.72, 0.55, -0.22), C.glass, 0, 0.95, -0.4));
  d.push(part(box(1.62, 0.04, 2.64), C.trim, 0, 0.97, -0.4));
  d.push(part(box(1.86, 0.26, 0.3), C.dark, 0, 0.47, 1.95));
  d.push(part(box(1.86, 0.28, 0.28), C.dark, 0, 0.5, -1.98));
  d.push(part(box(1.3, 0.06, 0.6), C.skid, 0, 0.36, 1.7));
  d.push(part(box(0.7, 0.16, 0.06), C.dark, 0, 0.7, 2.0));
  for (const sx of [-1, 1]) {
    d.push(part(box(0.38, 0.17, 0.06), C.light, sx * 0.58, 0.7, 2.0));
    d.push(part(box(0.18, 0.08, 0.05), C.amber, sx * 0.62, 0.57, 2.1));
    d.push(part(box(0.34, 0.18, 0.06), C.tail, sx * 0.6, 0.82, -2.02));
  }
  d.push(part(box(1.2, 0.04, 0.3), C.glass, 0, 0.99, -1.72));
  d.push(part(cylZ(0.06, 0.25, 8), C.skid, 0.55, 0.4, -2.05));
  for (const sx of [-1, 1]) d.push(part(box(0.06, 0.16, 1.4), C.dark, sx * 0.9, 0.5, 0));
  // hood light pod with 4 round lamps
  const hoodY = (z) => 0.78 + (1.93 - z) / (1.93 - 1.05) * (0.93 - 0.78) + 0.07;
  const podZ = 1.62;
  d.push(part(box(1.16, 0.2, 0.2), C.dark, 0, hoodY(podZ) + 0.1, podZ));
  for (let k = 0; k < 4; k++) d.push(part(cylZ(0.1, 0.06, 10), C.lamp, -0.42 + k * 0.28, hoodY(podZ) + 0.11, podZ + 0.12));
  // twin racing stripes
  const hoodAng = Math.atan2(0.15, 1.93 - 1.05);
  for (const sx of [-1, 1]) {
    const hs = box(0.16, 0.02, 0.62); hs.rotateX(hoodAng);
    d.push(part(hs, C.stripe, sx * 0.16, hoodY(1.22) + 0.005, 1.22));
    d.push(part(box(0.16, 0.02, 1.52), C.stripe, sx * 0.16, 1.585, -0.77));
    d.push(part(box(0.16, 0.02, 0.42), C.stripe, sx * 0.16, 1.735, -1.72));
  }
  for (const sx of [-1, 1]) roundel(d, sx * 0.94, 0.7, -0.1, sx);
  for (const sx of [-1, 1]) {
    d.push(part(box(0.06, 0.2, 0.12), C.dark, sx * 0.5, 1.6, -1.66));
    d.push(part(box(0.04, 0.2, 0.46), C.dark, sx * 0.84, 1.7, -1.72));
  }
  mudFlaps(d, dm);
  return { paint, d };
}

// ---- 2. Pip 66: tall short city box with a white roof and roof basket ---------
function buildPip(dm) {
  const paint = [], d = [];
  paint.push(part(profileBody([
    [-1.52, 0.34], [1.5, 0.34], [1.6, 0.46], [1.58, 0.76], [1.2, 0.9],
    [-1.5, 0.94], [-1.6, 0.86], [-1.6, 0.46],
  ], 1.38, 0.06), '#fff'));
  roundArches(paint, d, dm, 0.44, 0.35, 0.12, 0.7, 0.755);
  for (const sx of [-1, 1]) paint.push(part(box(0.1, 0.09, 0.14), '#fff', sx * 0.76, 0.98, 0.9));
  // tall upright glasshouse, two-tone off-white roof
  d.push(part(frustum(1.42, 2.6, 1.32, 2.3, 0.68, -0.08), C.glass, 0, 0.92, -0.22));
  d.push(part(box(1.44, 0.04, 2.58), C.trim, 0, 0.94, -0.22));
  d.push(part(frustum(1.38, 2.36, 1.3, 2.2, 0.07), C.stripe, 0, 1.6, -0.3));
  // roof basket
  for (const sx of [-1, 1]) d.push(part(box(0.05, 0.05, 1.7), C.dark, sx * 0.55, 1.75, -0.3));
  for (const z of [0.45, -0.3, -1.05]) d.push(part(box(1.14, 0.05, 0.05), C.dark, 0, 1.75, z));
  for (const sx of [-1, 1]) for (const z of [0.45, -1.05]) d.push(part(box(0.05, 0.1, 0.05), C.dark, sx * 0.55, 1.7, z));
  d.push(part(box(0.9, 0.18, 0.5), '#5a4a3a', 0, 1.86, -0.5)); // a strapped spare-parts crate
  // little roof spoiler
  d.push(part(box(1.3, 0.05, 0.18), C.dark, 0, 1.66, -1.48));
  // round headlights + grille + bumpers
  d.push(part(box(1.6, 0.22, 0.22), C.dark, 0, 0.42, 1.6));
  d.push(part(box(1.6, 0.24, 0.2), C.dark, 0, 0.44, -1.62));
  d.push(part(box(0.5, 0.14, 0.05), C.dark, 0, 0.66, 1.62));
  for (const sx of [-1, 1]) {
    d.push(part(cylZ(0.14, 0.06, 12), C.light, sx * 0.5, 0.68, 1.6));
    d.push(part(box(0.14, 0.34, 0.06), C.tail, sx * 0.6, 0.72, -1.63));
  }
  // single fat stripe down the centre of the bonnet
  const hs = box(0.3, 0.02, 0.42); hs.rotateX(Math.atan2(0.14, 0.38));
  d.push(part(hs, C.stripe, 0, 0.92, 1.36));
  for (const sx of [-1, 1]) d.push(part(box(0.05, 0.12, 1.2), C.dark, sx * 0.77, 0.45, 0));
  for (const sx of [-1, 1]) roundel(d, sx * 0.775, 0.66, 0.05, sx, 0.22);
  mudFlaps(d, dm, 0.26, 0.24);
  return { paint, d };
}

// ---- 3. Halvard Longtail: long-bonnet fastback coupe with a ducktail -----------
function buildHalvard(dm) {
  const paint = [], d = [];
  paint.push(part(profileBody([
    [-2.22, 0.4], [2.2, 0.4], [2.34, 0.5], [2.3, 0.64], [0.55, 0.84],
    [-1.95, 0.9], [-2.3, 0.86], [-2.32, 0.55],
  ], 1.64), '#fff'));
  roundArches(paint, d, dm, 0.52, 0.44, 0.15, 0.84, 0.895);
  // ducktail spoiler (paint wedge)
  const duck = frustum(1.7, 0.42, 1.74, 0.2, 0.14, -0.1);
  paint.push(part(duck, '#fff', 0, 0.94, -2.12));
  // low fastback glass with paint roof
  d.push(part(frustum(1.5, 2.4, 1.14, 1.0, 0.4, -0.5), C.glass, 0, 0.86, -0.55));
  d.push(part(box(1.52, 0.04, 2.38), C.trim, 0, 0.88, -0.55));
  paint.push(part(frustum(1.16, 1.0, 1.06, 0.84, 0.05, -0.02), '#fff', 0, 1.26, -1.05));
  for (const sx of [-1, 1]) paint.push(part(box(0.12, 0.09, 0.16), '#fff', sx * 0.86, 0.95, 0.5));
  // long single centre stripe: bonnet, roof, tail
  const bonAng = Math.atan2(0.2, 2.3 - 0.55);
  const bs = box(0.42, 0.02, 1.72); bs.rotateX(bonAng);
  d.push(part(bs, C.stripe, 0, 0.81, 1.42));
  d.push(part(box(0.42, 0.02, 0.86), C.stripe, 0, 1.325, -1.07));
  d.push(part(box(0.42, 0.02, 0.24), C.stripe, 0, 1.085, -2.12));
  // nose: slim lamps, splitter; tail: full-width light bar, diffuser
  d.push(part(box(1.86, 0.08, 0.36), C.dark, 0, 0.38, 2.2));
  for (const sx of [-1, 1]) {
    d.push(part(box(0.46, 0.09, 0.06), C.light, sx * 0.55, 0.62, 2.3));
    d.push(part(cylZ(0.07, 0.3, 8), C.skid, sx * 0.3, 0.42, -2.3));
  }
  d.push(part(box(0.5, 0.1, 0.05), C.dark, 0, 0.55, 2.34));
  d.push(part(box(1.5, 0.1, 0.06), C.tail, 0, 0.8, -2.33));
  d.push(part(box(1.7, 0.18, 0.2), C.dark, 0, 0.46, -2.24));
  // bonnet vents
  for (const sx of [-1, 1]) d.push(part(box(0.24, 0.03, 0.5), C.dark, sx * 0.48, 0.8, 1.1));
  for (const sx of [-1, 1]) d.push(part(box(0.05, 0.12, 1.9), C.dark, sx * 0.88, 0.47, 0));
  for (const sx of [-1, 1]) roundel(d, sx * 0.885, 0.64, -0.1, sx, 0.24);
  mudFlaps(d, dm, 0.3, 0.26);
  return { paint, d };
}

// ---- 4. Grendel S: wide box-arched special with roof scoop and big wing --------
function buildGrendel(dm) {
  const paint = [], d = [];
  paint.push(part(profileBody([
    [-1.95, 0.46], [1.92, 0.46], [2.06, 0.58], [2.02, 0.78], [1.1, 0.94],
    [-1.7, 1.0], [-2.0, 0.92], [-2.02, 0.62],
  ], 1.62), '#fff'));
  // boxy bolt-on arches, chamfered at front and back
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const fl = frustum(0.3, 1.36, 0.3, 1.0, 0.36);
    paint.push(part(fl, '#fff', sx * 0.95, 0.66, sz * dm.wz));
    const well = new THREE.CylinderGeometry(0.47, 0.47, 0.02, 10, 1, false, 0, Math.PI);
    well.rotateZ(Math.PI / 2);
    d.push(part(well, C.well, sx * 0.895, dm.wheelR + 0.02, sz * dm.wz));
    d.push(part(box(0.3, 0.06, 1.38), C.dark, sx * 0.95, 0.66, sz * dm.wz)); // arch lip
  }
  // squat cabin
  d.push(part(frustum(1.56, 2.5, 1.22, 1.5, 0.5, -0.25), C.glass, 0, 0.98, -0.42));
  d.push(part(box(1.58, 0.04, 2.48), C.trim, 0, 1.0, -0.42));
  paint.push(part(frustum(1.26, 1.54, 1.16, 1.36, 0.06, -0.02), '#fff', 0, 1.48, -0.67));
  // roof scoop
  d.push(part(frustum(0.5, 0.7, 0.42, 0.5, 0.2, -0.06), C.dark, 0, 1.53, -0.25));
  d.push(part(box(0.36, 0.13, 0.04), '#101114', 0, 1.62, 0.1));
  // huge rear wing on tall struts, with big endplates
  paint.push(part(box(2.0, 0.07, 0.6), '#fff', 0, 1.88, -1.82));
  for (const sx of [-1, 1]) {
    d.push(part(box(0.07, 0.42, 0.16), C.dark, sx * 0.55, 1.64, -1.78));
    d.push(part(box(0.05, 0.36, 0.74), C.dark, sx * 1.0, 1.86, -1.84));
  }
  d.push(part(box(2.0, 0.03, 0.12), C.stripe, 0, 1.93, -1.6)); // wing leading-edge band
  // aggressive front: deep splitter, bumper lamps, bonnet vents
  d.push(part(box(2.06, 0.1, 0.5), C.dark, 0, 0.42, 1.98));
  d.push(part(box(1.9, 0.26, 0.24), C.dark, 0, 0.62, 2.0));
  for (let k = 0; k < 4; k++) d.push(part(cylZ(0.12, 0.06, 10), C.lamp, -0.6 + k * 0.4, 0.64, 2.13));
  for (const sx of [-1, 1]) {
    d.push(part(box(0.32, 0.12, 0.05), C.light, sx * 0.6, 0.86, 2.02));
    d.push(part(box(0.4, 0.16, 0.06), C.tail, sx * 0.6, 0.84, -2.04));
    d.push(part(box(0.28, 0.03, 0.42), C.dark, sx * 0.36, 0.95, 1.45));
    d.push(part(box(0.06, 0.26, 0.5), C.dark, sx * 0.87, 0.74, -0.75)); // side intakes
  }
  d.push(part(box(1.9, 0.3, 0.26), C.dark, 0, 0.56, -2.02));
  for (const sx of [-1, 1]) d.push(part(cylZ(0.08, 0.3, 8), C.skid, sx * 0.45, 0.46, -2.15));
  // diagonal livery band over the bonnet
  const band = box(0.36, 0.02, 1.5); band.rotateY(0.5); band.rotateX(Math.atan2(0.16, 0.92));
  d.push(part(band, C.stripe, 0.05, 0.92, 1.45));
  for (const sx of [-1, 1]) roundel(d, sx * 0.885, 0.72, 0.15, sx, 0.25);
  mudFlaps(d, dm, 0.36, 0.32);
  return { paint, d };
}

function buildWheel(dm, side) {
  const r = dm.wheelR, w = dm.wheelW, o = w / 2;
  const parts = [];
  parts.push(part(cylX(r, w, 14), C.tyre));
  parts.push(part(cylX(r * 0.92, w + 0.02, 14), C.tyre)); // sidewall shoulder
  parts.push(part(cylX(r * 0.58, 0.04, 10), C.hub, o, 0, 0));
  parts.push(part(box(0.03, r, 0.06), C.dark, o + 0.025, 0, 0));
  parts.push(part(box(0.03, 0.06, r), C.dark, o + 0.025, 0, 0));
  parts.push(part(cylX(r * 0.17, 0.05, 8), C.hub, o + 0.03, 0, 0));
  const g = merge(parts);
  if (side < 0) g.rotateY(Math.PI); // hub faces outward on the right-hand wheels
  return g;
}

// ---------------------------------------------------------------------------
export class Car {
  constructor(carId = CARS[0].id) {
    const def = carDef(carId);
    this.carId = def.id;
    this.def = def;
    this.H = def.handling;
    const dm = this.dims = def.dims;

    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.body = new THREE.Group();
    this.body.position.y = dm.pivot;
    this.group.add(this.body);

    const shell = def.build(dm);
    const paintGeo = merge(shell.paint), detailGeo = merge(shell.d);
    this.paintMat = new THREE.MeshLambertMaterial({ color: PAINTS[0].hex, flatShading: true });
    this.detailMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    paintGeo.translate(0, -dm.pivot, 0);
    detailGeo.translate(0, -dm.pivot, 0);
    const pm = new THREE.Mesh(paintGeo, this.paintMat);
    const dmesh = new THREE.Mesh(detailGeo, this.detailMat);
    pm.castShadow = dmesh.castShadow = true;
    pm.receiveShadow = dmesh.receiveShadow = true;
    this.body.add(pm, dmesh);
    this._meshes = [pm, dmesh];

    const wl = buildWheel(dm, 1), wr = buildWheel(dm, -1);
    this.wheels = [];
    this.wheelPivots = [];
    const pos = [[dm.wx, dm.wz], [-dm.wx, dm.wz], [dm.wx, -dm.wzR], [-dm.wx, -dm.wzR]];
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      pivot.position.set(pos[i][0], dm.wheelR, pos[i][1]);
      const m = new THREE.Mesh(pos[i][0] > 0 ? wl : wr, this.detailMat);
      m.castShadow = true;
      pivot.add(m);
      this.group.add(pivot);
      this.wheels.push(m);
      this.wheelPivots.push(pivot);
      this._meshes.push(m);
    }
    this.wheelLocal = pos;
    this._ghost = false;
    this._ghostMat = null;

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

  setPaint(hex) {
    this.paintMat.color.set(hex);
    if (this._ghostMat) this._ghostMat.color.set(hex).lerp(new THREE.Color('#ffffff'), 0.35);
  }

  // translucent single-tint look for ghost replays; reversible
  setGhost(on) {
    on = !!on;
    if (on === this._ghost) return;
    this._ghost = on;
    if (on && !this._ghostMat) {
      this._ghostMat = new THREE.MeshLambertMaterial({
        color: this.paintMat.color.clone().lerp(new THREE.Color('#ffffff'), 0.35),
        transparent: true, opacity: 0.35, depthWrite: false, flatShading: true,
      });
    }
    for (const m of this._meshes) {
      if (on) { m.userData.mat = m.material; m.material = this._ghostMat; m.castShadow = false; m.receiveShadow = false; }
      else { m.material = m.userData.mat || m.material; m.castShadow = true; m.receiveShadow = m.parent === this.body; }
    }
  }

  // place the visual directly (no physics), e.g. for ghost playback
  setPose(x, y, z, yaw, pitch = 0, roll = 0, steer = 0, wheelSpin = 0) {
    this.rx = x; this.ry = y; this.rz = z; this.ryaw = yaw;
    this._pitch = pitch; this._roll = roll;
    this.group.position.set(x, y, z);
    this.group.rotation.set(pitch, yaw, roll);
    this.body.rotation.set(0, 0, 0);
    this.body.position.y = this.dims.pivot;
    for (let i = 0; i < 4; i++) {
      this.wheels[i].rotation.x = wheelSpin;
      if (i < 2) this.wheelPivots[i].rotation.y = steer;
    }
  }

  // the current rendered pose, for recording
  getPose(out = {}) {
    out.x = this.rx; out.y = this.ry; out.z = this.rz; out.yaw = this.ryaw;
    out.pitch = this._pitch; out.roll = this._roll;
    out.steer = this.wheelPivots[0].rotation.y;
    out.wheelSpin = this.wheels[0].rotation.x;
    return out;
  }

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
    const K = this.H;
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
    const rate = into ? K.steerIn - K.steerInDrop * sp01 : K.steerOut;
    this._sIn += clamp(sIn - s0, -rate * dt, rate * dt);
    const sN = this._sIn;
    const maxSteer = K.lock0 - K.lockDrop * Math.min(1, speed / 42);
    this.steer = sN * maxSteer;

    const grip = stage.def.grip;
    const baseLat = GRIP * K.grip * grip * (1 - 0.25 * off);
    let aLong = 0, aLat = 0;
    const beta = Math.atan2(vl, Math.abs(vf) + 1.5);
    if (contact) {
      // ---- longitudinal ----
      let drive = 0, decel = 0;
      if (vf > -1) drive += thr * K.power * Math.max(0, 1 - vf / K.vmax);
      else drive += thr * 14;
      if (brk > 0) {
        if (vf > 1) decel += brk * K.brake;
        else if (vf > -REV_MAX) drive -= brk * REV_ACC * Math.min(1, (vf + REV_MAX) / 2);
      }
      if (hand) decel += K.handDec;
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
      if (prevThr > 0.3 && thr < 0.2 && Math.abs(sN) > 0.7 && d < K.liftOff * fast) d += K.liftRate * fast * dt; // sustained lift-off
      if (brk > 0.3 && vf > 1 && turning && d < K.trail * brk * fast) d += (K.trail * brk * fast - d) * Math.min(1, 3 * dt); // trail-brake
      if (hand && speed > 4) d += (1 - d) * Math.min(1, 6 * dt);                                  // handbrake
      if (thr > 0.8 && Math.abs(sN) > 0.7 && speed > 7) {                                         // power oversteer
        d += thr * Math.max(0, 1.05 - grip + K.powerOS) * (this.gear <= 2 ? 1.2 : 0.5) * dt;
      }
      const holding = d > 0.25 && thr > 0.4 && Math.abs(beta) > 0.1 && turning && Math.sign(sN) === Math.sign(this.yawRate);
      if (holding && !hand) d = Math.max(d, Math.min(this.drift, K.holdMax)) - 0.08 * dt;
      else if (!hand) d *= Math.exp(-(sN === 0 ? 2.8 : Math.sign(sN) !== Math.sign(this.yawRate) ? 3.5 : 1.6) * dt);
      this.drift = d = clamp(d, 0, 1);

      // ---- lateral grip with traction circle ----
      const use = Math.min(1, longUse / 16);
      let maxLat = baseLat * (1 - 0.25 * use * use) * (1 - K.driftLatLoss * d);
      if (hand) maxLat *= K.handLat;
      if (thr > 0.5 && d > 0.2 && Math.abs(vl) > 1.5) maxLat *= 0.9;
      aLat = clamp(-vl * K.latStiff, -maxLat, maxLat);
      vl += aLat * dt;

      // ---- yaw: proportional to steering, speed-limited near the grip limit ----
      const av = Math.max(Math.abs(vf), 4);
      const wKin = Math.abs(vf) * Math.tan(maxSteer) / K.wb;
      const wGrip = baseLat / av * (K.yawMargin + K.driftYaw * d + (hand ? K.handYaw : 0));
      const wMax = Math.min(wKin * (hand ? 1.35 : 1), wGrip);
      let target = sN * wMax * Math.sign(vf || 1);
      // self-aligning toward the velocity; weaker while a slide is held on throttle,
      // stronger (counter-steer assist) when the player isn't steering into the slide
      const intoSlide = sN !== 0 && Math.sign(sN) === -Math.sign(beta);
      let align = hand ? 0.5 : K.alignBase - K.alignHold * d * thr;
      if (!intoSlide && !hand) align += K.assist;
      target += beta * align * Math.min(1, speed / 3);
      // anti-spin: pull back hard past the car's slide limit
      const bLim = hand ? 1.2 : K.betaLim + K.betaLimDrift * this.drift;
      if (Math.abs(beta) > bLim) target += Math.sign(beta) * (Math.abs(beta) - bLim) * 6;
      this.yawRate += (target - this.yawRate) * Math.min(1, K.yawResp * dt);
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
    const G = K.gears;
    const v = Math.abs(this.vf);
    if (this.vf < -0.5 && brk > 0 && thr < 0.1) this.gear = 0;
    else {
      if (this.gear === 0) this.gear = 1;
      while (this.gear < 5 && v > G[this.gear]) this.gear++;
      while (this.gear > 1 && v < G[this.gear - 1] - 2.5) this.gear--;
    }
    let rpmT;
    if (this.gear === 0) rpmT = 0.25 + 0.75 * Math.min(1, v / REV_MAX);
    else {
      const lo = this.gear === 1 ? 0 : G[this.gear - 1] - 2.5, hi = G[this.gear];
      rpmT = 0.25 + 0.75 * clamp((v - lo) / (hi - lo), 0, 1);
    }
    if (!contact || this.slip > 4) rpmT = Math.max(rpmT, 0.3 + 0.6 * thr);
    if (this.gear === 1 && v < 4) rpmT = Math.max(rpmT, 0.25 + 0.45 * thr);
    this.rpm += (rpmT - this.rpm) * Math.min(1, 14 * dt);
  }

  // two circles (front / rear axle) against the stage's round obstacles
  _collide(stage) {
    const K = this.H, dm = this.dims;
    const halfW = dm.wx + dm.wheelW * 0.5;
    const rad = Math.max(0.8, halfW);
    const e = 0.25 + 0.15 * (1 - K.mass);          // lighter cars bounce a little more
    const yawK = 0.08 / K.mass;
    for (let k = 0; k < 2; k++) {
      const arm = k === 0 ? dm.wz * 0.92 : -dm.wzR * 0.92;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const cx = this.x + fx * arm, cz = this.z + fz * arm;
      stage.collide(cx, cz, rad, (o, dx, dz, rr) => {
        const d = Math.hypot(dx, dz) || 1e-3, nx = dx / d, nz = dz / d;
        const pen = rr - d;
        this.x += nx * pen; this.z += nz * pen;
        // velocity of the contact point (includes rotation)
        const pvx = this.vx + this.yawRate * fz * arm, pvz = this.vz - this.yawRate * fx * arm;
        const vn = pvx * nx + pvz * nz;
        if (vn >= 0) return;
        const before = Math.hypot(this.vx, this.vz);
        const head = clamp(-vn / Math.max(before, 1), 0, 1); // 1 = head-on, 0 = grazing
        const jn = -(1 + e) * vn;
        this.vx += jn * nx; this.vz += jn * nz;
        // scrub the tangential part: little when grazing, a lot head-on
        const tvn = this.vx * nx + this.vz * nz;
        const tx = this.vx - tvn * nx, tz = this.vz - tvn * nz;
        const keep = 1 - 0.85 * head * head - 0.06;
        this.vx = tvn * nx + tx * keep; this.vz = tvn * nz + tz * keep;
        const cross = (fx * arm) * nz - (fz * arm) * nx;
        this.yawRate = clamp(this.yawRate - cross * jn * yawK, -2, 2);
        this.drift *= 0.5;
        const lost = before - Math.hypot(this.vx, this.vz);
        if (lost > 0.5) this.impact = Math.max(this.impact, lost);
      });
    }
  }

  _poseFromGround(x, z, yaw, snap) {
    const st = this._stage; if (!st) return null;
    const dm = this.dims;
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    for (let i = 0; i < 4; i++) {
      const [ax, az] = this.wheelLocal[i];
      this._wheelH[i] = st.height(x + cy * ax + sy * az, z - sy * ax + cy * az);
    }
    const [hFL, hFR, hRL, hRR] = this._wheelH;
    const pitch = clamp(Math.atan2((hRL + hRR) - (hFL + hFR), 2 * (dm.wz + dm.wzR)), -0.4, 0.4);
    const roll = clamp(Math.atan2((hFL + hRL) - (hFR + hRR), 2 * 2 * dm.wx), -0.4, 0.4);
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
    this.body.position.y = this.dims.pivot + this._bob;

    // wheels
    const spin = this.grounded ? this.vf / this.dims.wheelR : this.throttle * 40;
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

// a model-only group (no physics) for menu turntables
export function buildCarPreview(carId, paintHex) {
  const c = new Car(carId);
  if (paintHex) c.setPaint(paintHex);
  c.group.userData.car = c;
  return c.group;
}

// ---------------------------------------------------------------------------
// Autopilot: pure pursuit + curvature-based speed planning (scaled per car)
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

  const K = car.H || BASE;
  const _ai = { steer: 0, throttle: 0, brake: 0, hand: false };
  const speed = car.speed, i0 = car.idx, N = stage.n;
  const look = clamp(6 + speed * 0.55, 8, 40);
  const j = Math.min(N - 1, i0 + Math.round(look / STEP));
  const ang = Math.atan2(stage.sx[j] - car.x, stage.sz[j] - car.z);
  let diff = ang - car.yaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  // pure pursuit -> desired yaw rate -> normalised steer for the car's speed-limited steering
  const L = Math.max(4, Math.hypot(stage.sx[j] - car.x, stage.sz[j] - car.z));
  const wDes = 2 * Math.sin(diff) / L * Math.max(speed, 3);
  const av = Math.max(Math.abs(car.vf), 4);
  const maxSteer = K.lock0 - K.lockDrop * Math.min(1, speed / 42);
  const lat = GRIP * K.grip * stage.def.grip;
  const wMax = Math.max(0.05, Math.min(Math.abs(car.vf) * Math.tan(maxSteer) / K.wb, lat * (1 - 0.25 * car.offroad) / av * K.yawMargin));
  _ai.steer = clamp(wDes / wMax * 1.25 + diff * 0.5, -1, 1);

  // speed plan: allowed speed at each upcoming sample, relaxed by braking distance
  const span = Math.round((15 + speed * 1.6) / STEP);
  const bDec = 9 * K.brake / 17;
  let vT = 70;
  for (let k = 0; k <= span; k++) {
    const i = Math.min(N - 1, i0 + k);
    const c = Math.abs(stage.curv[i]);
    const vc = c > 1e-4 ? Math.sqrt(lat * 0.75 / c) : 70;
    const v = Math.sqrt(vc * vc + 2 * bDec * k * STEP);
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
