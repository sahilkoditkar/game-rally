import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

export const STEP = 2;
export const ROAD_HALF = 3.6;

export const STAGES = [
  {
    id: 'larch', name: 'Larch Hollow', tag: 'Autumn forest · loose gravel', seed: 7, points: 30,
    twist: 1.0, sharp: 0.22, hills: 15, grip: 1.0, flora: 'forest',
    sky: ['#8fc4d8', '#f7e3bd'], fog: '#f1dfbf', fogRange: [70, 330],
    ground: ['#93a644', '#b9b356', '#7b9440'], rock: '#8f8a7d', verge: '#b09a66',
    road: ['#cfae7c', '#bf9d6b'], dust: '#d9c29a', sun: '#fff0d2', sunPos: [60, 70, 30], ambient: ['#cfe6f5', '#8a7a50'],
  },
  {
    id: 'mesa', name: 'Saltwind Mesa', tag: 'High desert · hardpack', seed: 23, points: 36,
    twist: 0.8, sharp: 0.3, hills: 10, grip: 1.08, flora: 'desert',
    sky: ['#6f8fc9', '#ffc9a3'], fog: '#fbc9a4', fogRange: [90, 380],
    ground: ['#d98f5c', '#e3a76a', '#c97a50'], rock: '#a8573f', verge: '#d9a777',
    road: ['#efd2a4', '#e2c08f'], dust: '#f1d3ab', sun: '#ffe2c0', sunPos: [-70, 45, 40], ambient: ['#ffd9c2', '#a25a3c'],
  },
  {
    id: 'frost', name: 'Frostfell Pass', tag: 'Alpine snow · low grip', seed: 41, points: 32,
    twist: 1.1, sharp: 0.2, hills: 20, grip: 0.72, flora: 'snow',
    sky: ['#7fa3c9', '#e6eef5'], fog: '#e3ebf2', fogRange: [60, 300],
    ground: ['#f4f7fa', '#e4ecf3', '#d5e0ea'], rock: '#7c8794', verge: '#d9e2ea',
    road: ['#cdd6de', '#bcc7d1'], dust: '#f5f8fb', sun: '#fff6e8', sunPos: [50, 50, -50], ambient: ['#dbe9ff', '#8793a6'],
  },
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
    return this.n1(x / 240, z / 240) * A + this.n1(x / 90 + 40, z / 90) * A * 0.35 + this.n2(x / 28, z / 28) * A * 0.07;
  }

  buildPath() {
    const R = this.R, d = this.def;
    const pts = [new THREE.Vector3(0, 0, -90), new THREE.Vector3(0, 0, -40), new THREE.Vector3(0, 0, 20)];
    let x = 0, z = 20, h = 0;
    for (let k = 0; k < d.points; k++) {
      if (R() < d.sharp) h += (R() < 0.5 ? -1 : 1) * (0.75 + R() * 0.5);
      else h += (R() - 0.5) * d.twist * 2;
      h = clamp(h * 0.9, -1.2, 1.2);
      const len = 38 + R() * 50;
      x += Math.sin(h) * len; z += Math.cos(h) * len;
      pts.push(new THREE.Vector3(x, 0, z));
    }
    for (let k = 0; k < 3; k++) { x += Math.sin(h) * 45; z += Math.cos(h) * 45; pts.push(new THREE.Vector3(x, 0, z)); }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    curve.arcLengthDivisions = 4000;
    const n = Math.floor(curve.getLength() / STEP);
    const sp = curve.getSpacedPoints(n);
    this.n = n + 1;
    const N = this.n;
    this.sx = new Float32Array(N); this.sz = new Float32Array(N); this.sy = new Float32Array(N);
    this.tx = new Float32Array(N); this.tz = new Float32Array(N); this.curv = new Float32Array(N);
    for (let i = 0; i < N; i++) { this.sx[i] = sp[i].x; this.sz[i] = sp[i].z; }
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
      const dx = this.sx[b] - this.sx[a], dz = this.sz[b] - this.sz[a], l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
    }
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 3), b = Math.min(N - 1, i + 3);
      let dh = Math.atan2(this.tx[b], this.tz[b]) - Math.atan2(this.tx[a], this.tz[a]);
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.curv[i] = dh / ((b - a) * STEP);
    }
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
    this.sy = h0;
    this.startIdx = Math.round(80 / STEP);
    this.finishIdx = N - Math.round(70 / STEP);
    this.length = (this.finishIdx - this.startIdx) * STEP;
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
    const mat = flatMat();
    const hs = new Float32Array((NC + 1) * (NC + 1)), ds = new Float32Array((NC + 1) * (NC + 1));
    for (const key of chunks) {
      const [cx, cz] = key.split(',').map(Number);
      const x0 = cx * CH, z0 = cz * CH;
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

    for (let i = 4; i < this.n - 4; i += 2) {
      for (const side of [-1, 1]) {
        // ground cover close to the verge
        if (R() < 0.5) {
          const off = ROAD_HALF + 1 + R() * 7;
          const x = this.sx[i] + this.tz[i] * off * side, z = this.sz[i] - this.tx[i] * off * side;
          const n = this.nearest(x, z);
          if (!n || n.d > ROAD_HALF + 0.8) {
            const hex = flora === 'forest' ? pick(['#6e8f3a', '#a7a843', '#c98a3a']) : flora === 'desert' ? pick(['#a8a25c', '#8c9a5a', '#c2a268']) : pick(['#eef3f7', '#ffffff', '#5f7a66']);
            add('bush', i, x, this.height(x, z, true), z, R() * 6, 0.5 + R() * 0.9, 0.5 + R() * 0.8, hex);
          }
        }
        const tries = flora === 'desert' ? 2 : 4;
        for (let a = 0; a < tries; a++) {
          const off = ROAD_HALF + 4.5 + Math.pow(R(), 1.7) * 130;
          const x = this.sx[i] + this.tz[i] * off * side, z = this.sz[i] - this.tx[i] * off * side;
          const n = this.nearest(x, z);
          const dist = n ? n.d : 99;
          if (dist < ROAD_HALF + 4) continue;
          const dens = this.n2(x / 55 + 3, z / 55) * 0.5 + 0.5;
          const thresh = flora === 'desert' ? 0.62 : flora === 'snow' ? 0.42 : 0.3;
          if (dens < thresh && R() < 0.85) continue;
          const y = this.height(x, z, true) - 0.1, rot = R() * 6.28, s = 0.8 + R() * 0.9;
          const near = dist < 45;
          if (flora === 'desert') {
            const q = R();
            if (q < 0.4) { add('cactus', i, x, y, z, rot, s, s, pick(['#5f8f5a', '#6f9a58', '#4f8060'])); if (near) this.addCollider(x, z, 0.4 * s); }
            else if (q < 0.62) { const w = 2 + R() * 5; if (dist > 9 + w) { add('mesa', i, x, y - 0.3, z, rot, w, 2 + R() * 7, pick(['#c2603f', '#b55238', '#d07248'])); if (near) this.addCollider(x, z, w * 0.95); } }
            else { add('rock', i, x, y, z, rot, 0.6 + R() * 1.6, 0.6 + R() * 1.4, pick(['#b8694a', '#a85a40', '#c98058'])); }
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
      // spectator clusters on the outside of corners and at random straights
      if (i % 40 === 0 && i > this.startIdx - 20 && R() < 0.75) {
        const side = this.curv[i] > 0 ? -1 : 1; // lat>0 is left; curv>0 turns left, so outside is right
        const cnt = 3 + Math.floor(R() * 7);
        for (let q = 0; q < cnt; q++) {
          const j = clamp(i + Math.floor((R() - 0.5) * 10), 0, this.n - 1), off = (ROAD_HALF + 6.5 + R() * 3.5) * side;
          const x = this.sx[j] + this.tz[j] * off, z = this.sz[j] - this.tx[j] * off;
          const n = this.nearest(x, z); if (n && n.d < ROAD_HALF + 5.5) continue;
          const y = this.height(x, z, true), rot = Math.atan2(this.sx[j] - x, this.sz[j] - z);
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
