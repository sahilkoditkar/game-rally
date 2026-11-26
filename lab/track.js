// track.js — the lab course: a closed loop built from straights and arcs (no dependencies).
// Same conventions as handling.js: heading 0 faces +Z, forward = (sin h, cos h), +turn = left.

export const ROAD_WIDTH = 7.2;
export const HALF = ROAD_WIDTH / 2;
const D = Math.PI / 180;

// [kind, length or radius, angle in degrees (+ left), label]
// Two straights ('S?') are solved so that the loop closes exactly.
const SEGMENTS = [
  ['S', 200, 0, 'Long straight'],
  ['A', 150, 45, 'Fast sweeper (R150)'],
  ['S', 50, 0, ''],
  ['A', 45, 90, 'Medium 90 (R45)'],
  ['S?', 60, 0, ''],
  ['A', 18, 90, 'Tight 90 (R18)'],
  ['S', 50, 0, ''],
  ['A', 35, -55, 'S-bend'],
  ['A', 35, 55, 'S-bend'],
  ['S', 50, 0, ''],
  ['A', 12, -180, 'Hairpin right (R12)'],
  ['S', 90, 0, ''],
  ['A', 12, 180, 'Hairpin left (R12)'],
  ['S?', 60, 0, ''],
  ['A', 60, 135, 'Long left (R60)'],
  ['S', 30, 0, ''],
];

export function walk(segs, step) {
  let x = 0, z = 0, h = 0, s = 0;
  const pts = [{ x, z, h, s, k: 0, seg: 0 }];
  segs.forEach((g, i) => {
    const [kind, a, deg] = g;
    const len = kind === 'A' ? Math.abs(deg * D) * a : a;
    const k = kind === 'A' ? Math.sign(deg) / a : 0;
    const n = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < n; j++) {
      const ds = len / n;
      if (k) { const h2 = h + k * ds; x += (Math.cos(h) - Math.cos(h2)) / k; z += (Math.sin(h2) - Math.sin(h)) / k; h = h2; }
      else { x += Math.sin(h) * ds; z += Math.cos(h) * ds; }
      s += ds;
      pts.push({ x, z, h, s, k, seg: i });
    }
  });
  return pts;
}

function solve() {
  // End position is linear in the two free straight lengths: solve the 2x2 system for closure.
  const free = SEGMENTS.map((g, i) => (g[0] === 'S?' ? i : -1)).filter((i) => i >= 0);
  const segAt = (a, b) => SEGMENTS.map((g, i) => (i === free[0] ? ['S', a] : i === free[1] ? ['S', b] : g));
  const end = (a, b) => { const p = walk(segAt(a, b), 1); return p[p.length - 1]; };
  const e0 = end(0, 0), ea = end(1, 0), eb = end(0, 1);
  const ax = ea.x - e0.x, az = ea.z - e0.z, bx = eb.x - e0.x, bz = eb.z - e0.z;
  const det = ax * bz - az * bx;
  const a = (-e0.x * bz + e0.z * bx) / det, b = (-ax * e0.z + az * e0.x) / det;
  return segAt(a, b).map((g, i) => [g[0], g[1], SEGMENTS[i][2], SEGMENTS[i][3]]);
}

export function buildTrack(step = 1) {
  const segs = solve();
  const pts = walk(segs, step);
  pts.pop(); // last point coincides with the first
  const length = pts[pts.length - 1].s + Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z);
  const apexes = [];
  segs.forEach((g, i) => {
    if (g[0] !== 'A') return;
    const idx = pts.filter((p) => p.seg === i);
    const mid = idx[Math.floor(idx.length / 2)];
    apexes.push({ x: mid.x, z: mid.z, h: mid.h, side: Math.sign(g[2]), r: g[1], label: g[3] });
  });
  return { pts, length, segs, apexes, closureError: Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) };
}

// An open path (for isolated tests such as a lone hairpin). Same shape as buildTrack's result.
export function buildPath(segs, step = 0.5) {
  const pts = walk(segs, step);
  return { pts, length: pts[pts.length - 1].s, segs, apexes: [], open: true };
}

// Nearest centreline point. hint = last index (local search); pass -1 for a global search.
export function locate(track, x, z, hint = -1) {
  const P = track.pts, n = P.length;
  let best = 0, bd = Infinity;
  if (hint < 0) {
    for (let i = 0; i < n; i++) { const d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } }
  } else {
    for (let o = -40; o <= 40; o++) { const i = (hint + o + n) % n; const d = (P[i].x - x) ** 2 + (P[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } }
  }
  const p = P[best];
  // signed lateral offset, + = left of the centreline
  const lat = (x - p.x) * Math.cos(p.h) - (z - p.z) * Math.sin(p.h);
  const fwd = (x - p.x) * Math.sin(p.h) + (z - p.z) * Math.cos(p.h);
  return { i: best, p, lat, s: track.open ? p.s + fwd : (p.s + fwd + track.length) % track.length };
}
