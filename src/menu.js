// Main menu: mode toggle, region tabs + stage cards, the daily stage card, paints, mute.
import { PAINTS } from './car.js';
import { $, fmt, esc } from './util.js';
import { getBest } from './storage.js';
import { REGIONS, getDef, regionOf, lengthOf, conditions, dailyDef } from './catalog.js';
import { condIcons } from './hud.js';

let viewRegion = null; // region whose cards are shown (tabs only change the view, not the selection)
export const setViewRegion = (id) => { viewRegion = id; };

function stageCard(def, n, selected) {
  const b = getBest(def.id), L = lengthOf(def), km = L ? (L / 1000).toFixed(1) + ' km' : '';
  return `<button class="card${selected ? ' sel' : ''}" data-id="${esc(def.id)}">
    <span class="card-num">${String(n).padStart(2, '0')}</span>
    <span class="card-name">${esc(def.name)}</span>
    <span class="card-tag">${condIcons(conditions(def))}${esc(def.tag || '')}</span>
    <span class="card-meta"><b>${km}</b><span class="${b ? 'has-best' : ''}">${b ? fmt(b.t) : 'no time'}</span></span>
  </button>`;
}

function dailyCard(selected) {
  const def = dailyDef(), b = getBest(def.id), L = lengthOf(def), km = L ? (L / 1000).toFixed(1) + ' km' : '';
  const d = new Date(def.date + 'T12:00:00');
  const when = isNaN(d) ? def.date : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return `<button class="card daily${selected ? ' sel' : ''}" data-id="${esc(def.id)}">
    <span class="card-num"><svg viewBox="0 0 16 16" class="ico cal" aria-hidden="true"><rect x="1.5" y="3" width="13" height="11.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" stroke="currentColor" stroke-width="1.8"/></svg></span>
    <span class="card-name">Daily Stage <em>${esc(when)}</em></span>
    <span class="card-tag">${condIcons(conditions(def))}${esc(def.tag || 'A new stage every day')}</span>
    <span class="card-meta"><b>${km}</b><span class="${b ? 'has-best' : ''}">${b ? fmt(b.t) : 'no time'}</span></span>
  </button>`;
}

// ctx: { sel, mode, duelAvailable, players, onSelect(id), onStart(id), onMode(m), onPaint(i, idx) }
export function renderMenu(ctx) {
  const selRegion = regionOf(ctx.sel);
  if (!viewRegion || (selRegion !== 'daily' && !ctx.keepView)) viewRegion = selRegion === 'daily' ? viewRegion || REGIONS[0].id : selRegion;
  const region = REGIONS.find((r) => r.id === viewRegion) || REGIONS[0];

  $('regionTabs').innerHTML = REGIONS.map((r) => `<button class="tab${r.id === region.id ? ' sel' : ''}${r.id === selRegion ? ' has-sel' : ''}" data-r="${esc(r.id)}" role="tab" aria-selected="${r.id === region.id}">${esc(r.name)}</button>`).join('');
  for (const b of $('regionTabs').children) b.addEventListener('click', () => { viewRegion = b.dataset.r; renderMenu({ ...ctx, keepView: true }); });
  $('regionBlurb').textContent = region.blurb || '';
  $('regionTabs').classList.toggle('hidden', REGIONS.length < 2);

  let n = 0;
  const offset = {};
  for (const r of REGIONS) { offset[r.id] = n; n += r.stages.length; }
  $('cards').innerHTML = region.stages.map((id, k) => stageCard(getDef(id), offset[region.id] + k + 1, id === ctx.sel)).join('');
  $('dailySlot').innerHTML = dailyCard(regionOf(ctx.sel) === 'daily');
  for (const el of [...$('cards').children, ...$('dailySlot').children]) {
    el.addEventListener('click', () => { const id = el.dataset.id; if (id === ctx.sel) ctx.onStart(id); else ctx.onSelect(id); });
  }

  const [p1, p2] = ctx.players;
  const paintRow = (el, p) => {
    el.innerHTML = PAINTS.map((c, i) => `<button class="swatch${i === p.paintIdx ? ' sel' : ''}" data-i="${i}" style="background:${c.hex}" aria-label="${p.name} ${c.name}" title="${c.name}"></button>`).join('');
    for (const b of el.children) b.addEventListener('click', () => ctx.onPaint(p.i, +b.dataset.i));
  };
  paintRow($('paints'), p1); paintRow($('paints2'), p2);
  const duel = ctx.mode === 'duel', avail = ctx.duelAvailable;
  $('paintName').textContent = duel ? `${p1.paint.name} vs ${p2.paint.name}` : p1.paint.name;
  $('menu').classList.toggle('duel', duel);
  for (const b of document.querySelectorAll('.seg-btn')) {
    b.classList.toggle('sel', b.dataset.mode === ctx.mode);
    b.setAttribute('aria-checked', String(b.dataset.mode === ctx.mode));
  }
  document.querySelector('.seg-btn[data-mode="duel"]').disabled = !avail;
  $('modeNote').textContent = avail ? (duel ? 'split screen, one keyboard' : 'time trial') : 'Duel needs a keyboard or two gamepads';
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
