// Medals, medal points and rally (championship) records.
// A stage's medal is derived from its stored best time and the stage par; nothing medal-specific is stored.
import * as T from './track.js';
import { store, getBest } from './storage.js';
import { STAGES, REGIONS, getDef } from './catalog.js';

// best first; a time earns a medal when it is <= par * factor
export const MEDALS = [
  { id: 'gold', name: 'Gold', factor: 1.03, points: 3, color: '#f2b632' },
  { id: 'silver', name: 'Silver', factor: 1.15, points: 2, color: '#c9ced6' },
  { id: 'bronze', name: 'Bronze', factor: 1.35, points: 1, color: '#c0793f' },
];
export const MEDAL = Object.fromEntries(MEDALS.map((m) => [m.id, m]));
const RANK = { gold: 3, silver: 2, bronze: 1 };
export const medalRank = (id) => RANK[id] || 0;

// the 12 regular stages count towards points; the daily stage shows a medal but does not count
const REGULAR = REGIONS.flatMap((r) => r.stages);
export const MAX_POINTS = REGULAR.length * 3;

const parCache = new Map();
export function parOf(def) {
  if (!def) return null;
  if (typeof def.par === 'number' && def.par > 0) return def.par;
  if (parCache.has(def.id)) return parCache.get(def.id);
  let p = null;
  try { if (typeof T.estimatePar === 'function') p = T.estimatePar(def); } catch { p = null; }
  p = typeof p === 'number' && p > 0 ? p : null;
  parCache.set(def.id, p);
  return p;
}

const thresholds = (par) => (par ? { gold: par * MEDAL.gold.factor, silver: par * MEDAL.silver.factor, bronze: par * MEDAL.bronze.factor } : null);

// { gold, silver, bronze } target times in seconds, or null when the stage has no par
export function medalTimes(def) { return thresholds(parOf(def)); }

// 'gold' | 'silver' | 'bronze' | null
export function medalFor(def, t) {
  const m = medalTimes(def);
  if (!m || !(t > 0)) return null;
  return MEDALS.find((x) => t <= m[x.id])?.id || null;
}

// medal of a stage's stored best time
export function stageMedal(id) {
  const def = getDef(id), b = def && getBest(def.id);
  return b ? medalFor(def, b.t) : null;
}

export function medalPoints() { return REGULAR.reduce((s, id) => s + (MEDAL[stageMedal(id)]?.points || 0), 0); }
export const regionMedals = (regionId) => (REGIONS.find((r) => r.id === regionId)?.stages || []).map(stageMedal);

// the best medal still reachable at clock time t (for the in-race target), or null
export function nextTarget(times, t) {
  if (!times) return null;
  const m = MEDALS.find((x) => t <= times[x.id]);
  return m ? { id: m.id, name: m.name, t: times[m.id] } : null;
}
// the next medal above `medal` and how far t is from it
export function medalUp(def, t, medal) {
  const times = medalTimes(def);
  if (!times) return null;
  const better = MEDALS.filter((m) => medalRank(m.id) > medalRank(medal));
  const up = better[better.length - 1];
  return up ? { id: up.id, name: up.name, gap: t - times[up.id] } : null;
}

// ---------------------------------------------------------------- rallies: one per region, its stages back to back
export const rallyStages = (regionId) => REGIONS.find((r) => r.id === regionId)?.stages.slice() || [];
export function rallyPar(regionId) {
  const ps = rallyStages(regionId).map((id) => parOf(getDef(id)));
  return ps.length && ps.every((p) => p) ? ps.reduce((a, b) => a + b, 0) : null;
}
export const rallyTimes = (regionId) => thresholds(rallyPar(regionId));
export function trophyFor(regionId, total) {
  const m = rallyTimes(regionId);
  if (!m || !(total > 0)) return null;
  return MEDALS.find((x) => total <= m[x.id])?.id || null;
}
// { t: total seconds, stages: [t1, t2, t3] }
export const rallyKey = (regionId) => `dustline.rally.${regionId}`;
export function getRallyBest(regionId) { const b = store.get(rallyKey(regionId), null); return b && typeof b.t === 'number' ? b : null; }
export function setRallyBest(regionId, rec) { store.set(rallyKey(regionId), rec); }

// handy summary for the test hook / UI
export function medalSummary() {
  return { points: medalPoints(), max: MAX_POINTS, stages: Object.fromEntries([...REGULAR, ...STAGES.filter((d) => !REGULAR.includes(d.id)).map((d) => d.id)].map((id) => [id, stageMedal(id)])) };
}
