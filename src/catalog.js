// Stage catalogue: regions, menu order, the daily stage, lookups and lengths.
// Codes defensively against track.js: REGIONS / stageLength / dailyStage and the new def fields
// (region, night, rain, par, lightIntensity) may be missing, in which case sensible defaults apply.
import * as T from './track.js';
import { params } from './util.js';

export const STAGES = T.STAGES;
const byId = new Map(STAGES.map((d) => [d.id, d]));

const FALLBACK_REGIONS = [{ id: 'classic', name: 'Classic', blurb: 'The original three stages.', stages: STAGES.map((d) => d.id) }];
export const REGIONS = (Array.isArray(T.REGIONS) && T.REGIONS.length ? T.REGIONS : FALLBACK_REGIONS)
  .map((r) => ({ id: r.id, name: r.name || r.id, blurb: r.blurb || '', stages: (r.stages || []).filter((id) => byId.has(id)) }))
  .filter((r) => r.stages.length);
// any stage not listed in a region still gets a home, so nothing becomes unreachable
{
  const listed = new Set(REGIONS.flatMap((r) => r.stages)), rest = STAGES.filter((d) => !listed.has(d.id)).map((d) => d.id);
  if (rest.length) REGIONS.push({ id: 'more', name: 'More', blurb: '', stages: rest });
}

export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const dailyCache = new Map();
export function dailyDef(dateStr = localDateStr()) {
  if (dailyCache.has(dateStr)) return dailyCache.get(dateStr);
  let def = null;
  try { if (typeof T.dailyStage === 'function') def = T.dailyStage(dateStr); } catch { def = null; }
  if (!def) {
    // fallback for a track.js without dailyStage(): re-seed one of the stages from the date
    let h = 2166136261;
    for (const c of dateStr) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    h >>>= 0;
    const base = STAGES[h % STAGES.length];
    def = { ...base, seed: 1000 + (h % 90000), points: (base.points || 30) + (h % 5) - 2 };
  }
  def = { ...def, id: `daily-${dateStr}`, name: def.name && def.daily ? def.name : 'Daily Stage', region: 'daily', daily: true, date: dateStr };
  dailyCache.set(dateStr, def);
  return def;
}
export const isDaily = (id) => id === 'daily' || String(id).startsWith('daily-');

// menu order: every region's stages, then the daily stage
export function menuIds() { return [...REGIONS.flatMap((r) => r.stages), dailyDef().id]; }

export function getDef(key) {
  if (key == null) return STAGES[0];
  if (typeof key === 'object' && key.id) return key;
  const k = String(key);
  if (isDaily(k)) return k === 'daily' ? dailyDef() : dailyDef(k.slice(6));
  if (byId.has(k)) return byId.get(k);
  if (/^\d+$/.test(k)) return STAGES[Math.min(STAGES.length - 1, +k)] || STAGES[0];
  return null;
}

export function regionOf(id) {
  if (isDaily(id)) return 'daily';
  const r = REGIONS.find((x) => x.stages.includes(id));
  return r ? r.id : REGIONS[0].id;
}

// "next stage" follows REGIONS order and wraps (the daily stage leads back to the first stage)
export function nextId(id) {
  const ids = REGIONS.flatMap((r) => r.stages), i = ids.indexOf(id);
  return ids[(i + 1) % ids.length] || ids[0];
}

const lenCache = new Map();
export function lengthOf(def) {
  if (lenCache.has(def.id)) return lenCache.get(def.id);
  let L = 0;
  try {
    if (typeof T.stageLength === 'function') L = T.stageLength(def);
    else { // old track.js: run only the path builder on a bare object with flat noise
      const o = Object.create(T.Stage.prototype);
      o.def = def; o.R = T.mulberry(def.seed); o.n1 = o.n2 = () => 0;
      o.buildPath(); L = o.length;
    }
  } catch { L = 0; }
  lenCache.set(def.id, L);
  return L;
}

// conditions, with defaults; ?cond=night,rain forces them (a dev/test override)
const force = new Set((params.get('cond') || '').split(',').filter(Boolean));
export function conditions(def) {
  const night = !!def.night || force.has('night'), rain = !!def.rain || force.has('rain');
  const li = def.lightIntensity || (night ? { sun: 0.3, ambient: 0.35 } : { sun: 1, ambient: 1 });
  return { night, rain, sun: li.sun ?? 1, ambient: li.ambient ?? 1 };
}
