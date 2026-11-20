import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

export const STEP = 2;
export const ROAD_HALF = 3.6;

// Stage defs. Shape: seed, points, twist, sharp, hills (these alone decide the road). Feel: grip, flora.
// Palette: sky [top, horizon], fog, fogRange, ground[3], rock, verge, road[2], dust, sun, sunPos, ambient [sky, ground].
// Conditions: night, rain (bools), lightIntensity { sun, ambient } multipliers (default 1/1).
// Coast only: seaLevel (absolute y of the sea plane), sea (colour), sand (beach colour).
// Desert extras (optional): cactus / mesa (scenery mix shares), mesaH (mesa height scale), dens (density threshold).
// par: reference time in seconds = the car.js autopilot at dt 1/120, start gate to finish gate (baked offline).
export const STAGES = [
  // ---------------------------------------------------------------- forest
  {
    id: 'larch', name: 'Larch Hollow', tag: 'Autumn forest · loose gravel', seed: 7, points: 30,
    twist: 1.0, sharp: 0.22, hills: 15, grip: 1.0, flora: 'forest',
    region: 'forest', night: false, rain: false, par: 72.6,
    sky: ['#8fc4d8', '#f7e3bd'], fog: '#f1dfbf', fogRange: [70, 330],
    ground: ['#93a644', '#b9b356', '#7b9440'], rock: '#8f8a7d', verge: '#b09a66',
    road: ['#cfae7c', '#bf9d6b'], dust: '#d9c29a', sun: '#fff0d2', sunPos: [60, 70, 30], ambient: ['#cfe6f5', '#8a7a50'],
  },
  {
    id: 'mossbrook', name: 'Mossbrook Run', tag: 'Forest rain · wet gravel', seed: 58, points: 34,
    twist: 1.05, sharp: 0.24, hills: 14, grip: 0.85, flora: 'forest',
    region: 'forest', night: false, rain: true, par: 81.4,
    sky: ['#6f7b80', '#aeb8b4'], fog: '#a3ada9', fogRange: [40, 230],
    ground: ['#56743a', '#6b7f3c', '#45663a'], rock: '#6f716c', verge: '#7a6d4f',
    road: ['#8f7a5c', '#7d6a4f'], dust: '#5c5a52', sun: '#d9e0e0', sunPos: [30, 80, 20], ambient: ['#b9c6c8', '#55583f'],
  },
  {
    id: 'owlcrest', name: 'Owlcrest by Night', tag: 'Forest night · headlights', seed: 77, points: 38,
    twist: 1.15, sharp: 0.26, hills: 18, grip: 0.95, flora: 'forest',
    region: 'forest', night: true, rain: false, par: 96.4, lightIntensity: { sun: 0.25, ambient: 0.45 },
    sky: ['#03060f', '#1a2742'], fog: '#111a2d', fogRange: [25, 190],
    ground: ['#5f7f52', '#728c58', '#4f7050'], rock: '#7d8590', verge: '#9a9070',
    road: ['#c9b48f', '#b9a37e'], dust: '#8a8a8a', sun: '#b9cdff', sunPos: [-40, 60, 50], ambient: ['#8ea6e0', '#2c3550'],
  },
  // ---------------------------------------------------------------- desert
  {
    id: 'mesa', name: 'Saltwind Mesa', tag: 'High desert · hardpack', seed: 23, points: 36,
    twist: 0.8, sharp: 0.3, hills: 10, grip: 1.08, flora: 'desert',
    region: 'desert', night: false, rain: false, par: 88.8,
    sky: ['#6f8fc9', '#ffc9a3'], fog: '#fbc9a4', fogRange: [90, 380],
    ground: ['#d98f5c', '#e3a76a', '#c97a50'], rock: '#a8573f', verge: '#d9a777',
    road: ['#efd2a4', '#e2c08f'], dust: '#f1d3ab', sun: '#ffe2c0', sunPos: [-70, 45, 40], ambient: ['#ffd9c2', '#a25a3c'],
  },
  {
    id: 'ember', name: 'Ember Flats', tag: 'Desert dusk · fast sweepers', seed: 91, points: 48,
    twist: 0.6, sharp: 0.12, hills: 9, grip: 1.08, flora: 'desert',
    region: 'desert', night: false, rain: false, par: 107.7,
    sky: ['#4b4f8f', '#ff9a5c'], fog: '#f29a68', fogRange: [80, 360],
    ground: ['#c9774a', '#d98c55', '#b8653f'], rock: '#8e4434', verge: '#d8915e',
    road: ['#e9b884', '#d9a573'], dust: '#efb98a', sun: '#ffb070', sunPos: [-80, 18, 60], ambient: ['#ffc2a0', '#7a3f3a'],
  },
  {
    id: 'redcleft', name: 'Redcleft Gorge', tag: 'Canyon · tight and technical', seed: 104, points: 26,
    twist: 1.3, sharp: 0.42, hills: 12, grip: 1.02, flora: 'desert',
    region: 'desert', night: false, rain: false, par: 75.6, cactus: 0.18, mesa: 0.52, mesaH: 1.8, dens: 0.5,
    sky: ['#5f86c4', '#f3c7a0'], fog: '#e9b893', fogRange: [70, 320],
    ground: ['#c4683f', '#d27f4f', '#b05a3a'], rock: '#93412f', verge: '#cf8f63',
    road: ['#e7c194', '#d8ae80'], dust: '#ebc39a', sun: '#ffe0b8', sunPos: [40, 75, -20], ambient: ['#ffd3b4', '#8c4632'],
  },
  // ---------------------------------------------------------------- snow
  {
    id: 'glimmer', name: 'Glimmerfield Sprint', tag: 'Bluebird day · packed snow', seed: 133, points: 28,
    twist: 0.9, sharp: 0.2, hills: 16, grip: 0.88, flora: 'snow',
    region: 'snow', night: false, rain: false, par: 63.1,
    sky: ['#2f76d2', '#cfe6fb'], fog: '#d8e9f8', fogRange: [90, 380],
    ground: ['#f7fafd', '#e8f0f8', '#dbe7f2'], rock: '#6d7b8c', verge: '#dfe8f0',
    road: ['#c9d3dd', '#b6c3cf'], dust: '#f7fafd', sun: '#fffaf0', sunPos: [70, 60, 20], ambient: ['#d4e6ff', '#7c8ba3'],
  },
  {
    id: 'frost', name: 'Frostfell Pass', tag: 'Alpine snow · low grip', seed: 41, points: 32,
    twist: 1.1, sharp: 0.2, hills: 20, grip: 0.72, flora: 'snow',
    region: 'snow', night: false, rain: false, par: 82.0,
    sky: ['#7fa3c9', '#e6eef5'], fog: '#e3ebf2', fogRange: [60, 300],
    ground: ['#f4f7fa', '#e4ecf3', '#d5e0ea'], rock: '#7c8794', verge: '#d9e2ea',
    road: ['#cdd6de', '#bcc7d1'], dust: '#f5f8fb', sun: '#fff6e8', sunPos: [50, 50, -50], ambient: ['#dbe9ff', '#8793a6'],
  },
  {
    id: 'lanternfell', name: 'Lanternfell Night', tag: 'Snow at night · ice ruts', seed: 151, points: 36,
    twist: 1.15, sharp: 0.25, hills: 22, grip: 0.7, flora: 'snow',
    region: 'snow', night: true, rain: false, par: 99.4, lightIntensity: { sun: 0.25, ambient: 0.45 },
    sky: ['#040814', '#1b2a4a'], fog: '#142038', fogRange: [30, 210],
    ground: ['#e9eef6', '#d9e2ee', '#c9d5e4'], rock: '#5c6676', verge: '#cdd7e3',
    road: ['#aeb9c8', '#9caabb'], dust: '#dfe6f0', sun: '#c4d4ff', sunPos: [-50, 55, 40], ambient: ['#8ea4d8', '#2e3a55'],
  },
  // ---------------------------------------------------------------- coast
  {
    id: 'brightwater', name: 'Brightwater Cove', tag: 'Sunlit coast · limestone', seed: 167, points: 32,
    twist: 0.85, sharp: 0.18, hills: 9, grip: 1.04, flora: 'coast',
    region: 'coast', night: false, rain: false, par: 81.1, seaLevel: 0, sea: '#2aa39b', sand: '#efe2bd',
    sky: ['#4f9ed8', '#d9f0f2'], fog: '#d4ecee', fogRange: [90, 380],
    ground: ['#c4c58a', '#b0b778', '#97a266'], rock: '#e6e1d4', verge: '#e4dabd',
    road: ['#f1e9d4', '#e3d8bd'], dust: '#efe6d0', sun: '#fff4dc', sunPos: [60, 70, -30], ambient: ['#d6eef5', '#9c9470'],
  },
  {
    id: 'saffron', name: 'Saffron Cape', tag: 'Coast sunset · dry hardpack', seed: 181, points: 40,
    twist: 1.0, sharp: 0.26, hills: 11, grip: 1.0, flora: 'coast',
    region: 'coast', night: false, rain: false, par: 103.5, seaLevel: 0, sea: '#24727f', sand: '#f0cf9e',
    sky: ['#4a5a9e', '#ffb17a'], fog: '#f4b98c', fogRange: [80, 360],
    ground: ['#b89d5e', '#a3985b', '#8a8a50'], rock: '#ecd8c0', verge: '#e8cf9f',
    road: ['#f0dcb8', '#e2caa2'], dust: '#efcfa6', sun: '#ffbf80', sunPos: [70, 20, 50], ambient: ['#ffcfae', '#7d5a48'],
  },
  {
    id: 'gullrock', name: 'Gullrock Squall', tag: 'Coast rain · slick limestone', seed: 199, points: 44,
    twist: 1.15, sharp: 0.3, hills: 12, grip: 0.86, flora: 'coast',
    region: 'coast', night: false, rain: true, par: 115.3, seaLevel: 0, sea: '#2d5f63', sand: '#b9b29a',
    sky: ['#5f6c73', '#a9b4b4'], fog: '#9aa6a7', fogRange: [40, 230],
    ground: ['#9aa07a', '#8a9468', '#76845a'], rock: '#c9c8bf', verge: '#9b9479',
    road: ['#8f897a', '#7f7a6c'], dust: '#5f625d', sun: '#dde3e3', sunPos: [-30, 80, 10], ambient: ['#bcc8cb', '#5a5a48'],
  },
];

export const REGIONS = [
  { id: 'forest', name: 'Hollowmere Woods', blurb: 'Gravel lanes under larch and pine: autumn sun, soaking rain, and a moonlit night run.', stages: ['larch', 'mossbrook', 'owlcrest'] },
  { id: 'desert', name: 'Saltwind Badlands', blurb: 'Hardpack across red mesas: wide-open plateau, fast dusk sweepers and a tight canyon.', stages: ['mesa', 'ember', 'redcleft'] },
  { id: 'snow', name: 'Frostfell Range', blurb: 'Packed snow and ice between the firs: bluebird sprint, alpine pass and a night descent.', stages: ['glimmer', 'frost', 'lanternfell'] },
  { id: 'coast', name: 'Corallin Coast', blurb: 'White limestone tracks above a teal sea, lined with umbrella pines and palms.', stages: ['brightwater', 'saffron', 'gullrock'] },
];

export function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const r = mulberry(seed);
  const P = new Uint8Array(512), V = new Float32Array(256);
  const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
  for (let i = 0; i < 256; i++) V[i] = r() * 2 - 1;
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const X = xi & 255, Y = yi & 255;
    const a = V[P[P[X] + Y]], b = V[P[P[X + 1] + Y]];
    const c = V[P[P[X] + Y + 1]], d = V[P[P[X + 1] + Y + 1]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- path (x/z only, no noise)
// R is the stage RNG; it is consumed here first, so the road depends only on seed + shape params.
function samplePath(def, R) {
  const pts = [new THREE.Vector3(0, 0, -90), new THREE.Vector3(0, 0, -40), new THREE.Vector3(0, 0, 20)];
  let x = 0, z = 20, h = 0;
  for (let k = 0; k < def.points; k++) {
    if (R() < def.sharp) h += (R() < 0.5 ? -1 : 1) * (0.75 + R() * 0.5);
    else h += (R() - 0.5) * def.twist * 2;
    h = clamp(h * 0.9, -1.2, 1.2); // heading clamp: always progressing in +Z, so the road never folds back on itself
    const len = 38 + R() * 50;
    x += Math.sin(h) * len; z += Math.cos(h) * len;
    pts.push(new THREE.Vector3(x, 0, z));
  }
  for (let k = 0; k < 3; k++) { x += Math.sin(h) * 45; z += Math.cos(h) * 45; pts.push(new THREE.Vector3(x, 0, z)); }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  curve.arcLengthDivisions = 4000;
  const n = Math.floor(curve.getLength() / STEP);
  const sp = curve.getSpacedPoints(n);
  const N = n + 1;
  const sx = new Float32Array(N), sz = new Float32Array(N), tx = new Float32Array(N), tz = new Float32Array(N), curv = new Float32Array(N);
  for (let i = 0; i < N; i++) { sx[i] = sp[i].x; sz[i] = sp[i].z; }
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
    const dx = sx[b] - sx[a], dz = sz[b] - sz[a], l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l;
  }
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 3), b = Math.min(N - 1, i + 3);
    let dh = Math.atan2(tx[b], tz[b]) - Math.atan2(tx[a], tz[a]);
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    curv[i] = dh / ((b - a) * STEP);
  }
  const startIdx = Math.round(80 / STEP), finishIdx = N - Math.round(70 / STEP);
  return { n: N, sx, sz, tx, tz, curv, startIdx, finishIdx, length: (finishIdx - startIdx) * STEP };
}

// timed length of a stage in metres (start gate to finish gate), path only: ~1-3 ms
export function stageLength(def) { return samplePath(def, mulberry(def.seed)).length; }

// cheap reference-time estimate from the path alone: a curvature speed profile mirroring the autopilot's
// planner (lateral limit from grip, 9 m/s² braking, a speed-dependent acceleration), with fitted constants.
// Fitted against the baked autopilot pars of the 12 STAGES.
export function estimatePar(def) {
  const p = samplePath(def, mulberry(def.seed));
  return Math.round(profileTime(p, def.grip) * 10) / 10;
}
const EP = { lat: 10.5 * 0.75, vmax: 41, acc: 6.5, accFall: 0.11, k: 0.907, c: 0 };
function profileTime(p, grip) {
  const { n, curv, startIdx, finishIdx } = p;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) { const c = Math.abs(curv[i]); v[i] = Math.min(EP.vmax, c > 1e-4 ? Math.sqrt(EP.lat * grip / c) : EP.vmax); }
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * 9 * STEP));
  let s = 0; v[Math.max(0, startIdx - 2)] = Math.min(v[Math.max(0, startIdx - 2)], 3);
  for (let i = Math.max(0, startIdx - 2) + 1; i < n; i++) {
    const a = Math.max(0.5, EP.acc - EP.accFall * v[i - 1]);
    v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * a * STEP));
  }
  for (let i = startIdx; i < finishIdx; i++) s += STEP / Math.max(1, 0.5 * (v[i] + v[i + 1]));
  return EP.k * s + EP.c;
}

// FNV-1a string hash -> uint32
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
const PALETTE_KEYS = ['sky', 'fog', 'fogRange', 'ground', 'rock', 'verge', 'road', 'dust', 'sun', 'sunPos', 'ambient',
  'lightIntensity', 'seaLevel', 'sea', 'sand', 'cactus', 'mesa', 'mesaH', 'dens'];
const BIOME = { forest: 'Forest', desert: 'Desert', snow: 'Snow', coast: 'Coast' };

// The daily stage: same date string => the same stage for everyone. Palette/flora/conditions come from one of
// the 12 templates; the road shape is drawn from ranges that the autopilot was validated on.
export function dailyStage(dateStr) {
  const seedHash = hashStr('dustline-daily:' + dateStr);
  const R = mulberry(seedHash);
  const tpl = STAGES[Math.floor(R() * STAGES.length)];
  const def = { id: 'daily-' + dateStr, name: 'Daily Stage' };
  for (const k of PALETTE_KEYS) if (tpl[k] !== undefined) def[k] = tpl[k];
  Object.assign(def, {
    seed: 1000 + (seedHash % 900000),
    points: 28 + Math.floor(R() * 15),
    twist: 0.7 + R() * 0.45,
    sharp: 0.14 + R() * 0.16,
    hills: Math.round(9 + R() * 11),
    grip: tpl.grip, flora: tpl.flora,
    region: 'daily', daily: true, template: tpl.id,
    night: !!tpl.night, rain: !!tpl.rain,
  });
  def.tag = `${BIOME[tpl.flora]} · ${tpl.night ? 'night' : tpl.rain ? 'rain' : 'clear'} · ${dateStr}`;
  def.par = estimatePar(def);
  return def;
}

function paint(g, hex) {
  if (g.index) g = g.toNonIndexed();
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
export function part(g, hex, x = 0, y = 0, z = 0) { g = paint(g, hex); g.translate(x, y, z); return g; }
export const merge = (arr) => mergeGeometries(arr);

const flatMat = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

function bannerTexture(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  g.fillStyle = fg;
  for (let i = 0; i < 6; i++) { g.fillRect(i * 16 * 2, 0, 16, 16); g.fillRect(i * 32 + 16, 16, 16, 16); g.fillRect(512 - i * 32 - 16, 0, 16, 16); g.fillRect(512 - i * 32 - 32, 16, 16, 16); }
  g.font = 'italic 900 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 56);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Stage {
  constructor(def) {
    this.def = def;
    this.group = new THREE.Group();
    this.R = mulberry(def.seed);
    this.n1 = makeNoise(def.seed * 3 + 1);
    this.n2 = makeNoise(def.seed * 5 + 2);
    this._res = { i: 0, d: 0, lat: 0, along: 0 };
    this.colliders = new Map();
    this.buildPath();
    this.buildTerrain();
    this.buildRoad();
    this.buildScenery();
  }

  baseH(x, z) {
    const A = this.def.hills;
    const h = this.n1(x / 240, z / 240) * A + this.n1(x / 90 + 40, z / 90) * A * 0.35 + this.n2(x / 28, z / 28) * A * 0.07;
    if (!this.coast) return h;
    // coast: beyond a wandering shoreline on the sea side the land falls away to a seabed below sea level
    const c = this.coast;
    let f = (z - c.z0) / c.bin; f = clamp(f, 0, c.nb - 1.001);
    const k = Math.floor(f), u = f - k;
    const X = c.x[k] + (c.x[k + 1] - c.x[k]) * u, C = c.c[k] + (c.c[k + 1] - c.c[k]) * u;
    const lat = (x - X) * C * c.side;
    const land = h + this.hOff;
    if (lat < 25) return land;
    const w0 = 38 + 12 * this.n1(z / 170 + 77, 3.3);
    const bed = this.def.seaLevel - 7 + this.n2(x / 40 + 11, z / 40) * 2;
    return land + (bed - land) * smoothstep(w0, w0 + 60, lat);
  }

  // z -> road x lookup (the road is monotonic in z) used to put the sea on one side of the stage
  buildCoast() {
    const { sx, sz, tz, n } = this, bin = 8;
    const z0 = sz[0], nb = Math.max(2, Math.ceil((sz[n - 1] - z0) / bin) + 1);
    const x = new Float32Array(nb), c = new Float32Array(nb), w = new Float32Array(nb);
    for (let i = 0; i < n; i++) { const k = Math.min(nb - 1, Math.round((sz[i] - z0) / bin)); x[k] += sx[i]; c[k] += Math.abs(tz[i]); w[k]++; }
    let last = 0;
    for (let k = 0; k < nb; k++) if (w[k]) { x[k] /= w[k]; c[k] /= w[k]; last = k; } else if (k > 0) { x[k] = x[k - 1]; c[k] = c[k - 1]; }
    for (let k = last + 1; k < nb; k++) { x[k] = x[last]; c[k] = c[last]; }
    this.coast = { z0, bin, nb, x, c, side: (this.def.seed >> 1) % 2 ? 1 : -1 };
  }

  buildPath() {
    const d = this.def;
    const p = samplePath(d, this.R);
    const N = this.n = p.n;
    this.sx = p.sx; this.sz = p.sz; this.tx = p.tx; this.tz = p.tz; this.curv = p.curv;
    this.hOff = 0;
    if (d.seaLevel != null) this.buildCoast();
    let h0 = new Float32Array(N);
    for (let i = 0; i < N; i++) h0[i] = this.baseH(this.sx[i], this.sz[i]);
    for (let pass = 0; pass < 2; pass++) {
      const h1 = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        let s = 0, c = 0;
        for (let j = Math.max(0, i - 9); j <= Math.min(N - 1, i + 9); j++) { s += h0[j]; c++; }
        h1[i] = s / c;
      }
      h0 = h1;
    }
    if (this.coast) {
      // sit the road's lowest point just above the sea: the whole land surface shifts, the seabed does not
      let mn = Infinity; for (let i = 0; i < N; i++) mn = Math.min(mn, h0[i]);
      this.hOff = d.seaLevel + 2.2 - mn;
      for (let i = 0; i < N; i++) h0[i] += this.hOff;
    }
    this.sy = h0;
    this.startIdx = p.startIdx;
    this.finishIdx = p.finishIdx;
    this.length = p.length;
    this.splits = [1 / 3, 2 / 3].map((f) => Math.round(this.startIdx + (this.finishIdx - this.startIdx) * f));
    this.hash = new Map();
    for (let i = 0; i < N; i++) {
      const k = Math.floor(this.sx[i] / 32) * 100003 + Math.floor(this.sz[i] / 32);
      let a = this.hash.get(k); if (!a) this.hash.set(k, (a = []));
      a.push(i);
    }
  }

  // nearest road sample; hint>=0 searches locally around that index, else uses the spatial hash (32 m reach)
  nearest(x, z, hint = -1) {
    let bi = -1, bd = 1e18;
    const { sx, sz } = this;
    if (hint >= 0) {
      const a = Math.max(0, hint - 60), b = Math.min(this.n - 1, hint + 60);
      for (let i = a; i <= b; i++) { const dx = x - sx[i], dz = z - sz[i], d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
    } else {
      const cx = Math.floor(x / 32), cz = Math.floor(z / 32);
      for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const arr = this.hash.get(ix * 100003 + iz); if (!arr) continue;
        for (let q = 0; q < arr.length; q++) { const i = arr[q], dx = x - sx[i], dz = z - sz[i], d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
      }
    }
    if (bi < 0) return null;
    const r = this._res, dx = x - sx[bi], dz = z - sz[bi];
    r.i = bi;
    r.along = dx * this.tx[bi] + dz * this.tz[bi];
    r.lat = dx * this.tz[bi] - dz * this.tx[bi];
    r.d = (bi === 0 || bi === this.n - 1) ? Math.sqrt(bd) : Math.abs(r.lat);
    return r;
  }

  height(x, z, mesh = false) {
    const b = this.baseH(x, z);
    const n = this.nearest(x, z);
    if (!n || n.d >= 30) return b;
    const f = clamp(n.along / STEP, -1, 1);
    const j = clamp(n.i + Math.sign(f), 0, this.n - 1);
    const ry = this.sy[n.i] + (this.sy[j] - this.sy[n.i]) * Math.abs(f);
    let h = ry + (b - ry) * smoothstep(10, 30, n.d);
    h -= 0.1 * (1 - smoothstep(10, 14, n.d));
    if (!mesh && n.d < ROAD_HALF) h += 0.1;
    return h;
  }

  buildTerrain() {
    const d = this.def, CH = 64, CELL = 4, NC = CH / CELL, R = this.R;
    const chunks = new Set();
    for (let i = 0; i < this.n; i += 6) {
      const cx = Math.floor(this.sx[i] / CH), cz = Math.floor(this.sz[i] / CH);
      for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) {
        const ox = (cx + a + 0.5) * CH - this.sx[i], oz = (cz + b + 0.5) * CH - this.sz[i];
        if (ox * ox + oz * oz < 250 * 250) chunks.add((cx + a) + ',' + (cz + b));
      }
    }
    const g0 = new THREE.Color(d.ground[0]), g1 = new THREE.Color(d.ground[1]), g2 = new THREE.Color(d.ground[2]);
    const rock = new THREE.Color(d.rock), verge = new THREE.Color(d.verge), col = new THREE.Color();
    const sand = this.coast ? new THREE.Color(d.sand || '#efe2bd') : null;
    const wetSand = sand ? sand.clone().lerp(new THREE.Color(d.sea || '#2aa39b'), 0.35).multiplyScalar(0.8) : null;
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    const mat = flatMat();
    const hs = new Float32Array((NC + 1) * (NC + 1)), ds = new Float32Array((NC + 1) * (NC + 1));
    for (const key of chunks) {
      const [cx, cz] = key.split(',').map(Number);
      const x0 = cx * CH, z0 = cz * CH;
      bx0 = Math.min(bx0, x0); bx1 = Math.max(bx1, x0 + CH); bz0 = Math.min(bz0, z0); bz1 = Math.max(bz1, z0 + CH);
      for (let a = 0; a <= NC; a++) for (let b = 0; b <= NC; b++) {
        const x = x0 + a * CELL, z = z0 + b * CELL;
        hs[a * (NC + 1) + b] = this.height(x, z, true);
        const n = this.nearest(x, z); ds[a * (NC + 1) + b] = n ? n.d : 99;
      }
      const pos = new Float32Array(NC * NC * 18), colr = new Float32Array(NC * NC * 18);
      let p = 0;
      const tri = (a1, b1, a2, b2, a3, b3) => {
        const idx = [a1 * (NC + 1) + b1, a2 * (NC + 1) + b2, a3 * (NC + 1) + b3];
        const xs = [x0 + a1 * CELL, x0 + a2 * CELL, x0 + a3 * CELL], zs = [z0 + b1 * CELL, z0 + b2 * CELL, z0 + b3 * CELL];
        const ys = idx.map((i) => hs[i]);
        const ux = xs[1] - xs[0], uy = ys[1] - ys[0], uz = zs[1] - zs[0], vx = xs[2] - xs[0], vy = ys[2] - ys[0], vz = zs[2] - zs[0];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const slope = 1 - ny / Math.hypot(nx, ny, nz);
        const mx = (xs[0] + xs[1] + xs[2]) / 3, mz = (zs[0] + zs[1] + zs[2]) / 3;
        const dd = (ds[idx[0]] + ds[idx[1]] + ds[idx[2]]) / 3;
        const t = this.n2(mx / 70, mz / 70) * 0.5 + 0.5;
        col.copy(g0).lerp(g1, smoothstep(0.3, 0.7, t));
        if (this.n1(mx / 35 + 9, mz / 35) > 0.35) col.lerp(g2, 0.7);
        col.lerp(rock, smoothstep(0.06, 0.16, slope));
        if (sand) { // beaches just above the waterline, darker wet sand at it
          const my = (ys[0] + ys[1] + ys[2]) / 3 - d.seaLevel;
          if (my < 2.2) col.lerp(sand, 1 - smoothstep(1.2, 2.2, my));
          if (my < 0.4) col.lerp(wetSand, smoothstep(0.4, -0.6, my));
        }
        col.lerp(verge, 1 - smoothstep(4, 12, dd));
        col.multiplyScalar(0.95 + R() * 0.1);
        for (let k = 0; k < 3; k++) {
          pos[p] = xs[k]; pos[p + 1] = ys[k]; pos[p + 2] = zs[k];
          colr[p] = col.r; colr[p + 1] = col.g; colr[p + 2] = col.b; p += 3;
        }
      };
      for (let a = 0; a < NC; a++) for (let b = 0; b < NC; b++) {
        tri(a, b, a, b + 1, a + 1, b);
        tri(a + 1, b, a, b + 1, a + 1, b + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
      this.group.add(m);
    }
    if (this.coast) this.buildSea(bx0 - 600, bx1 + 600, bz0 - 600, bz1 + 600);
  }

  // opaque low-poly sea: a coarse grid with a little vertex-colour shimmer, flat at seaLevel (never below the road:
  // the road's lowest point sits seaLevel + 2.2, the shoulders seaLevel + 2.1)
  buildSea(x0, x1, z0, z1) {
    const d = this.def, CELL = 48, nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL);
    const g = new THREE.PlaneGeometry(nx * CELL, nz * CELL, nx, nz).toNonIndexed();
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, d.seaLevel, (z0 + z1) / 2);
    const base = new THREE.Color(d.sea || '#2aa39b'), deep = base.clone().multiplyScalar(0.78), col = new THREE.Color();
    const pos = g.attributes.position, cnt = pos.count, colr = new Float32Array(cnt * 3);
    for (let t = 0; t < cnt; t += 3) {
      const mx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3, mz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
      col.copy(base).lerp(deep, this.n2(mx / 160 + 5, mz / 160) * 0.5 + 0.5).multiplyScalar(0.96 + this.R() * 0.08);
      for (let k = 0; k < 3; k++) { colr[(t + k) * 3] = col.r; colr[(t + k) * 3 + 1] = col.g; colr[(t + k) * 3 + 2] = col.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.receiveShadow = true;
    this.group.add(m);
  }

  buildRoad() {
    const offs = [-ROAD_HALF, -2.3, -0.9, 0.9, 2.3, ROAD_HALF];
    const c0 = new THREE.Color(this.def.road[0]), c1 = new THREE.Color(this.def.road[1]), col = new THREE.Color();
    const SEG = 150;
    for (let s = 0; s < this.n - 1; s += SEG) {
      const e = Math.min(this.n - 1, s + SEG);
      const cnt = (e - s) * 5 * 6;
      const pos = new Float32Array(cnt * 3), colr = new Float32Array(cnt * 3);
      let p = 0;
      const V = (i, k) => [this.sx[i] + this.tz[i] * offs[k], this.sy[i], this.sz[i] - this.tx[i] * offs[k]];
      for (let i = s; i < e; i++) for (let k = 0; k < 5; k++) {
        const a = V(i, k), b = V(i + 1, k), c = V(i, k + 1), d = V(i + 1, k + 1);
        // wheel ruts (k=1,3) are lighter; edges and crown darker
        col.copy(k === 1 || k === 3 ? c0 : c1).multiplyScalar(0.96 + this.R() * 0.08);
        for (const v of [a, b, c, c, b, d]) {
          pos[p] = v[0]; pos[p + 1] = v[1]; pos[p + 2] = v[2];
          colr[p] = col.r; colr[p + 1] = col.g; colr[p + 2] = col.b; p += 3;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, flatMat()); m.receiveShadow = true;
      this.group.add(m);
    }
  }

  addCollider(x, z, r) {
    const k = Math.floor(x / 8) * 100003 + Math.floor(z / 8);
    let a = this.colliders.get(k); if (!a) this.colliders.set(k, (a = []));
    a.push({ x, z, r });
  }

  collide(x, z, r, cb) {
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const arr = this.colliders.get(ix * 100003 + iz); if (!arr) continue;
      for (const o of arr) { const dx = x - o.x, dz = z - o.z, rr = r + o.r; if (dx * dx + dz * dz < rr * rr) cb(o, dx, dz, rr); }
    }
  }

  buildScenery() {
    const R = this.R, d = this.def, flora = d.flora;
    const cone = (r, h, y, hex) => part(new THREE.ConeGeometry(r, h, 6), hex, 0, y, 0);
    const blob = (r, hex, x, y, z, sy = 1) => { const g = new THREE.IcosahedronGeometry(r, 0); g.scale(1, sy, 1); return part(g, hex, x, y, z); };
    const T = {};
    const def = (name, geo, shadow = true) => { T[name] = { geo, shadow, items: new Map() }; };
    def('trunk', part(new THREE.CylinderGeometry(0.16, 0.26, 2, 5), flora === 'snow' ? '#4b3a30' : '#6b4a35', 0, 1, 0));
    if (flora === 'snow') {
      def('conifer', merge([cone(1.7, 2.6, 2.4, '#2f5d50'), cone(1.3, 2.2, 3.9, '#356a5a'), cone(0.85, 1.9, 5.2, '#3b7362'),
        cone(1.2, 1.1, 3.3, '#f7fafc'), cone(0.9, 1.0, 4.6, '#f7fafc'), cone(0.55, 0.9, 5.8, '#ffffff')]));
    } else {
      def('conifer', merge([cone(1.7, 2.6, 2.4, '#e8e8e8'), cone(1.3, 2.2, 3.9, '#f4f4f4'), cone(0.85, 1.9, 5.2, '#ffffff')]));
    }
    def('round', merge([blob(1.7, '#ffffff', 0, 3.3, 0, 0.9), blob(1.2, '#eeeeee', 0.9, 2.6, 0.4), blob(1.1, '#f6f6f6', -0.7, 2.8, -0.6)]));
    def('rock', (() => { const g = new THREE.DodecahedronGeometry(1, 0); g.scale(1, 0.7, 0.85); return part(g, '#ffffff', 0, 0.3, 0); })());
    def('bush', blob(0.6, '#ffffff', 0, 0.3, 0, 0.7), false);
    const cyl = (r, h, x, y, z, rz = 0) => { const g = new THREE.CylinderGeometry(r, r, h, 6); g.rotateZ(rz); return part(g, '#ffffff', x, y, z); };
    def('cactus', merge([cyl(0.32, 3.4, 0, 1.7, 0), cyl(0.2, 0.9, 0.6, 1.7, 0, Math.PI / 2), cyl(0.2, 1.2, 1.0, 2.2, 0),
      cyl(0.2, 0.8, -0.55, 2.3, 0, Math.PI / 2), cyl(0.2, 0.9, -0.9, 2.7, 0)]));
    def('mesa', (() => { const g = new THREE.CylinderGeometry(0.75, 1, 1, 7); return merge([part(g, '#ffffff', 0, 0.5, 0), part(new THREE.CylinderGeometry(0.5, 0.62, 0.35, 7), '#f0e0d8', 0.1, 1.15, 0)]); })());
    def('post', merge([part(new THREE.BoxGeometry(0.14, 0.9, 0.14), '#f5f1e6', 0, 0.45, 0), part(new THREE.BoxGeometry(0.16, 0.2, 0.16), '#e2472f', 0, 0.8, 0)]), false);
    def('body', merge([part(new THREE.CylinderGeometry(0.2, 0.26, 0.75, 6), '#ffffff', 0, 1.1, 0), part(new THREE.BoxGeometry(0.34, 0.75, 0.22), '#3b3f52', 0, 0.38, 0)]));
    def('head', part(new THREE.IcosahedronGeometry(0.19, 0), '#e9b98f', 0, 1.68, 0), false);
    if (flora === 'coast') {
      // umbrella pine: tall leaning bare trunk (tinted bark) + flat layered canopy (tinted green)
      const lean = (g, a) => { g.rotateZ(a); return g; };
      def('ptrunk', merge([part(lean(new THREE.CylinderGeometry(0.15, 0.24, 4.6, 5).translate(0, 2.3, 0), 0.12), '#ffffff'),
        part(lean(new THREE.CylinderGeometry(0.07, 0.11, 1.6, 4).translate(0, 0.8, 0), -0.9), '#ffffff', -0.3, 3.9, 0)]));
      const disc = (r, h, x, y, z, hex) => part(new THREE.CylinderGeometry(r, r * 1.12, h, 7), hex, x, y, z);
      def('canopy', merge([disc(2.5, 0.75, -0.45, 4.95, 0, '#ffffff'), disc(1.8, 0.6, -0.25, 5.55, 0.2, '#f2f2f2'),
        disc(1.3, 0.55, -1.7, 4.65, -0.3, '#e9e9e9')]));
      // palm: curved segmented trunk + drooping fronds, both baked with the same curve so they share one transform
      const seg = [], top = [0, 0, 0];
      for (let s = 0; s < 6; s++) {
        const a = s * 0.07, g = new THREE.CylinderGeometry(0.17 - s * 0.012, 0.2 - s * 0.012, 0.95, 6);
        g.rotateZ(-a); g.translate(top[0] + Math.sin(a) * 0.47, top[1] + Math.cos(a) * 0.47, 0);
        seg.push(part(g, s % 2 ? '#ffffff' : '#e6e1d6'));
        top[0] += Math.sin(a) * 0.95; top[1] += Math.cos(a) * 0.95;
      }
      def('palmtrunk', merge(seg));
      const fr = [];
      for (let k = 0; k < 7; k++) {
        const g = new THREE.BoxGeometry(2.3, 0.06, 0.42);
        g.translate(1.15, 0, 0); g.rotateZ(-0.38 - (k % 2) * 0.18); g.rotateY(k / 7 * Math.PI * 2 + 0.3);
        fr.push(part(g, k % 2 ? '#ffffff' : '#eaeaea', top[0], top[1] + 0.05, 0));
      }
      fr.push(part(new THREE.IcosahedronGeometry(0.3, 0), '#c9b28a', top[0], top[1] - 0.1, 0));
      def('fronds', merge(fr));
      def('cypress', merge([part(new THREE.CylinderGeometry(0.1, 0.14, 0.8, 5), '#7a5a40', 0, 0.4, 0),
        part(new THREE.ConeGeometry(0.75, 3.6, 6).translate(0, 2.4, 0), '#ffffff'), part(new THREE.IcosahedronGeometry(0.72, 0).scale(1, 1.4, 1), '#f0f0f0', 0, 1.25, 0)]));
      def('wall', merge([part(new THREE.BoxGeometry(2.6, 0.62, 0.5), '#ffffff', 0, 0.21, 0), part(new THREE.BoxGeometry(2.7, 0.12, 0.6), '#f2efe8', 0, 0.58, 0)]));
    }

    const dummy = new THREE.Object3D(), color = new THREE.Color();
    const add = (type, i, x, y, z, rot, s, sy, hex, jitter = 0.12) => {
      const b = Math.floor(i / 110);
      let it = T[type].items.get(b); if (!it) T[type].items.set(b, (it = { m: [], c: [] }));
      dummy.position.set(x, y, z); dummy.rotation.set(0, rot, 0); dummy.scale.set(s, sy, s); dummy.updateMatrix();
      it.m.push(dummy.matrix.clone());
      color.set(hex); const j = 1 - jitter + R() * jitter * 2; color.multiplyScalar(j);
      it.c.push(color.r, color.g, color.b);
    };
    const pick = (arr) => arr[Math.floor(R() * arr.length)];
    const AUT = ['#d9822b', '#e3a02d', '#c9562c', '#e8c046', '#b84a32'];
    const GRN = ['#4f7f3a', '#3f6e3d', '#5d8f3f'];

    const sea = this.coast ? d.seaLevel : -Infinity;
    const pCactus = d.cactus ?? 0.4, pMesa = pCactus + (d.mesa ?? 0.22), mesaH = d.mesaH ?? 1;
    const PINE = ['#3f6b3a', '#4b7a3c', '#355f38'], DRY = ['#a49f63', '#b8a86e', '#8a9258', '#c2b27c'];
    let wallRun = 0, wallSide = 1;
    for (let i = 4; i < this.n - 4; i += 2) {
      for (const side of [-1, 1]) {
        // ground cover close to the verge
        if (R() < 0.5) {
          const off = ROAD_HALF + 1 + R() * 7;
          const x = this.sx[i] + this.tz[i] * off * side, z = this.sz[i] - this.tx[i] * off * side;
          const n = this.nearest(x, z);
          if (!n || n.d > ROAD_HALF + 0.8) {
            const hex = flora === 'forest' ? pick(['#6e8f3a', '#a7a843', '#c98a3a']) : flora === 'desert' ? pick(['#a8a25c', '#8c9a5a', '#c2a268']) : flora === 'coast' ? pick(DRY) : pick(['#eef3f7', '#ffffff', '#5f7a66']);
            const y = this.height(x, z, true);
            if (y > sea + 0.3) add('bush', i, x, y, z, R() * 6, 0.5 + R() * 0.9, 0.5 + R() * 0.8, hex);
          }
        }
        const tries = flora === 'desert' ? 2 : flora === 'coast' ? 3 : 4;
        for (let a = 0; a < tries; a++) {
          const off = ROAD_HALF + 6.5 + Math.pow(R(), 1.7) * 130;
          const x = this.sx[i] + this.tz[i] * off * side, z = this.sz[i] - this.tx[i] * off * side;
          const n = this.nearest(x, z);
          const dist = n ? n.d : 99;
          if (dist < ROAD_HALF + 6) continue;
          const dens = this.n2(x / 55 + 3, z / 55) * 0.5 + 0.5;
          const thresh = d.dens ?? (flora === 'desert' ? 0.62 : flora === 'snow' ? 0.42 : flora === 'coast' ? 0.45 : 0.3);
          if (dens < thresh && R() < 0.85) continue;
          const y = this.height(x, z, true) - 0.1, rot = R() * 6.28, s = 0.8 + R() * 0.9;
          const near = dist < 45;
          if (flora === 'desert') {
            const q = R();
            if (q < pCactus) { add('cactus', i, x, y, z, rot, s, s, pick(['#5f8f5a', '#6f9a58', '#4f8060'])); if (near) this.addCollider(x, z, 0.4 * s); }
            else if (q < pMesa) { const w = 2 + R() * 5; if (dist > 9 + w) { add('mesa', i, x, y - 0.3, z, rot, w, (2 + R() * 7) * mesaH, pick(['#c2603f', '#b55238', '#d07248'])); if (near) this.addCollider(x, z, w * 0.95); } }
            else { add('rock', i, x, y, z, rot, 0.6 + R() * 1.6, 0.6 + R() * 1.4, pick(['#b8694a', '#a85a40', '#c98058'])); }
          } else if (flora === 'coast') {
            if (y < sea + 0.5) continue; // nothing grows in the sea
            const q = R();
            if (q < 0.14) { const rs = 0.6 + R() * 1.7; add('rock', i, x, y, z, rot, rs, rs * (0.6 + R() * 0.5), d.rock, 0.06); if (near && rs > 1.2) this.addCollider(x, z, rs * 0.8); }
            else if (q < 0.5) {
              add('ptrunk', i, x, y, z, rot, s, s, '#8a6a4e', 0.08); add('canopy', i, x, y, z, rot, s * (1 + R() * 0.3), s, pick(PINE));
              if (near) this.addCollider(x, z, 0.3 * s);
            } else if (q < 0.7) {
              add('palmtrunk', i, x, y, z, rot, s, s, '#b39a78', 0.06); add('fronds', i, x, y, z, rot, s, s, pick(['#5f8f3e', '#6d9a42', '#4f7f3a']));
              if (near) this.addCollider(x, z, 0.3 * s);
            } else if (q < 0.82) {
              add('cypress', i, x, y, z, rot, s * 0.9, s * (1 + R() * 0.5), pick(['#2f5534', '#3a6138']));
              if (near) this.addCollider(x, z, 0.35 * s);
            } else add('bush', i, x, y + 0.1, z, rot, 1 + R() * 1.2, 0.8 + R() * 0.6, pick(DRY));
          } else {
            const q = R();
            if (q < 0.08) { const rs = 0.7 + R() * 1.8; add('rock', i, x, y, z, rot, rs, rs, d.rock); if (near && rs > 1.2) this.addCollider(x, z, rs * 0.8); }
            else if (flora === 'forest' && q < 0.55) {
              add('trunk', i, x, y, z, rot, s, s, '#ffffff', 0.05); add('round', i, x, y, z, rot, s, s * (0.9 + R() * 0.3), pick(AUT));
              if (near) this.addCollider(x, z, 0.3 * s);
            } else {
              const hs = s * (0.9 + R() * 0.5);
              add('trunk', i, x, y, z, rot, s, s, '#ffffff', 0.05);
              add('conifer', i, x, y, z, rot, s, hs, flora === 'snow' ? '#ffffff' : pick(GRN), flora === 'snow' ? 0.06 : 0.12);
              if (near) this.addCollider(x, z, 0.3 * s);
            }
          }
        }
        // marker posts on corners
        if (i % 6 === 0 && Math.abs(this.curv[i]) > 0.012) {
          const off = (ROAD_HALF + 0.7) * side;
          const x = this.sx[i] + this.tz[i] * off, z = this.sz[i] - this.tx[i] * off;
          add('post', i, x, this.sy[i] - 0.1, z, Math.atan2(this.tx[i], this.tz[i]), 1, 1, '#ffffff', 0);
        }
      }
      // coast: runs of low whitewashed dry-stone wall along the verge
      if (flora === 'coast') {
        if (wallRun <= 0 && R() < 0.03) { wallRun = 8 + Math.floor(R() * 26); wallSide = R() < 0.5 ? -1 : 1; }
        if (wallRun > 0) {
          wallRun--;
          const off = (ROAD_HALF + 4.4) * wallSide;
          const x = this.sx[i] + this.tz[i] * off, z = this.sz[i] - this.tx[i] * off;
          const n = this.nearest(x, z), y = this.height(x, z, true);
          if (n && n.d > ROAD_HALF + 3.6 && y > sea + 0.4) {
            add('wall', i, x, y - 0.12, z, Math.atan2(-this.tz[i], this.tx[i]), 1.55, 0.85 + R() * 0.3, '#f4f1ea', 0.05);
            for (const k of [-1, 0, 1]) this.addCollider(x + this.tx[i] * k * 1.4, z + this.tz[i] * k * 1.4, 0.45);
          }
        }
      }
      // spectator clusters on the outside of corners and at random straights
      if (i % 40 === 0 && i > this.startIdx - 20 && R() < 0.75) {
        const side = this.curv[i] > 0 ? -1 : 1; // lat>0 is left; curv>0 turns left, so outside is right
        const cnt = 3 + Math.floor(R() * 7);
        for (let q = 0; q < cnt; q++) {
          const j = clamp(i + Math.floor((R() - 0.5) * 10), 0, this.n - 1), off = (ROAD_HALF + 6.5 + R() * 3.5) * side;
          const x = this.sx[j] + this.tz[j] * off, z = this.sz[j] - this.tx[j] * off;
          const n = this.nearest(x, z); if (n && n.d < ROAD_HALF + 5.5) continue;
          const y = this.height(x, z, true), rot = Math.atan2(this.sx[j] - x, this.sz[j] - z);
          if (y < sea + 0.3) continue;
          const s = 0.9 + R() * 0.25;
          add('body', i, x, y, z, rot, s, s, pick(['#e2472f', '#f2b632', '#3d7fc4', '#f4f1e8', '#5aa469', '#8e5bb5', '#ef8a3c']), 0.05);
          add('head', i, x, y, z, rot, s, s, pick(['#ffffff', '#d9b08c', '#b98562']), 0.04);
          this.addCollider(x, z, 0.3);
        }
      }
    }

    for (const name in T) {
      const t = T[name], mat = flatMat();
      for (const it of t.items.values()) {
        const m = new THREE.InstancedMesh(t.geo, mat, it.m.length);
        it.m.forEach((mx, k) => m.setMatrixAt(k, mx));
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(it.c), 3);
        m.castShadow = t.shadow; m.receiveShadow = false;
        m.computeBoundingSphere();
        this.group.add(m);
      }
    }

    // gates
    const gate = (i, text, bg, fg) => {
      const g = new THREE.Group();
      const pil = merge([part(new THREE.BoxGeometry(0.5, 5.6, 0.5), '#f4efe2', -5.2, 2.8, 0), part(new THREE.BoxGeometry(0.5, 5.6, 0.5), '#f4efe2', 5.2, 2.8, 0),
        part(new THREE.BoxGeometry(11, 1.5, 0.3), bg, 0, 5.2, 0),
        part(new THREE.BoxGeometry(0.9, 0.5, 0.9), '#e2472f', -5.2, 0.25, 0), part(new THREE.BoxGeometry(0.9, 0.5, 0.9), '#e2472f', 5.2, 0.25, 0)]);
      const pm = new THREE.Mesh(pil, flatMat()); pm.castShadow = true; g.add(pm);
      const bm = new THREE.MeshBasicMaterial({ map: bannerTexture(text, bg, fg) });
      for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 1.4), bm); p.position.set(0, 5.2, 0.16 * s); if (s < 0) p.rotation.y = Math.PI; g.add(p); }
      g.position.set(this.sx[i], this.sy[i] - 0.1, this.sz[i]);
      g.rotation.y = Math.atan2(this.tx[i], this.tz[i]);
      this.group.add(g);
      for (const s of [-1, 1]) this.addCollider(this.sx[i] + this.tz[i] * 5.2 * s, this.sz[i] - this.tx[i] * 5.2 * s, 0.45);
    };
    gate(this.startIdx, 'START', '#2b2d3a', '#f4efe2');
    gate(this.finishIdx, 'FINISH', '#e2472f', '#fff6e0');
    const flagGeo = merge([part(new THREE.BoxGeometry(0.12, 4, 0.12), '#f4efe2', 0, 2, 0), part(new THREE.BoxGeometry(0.06, 0.9, 1.5), '#f2b632', 0, 3.5, 0.8)]);
    for (const i of this.splits) for (const s of [-1, 1]) {
      const m = new THREE.Mesh(flagGeo, flatMat()); m.castShadow = true;
      m.position.set(this.sx[i] + this.tz[i] * 5 * s, this.sy[i] - 0.1, this.sz[i] - this.tx[i] * 5 * s);
      m.rotation.y = Math.atan2(this.tx[i], this.tz[i]);
      this.group.add(m);
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}
