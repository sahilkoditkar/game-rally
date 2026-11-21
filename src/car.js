import * as THREE from 'three';
import { ROAD_HALF, STEP, clamp, smoothstep, part, merge } from './track.js';

// ---------------------------------------------------------------------------
// Dustline car: the Rook, an original chunky low-poly rally hatchback, with
// performance upgrades (engine / tyres / brakes / suspension, levels 0..3) and
// cosmetic parts. Level 0 everywhere = the stock Rook, which drives bit-for-bit
// like the original car (pars, ghosts and medals depend on it).
// Conventions: Y up, yaw 0 faces +Z, forward f = (sin yaw, cos yaw),
// left l = (cos yaw, -sin yaw), positive yaw rate / steer = turn LEFT.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------- catalogue
export const PAINTS = [
  { name: 'Ember', hex: '#e2472f', cost: 0 },
  { name: 'Glacier', hex: '#3d7fc4', cost: 0 },
  { name: 'Marigold', hex: '#f2b632', cost: 0 },
  { name: 'Fern', hex: '#3f9a63', cost: 0 },
  { name: 'Chalk', hex: '#ece7da', cost: 0 },
  { name: 'Plum', hex: '#7c4bb0', cost: 0 },
  { name: 'Coal', hex: '#2e3036', cost: 150 },
  { name: 'Tangerine', hex: '#f07b2a', cost: 150 },
  { name: 'Lagoon', hex: '#1f9e9a', cost: 200 },
  { name: 'Moss', hex: '#6d7a3a', cost: 200 },
  { name: 'Brick', hex: '#9a3b2e', cost: 250 },
  { name: 'Cornflower', hex: '#7d9be0', cost: 250 },
  { name: 'Rosewood', hex: '#c2516f', cost: 300 },
  { name: 'Sandstone', hex: '#d1aa78', cost: 300 },
  { name: 'Gilded', hex: '#c9a23a', cost: 400, medals: 18 },
  { name: 'Midnight', hex: '#20305e', cost: 400, medals: 27 },
];

export const ACCENTS = [
  { name: 'Chalk', hex: '#f3efe4', cost: 0 },
  { name: 'Coal', hex: '#26272d', cost: 100 },
  { name: 'Signal', hex: '#f2c230', cost: 150 },
  { name: 'Sky', hex: '#86c8ea', cost: 150 },
  { name: 'Crimson', hex: '#c8262c', cost: 200 },
  { name: 'Brass', hex: '#d0a640', cost: 250 },
];

const UP_COST = [400, 900, 1600], UP_MEDALS = [0, 8, 18];
const lv = (names, blurbs) => names.map((name, i) => ({ name, blurb: blurbs[i], cost: UP_COST[i], medals: UP_MEDALS[i] }));
export const UPGRADES = [
  {
    id: 'engine', name: 'Engine', blurb: 'More power: quicker out of corners and a higher top speed.',
    levels: lv(['Street tune', 'Rally cams', 'Full rally engine'], [
      'Freer intake and exhaust. A little more shove everywhere.',
      'Hotter cams and a bigger exhaust: pulls harder past 100.',
      'Fully built engine with an intercooler and bonnet scoop.']),
  },
  {
    id: 'tyres', name: 'Tyres', blurb: 'More grip in corners, better traction, less grip lost on the verge.',
    levels: lv(['Gravel tyres', 'Rally compound', 'Competition tyres'], [
      'Proper gravel tread. Corners a touch faster.',
      'Softer compound that keeps its grip when you power out.',
      'Wide competition tyres: the most grip on and off the road.']),
  },
  {
    id: 'brakes', name: 'Brakes', blurb: 'Stops shorter and stays straighter and grippier while braking.',
    levels: lv(['Fast-road pads', 'Vented discs', 'Rally calipers'], [
      'Grippier pads. Brake a little later.',
      'Bigger vented discs: stronger and calmer into corners.',
      'Four-pot calipers: the latest braking and the steadiest.']),
  },
  {
    id: 'suspension', name: 'Suspension', blurb: 'Rides bumps, jumps and the verge with less drama and less lost speed.',
    levels: lv(['Uprated dampers', 'Gravel suspension', 'Long-travel rally kit'], [
      'Firmer dampers. Less lost on the rough stuff.',
      'Gravel springs: shrugs off landings, kerbs and glancing knocks.',
      'Long-travel kit with a raised ride height: the calmest car over anything.']),
  },
];

// per-level handling values (index = level). Level 0 is exactly the stock Rook.
const TUNE = {
  engine: { power: [13, 13.75, 14.5, 15.35], vmax: [52, 54, 56.5, 59] },
  tyres: { grip: [1, 1.035, 1.07, 1.105], offGripLoss: [0.25, 0.21, 0.17, 0.13], traction: [16, 17.5, 19, 20.5], powerOS: [0, -0.03, -0.06, -0.09] },
  brakes: { brake: [17, 19.5, 22, 24.5], tractionBrake: [16, 20, 24.5, 29.5] },
  suspension: {
    offDrag: [0.17, 0.15, 0.13, 0.11], offFlat: [1.2, 1.05, 0.9, 0.75],
    landLoss: [0.015, 0.012, 0.009, 0.006], landCap: [0.15, 0.12, 0.09, 0.06], scrub: [0.06, 0.05, 0.04, 0.03],
    contactTol: [0.15, 0.18, 0.21, 0.24], lean: [1, 0.9, 0.8, 0.7], planted: [0, 0.035, 0.07, 0.105],
  },
};

const P0 = (o) => ({ cost: 0, medals: 0, ...o });
export const PARTS = [
  // wing
  P0({ id: 'wing-rally', slot: 'wing', name: 'Rally wing', blurb: 'The classic wing on short struts.' }),
  P0({ id: 'wing-lip', slot: 'wing', name: 'Roof lip', blurb: 'A neat roof-edge lip. Clean and quiet.' }),
  { id: 'wing-duck', slot: 'wing', name: 'Ducktail', blurb: 'A kicked-up tail on the hatch.', cost: 250, medals: 0 },
  { id: 'wing-big', slot: 'wing', name: 'Monster wing', blurb: 'A huge winged spoiler on tall struts.', cost: 800, medals: 12 },
  // roof
  P0({ id: 'roof-none', slot: 'roof', name: 'Bare roof', blurb: 'Nothing up top.' }),
  { id: 'roof-rack', slot: 'roof', name: 'Roof rack', blurb: 'Rack with a strapped-down spare wheel.', cost: 300, medals: 0 },
  { id: 'roof-scoop', slot: 'roof', name: 'Roof scoop', blurb: 'A ram-air scoop on the roof.', cost: 450, medals: 0 },
  { id: 'roof-lamps', slot: 'roof', name: 'Lamp bar', blurb: 'Four roof lamps for night stages.', cost: 500, medals: 0 },
  // lamps (today's Rook wears the 4-lamp bonnet pod, so it stays the free default)
  P0({ id: 'lamps-pod', slot: 'lamps', name: 'Bonnet pod', blurb: 'Four round lamps on the bonnet.' }),
  P0({ id: 'lamps-none', slot: 'lamps', name: 'No pod', blurb: 'Clean bonnet, headlights only.' }),
  { id: 'lamps-big', slot: 'lamps', name: 'Big rally pod', blurb: 'Four huge lamps for the darkest stages.', cost: 600, medals: 0 },
  // front
  P0({ id: 'front-stock', slot: 'front', name: 'Stock bumper', blurb: 'Bumper with a skid plate.' }),
  { id: 'front-bull', slot: 'front', name: 'Bull bar', blurb: 'Tubular bar for pushing through the scrub.', cost: 300, medals: 0 },
  { id: 'front-splitter', slot: 'front', name: 'Splitter', blurb: 'Deep splitter with a yellow tow hook.', cost: 350, medals: 0 },
  // arches
  P0({ id: 'arches-stock', slot: 'arches', name: 'Round flares', blurb: 'The stock flared arches.' }),
  { id: 'arches-wide', slot: 'arches', name: 'Wide box arches', blurb: 'Bolt-on box arches over a wider track.', cost: 700, medals: 0, requires: { upgrade: 'tyres', level: 2 } },
  // wheels
  P0({ id: 'wheels-steel', slot: 'wheels', name: 'Steel', blurb: 'Plain steel wheels.' }),
  { id: 'wheels-white', slot: 'wheels', name: 'White rally', blurb: 'White rally wheels.', cost: 200, medals: 0 },
  { id: 'wheels-gold', slot: 'wheels', name: 'Gold spoked', blurb: 'Gold spoked wheels.', cost: 400, medals: 0 },
  { id: 'wheels-dish', slot: 'wheels', name: 'Black deep-dish', blurb: 'Black wheels with a polished lip.', cost: 350, medals: 0 },
  // mud flaps
  P0({ id: 'flaps-red', slot: 'flaps', name: 'Red flaps', blurb: 'Red mud flaps.' }),
  { id: 'flaps-white', slot: 'flaps', name: 'White flaps', blurb: 'White mud flaps.', cost: 100, medals: 0 },
  { id: 'flaps-black', slot: 'flaps', name: 'Black flaps', blurb: 'Black mud flaps.', cost: 100, medals: 0 },
  { id: 'flaps-none', slot: 'flaps', name: 'No flaps', blurb: 'Mud flaps removed.', cost: 100, medals: 0 },
  // livery (drawn in the accent colour)
  P0({ id: 'livery-twin', slot: 'livery', name: 'Twin stripes', blurb: 'Two stripes nose to tail.' }),
  { id: 'livery-offset', slot: 'livery', name: 'Offset stripe', blurb: 'One fat stripe, off to one side.', cost: 200, medals: 0 },
  { id: 'livery-band', slot: 'livery', name: 'Diagonal band', blurb: 'Bold diagonal bands over bonnet and roof.', cost: 300, medals: 0 },
  { id: 'livery-twotone', slot: 'livery', name: 'Two-tone', blurb: 'Roof and pillars in the accent colour.', cost: 300, medals: 0 },
  { id: 'livery-chequer', slot: 'livery', name: 'Chequer flank', blurb: 'Chequered panels around the door number.', cost: 400, medals: 0 },
  { id: 'livery-clean', slot: 'livery', name: 'Clean', blurb: 'No stripes at all.', cost: 100, medals: 0 },
  // door number
  P0({ id: 'number-7', slot: 'number', name: 'No. 7', blurb: 'The classic 7 roundel.' }),
  { id: 'number-3', slot: 'number', name: 'No. 3', blurb: 'Door roundel, number 3.', cost: 100, medals: 0 },
  { id: 'number-11', slot: 'number', name: 'No. 11', blurb: 'Door roundel, number 11.', cost: 150, medals: 0 },
  { id: 'number-24', slot: 'number', name: 'No. 24', blurb: 'Door roundel, number 24.', cost: 150, medals: 0 },
  { id: 'number-none', slot: 'number', name: 'No number', blurb: 'Plain doors.', cost: 100, medals: 0 },
];
const SLOTS = ['wing', 'roof', 'lamps', 'front', 'arches', 'wheels', 'flaps', 'livery', 'number'];
const PART_BY_ID = new Map(PARTS.map((p) => [p.id, p]));
const slotDefault = (slot) => PARTS.find((p) => p.slot === slot).id;

export const DEFAULT_BUILD = Object.freeze({
  engine: 0, tyres: 0, brakes: 0, suspension: 0,
  parts: Object.freeze(Object.fromEntries(SLOTS.map((s) => [s, slotDefault(s)]))),
  paint: PAINTS[0].hex, accent: ACCENTS[0].hex,
});

const HEX = /^#[0-9a-f]{6}$/i;
const level = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? clamp(n, 0, 3) : 0; };
// -> a valid, complete build; unknown ids fall back to defaults, levels clamp to 0..3, never throws
export function normalizeBuild(any) {
  try { return normalizeRaw(any); } catch { return normalizeRaw(null); }
}
function normalizeRaw(any) {
  const b = any && typeof any === 'object' ? any : {};
  const out = {
    engine: level(b.engine), tyres: level(b.tyres), brakes: level(b.brakes), suspension: level(b.suspension),
    parts: {}, paint: DEFAULT_BUILD.paint, accent: DEFAULT_BUILD.accent,
  };
  const parts = b.parts && typeof b.parts === 'object' ? b.parts : {};
  for (const s of SLOTS) {
    let id = null;
    try { id = parts[s]; } catch { id = null; }
    const p = typeof id === 'string' ? PART_BY_ID.get(id) : null;
    const ok = p && p.slot === s && (!p.requires || out[p.requires.upgrade] >= p.requires.level);
    out.parts[s] = ok ? p.id : slotDefault(s);
  }
  if (typeof b.paint === 'string' && HEX.test(b.paint)) out.paint = b.paint.toLowerCase();
  if (typeof b.accent === 'string' && HEX.test(b.accent)) out.accent = b.accent.toLowerCase();
  return out;
}

// ---------------------------------------------------------------- handling
// shared constants
const REV_ACC = 6, REV_MAX = 9, GRIP = 10.5, GRAV = 20;
const FIXED_DT = 1 / 120;
const MAX_ROLL = 0.105, MAX_PITCH = 0.07; // cosmetic body lean limits (~6 deg, ~4 deg)
// physical footprint for collisions (independent of cosmetic parts)
const PHYS = { wx: 0.82, wheelW: 0.26, wz: 1.25, wzR: 1.25 };

// the stock Rook. Every number is consumed by Car.step.
const BASE = Object.freeze({
  power: 13,        // m/s^2 drive at standstill, falls linearly to 0 at vmax
  vmax: 52,         // m/s, drive cut-off (real top speed is lower because of drag)
  brake: 17,        // m/s^2
  handDec: 4,       // handbrake decel m/s^2
  grip: 1,          // multiplies GRIP * stage grip
  offGripLoss: 0.25,// lateral grip lost fully off the road
  traction: 16,     // traction circle: longitudinal accel that costs 25% of lateral grip (driving)
  tractionBrake: 16,// ... and while braking
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
  betaLimDrift: 0,  // extra slide angle allowed per unit drift state
  yawResp: 10,      // yaw-rate response (1/s)
  mass: 1,          // collision response: lighter bounces/spins more, heavier ploughs on
  roll: 0.25,       // rolling resistance m/s^2
  offDrag: 0.17, offFlat: 1.2,   // off-road drag: per m/s and flat
  landHit: 4, landLoss: 0.015, landCap: 0.15, // speed lost on hard landings
  scrub: 0.06,      // tangential speed lost on any obstacle contact
  contactTol: 0.15, // height above ground that still counts as tyre contact (micro-hops)
  planted: 0,       // extra lateral grip at speed from tyres staying planted over ruts (0 at 15 m/s .. full at 35)
  lean: 1,          // cosmetic body roll / pitch / bob scale
  gears: [0, 11, 19, 27, 36, 46],
});

// -> the handling parameter block for a build (frozen)
export function buildHandling(build) {
  const b = normalizeBuild(build);
  const h = { ...BASE };
  for (const cat of ['engine', 'tyres', 'brakes', 'suspension']) {
    const t = TUNE[cat], l = b[cat];
    for (const k in t) h[k] = t[k][l];
  }
  if (b.engine) { const s = h.vmax / BASE.vmax; h.gears = BASE.gears.map((g) => Math.round(g * s * 10) / 10); }
  return Object.freeze(h);
}

// analytic-ish performance figures of a handling block (flat road, grip 1)
function perf(h) {
  const top = (h.power - h.roll) / (h.power / h.vmax + 0.03);
  let v = 0, t = 0; const dt = 0.01;
  while (v < 27.78 && t < 20) { v += (h.power * Math.max(0, 1 - v / h.vmax) - h.roll - 0.03 * v) * dt; t += dt; }
  const brakeDist = (27.78 * 27.78) / (2 * (h.brake + h.roll + 0.03 * 14));
  const latG = GRIP * h.grip / 9.81;
  return { top, t100: t, brakeDist, latG };
}
const STOCK_PERF = perf(BASE), MAX_PERF = perf(buildHandling({ engine: 3, tyres: 3, brakes: 3, suspension: 3 }));
const span01 = (v, a, b) => clamp((v - a) / (b - a), 0, 1);
// -> { speed, accel, grip, braking, composure, lights } each 0..1. Stock sits around 0.3, fully upgraded around 0.9.
export function buildStats(build) {
  const b = normalizeBuild(build), h = buildHandling(b), p = perf(h);
  const lo = 0.3, hi = 0.9, map = (v, s, m) => lo + (hi - lo) * span01(v, s, m);
  const stats = {
    speed: map(p.top, STOCK_PERF.top, MAX_PERF.top),
    accel: map(-p.t100, -STOCK_PERF.t100, -MAX_PERF.t100),
    grip: lo + (hi - lo) * (0.6 * span01(h.grip, 1, 1.105) + 0.2 * span01(-h.offGripLoss, -0.25, -0.13) + 0.2 * span01(h.traction, 16, 20.5)),
    braking: lo + (hi - lo) * (0.7 * span01(-p.brakeDist, -STOCK_PERF.brakeDist, -MAX_PERF.brakeDist) + 0.3 * span01(h.tractionBrake, 16, 29.5)),
    composure: lo + (hi - lo) * (0.25 * span01(-h.landLoss, -0.015, -0.006) + 0.25 * span01(-h.offDrag, -0.17, -0.11)
      + 0.25 * span01(-h.scrub, -0.06, -0.03) + 0.25 * span01(h.contactTol, 0.15, 0.24)),
    lights: 0,
  };
  const L = { 'lamps-none': 0.3, 'lamps-pod': 0.6, 'lamps-big': 0.85 }[b.parts.lamps] + (b.parts.roof === 'roof-lamps' ? 0.15 : 0);
  stats.lights = clamp(L, 0, 1);
  for (const k in stats) stats[k] = Math.round(stats[k] * 1000) / 1000;
  return stats;
}

// ---------------------------------------------------------------- model
const C = {
  dark: '#2b2c33', trim: '#3a3c45', glass: '#26313d', light: '#fff4d6', lamp: '#fff8e6',
  tail: '#d8252b', amber: '#f39a2b', stripe: '#f3efe4', tyre: '#1f2024', hub: '#d8d4c8', flap: '#c62c2c',
  skid: '#8a8d94', number: '#22232a', well: '#17181c', chrome: '#c9ccd2',
};
const FLAP_HEX = { 'flaps-red': C.flap, 'flaps-white': '#ecebe4', 'flaps-black': '#1c1d21' };

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
function cylY(r, h, seg = 12) { return new THREE.CylinderGeometry(r, r, h, seg); }
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

// bonnet surface height (top of the bevelled body) at z
const hoodY = (z) => 0.78 + (1.93 - z) / (1.93 - 1.05) * (0.93 - 0.78) + 0.07;
const HOOD_ANG = Math.atan2(0.15, 1.93 - 1.05);
const onHood = (g, hex, x, z, lift = 0.005) => { g.rotateX(HOOD_ANG); return part(g, hex, x, hoodY(z) + lift, z); };

// 7-segment style door numbers (drawn on the x = const plane, facing outward)
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abfgcd' };
function digit(d, ch, x, y, z, sx, k) {
  const w = 0.16 * k, h = 0.28 * k, t = 0.05 * k;
  const segs = { a: [0, h / 2, 1], b: [w / 2, h / 4, 0], c: [w / 2, -h / 4, 0], d: [0, -h / 2, 1], e: [-w / 2, -h / 4, 0], f: [-w / 2, h / 4, 0], g: [0, 0, 1] };
  for (const s of SEG[ch]) {
    const [u, v, horiz] = segs[s];
    const g = horiz ? box(0.02, t, w + t) : box(0.02, h / 2 + t, t);
    d.push(part(g, C.number, x, y + v, z - sx * u)); // viewer's right on the +x side is -z
  }
}
function roundel(d, x, y, z, sx, num) {
  d.push(part(cylX(0.27, 0.02, 16), C.stripe, x, y, z));
  const xo = x + sx * 0.012;
  if (num === '7') { // the original bold 7
    d.push(part(box(0.02, 0.06, 0.24), C.number, xo, y + 0.1, z));
    const diag = box(0.02, 0.3, 0.07); diag.rotateX(-sx * 0.45);
    d.push(part(diag, C.number, xo, y - 0.04, z - sx * 0.05));
  } else if (num.length === 1) digit(d, num, xo, y, z, sx, 1);
  else { digit(d, num[0], xo, y, z + sx * 0.085, sx, 0.72); digit(d, num[1], xo, y, z - sx * 0.085, sx, 0.72); }
}

function buildWheel(dm, style, side) {
  const r = dm.wheelR, w = dm.wheelW, o = w / 2;
  const parts = [];
  parts.push(part(cylX(r, w, 14), C.tyre));
  parts.push(part(cylX(r * 0.92, w + 0.02, 14), C.tyre)); // sidewall shoulder
  const rr = 0.21 * r / 0.36;
  if (style === 'wheels-white') {
    parts.push(part(cylX(rr * 1.05, 0.04, 12), '#f2f1ec', o, 0, 0));
    for (let k = 0; k < 3; k++) { const b = box(0.03, r * 0.95, 0.07); b.rotateX(k * Math.PI / 3); parts.push(part(b, '#3a3c45', o + 0.025, 0, 0)); }
    parts.push(part(cylX(rr * 0.4, 0.05, 10), '#f2f1ec', o + 0.03, 0, 0));
  } else if (style === 'wheels-gold') {
    parts.push(part(cylX(rr * 1.05, 0.04, 12), '#3a3226', o, 0, 0));
    for (let k = 0; k < 5; k++) { const b = box(0.03, r * 0.98, 0.05); b.rotateX(k * Math.PI / 5); parts.push(part(b, '#d3aa45', o + 0.02, 0, 0)); }
    parts.push(part(cylX(rr * 0.32, 0.06, 10), '#d3aa45', o + 0.03, 0, 0));
  } else if (style === 'wheels-dish') {
    parts.push(part(cylX(rr * 1.12, 0.03, 14), C.chrome, o + 0.005, 0, 0));
    parts.push(part(cylX(rr * 0.92, 0.04, 12), '#18191d', o + 0.01, 0, 0));
    for (let k = 0; k < 2; k++) { const b = box(0.03, r * 0.8, 0.05); b.rotateX(k * Math.PI / 2); parts.push(part(b, '#33353c', o + 0.025, 0, 0)); }
    parts.push(part(cylX(rr * 0.25, 0.05, 8), C.chrome, o + 0.03, 0, 0));
  } else { // steel: the original light hubs with a dark cross
    parts.push(part(cylX(rr, 0.04, 10), C.hub, o, 0, 0));
    parts.push(part(box(0.03, r, 0.06), C.dark, o + 0.025, 0, 0));
    parts.push(part(box(0.03, 0.06, r), C.dark, o + 0.025, 0, 0));
    parts.push(part(cylX(0.06 * r / 0.36, 0.05, 8), C.hub, o + 0.03, 0, 0));
  }
  const g = merge(parts);
  if (side < 0) g.rotateY(Math.PI); // hub faces outward on the right-hand wheels
  return g;
}

// visual dimensions for a build (cosmetic only: physics uses PHYS)
function visDims(b) {
  const chunky = b.tyres >= 3, wide = b.parts.arches === 'arches-wide';
  return {
    wheelR: chunky ? 0.375 : 0.36, wheelW: chunky ? 0.32 : 0.26,
    wx: wide ? 0.88 : 0.82, wz: 1.25, wzR: 1.25,
    pivot: 0.45, ride: b.suspension >= 3 ? 0.08 : 0,
  };
}

// -> { paint: [], accent: [], d: [] } geometry lists for the Rook body with the build's parts
function buildRook(b, dm) {
  const P = b.parts, paint = [], acc = [], d = [];
  const twoTone = P.livery === 'livery-twotone';

  // shell
  paint.push(part(profileBody([
    [-1.9, 0.42], [1.86, 0.42], [1.96, 0.56], [1.93, 0.78], [1.05, 0.93],
    [-1.62, 0.98], [-1.9, 0.9], [-1.95, 0.6],
  ], 1.6), '#fff'));
  for (const sx of [-1, 1]) paint.push(part(box(0.12, 0.1, 0.16), '#fff', sx * 0.9, 1.06, 0.74)); // mirrors
  (twoTone ? acc : paint).push(part(frustum(1.36, 1.72, 1.24, 1.5, 0.07, -0.05), '#fff', 0, 1.5, -0.72)); // roof panel
  d.push(part(frustum(1.6, 2.7, 1.3, 1.72, 0.55, -0.22), C.glass, 0, 0.95, -0.4));
  d.push(part(box(1.62, 0.04, 2.64), C.trim, 0, 0.97, -0.4));
  d.push(part(box(1.86, 0.28, 0.28), C.dark, 0, 0.5, -1.98));
  for (const sx of [-1, 1]) {
    d.push(part(box(0.38, 0.17, 0.06), C.light, sx * 0.58, 0.7, 2.0));
    d.push(part(box(0.18, 0.08, 0.05), C.amber, sx * 0.62, 0.57, 2.1));
    d.push(part(box(0.34, 0.18, 0.06), C.tail, sx * 0.6, 0.82, -2.02));
  }
  d.push(part(box(1.2, 0.04, 0.3), C.glass, 0, 0.99, -1.72));
  for (const sx of [-1, 1]) d.push(part(box(0.06, 0.16, 1.4), C.dark, sx * 0.9, 0.5, 0));

  // arches
  if (P.arches === 'arches-wide') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      paint.push(part(frustum(0.3, 1.36, 0.3, 1.0, 0.36), '#fff', sx * 0.95, 0.66, sz * dm.wz));
      const well = new THREE.CylinderGeometry(0.47, 0.47, 0.02, 10, 1, false, 0, Math.PI);
      well.rotateZ(Math.PI / 2);
      d.push(part(well, C.well, sx * 0.885, 0.38, sz * dm.wz));
      d.push(part(box(0.3, 0.06, 1.38), C.dark, sx * 0.95, 0.66, sz * dm.wz));
    }
  } else {
    const arch = new THREE.Shape();
    arch.absarc(0, 0, 0.54, 0, Math.PI, false);
    arch.absarc(0, 0, 0.43, Math.PI, 0, true);
    const archG = new THREE.ExtrudeGeometry(arch, { depth: 0.16, bevelEnabled: false, curveSegments: 5 });
    archG.rotateY(-Math.PI / 2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const g = archG.clone(); g.translate(sx > 0 ? 0.16 : 0, 0, 0);
      paint.push(part(g, '#fff', sx * 0.82, 0.38, sz * dm.wz));
      const well = new THREE.CylinderGeometry(0.44, 0.44, 0.02, 10, 1, false, 0, Math.PI);
      well.rotateZ(Math.PI / 2);
      d.push(part(well, C.well, sx * 0.885, 0.38, sz * dm.wz));
    }
  }

  // front
  d.push(part(box(1.86, 0.26, 0.3), C.dark, 0, 0.47, 1.95));
  if (P.front === 'front-splitter') {
    d.push(part(box(2.02, 0.07, 0.56), C.dark, 0, 0.36, 2.0));
    for (const sx of [-1, 1]) d.push(part(box(0.05, 0.12, 0.3), C.dark, sx * 0.98, 0.42, 2.0));
    d.push(part(box(0.07, 0.16, 0.16), '#f2c230', 0.45, 0.45, 2.15));
  } else {
    d.push(part(box(1.3, 0.06, 0.6), C.skid, 0, 0.36, 1.7));
  }
  if (P.front === 'front-bull') {
    const T = '#5b5e66';
    for (const sx of [-1, 1]) d.push(part(cylY(0.045, 0.5, 8), T, sx * 0.5, 0.62, 2.2));
    d.push(part(cylX(0.045, 1.14, 8), T, 0, 0.86, 2.2));
    d.push(part(cylX(0.04, 1.4, 8), T, 0, 0.5, 2.18));
    for (const sx of [-1, 1]) d.push(part(cylZ(0.035, 0.2, 6), T, sx * 0.5, 0.86, 2.1));
  }
  // grille / intercooler (engine L3)
  if (b.engine >= 3) {
    d.push(part(box(0.86, 0.2, 0.06), '#9aa0a8', 0, 0.7, 2.0));
    for (let k = -1; k <= 1; k++) d.push(part(box(0.88, 0.025, 0.03), '#4a4d55', 0, 0.7 + k * 0.06, 2.035));
  } else d.push(part(box(0.7, 0.16, 0.06), C.dark, 0, 0.7, 2.0));

  // exhaust (bigger tip from engine L2)
  if (b.engine >= 2) {
    d.push(part(cylZ(0.095, 0.32, 10), C.chrome, 0.55, 0.42, -2.07));
    d.push(part(cylZ(0.065, 0.04, 10), '#141417', 0.55, 0.42, -2.23));
  } else d.push(part(cylZ(0.06, 0.25, 8), C.skid, 0.55, 0.4, -2.05));
  // bonnet vents (engine L2) and scoop (engine L3)
  if (b.engine >= 2) for (const sx of [-1, 1]) d.push(onHood(box(0.24, 0.03, 0.34), C.dark, sx * 0.48, 1.32, 0.01));
  if (b.engine >= 3) {
    paint.push(onHood(frustum(0.56, 0.7, 0.46, 0.5, 0.16, -0.06), '#fff', 0, 1.3, -0.01));
    d.push(onHood(box(0.42, 0.11, 0.04), '#101114', 0, 1.62, 0.07));
  }

  // bonnet lamps
  const podZ = 1.62;
  if (P.lamps === 'lamps-pod') {
    d.push(part(box(1.16, 0.2, 0.2), C.dark, 0, hoodY(podZ) + 0.1, podZ));
    for (let k = 0; k < 4; k++) d.push(part(cylZ(0.1, 0.06, 10), C.lamp, -0.42 + k * 0.28, hoodY(podZ) + 0.11, podZ + 0.12));
  } else if (P.lamps === 'lamps-big') {
    d.push(part(box(1.58, 0.3, 0.22), C.dark, 0, hoodY(podZ) + 0.15, podZ));
    for (let k = 0; k < 4; k++) {
      d.push(part(cylZ(0.17, 0.05, 12), '#c9ccd2', -0.57 + k * 0.38, hoodY(podZ) + 0.16, podZ + 0.11));
      d.push(part(cylZ(0.14, 0.06, 12), C.lamp, -0.57 + k * 0.38, hoodY(podZ) + 0.16, podZ + 0.13));
    }
  }

  // wing
  const plateTop = { 'wing-rally': 1.735, 'wing-big': 1.92 }[P.wing];
  if (P.wing === 'wing-lip') {
    paint.push(part(frustum(1.24, 0.2, 1.28, 0.14, 0.06, -0.04), '#fff', 0, 1.56, -1.58));
  } else if (P.wing === 'wing-duck') {
    paint.push(part(frustum(1.64, 0.4, 1.7, 0.18, 0.15, -0.1), '#fff', 0, 0.98, -1.8));
  } else if (P.wing === 'wing-rally') {
    paint.push(part(box(1.66, 0.06, 0.42), '#fff', 0, 1.7, -1.72));
    for (const sx of [-1, 1]) {
      d.push(part(box(0.06, 0.2, 0.12), C.dark, sx * 0.5, 1.6, -1.66));
      d.push(part(box(0.04, 0.2, 0.46), C.dark, sx * 0.84, 1.7, -1.72));
    }
  } else if (P.wing === 'wing-big') {
    paint.push(part(box(2.0, 0.07, 0.6), '#fff', 0, 1.885, -1.86));
    for (const sx of [-1, 1]) {
      d.push(part(box(0.07, 0.86, 0.14), C.dark, sx * 0.55, 1.44, -1.84));
      d.push(part(box(0.05, 0.38, 0.76), C.dark, sx * 1.02, 1.86, -1.87));
    }
    acc.push(part(box(2.0, 0.03, 0.12), '#fff', 0, 1.935, -1.62));
  }

  // roof
  if (P.roof === 'roof-rack') {
    for (const sx of [-1, 1]) d.push(part(box(0.05, 0.05, 1.5), C.dark, sx * 0.55, 1.66, -0.72));
    for (const z of [-0.05, -0.72, -1.4]) d.push(part(box(1.15, 0.05, 0.05), C.dark, 0, 1.66, z));
    for (const sx of [-1, 1]) for (const z of [-0.05, -1.4]) d.push(part(box(0.05, 0.1, 0.05), C.dark, sx * 0.55, 1.61, z));
    d.push(part(cylY(0.3, 0.17, 12), C.tyre, 0, 1.77, -0.75));
    d.push(part(cylY(0.17, 0.18, 10), C.hub, 0, 1.775, -0.75));
    d.push(part(box(0.06, 0.02, 0.66), '#c9572e', 0, 1.865, -0.75));
  } else if (P.roof === 'roof-scoop') {
    paint.push(part(frustum(0.52, 0.74, 0.44, 0.52, 0.2, -0.06), '#fff', 0, 1.57, -0.3));
    d.push(part(box(0.38, 0.13, 0.04), '#101114', 0, 1.66, 0.06));
  } else if (P.roof === 'roof-lamps') {
    d.push(part(box(1.3, 0.14, 0.14), C.dark, 0, 1.67, 0.02));
    for (const sx of [-1, 1]) d.push(part(box(0.05, 0.1, 0.12), C.dark, sx * 0.55, 1.6, 0.02));
    for (let k = 0; k < 4; k++) d.push(part(cylZ(0.085, 0.05, 10), C.lamp, -0.45 + k * 0.3, 1.67, 0.1));
  }

  // livery (accent colour)
  if (P.livery === 'livery-twin' || P.livery === 'livery-offset') {
    const xs = P.livery === 'livery-twin' ? [-0.16, 0.16] : [0.3];
    const w = P.livery === 'livery-twin' ? 0.16 : 0.34;
    for (const x of xs) {
      acc.push(onHood(box(w, 0.02, 0.62), '#fff', x, 1.22));
      acc.push(part(box(w, 0.02, 1.52), '#fff', x, 1.585, -0.77));
      if (plateTop) acc.push(part(box(w, 0.02, P.wing === 'wing-big' ? 0.4 : 0.42), '#fff', x * (P.wing === 'wing-big' ? 1.2 : 1), plateTop, P.wing === 'wing-big' ? -1.9 : -1.72));
      if (P.livery === 'livery-offset') acc.push(part(box(w, 0.3, 0.02), '#fff', x, 0.72, -2.0)); // down the tailgate
    }
  } else if (P.livery === 'livery-band') {
    // sheared bands whose ends follow the panel edges: bonnet front-left to rear-right, roof the same way
    const shear = (g, k) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - p.getX(i) * k); g.computeVertexNormals(); return g; };
    acc.push(onHood(shear(box(1.62, 0.02, 0.4), 0.42), '#fff', 0, 1.42, 0.012));
    acc.push(part(shear(box(1.26, 0.02, 0.42), 1.05), '#fff', 0, 1.585, -0.72));
  } else if (P.livery === 'livery-twotone') {
    const ang = Math.atan2(0.15, 0.55); // glass side slope
    for (const sx of [-1, 1]) for (const z of [-0.35, -1.25]) {
      const pl = box(0.03, 0.58, 0.16); pl.rotateZ(sx * ang);
      acc.push(part(pl, '#fff', sx * 0.735, 1.22, z));
    }
    for (const sx of [-1, 1]) acc.push(part(box(0.03, 0.08, 1.9), '#fff', sx * 0.885, 0.9, -0.1)); // belt line
  } else if (P.livery === 'livery-chequer') {
    const q = 0.14;
    for (const sx of [-1, 1]) for (const zc of [0.56, -0.56]) for (let row = 0; row < 4; row++) for (let col = 0; col < 2; col++) {
      if ((row + col + (zc > 0 ? 0 : 1)) % 2) continue;
      acc.push(part(box(0.02, q, q), '#fff', sx * 0.945, 0.49 + row * q, zc + (col - 0.5) * q));
    }
    acc.push(part(box(1.36, 0.02, 0.14), '#fff', 0, 1.585, 0.0)); // roof edge band
  }

  // door number
  if (P.number !== 'number-none') {
    const num = P.number.split('-')[1];
    for (const sx of [-1, 1]) roundel(d, sx * 0.94, 0.7, -0.1, sx, num);
  }

  // mud flaps
  if (P.flaps !== 'flaps-none') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) d.push(part(box(0.3, 0.3, 0.03), FLAP_HEX[P.flaps], sx * dm.wx, 0.27, sz * dm.wz - 0.5));
  }
  return { paint, acc, d };
}

// ---------------------------------------------------------------- the car
export class Car {
  constructor(build = DEFAULT_BUILD) {
    if (typeof build === 'string') build = DEFAULT_BUILD; // legacy car id (old ghost records)
    this.carId = 'rook';  // deprecated: there is only the Rook now
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.paintMat = new THREE.MeshLambertMaterial({ color: PAINTS[0].hex, flatShading: true });
    this.accentMat = new THREE.MeshLambertMaterial({ color: ACCENTS[0].hex, flatShading: true });
    this.detailMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this._ghost = false;
    this._ghostMat = null;
    this.model = null;

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
    this.setBuild(build);
  }

  // rebuild model + handling in place: car.group, its foreign children, pose, physics state and ghost mode are kept
  setBuild(build) {
    const b = this.build = normalizeBuild(build);
    this.H = buildHandling(b);
    const dm = this.dims = visDims(b);
    const spin = this.wheels ? this.wheels[0].rotation.x : 0;

    if (this.model) {
      this.group.remove(this.model);
      this.model.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    const model = this.model = new THREE.Group();
    model.name = 'rook-model';
    this.body = new THREE.Group();
    this.body.position.y = dm.pivot + dm.ride;
    model.add(this.body);

    const g = buildRook(b, dm);
    this._meshes = [];
    for (const [list, mat, recv] of [[g.paint, this.paintMat, true], [g.acc, this.accentMat, true], [g.d, this.detailMat, true]]) {
      if (!list.length) continue;
      const geo = merge(list);
      geo.translate(0, -dm.pivot, 0);
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = recv;
      this.body.add(m);
      this._meshes.push(m);
    }
    const wl = buildWheel(dm, b.parts.wheels, 1), wr = buildWheel(dm, b.parts.wheels, -1);
    this.wheels = [];
    this.wheelPivots = [];
    const pos = [[dm.wx, dm.wz], [-dm.wx, dm.wz], [dm.wx, -dm.wzR], [-dm.wx, -dm.wzR]];
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      pivot.position.set(pos[i][0], dm.wheelR, pos[i][1]);
      pivot.rotation.y = i < 2 ? this.steer : 0;
      const m = new THREE.Mesh(pos[i][0] > 0 ? wl : wr, this.detailMat);
      m.castShadow = true;
      m.rotation.x = spin;
      pivot.add(m);
      model.add(pivot);
      this.wheels.push(m);
      this.wheelPivots.push(pivot);
      this._meshes.push(m);
    }
    this.wheelLocal = pos;
    this.group.add(model);

    this.paintMat.color.set(b.paint);
    this.accentMat.color.set(b.accent);
    this.body.rotation.set(this._bPitch, 0, this._bRoll);
    if (this._ghost) { this._ghost = false; this.setGhost(true); }
    else if (this._ghostMat) this._ghostMat.color.set(b.paint).lerp(new THREE.Color('#ffffff'), 0.35);
    return this;
  }

  setPaint(hex) {
    this.paintMat.color.set(hex);
    if (typeof hex === 'string' && HEX.test(hex)) this.build.paint = hex.toLowerCase();
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
    this.body.position.y = this.dims.pivot + this.dims.ride;
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
    const contact = this.grounded || this.y - h < K.contactTol;

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
    const baseLat = GRIP * K.grip * grip * (1 - K.offGripLoss * off) * (1 + K.planted * smoothstep(15, 35, speed));
    let aLong = 0, aLat = 0;
    const beta = Math.atan2(vl, Math.abs(vf) + 1.5);
    if (contact) {
      // ---- longitudinal ----
      let drive = 0, decel = 0;
      if (vf > -1) drive += thr * K.power * Math.max(0, 1 - vf / K.vmax);
      else drive += thr * 14;
      const braking = brk > 0 && vf > 1;
      if (brk > 0) {
        if (vf > 1) decel += brk * K.brake;
        else if (vf > -REV_MAX) drive -= brk * REV_ACC * Math.min(1, (vf + REV_MAX) / 2);
      }
      if (hand) decel += K.handDec;
      if (thr < 0.05 && vf > 2) decel += 1.1 + 0.025 * vf; // engine braking
      decel += K.roll + Math.abs(vf) * (0.03 + K.offDrag * off) + off * K.offFlat;
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
      const use = Math.min(1, longUse / (braking ? K.tractionBrake : K.traction));
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
      // anti-spin: pull back hard past the slide limit
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
        if (hit > K.landHit) {
          this.impact = Math.max(this.impact, hit * 0.5);
          const k = 1 - Math.min(K.landCap, (hit - K.landHit) * K.landLoss);
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
    const K = this.H, dm = PHYS;
    const halfW = dm.wx + dm.wheelW * 0.5;
    const rad = Math.max(0.8, halfW);
    const e = 0.25 + 0.15 * (1 - K.mass);
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
        const keep = 1 - 0.85 * head * head - K.scrub;
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
    const K = this.H;
    // interpolate between the last two physics states (render lags physics by < 1 step)
    this._vt = clamp(this._vt + dt, this.time - this._lastDt, this.time);
    const alpha = clamp(1 - (this.time - this._vt) / this._lastDt, 0, 1);

    // integrate the cosmetic springs in small fixed sub-steps so low frame rates stay stable
    const rT = clamp(this.aLat * 0.009 * K.lean, -MAX_ROLL, MAX_ROLL);
    const pT = clamp(-this.aLong * 0.005 * K.lean, -MAX_PITCH, MAX_PITCH);
    if (this._land > 0) { this._bobV -= Math.min(this._land, 12) * 0.2 * K.lean; this._land = 0; }
    const rough = this.speed * (0.0015 + 0.008 * this.offroad) * K.lean;
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
    this.body.position.y = this.dims.pivot + this.dims.ride + this._bob;

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

// a model-only group (no physics) for the garage turntable
export function buildCarPreview(build = DEFAULT_BUILD) {
  const c = new Car(build);
  c.group.userData.car = c;
  return c.group;
}

// ---------------------------------------------------------------------------
// Autopilot: pure pursuit + curvature-based speed planning (scaled to the build's handling)
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
  // the reference driver brakes harder and later with stronger brakes (stock = 9 m/s^2), and commits to a little
  // more corner-entry speed the steadier the car is under braking (stock = 0.75 of the grip limit)
  const bDec = 9 * Math.pow(K.brake / 17, 1.5);
  const entry = 0.75 + 0.03 * (K.tractionBrake - 16) / 13.5;
  let vT = 70;
  for (let k = 0; k <= span; k++) {
    const i = Math.min(N - 1, i0 + k);
    const c = Math.abs(stage.curv[i]);
    let vc = c > 1e-4 ? Math.sqrt(lat * entry / c) : 70;
    if (K.planted && c > 1e-4) vc = Math.sqrt(lat * (1 + K.planted * smoothstep(15, 35, vc)) * entry / c);
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
