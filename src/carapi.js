// The one car (the Rook) and its build: re-exports car.js's upgrade/parts API, with contract-shaped fallbacks
// so the shell keeps working against an older car.js that only has the fixed car.
import * as C from './car.js';

export const autopilot = C.autopilot;
export const HAS_BUILDS = typeof C.normalizeBuild === 'function' && Array.isArray(C.UPGRADES);

const FB_UPGRADES = ['engine', 'tyres', 'brakes', 'suspension'].map((id) => ({
  id, name: id[0].toUpperCase() + id.slice(1), blurb: '',
  // levels are the three purchasable steps; build[id] = 0 is stock, n = levels[n - 1] fitted
  levels: [{ name: 'Stage I', blurb: '', cost: 400, medals: 0 }, { name: 'Stage II', blurb: '', cost: 900, medals: 8 }, { name: 'Stage III', blurb: '', cost: 1600, medals: 18 }],
}));
const FB_SLOTS = ['livery', 'wheels', 'wing', 'roof', 'lamps', 'front', 'arches', 'flaps', 'number'];
const FB_PARTS = FB_SLOTS.flatMap((slot) => [
  { id: `${slot}-std`, slot, name: 'Standard', blurb: '', cost: 0 },
  { id: `${slot}-a`, slot, name: 'Sport', blurb: '', cost: 250 },
  { id: `${slot}-b`, slot, name: 'Works', blurb: '', cost: 600, medals: 10 },
]);
const FB_PAINTS = [...(C.PAINTS || [])].slice(0, 6).map((p) => ({ ...p, cost: 0 }))
  .concat([['Sand', '#d8b98a'], ['Teal', '#2a9d8f'], ['Coral', '#ef8a6f'], ['Slate', '#4b5563'], ['Lime', '#9bc53d'], ['Ink', '#1f2a44'], ['Rose', '#d65a8a'], ['Gold', '#c9a227']]
    .map(([name, hex], i) => ({ name, hex, cost: 150 + i * 50, medals: i > 5 ? 12 : 0 })));
const FB_ACCENTS = [['Chalk', '#f3efe4'], ['Charcoal', '#2b2c33'], ['Mustard', '#f2b632'], ['Ember', '#e2472f'], ['Teal', '#39c5cf'], ['Ice', '#cfe3f5']]
  .map(([name, hex], i) => ({ name, hex, cost: i ? 120 : 0 }));

export const UPGRADES = HAS_BUILDS ? C.UPGRADES : FB_UPGRADES;
export const PARTS = HAS_BUILDS ? C.PARTS : FB_PARTS;
export const PAINTS = HAS_BUILDS ? C.PAINTS : FB_PAINTS;
export const ACCENTS = HAS_BUILDS ? (C.ACCENTS || FB_ACCENTS) : FB_ACCENTS;
export const SLOTS = [...new Set(PARTS.map((p) => p.slot))];
const firstOfSlot = (slot) => PARTS.find((p) => p.slot === slot)?.id;

export const DEFAULT_BUILD = HAS_BUILDS && C.DEFAULT_BUILD ? C.DEFAULT_BUILD : {
  engine: 0, tyres: 0, brakes: 0, suspension: 0,
  parts: Object.fromEntries(SLOTS.map((s) => [s, firstOfSlot(s)])), paint: PAINTS[0].hex, accent: ACCENTS[0].hex,
};

export function normalizeBuild(b) {
  if (HAS_BUILDS) { try { return C.normalizeBuild(b); } catch { return C.normalizeBuild(DEFAULT_BUILD); } }
  const o = b && typeof b === 'object' ? b : {}, out = { ...DEFAULT_BUILD, parts: { ...DEFAULT_BUILD.parts } };
  for (const u of UPGRADES) { const v = o[u.id] | 0; out[u.id] = Math.max(0, Math.min(u.levels.length, v)); }
  for (const s of SLOTS) { const id = o.parts && o.parts[s]; if (PARTS.some((p) => p.id === id && p.slot === s)) out.parts[s] = id; }
  if (typeof o.paint === 'string' && /^#[0-9a-f]{6}$/i.test(o.paint)) out.paint = o.paint;
  if (typeof o.accent === 'string' && /^#[0-9a-f]{6}$/i.test(o.accent)) out.accent = o.accent;
  return out;
}

export function buildStats(b) {
  if (HAS_BUILDS && typeof C.buildStats === 'function') { try { return C.buildStats(normalizeBuild(b)); } catch { /* fall through */ } }
  const n = normalizeBuild(b), L = (k) => n[k] / 3;
  return {
    speed: 0.5 + 0.4 * L('engine'), accel: 0.4 + 0.45 * L('engine'), grip: 0.45 + 0.4 * L('tyres'),
    braking: 0.45 + 0.45 * L('brakes'), composure: 0.4 + 0.45 * L('suspension'), lights: n.parts.lamps && !/std$/.test(n.parts.lamps) ? 0.8 : 0.5,
  };
}

// a car showing `build` (falls back to the fixed car + paint on an older car.js)
export function makeCar(build) {
  const b = normalizeBuild(build);
  const car = HAS_BUILDS ? new C.Car(b) : new C.Car();
  if (!HAS_BUILDS) car.setPaint(b.paint);
  return car;
}
export function applyBuild(car, build) {
  const b = normalizeBuild(build);
  if (HAS_BUILDS && typeof car.setBuild === 'function') car.setBuild(b);
  else car.setPaint(b.paint);
}
export const paintName = (hex) => PAINTS.find((p) => p.hex.toLowerCase() === String(hex).toLowerCase())?.name || 'Custom';
export const accentName = (hex) => ACCENTS.find((p) => p.hex.toLowerCase() === String(hex).toLowerCase())?.name || 'Custom';
