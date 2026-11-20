// Garage: the car roster, medal-point unlocks, "NEW" tags, which car set each best, and the car pickers.
import { CARS, PAINTS } from './car.js';
import { $, esc } from './util.js';
import { store } from './storage.js';
import { medalPoints } from './progress.js';

export const carById = (id) => CARS.find((c) => c.id === id) || null;
export const isUnlocked = (id, points = medalPoints()) => { const c = carById(id); return !!c && points >= (c.unlock || 0); };
// cars whose threshold a points change crossed (before < unlock <= after)
export const crossedUnlocks = (before, after) => CARS.filter((c) => (c.unlock || 0) > before && (c.unlock || 0) <= after);

// cars unlocked but not yet looked at in the garage
const NEW_KEY = 'dustline.carsNew';
export const newCars = () => { const a = store.get(NEW_KEY, []); return Array.isArray(a) ? a : []; };
export function markNew(ids) { const a = new Set(newCars()); ids.forEach((id) => a.add(id)); store.set(NEW_KEY, [...a]); }
export function markSeen(id) { const a = newCars(); if (a.includes(id)) store.set(NEW_KEY, a.filter((x) => x !== id)); }

// one best time per stage (any car); remember which car set it
export const bestCarKey = (stageId) => `dustline.bestcar.${stageId}`;
export const getBestCar = (stageId) => carById(store.get(bestCarKey(stageId), null));
export const setBestCar = (stageId, carId) => store.set(bestCarKey(stageId), carId);

const STAT_NAMES = [['speed', 'Speed'], ['accel', 'Accel'], ['grip', 'Grip'], ['drift', 'Drift']];
const LOCK = '<svg class="lock" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.6"/><path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke-width="1.8"/></svg>';
export const lockIcon = LOCK;

// one player's picker: ◀ car ▶, blurb, stat bars, lock state, paint swatches
// opts: { player, carId, allUnlocked, points, onCar(dir), onPaint(idx) }
export function renderPicker(el, o) {
  const c = carById(o.carId) || CARS[0], idx = CARS.indexOf(c);
  const locked = !o.allUnlocked && o.points < (c.unlock || 0), isNew = newCars().includes(c.id);
  el.classList.toggle('locked', locked);
  el.innerHTML = `
    <div class="pk-head">
      <span class="pl-label">${o.player.name}</span>
      <button class="pk-arrow" data-dir="-1" aria-label="Previous car">◀</button>
      <div class="pk-name"><b>${esc(c.name)}</b>${isNew ? '<span class="new-tag">NEW</span>' : ''}${locked ? `<span class="pk-lock">${LOCK}</span>` : ''}</div>
      <button class="pk-arrow" data-dir="1" aria-label="Next car">▶</button>
      <span class="pk-count">${idx + 1} / ${CARS.length}</span>
    </div>
    <div class="pk-blurb">${esc(c.blurb || '')}</div>
    <div class="pk-stats">${STAT_NAMES.map(([k, n]) => `<span class="st"><i>${n}</i><span class="bar"><b style="width:${Math.round((c.stats?.[k] ?? 0) * 100)}%"></b></span></span>`).join('')}</div>
    ${locked ? `<div class="pk-lockline">${LOCK} ${c.unlock - o.points} more medal point${c.unlock - o.points === 1 ? '' : 's'} to unlock <span>(${c.unlock} needed)</span></div>` : ''}
    <div class="paints pk-paints">${PAINTS.map((p, i) => `<button class="swatch${i === o.player.paintIdx ? ' sel' : ''}" data-i="${i}" style="background:${p.hex}" aria-label="${o.player.name} ${p.name}" title="${p.name}"></button>`).join('')}<span class="pk-paint">${esc(o.player.paint.name)}</span></div>`;
  for (const b of el.querySelectorAll('.pk-arrow')) b.addEventListener('click', () => o.onCar(+b.dataset.dir));
  for (const b of el.querySelectorAll('.swatch')) b.addEventListener('click', () => o.onPaint(+b.dataset.i));
}

// NEW-car flourish for finish / rally panels
export const unlockBlock = (cars) => (cars && cars.length ? cars.map((c) => `<div class="unlock"><span class="ul-k">NEW CAR UNLOCKED</span><b>${esc(c.name)}</b><span class="ul-hint">pick it in the Garage</span></div>`).join('') : '');
