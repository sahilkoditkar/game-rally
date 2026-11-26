// Main menu: top bar (medal points, credits, settings), PLAY / GARAGE tabs, the SOLO / DUEL pill,
// one row of tabs (each region + DAILY), that tab's list (3 stages + the region's RALLY, or today's stage) and START.
// The tab IS the selection: whatever START will start is always the highlighted entry on screen.
import { $, fmt, esc } from './util.js';
import { getBest } from './storage.js';
import { REGIONS, getDef, lengthOf, conditions, dailyDef } from './catalog.js';
import { condIcons, medalIcon, targetsHtml, trophyIcon } from './hud.js';
import { renderGarage } from './garage.js';
import { profile, anythingAffordable, EARN } from './economy.js';
import { medalTimes, medalFor, medalPoints, MAX_POINTS, regionMedals, rallyStages, getRallyBest, trophyFor, rallyTimes, stageMedal } from './progress.js';

// ---------------------------------------------------------------- the PLAY list model
// tabs: every region, then DAILY; a region's entries are its stages followed by 'rally'; DAILY holds today's stage
export const TAB_WORD = { forest: 'Forest', desert: 'Desert', snow: 'Snow', coast: 'Coast', peaks: 'Peaks', daily: 'Daily' };
export const playTabs = () => [...REGIONS.map((r) => r.id), 'daily'];
export function tabEntries(tab) {
  if (tab === 'daily') return [dailyDef().id];
  const r = REGIONS.find((x) => x.id === tab);
  return r ? [...r.stages, 'rally'] : [];
}
const tabWord = (tab) => TAB_WORD[tab] || (REGIONS.find((r) => r.id === tab) || {}).name || tab;
const fmtKm = (m) => (m / 1000).toFixed(1) + ' km';
const regionKm = (id) => rallyStages(id).reduce((s, x) => s + lengthOf(getDef(x)), 0);
// the daily tag without its ISO date (the date is in the list header)
const dailyTag = (def) => String(def.tag || '').replace(/\s*·\s*\d{4}-\d{2}-\d{2}\s*$/, '');
export function dailyWhen(def = dailyDef()) {
  const d = new Date(def.date + 'T12:00:00');
  return isNaN(d) ? def.date : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}

// what START says for the current pick (3.4): [verb, what]
export function startLabel(pick, duel) {
  if (pick.entry === 'rally') return [duel ? 'Start duel rally' : 'Start rally', `${rallyStages(pick.tab).length} stages`];
  const def = getDef(pick.entry);
  return [duel ? 'Start duel' : 'Start', pick.tab === 'daily' ? 'Today’s stage' : def ? def.name : ''];
}

function meta(def) {
  const b = getBest(def.id), L = lengthOf(def);
  const m = b ? medalFor(def, b.t) : null;
  return `<span class="card-meta"><b>${L ? fmtKm(L) : ''}</b><span class="${b ? 'has-best' : ''}">${b ? fmt(b.t) : 'no time'}</span></span>
    <span class="card-medal">${medalIcon(m)}</span>`;
}
const targets = (times, selected) => (selected && times ? `<span class="card-targets">${targetsHtml(times)}</span>` : '');

function stageCard(def, n, selected) {
  return `<button class="card${selected ? ' sel' : ''}" data-entry="${esc(def.id)}" role="option" aria-selected="${selected}">
    <span class="card-num">${String(n).padStart(2, '0')}</span>
    <span class="card-name">${esc(def.name)}</span>
    <span class="card-tag">${condIcons(conditions(def))}${esc(def.tag || '')}</span>
    ${meta(def)}${targets(medalTimes(def), selected)}
  </button>`;
}

function rallyCard(regionId, selected) {
  const best = getRallyBest(regionId), tr = best ? trophyFor(regionId, best.t) : null;
  return `<button class="card rally-card${selected ? ' sel' : ''}" data-entry="rally" role="option" aria-selected="${selected}">
    <span class="card-num">${trophyIcon(tr, 'num-trophy')}</span>
    <span class="card-name">Rally</span>
    <span class="card-tag">All ${rallyStages(regionId).length} stages · one clock</span>
    <span class="card-meta"><b>${fmtKm(regionKm(regionId))}</b><span class="${best ? 'has-best' : ''}">${best ? fmt(best.t) : 'no time'}</span></span>
    <span class="card-medal">${trophyIcon(tr)}</span>${targets(rallyTimes(regionId), selected)}
  </button>`;
}

function dailyCard(selected) {
  const def = dailyDef();
  return `<button class="card daily${selected ? ' sel' : ''}" data-entry="${esc(def.id)}" role="option" aria-selected="${selected}">
    <span class="card-num"><svg viewBox="0 0 16 16" class="ico cal" aria-hidden="true"><rect x="1.5" y="3" width="13" height="11.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" stroke="currentColor" stroke-width="1.8"/></svg></span>
    <span class="card-name">Today’s stage</span>
    <span class="card-tag">${condIcons(conditions(def))}${esc(dailyTag(def) || 'A new stage every day')}</span>
    ${meta(def)}
    <span class="card-note">Not counted for medal points · ${profile.stats.dailyDone === def.date ? 'today’s bonus collected' : `first finish today +${EARN.dailyFirst} CR`}</span>${targets(medalTimes(def), selected)}
  </button>`;
}

let lastCredits = null;
// ctx: { pick: {tab, entry}, mode, duelAvailable, view, garage, scroll,
//        onView(v), onPick(tab, entry|null), onStart(), onMode(m), onP2() }
export function renderMenu(ctx) {
  const { pick } = ctx, duel = ctx.mode === 'duel', garage = ctx.view === 'garage';

  // top bar
  const pts = medalPoints();
  $('points').innerHTML = `${medalIcon(pts ? 'gold' : null, 'sm')}<b>${pts}</b><span class="pt-max">/${MAX_POINTS}</span><span class="pt-bar"><i style="width:${(pts / MAX_POINTS) * 100}%"></i></span>`;
  const cr = Math.round(profile.credits);
  $('credits').innerHTML = `<b>${cr.toLocaleString('en-US')}</b><span>CR</span>`;
  if (lastCredits != null && cr !== lastCredits) { const c = $('credits'); c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }
  lastCredits = cr;

  // primary tabs + mode pill (hidden when duel is impossible: touch-only without two pads)
  for (const b of document.querySelectorAll('.view-btn')) {
    const on = (b.dataset.view === 'garage') === garage;
    b.classList.toggle('sel', on); b.setAttribute('aria-selected', String(on));
  }
  $('garageNew').classList.toggle('hidden', !anythingAffordable());
  $('modeSeg').classList.toggle('hidden', !ctx.duelAvailable);
  for (const b of document.querySelectorAll('.seg-btn[data-mode]')) {
    b.classList.toggle('sel', b.dataset.mode === ctx.mode);
    b.setAttribute('aria-checked', String(b.dataset.mode === ctx.mode));
  }
  $('modeNote').innerHTML = duel ? 'Split screen · both cars use your build · <button class="link-btn" id="p2Link">P2 colours ›</button>' : '';
  if (duel) $('p2Link').addEventListener('click', () => ctx.onP2());
  $('menu').classList.toggle('duel', duel);
  $('menu').classList.toggle('garage-view', garage);
  // first launch: what the game is, and one big PLAY (the full menu comes after the first finish or next visit)
  const first = !!ctx.firstRun && !garage && !duel;
  $('menu').classList.toggle('first-run', first);
  $('heroSec').classList.toggle('hidden', !first);
  $('heroSkip').classList.toggle('hidden', !first);
  $('garageSec').classList.toggle('hidden', !garage);
  $('stagesSec').classList.toggle('hidden', garage || first);
  if (first) {
    const def = getDef(pick.entry === 'rally' ? rallyStages(pick.tab)[0] : pick.entry);
    $('heroLine').innerHTML = def ? `${def.id === REGIONS[0].stages[0] ? 'First stage \u00b7 ' : ''}${esc(def.name)} \u00b7 ${fmtKm(lengthOf(def))}` : '';
    $('startBtn').innerHTML = '<span class="st-verb">Play</span><span class="btn-key">Enter</span>';
    $('startBtn').setAttribute('aria-label', 'Play' + (def ? ' ' + def.name : ''));
    $('startBtn').classList.remove('long');
    $('startBtn').classList.add('play-btn');
    return;
  }
  $('startBtn').classList.remove('play-btn');

  // START names what it starts (same in PLAY and GARAGE)
  const [verb, what] = startLabel(pick, duel);
  $('startBtn').innerHTML = `<span class="st-verb">${esc(verb)}</span>${what ? `<span class="st-what">· ${esc(what)}</span>` : ''}<span class="btn-key">Enter</span>`;
  $('startBtn').setAttribute('aria-label', `${verb} ${what}`);
  $('startBtn').classList.toggle('long', verb.includes(' ')); // 'Start duel', 'Start rally': a smaller verb so the name fits

  if (garage) { renderGarage(ctx.garage); return; }

  // tabs: short theme word + medal pips (DAILY: today's medal)
  $('regionTabs').innerHTML = playTabs().map((t) => {
    const pips = t === 'daily' ? [stageMedal(dailyDef().id)] : regionMedals(t);
    return `<button class="tab${t === pick.tab ? ' sel' : ''}${t === 'daily' ? ' daily-tab' : ''}" data-tab="${esc(t)}" role="tab" aria-selected="${t === pick.tab}"><span class="tab-l">${esc(tabWord(t))}</span><span class="pips">${pips.map((m) => `<i class="pip ${m || 'none'}"></i>`).join('')}</span></button>`;
  }).join('');
  for (const b of $('regionTabs').children) b.addEventListener('click', () => ctx.onPick(b.dataset.tab, null));

  // list header + entries
  let n = 0;
  const offset = {};
  for (const r of REGIONS) { offset[r.id] = n; n += r.stages.length; }
  if (pick.tab === 'daily') {
    $('listHead').innerHTML = `<b>Daily stage</b><span>${esc(dailyWhen())}</span>`;
    $('cards').innerHTML = dailyCard(true);
  } else {
    const region = REGIONS.find((r) => r.id === pick.tab) || REGIONS[0];
    $('listHead').innerHTML = `<b>${esc(region.name)}</b><span>${region.stages.length} stages · ${fmtKm(regionKm(region.id))}</span>`;
    $('cards').innerHTML = region.stages.map((id, k) => stageCard(getDef(id), offset[region.id] + k + 1, id === pick.entry)).join('') + rallyCard(region.id, pick.entry === 'rally');
  }
  // tap an entry to select it; tap the selected one to start it
  for (const el of $('cards').children) {
    el.addEventListener('click', () => { const e = el.dataset.entry; if (e === pick.entry) ctx.onStart(); else ctx.onPick(pick.tab, e); });
  }
  // keep the selected entry in view above the pinned footer
  const selEl = $('cards').querySelector('.card.sel');
  if (selEl && ctx.scroll) scrollIntoBody(selEl);
}

// scrollIntoView ignores the sticky footer; scroll the sheet so the element clears it
export function scrollIntoBody(el) {
  const body = $('menuBody'), foot = body.querySelector('.menu-foot');
  if (!body || !el) return;
  const b = body.getBoundingClientRect(), r = el.getBoundingClientRect(), fh = foot ? foot.getBoundingClientRect().height : 0;
  if (r.bottom > b.bottom - fh - 6) body.scrollTop += r.bottom - (b.bottom - fh - 6);
  else if (r.top < b.top + 6) body.scrollTop -= b.top + 6 - r.top;
}
