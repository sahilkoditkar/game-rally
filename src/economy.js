// Credits economy and the player's profile (one car, the Rook, upgraded over time).
// Profile `dustline.profile` = { v, credits, build, owned: { parts, paints, accents }, stats: { runs, earned, dailyDone } }
import { store } from './storage.js';
import { params } from './util.js';
import { UPGRADES, PARTS, PAINTS, ACCENTS, SLOTS, DEFAULT_BUILD, normalizeBuild } from './carapi.js';
import { medalPoints, medalRank, MEDAL } from './progress.js';

// ---------------------------------------------------------------- every earning number lives here
export const EARN = {
  // tuned with a simulated silver-level player: first upgrade on run 2, full performance tree in ~43-50 runs
  base: 100,          // any finished solo stage
  perKm: 12,          // per km of stage length
  medal: { bronze: 35, silver: 65, gold: 120, ace: 200 },  // medal of this run
  tierUp: 60,         // per medal tier gained on a stage for the first time (e.g. none -> silver = 2 tiers)
  personalBest: 50,   // beating your previous best on the stage
  dailyFirst: 120,    // first finish of today's daily stage
  rally: 250,         // completing a rally
  rallyGold: 200,     // extra for a gold (or ace) rally trophy
};
// purchases at or above this cost ask for a confirming second press
export const CONFIRM_AT = 900;

const KEY = 'dustline.profile';
const FREE_PAINTS = PAINTS.filter((p) => !(p.cost > 0)).map((p) => p.hex);
const FREE_ACCENTS = ACCENTS.filter((p) => !(p.cost > 0)).map((p) => p.hex);
const FREE_PARTS = PARTS.filter((p) => !(p.cost > 0)).map((p) => p.id);

function freshProfile() {
  // carry over the pre-garage paint choice (an index into the first six paints)
  const oldPaint = store.get('dustline.paint', null);
  const paint = Number.isInteger(oldPaint) && PAINTS[oldPaint] && FREE_PAINTS.includes(PAINTS[oldPaint].hex) ? PAINTS[oldPaint].hex : DEFAULT_BUILD.paint;
  return { v: 1, credits: 0, build: normalizeBuild({ ...DEFAULT_BUILD, paint }), owned: { parts: [], paints: [], accents: [] }, stats: { runs: 0, earned: 0, dailyDone: '' } };
}
function sanitize(p) {
  const f = freshProfile();
  if (!p || typeof p !== 'object') return f;
  const arr = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
  return {
    v: 1,
    credits: Math.max(0, Math.floor(Number(p.credits) || 0)),
    build: normalizeBuild(p.build),
    owned: { parts: arr(p.owned?.parts), paints: arr(p.owned?.paints), accents: arr(p.owned?.accents) },
    stats: { runs: Number(p.stats?.runs) || 0, earned: Number(p.stats?.earned) || 0, dailyDone: String(p.stats?.dailyDone || '') },
  };
}

// ?build=max|stock|<json> and ?credits=N are test overrides: they run on an in-memory profile and never save
const ephemeral = params.has('build') || params.has('credits');
export const profile = sanitize(store.get(KEY, null));
if (params.has('credits')) profile.credits = Math.max(0, Math.floor(Number(params.get('credits')) || 0));
if (params.has('build')) {
  const v = params.get('build');
  if (v === 'max') {
    const b = { ...profile.build, parts: { ...profile.build.parts } };
    for (const u of UPGRADES) b[u.id] = u.levels.length;
    for (const s of SLOTS) { const ps = PARTS.filter((p) => p.slot === s); b.parts[s] = ps[ps.length - 1].id; }
    profile.build = normalizeBuild(b);
  } else if (v === 'stock') profile.build = normalizeBuild({ ...DEFAULT_BUILD, paint: profile.build.paint });
  else { try { profile.build = normalizeBuild({ ...profile.build, ...JSON.parse(v) }); } catch { /* ignore */ } }
}
export function saveProfile() { if (!ephemeral) store.set(KEY, profile); }
export const isEphemeral = () => ephemeral;

// ---------------------------------------------------------------- ownership & purchases
export const ownsPart = (id) => FREE_PARTS.includes(id) || profile.owned.parts.includes(id) || Object.values(profile.build.parts).includes(id);
export const ownsPaint = (hex) => FREE_PAINTS.includes(hex) || profile.owned.paints.includes(hex) || profile.build.paint === hex;
export const ownsAccent = (hex) => FREE_ACCENTS.includes(hex) || profile.owned.accents.includes(hex) || profile.build.accent === hex;
export const partById = (id) => PARTS.find((p) => p.id === id) || null;
export const upgradeById = (id) => UPGRADES.find((u) => u.id === id) || null;

// what buying `id` of `kind` would cost and whether it is allowed now
// kind: 'upgrade' (next level of an upgrade id) | 'part' | 'paint' (hex) | 'accent' (hex)
export function offer(kind, id) {
  let item = null, cost = 0, medals = 0, owned = false, name = '', requires = null;
  if (kind === 'upgrade') {
    const u = upgradeById(id); if (!u) return { ok: false, reason: 'unknown' };
    const lv = profile.build[id] | 0;
    if (lv >= u.levels.length) return { ok: false, owned: true, reason: 'fully upgraded', name: u.name };
    item = u.levels[lv]; /* levels[n - 1] is upgrade level n (0 = stock) */ cost = item.cost | 0; medals = item.medals | 0; name = `${u.name} ${item.name}`;
  } else if (kind === 'part') {
    item = partById(id); if (!item) return { ok: false, reason: 'unknown' };
    owned = ownsPart(id); cost = item.cost | 0; medals = item.medals | 0; name = item.name; requires = item.requires || null;
  } else if (kind === 'paint' || kind === 'accent') {
    item = (kind === 'paint' ? PAINTS : ACCENTS).find((p) => p.hex === id); if (!item) return { ok: false, reason: 'unknown' };
    owned = kind === 'paint' ? ownsPaint(id) : ownsAccent(id); cost = item.cost | 0; medals = item.medals | 0; name = item.name;
  } else return { ok: false, reason: 'unknown' };
  if (owned) return { ok: true, owned: true, cost: 0, name };
  const pts = medalPoints();
  if (medals > pts) return { ok: false, cost, medals, name, reason: `needs ${medals} medal points` };
  if (requires) {
    const u = upgradeById(requires.upgrade);
    if (u && (profile.build[requires.upgrade] | 0) < requires.level) return { ok: false, cost, name, reason: `needs ${u.name}: ${u.levels[requires.level - 1]?.name || 'level ' + requires.level}` };
  }
  if (profile.credits < cost) return { ok: false, cost, name, reason: `${cost - profile.credits} CR short` };
  return { ok: true, cost, name, confirm: cost >= CONFIRM_AT };
}

// performs the purchase (and equips it); returns the offer result
export function buy(kind, id) {
  const o = offer(kind, id);
  if (!o.ok) return o;
  if (!o.owned) profile.credits -= o.cost;
  const b = profile.build;
  if (kind === 'upgrade') b[id] = (b[id] | 0) + 1;
  else if (kind === 'part') { if (!profile.owned.parts.includes(id)) profile.owned.parts.push(id); b.parts[partById(id).slot] = id; }
  else if (kind === 'paint') { if (!profile.owned.paints.includes(id)) profile.owned.paints.push(id); b.paint = id; }
  else if (kind === 'accent') { if (!profile.owned.accents.includes(id)) profile.owned.accents.push(id); b.accent = id; }
  profile.build = normalizeBuild(b);
  saveProfile();
  return { ...o, bought: !o.owned };
}

// something worth a look in the garage: any upgrade or unowned item the player can buy right now
export function anythingAffordable() {
  if (UPGRADES.some((u) => { const o = offer('upgrade', u.id); return o.ok && !o.owned; })) return true;
  return [...PARTS.map((p) => offer('part', p.id)), ...PAINTS.map((p) => offer('paint', p.hex))].some((o) => o.ok && !o.owned);
}

// ---------------------------------------------------------------- earnings
// run: { km, medal, prevMedal, isBest, hadPrev, daily, dateStr } -> { total, lines: [[label, amount]] }
export function stageEarnings(run) {
  const lines = [];
  lines.push(['Stage finish', Math.round(EARN.base + EARN.perKm * run.km)]);
  if (run.medal) lines.push([`${MEDAL[run.medal].name} medal`, EARN.medal[run.medal]]);
  const gained = medalRank(run.medal) - medalRank(run.prevMedal);
  if (gained > 0) lines.push([`New medal tier${gained > 1 ? ` ×${gained}` : ''}`, EARN.tierUp * gained]);
  if (run.isBest && run.hadPrev) lines.push(['Personal best', EARN.personalBest]);
  if (run.daily && profile.stats.dailyDone !== run.dateStr) lines.push(['Daily stage', EARN.dailyFirst]);
  return { total: lines.reduce((s, l) => s + l[1], 0), lines };
}
export function rallyEarnings(trophy) {
  const lines = [['Rally complete', EARN.rally]];
  if (trophy === 'gold' || trophy === 'ace') lines.push([`${MEDAL[trophy].name} trophy`, EARN.rallyGold]);
  return { total: lines.reduce((s, l) => s + l[1], 0), lines };
}
export function earn(n, { daily = null } = {}) {
  n = Math.max(0, Math.floor(n));
  profile.credits += n; profile.stats.earned += n;
  if (daily) profile.stats.dailyDone = daily;
  saveProfile();
  return profile.credits;
}
export function countRun() { profile.stats.runs++; saveProfile(); }
export function setBuild(b) { profile.build = normalizeBuild(b); saveProfile(); }
export const costs = () => ({
  upgrades: UPGRADES.reduce((s, u) => s + u.levels.reduce((a, l) => a + (l.cost | 0), 0), 0),
  cosmetics: PARTS.reduce((s, p) => s + (p.cost | 0), 0) + PAINTS.reduce((s, p) => s + (p.cost | 0), 0) + ACCENTS.reduce((s, p) => s + (p.cost | 0), 0),
});
