// Main menu: medal points, mode toggle, region tabs (+ rally strip) and stage cards, the daily card, paints, mute.
import { $, fmt, esc } from './util.js';
import { getBest } from './storage.js';
import { REGIONS, getDef, regionOf, lengthOf, conditions, dailyDef } from './catalog.js';
import { condIcons, medalIcon, targetsHtml } from './hud.js';
import { renderGarage } from './garage.js';
import { profile, anythingAffordable } from './economy.js';
import { medalTimes, medalFor, medalPoints, MAX_POINTS, regionMedals, rallyStages, getRallyBest, trophyFor } from './progress.js';

let viewRegion = null; // region whose cards are shown (tabs only change the view, not the selection)
export const getViewRegion = () => viewRegion;

function meta(def) {
  const b = getBest(def.id), L = lengthOf(def), km = L ? (L / 1000).toFixed(1) + ' km' : '';
  const m = b ? medalFor(def, b.t) : null;
  return `<span class="card-meta"><b>${km}</b><span class="${b ? 'has-best' : ''}">${b ? fmt(b.t) : 'no time'}</span></span>
    <span class="card-medal">${medalIcon(m)}</span>`;
}
const targets = (def, selected) => {
  if (!selected || !medalTimes(def)) return '';
  return `<span class="card-targets">${targetsHtml(medalTimes(def))}</span>`;
};

function stageCard(def, n, selected) {
  return `<button class="card${selected ? ' sel' : ''}" data-id="${esc(def.id)}">
    <span class="card-num">${String(n).padStart(2, '0')}</span>
    <span class="card-name">${esc(def.name)}</span>
    <span class="card-tag">${condIcons(conditions(def))}${esc(def.tag || '')}</span>
    ${meta(def)}${targets(def, selected)}
  </button>`;
}

function dailyCard(selected) {
  const def = dailyDef();
  const d = new Date(def.date + 'T12:00:00');
  const when = isNaN(d) ? def.date : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return `<button class="card daily${selected ? ' sel' : ''}" data-id="${esc(def.id)}">
    <span class="card-num"><svg viewBox="0 0 16 16" class="ico cal" aria-hidden="true"><rect x="1.5" y="3" width="13" height="11.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" stroke="currentColor" stroke-width="1.8"/></svg></span>
    <span class="card-name">Daily Stage <em>${esc(when)}</em></span>
    <span class="card-tag">${condIcons(conditions(def))}${esc(def.tag || 'A new stage every day')}</span>
    ${meta(def)}${targets(def, selected)}
  </button>`;
}

function rallyStrip(region) {
  const ids = rallyStages(region.id), best = getRallyBest(region.id);
  const km = ids.reduce((s, id) => s + lengthOf(getDef(id)), 0) / 1000;
  const tr = best ? trophyFor(region.id, best.t) : null;
  return `<div class="rs-info"><b>Rally</b> <span>${ids.length} stages · ${km.toFixed(1)} km</span>
      <span class="rs-best">${best ? `${medalIcon(tr, 'sm trophy-ico')} best ${fmt(best.t)}` : 'no rally time yet'}</span></div>
    <button class="btn rally-btn" data-r="${esc(region.id)}">Start rally · ${ids.length} stages<span class="btn-key kbd-only">T</span></button>`;
}

// ctx: { sel, mode, duelAvailable, players, muted, scroll, keepView,
//        onSelect(id), onStart(id), onRally(regionId), onMode(m), onPaint(i, idx) }
export function renderMenu(ctx) {
  const selRegion = regionOf(ctx.sel);
  if (!viewRegion || (selRegion !== 'daily' && !ctx.keepView)) viewRegion = selRegion === 'daily' ? viewRegion || REGIONS[0].id : selRegion;
  const region = REGIONS.find((r) => r.id === viewRegion) || REGIONS[0];

  const pts = medalPoints();
  $('points').innerHTML = `<span class="pt-lbl">Medal points</span><b>${pts}</b><span class="pt-max">/ ${MAX_POINTS}</span><span class="pt-bar"><i style="width:${(pts / MAX_POINTS) * 100}%"></i></span>`;

  $('regionTabs').innerHTML = REGIONS.map((r) => `<button class="tab${r.id === region.id ? ' sel' : ''}${r.id === selRegion ? ' has-sel' : ''}" data-r="${esc(r.id)}" role="tab" aria-selected="${r.id === region.id}">${esc(r.name)}<span class="pips">${regionMedals(r.id).map((m) => `<i class="pip ${m || 'none'}"></i>`).join('')}</span></button>`).join('');
  for (const b of $('regionTabs').children) b.addEventListener('click', () => { viewRegion = b.dataset.r; renderMenu({ ...ctx, keepView: true }); });
  $('regionBlurb').textContent = region.blurb || '';
  $('regionTabs').classList.toggle('hidden', REGIONS.length < 2);
  $('rallyStrip').innerHTML = rallyStrip(region);
  $('rallyStrip').querySelector('.rally-btn').addEventListener('click', () => ctx.onRally(region.id));

  let n = 0;
  const offset = {};
  for (const r of REGIONS) { offset[r.id] = n; n += r.stages.length; }
  $('cards').innerHTML = region.stages.map((id, k) => stageCard(getDef(id), offset[region.id] + k + 1, id === ctx.sel)).join('');
  $('dailySlot').innerHTML = dailyCard(regionOf(ctx.sel) === 'daily');
  for (const el of [...$('cards').children, ...$('dailySlot').children]) {
    el.addEventListener('click', () => { const id = el.dataset.id; if (id === ctx.sel) ctx.onStart(id); else ctx.onSelect(id); });
  }

  const [p1, p2] = ctx.players;
  const duel = ctx.mode === 'duel', avail = ctx.duelAvailable;
  $('menu').classList.toggle('duel', duel);
  // RACE view (stages) vs GARAGE view (car + paint); START stays pinned in the footer for both
  const garage = ctx.view === 'garage';
  $('garageSec').classList.toggle('hidden', !garage);
  $('stagesSec').classList.toggle('hidden', garage);
  $('menu').classList.toggle('garage-view', garage);
  for (const b of document.querySelectorAll('.view-btn')) { b.classList.toggle('sel', b.dataset.view === ctx.view); b.setAttribute('aria-selected', String(b.dataset.view === ctx.view)); }
  // a dot on the Garage tab whenever something can be bought right now
  $('garageNew').classList.toggle('hidden', !anythingAffordable());
  if (garage) renderGarage(ctx.garage);
  // footer: credits, the car's paint(s) and the stage you're about to drive; START always works
  const chip = (p) => `<span class="fs-car"><i style="background:${p.paint.hex}"></i>${duel ? `<em>${p.name}</em> ` : ''}${esc(p.paint.name)}</span>`;
  $('footSummary').innerHTML = `<span class="fs-cr"><b>${Math.round(profile.credits).toLocaleString('en-US')}</b> CR</span>` + (duel ? chip(p1) + chip(p2) : chip(p1)) + `<span class="fs-stage">${esc(getDef(ctx.sel).name)}</span>`;
  for (const b of document.querySelectorAll('.seg-btn[data-mode]')) {
    b.classList.toggle('sel', b.dataset.mode === ctx.mode);
    b.setAttribute('aria-checked', String(b.dataset.mode === ctx.mode));
  }
  document.querySelector('.seg-btn[data-mode="duel"]').disabled = !avail;
  $('modeNote').textContent = avail ? (duel ? 'split screen, one keyboard \u00b7 both cars run your build' : 'time trial') : 'Duel needs a keyboard or two gamepads';
  renderMute(ctx.muted);
  // keep the selected card in view inside the scrolling panel
  const selEl = document.querySelector('#menu .card.sel');
  if (selEl && ctx.scroll) selEl.scrollIntoView({ block: 'nearest' });
}

export function renderMute(muted) {
  const b = $('muteBtn');
  b.textContent = muted ? 'Sound off' : 'Sound on';
  b.setAttribute('aria-pressed', String(muted));
}
