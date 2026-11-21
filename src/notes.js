// Pace notes: corner, crest and jump call-outs, derived from a stage's public arrays only
// (sx, sz, sy, tx, tz, curv, n, startIdx, finishIdx; samples are STEP = 2 m apart), so every stage
// (the 12 regions' stages, daily stages, future regions) gets notes with no per-stage data.
//
// Rally convention for severity: 1 = tightest / slowest ... 6 = fast kink. Graded from the corner's
// minimum radius (stage.curv is the heading change per metre, already smoothed over ~12 m).
export const STEP = 2;

// ---------------------------------------------------------------- tuning (all distances in metres)
export const NOTE = {
  kIn: 1 / 110,        // a bend starts when |curv| rises above this (R < 110 m) ...
  kOut: 1 / 170,       // ... and ends when it drops below this (hysteresis)
  minTurnDeg: 12,      // smaller total heading changes are not called ...
  kinkK: 0.012, kinkMinDeg: 5, // ... unless they are a sharp kink (R < ~83 m) turning at least this much (the gates mark those too)
  mergeGap: 14,        // same-direction pieces closer than this are one corner (wiggles)
  // minimum radius upper bounds for severity 1..5 (anything wider than SEV_R[4] is a 6)
  SEV_R: [14, 24, 34, 50, 75],
  kinkDeg: 25,         // a corner turning less than this is called one grade faster (it can be straight-lined)
  hairpinDeg: 140, hairpinR: 22,
  longM: 70, longDeg: 60,     // 'long': this long (entry to exit) and turning at least this much
  tightRatio: 1.45,    // 'tightens' / 'opens': curvature of the second half vs the first half
  intoM: 25,           // 'into': the next corner starts within this distance of this one's exit
  crestSpan: 5,        // samples either side for the vertical curvature (10 m)
  crestK: 0.0042,      // convex vertical curvature (1/m) above which a fast car goes light (R < ~240 m)
  crestGap: 60,        // crests closer than this are one call
  callSec: 2.9, callMin: 45, // a note is called this many seconds ahead at current speed (at least callMin m)
};

const deg = (rad) => (rad * 180) / Math.PI;
export function severityFor(minR, turnDeg) {
  let sev = 6;
  for (let s = 0; s < NOTE.SEV_R.length; s++) if (minR < NOTE.SEV_R[s]) { sev = s + 1; break; }
  if (turnDeg < NOTE.kinkDeg) sev = Math.min(6, sev + 1);
  return sev;
}

// ---------------------------------------------------------------- corners
function corners(st) {
  const { curv, startIdx, finishIdx } = st;
  const lo = Math.max(1, startIdx), hi = Math.min(st.n - 2, finishIdx);
  const kIn = NOTE.kIn, kOut = NOTE.kOut;
  // 1) raw segments by sign with hysteresis; a sign change above kOut splits an S-bend
  const segs = [];
  let cur = null;
  for (let i = lo; i <= hi; i++) {
    const k = curv[i], a = Math.abs(k), s = Math.sign(k);
    if (cur) {
      if (a < kOut || s !== cur.dir) { cur.b = i - 1; segs.push(cur); cur = null; }
    }
    if (!cur && a >= kIn) cur = { dir: s, a: i, b: i };
  }
  if (cur) { cur.b = hi; segs.push(cur); }
  // extend each piece back / forward while it keeps the same sign above kOut (entry and exit points)
  for (const g of segs) {
    while (g.a - 1 > lo && Math.sign(curv[g.a - 1]) === g.dir && Math.abs(curv[g.a - 1]) >= kOut) g.a--;
  }
  // 2) merge same-direction pieces separated by a short gap
  const gapS = Math.round(NOTE.mergeGap / STEP), merged = [];
  for (const g of segs) {
    const p = merged[merged.length - 1];
    if (p && p.dir === g.dir && g.a - p.b <= gapS) p.b = Math.max(p.b, g.b);
    else merged.push({ ...g });
  }
  // 3) measure, drop small bends, grade
  const out = [];
  for (const g of merged) {
    let turn = 0, peak = 0, apex = g.a;
    for (let i = g.a; i <= g.b; i++) {
      turn += curv[i] * STEP;
      const a = Math.abs(curv[i]);
      if (a > peak) { peak = a; apex = i; }
    }
    const turnDeg = Math.abs(deg(turn));
    if (peak < kIn || turnDeg < (peak >= NOTE.kinkK ? NOTE.kinkMinDeg : NOTE.minTurnDeg)) continue;
    const minR = 1 / peak, lenM = (g.b - g.a) * STEP;
    const hairpin = turnDeg >= NOTE.hairpinDeg && minR <= NOTE.hairpinR;
    const sev = hairpin ? 1 : severityFor(minR, turnDeg);
    // tightens / opens: mean |curv| over the second half against the first half
    const mid = (g.a + g.b) >> 1;
    let k1 = 0, k2 = 0;
    for (let i = g.a; i <= mid; i++) k1 += Math.abs(curv[i]);
    for (let i = mid + 1; i <= g.b; i++) k2 += Math.abs(curv[i]);
    k1 /= Math.max(1, mid - g.a + 1); k2 /= Math.max(1, g.b - mid);
    const mods = [];
    if (lenM >= NOTE.longM && turnDeg >= NOTE.longDeg) mods.push('long');
    if (!hairpin && lenM >= 24) {
      if (k2 > k1 * NOTE.tightRatio) mods.push('tightens');
      else if (k1 > k2 * NOTE.tightRatio) mods.push('opens');
    }
    out.push({ kind: 'corner', idx: g.a, apexIdx: apex, endIdx: g.b, dir: g.dir > 0 ? 1 : -1, sev, hairpin, mods, minR: Math.round(minR * 10) / 10, turn: Math.round(turnDeg) });
  }
  // 'into': the next corner follows within intoM of this one's exit
  const intoS = Math.round(NOTE.intoM / STEP);
  for (let k = 0; k < out.length - 1; k++) if (out[k + 1].idx - out[k].endIdx <= intoS) out[k].mods.push('into');
  return out;
}

// ---------------------------------------------------------------- crests (sharp convex brows in the road height)
function crests(st) {
  const { sy, startIdx, finishIdx } = st;
  if (!sy || !sy.length) return [];
  const a = NOTE.crestSpan, d2 = (a * STEP) ** 2, out = [];
  const c = (i) => (sy[i - a] - 2 * sy[i] + sy[i + a]) / d2; // < 0: convex
  const lo = Math.max(a, startIdx + 10), hi = Math.min(st.n - 1 - a, finishIdx - 10);
  let best = null;
  for (let i = lo; i <= hi; i++) {
    const v = c(i);
    if (v <= -NOTE.crestK) { if (!best || v < best.v) best = { i, v }; }
    else if (best) { out.push(best.i); best = null; }
  }
  if (best) out.push(best.i);
  // one call per brow
  const gapS = Math.round(NOTE.crestGap / STEP), res = [];
  for (const i of out) if (!res.length || i - res[res.length - 1] > gapS) res.push(i);
  return res.map((idx) => ({ kind: 'crest', idx }));
}

// ---------------------------------------------------------------- jumps (stage.jumps = [{ idx, size }] when a stage has them)
function jumps(st) {
  if (!Array.isArray(st.jumps)) return [];
  return st.jumps.filter((j) => j && Number.isFinite(j.idx) && j.idx > st.startIdx && j.idx < st.finishIdx)
    .map((j) => ({ kind: 'jump', idx: Math.round(j.idx), size: Math.max(1, Math.min(3, Math.round(j.size || 1))) }));
}

// ordered by where they start; cached on the stage
export function buildNotes(stage) {
  if (!stage) return [];
  if (stage.notes && stage._notesFor === stage.n) return stage.notes;
  let list = [];
  try {
    list = [...corners(stage), ...crests(stage), ...jumps(stage)];
  } catch (e) { list = []; }
  // a jump replaces a crest at the same spot
  const js = list.filter((n) => n.kind === 'jump');
  list = list.filter((n) => n.kind !== 'crest' || !js.some((j) => Math.abs(j.idx - n.idx) < 15));
  list.sort((p, q) => p.idx - q.idx || (p.kind === 'corner' ? 1 : -1));
  try { stage.notes = list; stage._notesFor = stage.n; } catch (e) { /* frozen test object */ }
  return list;
}

// where a note stops being relevant (the call slides away once the car is past this sample)
export const passIdx = (n) => (n.kind === 'corner' ? n.apexIdx : n.idx);

// the notes to show for a car: called ones (entry within callSec at current speed, min callMin) not yet passed,
// at most two. Returns { list: [note...], dist: [m...] } with dist to each note's entry.
export function notesAhead(notes, idx, speed, max = 2) {
  const call = Math.max(NOTE.callMin, Math.abs(speed || 0) * NOTE.callSec);
  const list = [], dist = [];
  for (const n of notes) {
    if (passIdx(n) < idx) continue;
    const d = (n.idx - idx) * STEP;
    if (d > call) break; // sorted by entry
    list.push(n); dist.push(Math.max(0, d));
    if (list.length >= max) break;
  }
  return { list, dist, call };
}

// ---------------------------------------------------------------- HUD markup (inline SVG)
const SEV_CLASS = (n) => (n.kind !== 'corner' ? 'sv-x' : n.sev <= 2 ? 'sv-tight' : n.sev <= 4 ? 'sv-mid' : 'sv-fast');
const BEND = { 1: 165, 2: 125, 3: 95, 4: 72, 5: 52, 6: 34 }; // degrees drawn in the arrow per severity
function arrowPath(dir, thetaDeg, r, x0 = 24, y0 = 30) {
  const th = (thetaDeg * Math.PI) / 180;
  const cx = x0 - dir * r, cy = y0;
  const ex = cx + dir * r * Math.cos(th), ey = cy - r * Math.sin(th);
  const hx = -dir * Math.sin(th), hy = -Math.cos(th); // heading at the end
  const px = -hy, py = hx; // perpendicular
  const L = 9, W = 7;
  const tip = [ex + hx * L * 0.6, ey + hy * L * 0.6], b1 = [ex - hx * L * 0.4 + px * W, ey - hy * L * 0.4 + py * W], b2 = [ex - hx * L * 0.4 - px * W, ey - hy * L * 0.4 - py * W];
  const f = (v) => v.toFixed(1);
  const sweep = dir > 0 ? 0 : 1, large = thetaDeg > 180 ? 1 : 0;
  return `<path class="na-line" d="M${x0} 46 L${x0} ${y0} A${r} ${r} 0 ${large} ${sweep} ${f(ex)} ${f(ey)}"/><path class="na-head" d="M${f(tip[0])} ${f(tip[1])} L${f(b1[0])} ${f(b1[1])} L${f(b2[0])} ${f(b2[1])}Z"/>`;
}
export function noteIcon(n) {
  if (n.kind === 'crest') return '<svg viewBox="0 0 48 48" class="nicon"><path class="na-fill" d="M4 40 C14 40 16 16 24 16 C32 16 34 40 44 40Z"/><path class="na-line thin" d="M24 4 L24 12 M18 7 L24 3 L30 7"/></svg>';
  if (n.kind === 'jump') return '<svg viewBox="0 0 48 48" class="nicon"><path class="na-fill" d="M4 42 L26 42 L26 26Z"/><path class="na-line" d="M28 22 C33 12 40 12 45 20"/><path class="na-head" d="M47 25 L40 21 L46 16Z"/></svg>';
  if (n.hairpin) return `<svg viewBox="0 0 48 48" class="nicon">${arrowPath(n.dir, 180, 11, 24 + n.dir * 11, 24)}</svg>`;
  const th = BEND[n.sev] || 60, r = n.sev <= 2 ? 10 : n.sev <= 4 ? 13 : 18;
  return `<svg viewBox="0 0 48 48" class="nicon">${arrowPath(n.dir, th, r)}</svg>`;
}
const MOD_TXT = { long: 'long', tightens: 'tightens', opens: 'opens', into: '→ into' };
export function noteHtml(n) {
  const label = n.kind === 'crest' ? '<span class="n-word">CREST</span>'
    : n.kind === 'jump' ? `<span class="n-word">JUMP</span><span class="n-dots">${'<i></i>'.repeat(n.size)}</span>`
      : n.hairpin ? `<span class="n-word">HAIRPIN</span><span class="n-dir">${n.dir > 0 ? 'L' : 'R'}</span>`
        : `<span class="n-num">${n.sev}</span><span class="n-dir">${n.dir > 0 ? 'L' : 'R'}</span>`;
  const mods = n.kind === 'corner' && n.mods.length ? `<span class="n-mods">${n.mods.map((m) => `<em>${MOD_TXT[m] || m}</em>`).join('')}</span>` : '';
  return `<div class="n-card ${SEV_CLASS(n)}" data-key="${noteKey(n)}">${noteIcon(n)}<span class="n-lab">${label}</span>${mods}<span class="n-bar"><b></b></span></div>`;
}
export const noteKey = (n) => `${n.kind}:${n.idx}`;

// ---------------------------------------------------------------- per-pane renderer
// box: the pane's .hud-notes element; shown: notesAhead() result or null (hidden).
// Cards are keyed, so a call slides in once, its distance bar drains, and it slides away when passed.
// Returns the keys that are new this frame (for the call tick).
export function renderNotes(box, shown) {
  const els = box._els || (box._els = new Map());
  const list = shown ? shown.list : [];
  const keys = list.map(noteKey), fresh = [];
  for (const [k, el] of els) {
    if (keys.includes(k)) continue;
    els.delete(k);
    el.classList.add('n-out');
    setTimeout(() => el.remove(), 320);
  }
  list.forEach((n, i) => {
    const k = keys[i];
    let el = els.get(k);
    if (!el) {
      const t = document.createElement('div');
      t.innerHTML = noteHtml(n);
      el = t.firstElementChild; el.classList.add('n-in');
      els.set(k, el); fresh.push(k);
    }
    el.classList.toggle('n-next', i === 0); el.classList.toggle('n-then', i > 0);
    if (el.parentNode !== box) box.appendChild(el); // new calls are always further down the road
    const f = Math.max(0, Math.min(1, shown.dist[i] / shown.call));
    el.querySelector('.n-bar b').style.transform = `scaleX(${f.toFixed(3)})`;
  });
  return fresh;
}
export function clearNotes(box) { if (box._els) box._els.clear(); box.innerHTML = ''; }
