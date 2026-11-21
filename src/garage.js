// Garage view: upgrade the Rook (TUNE) and dress it (STYLE). Previews on hover/focus, buy on click/Space.
import { $, esc } from './util.js';
import { UPGRADES, PARTS, PAINTS, ACCENTS, SLOTS, buildStats, normalizeBuild } from './carapi.js';
import { profile, offer, buy, ownsPaint, ownsAccent, CONFIRM_AT } from './economy.js';

const STATS = [['speed', 'Speed'], ['accel', 'Accel'], ['grip', 'Grip'], ['braking', 'Brakes'], ['composure', 'Composure'], ['lights', 'Lights']];
const SLOT_NAMES = { livery: 'Livery', wheels: 'Wheels', wing: 'Wing', roof: 'Roof', lamps: 'Lamps', front: 'Front', arches: 'Arches', flaps: 'Mud flaps', number: 'Number' };
const fmtCr = (n) => `${Math.round(n).toLocaleString('en-US')} CR`;

// view state (kept across renders)
const G = { tab: 'tune', focus: 0, armed: null, armedTm: 0, preview: null, flash: null };
let ctx = null; // { duel, p2: {paint, accent}, onPreview(build|null), onBought(res), onP2(kind, hex), refresh() }

export const garageTab = () => G.tab;
export function setGarageTab(t) { G.tab = t === 'style' ? 'style' : 'tune'; G.focus = 0; G.armed = null; setPreview(null); }

function withItem(kind, id) {
  const b = normalizeBuild(profile.build);
  if (kind === 'upgrade') { const u = UPGRADES.find((x) => x.id === id); b[id] = Math.min(u.levels.length, (b[id] | 0) + 1); }
  else if (kind === 'part') { const p = PARTS.find((x) => x.id === id); if (p) b.parts[p.slot] = id; }
  else if (kind === 'paint') b.paint = id;
  else if (kind === 'accent') b.accent = id;
  return normalizeBuild(b);
}
function setPreview(build) {
  G.preview = build;
  renderStats();
  if (ctx) ctx.onPreview(build);
}

// ---------------------------------------------------------------- rendering
function statBars() {
  const cur = buildStats(profile.build), nxt = G.preview ? buildStats(G.preview) : cur;
  return STATS.map(([k, n]) => {
    const a = Math.max(0, Math.min(1, cur[k] ?? 0)), b = Math.max(0, Math.min(1, nxt[k] ?? 0));
    const lo = Math.min(a, b), d = b - a;
    return `<div class="gs"><i>${n}</i><span class="bar"><b style="width:${(lo * 100).toFixed(1)}%"></b>${d ? `<s class="${d > 0 ? 'up' : 'down'}" style="left:${(lo * 100).toFixed(1)}%;width:${(Math.abs(d) * 100).toFixed(1)}%"></s>` : ''}</span></div>`;
  }).join('');
}
function renderStats() { const el = $('gStats'); if (el) el.innerHTML = statBars(); }

function priceTag(o) {
  if (o.owned) return '<span class="g-owned">owned</span>';
  if (!o.ok) return `<span class="g-why">${esc(o.reason)}</span>`;
  return `<span class="g-cost">${fmtCr(o.cost)}</span>`;
}

function tuneHtml() {
  return UPGRADES.map((u) => {
    const lv = profile.build[u.id] | 0, max = u.levels.length, o = offer('upgrade', u.id), next = u.levels[lv]; // level n = levels[n - 1]
    const key = `upgrade:${u.id}`, armed = G.armed === key;
    return `<div class="g-row tune${G.flash === key ? ' bought' : ''}" data-nav data-kind="upgrade" data-id="${u.id}" tabindex="-1">
      <div class="g-name"><b>${esc(u.name)}</b><span class="pips">${u.levels.map((_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span><em>${lv ? esc(u.levels[lv - 1].name) : 'Stock'}</em></div>
      <div class="g-next">${next ? `<b>${esc(next.name)}</b> <span>${esc(next.blurb || u.blurb || '')}</span>` : `<b>${esc(u.levels[max - 1].name)}</b> <span>fully upgraded</span>`}</div>
      <div class="g-buy">${next ? priceTag(o) : '<span class="g-owned">max</span>'}
        ${next ? `<button class="btn g-btn${o.ok ? '' : ' off'}${armed ? ' armed' : ''}" data-act="buy" ${o.ok ? '' : 'aria-disabled="true"'}>${armed ? `Confirm ${fmtCr(o.cost)}` : 'Buy'}</button>` : ''}</div>
    </div>`;
  }).join('');
}

function chip(kind, id, label, sub, equipped, o, swatch) {
  const key = `${kind}:${id}`;
  return `<button class="g-chip${equipped ? ' eq' : ''}${o.owned ? ' own' : o.ok ? ' buyable' : ' locked'}${G.armed === key ? ' armed' : ''}${G.flash === key ? ' bought' : ''}${swatch ? ' sw' : ''}"
    data-kind="${kind}" data-id="${esc(id)}" title="${esc(label)}${o.owned ? '' : ' — ' + esc(o.ok ? fmtCr(o.cost) : o.reason)}">
    ${swatch ? `<span class="sw-dot" style="background:${swatch}"></span>` : ''}<span class="c-l">${esc(label)}</span>${sub ? `<span class="c-s">${sub}</span>` : ''}</button>`;
}
function chipSub(o, equipped) {
  if (equipped) return 'on';
  if (o.owned) return '';
  if (G.armed && o.ok) return esc(fmtCr(o.cost));
  return o.ok ? esc(fmtCr(o.cost)) : '<span class="lockdot"></span>' + esc(o.reason);
}
function styleHtml() {
  const b = profile.build, rows = [];
  rows.push(`<div class="g-row style sw-row" data-nav tabindex="-1"><div class="g-slot">Paint</div><div class="g-chips">${PAINTS.map((p) => {
    const o = offer('paint', p.hex), eq = b.paint === p.hex;
    return chip('paint', p.hex, p.name, eq ? 'on' : o.owned ? '' : o.ok ? fmtCr(o.cost) : esc(o.reason), eq, o, p.hex);
  }).join('')}</div></div>`);
  rows.push(`<div class="g-row style sw-row" data-nav tabindex="-1"><div class="g-slot">Accent</div><div class="g-chips">${ACCENTS.map((p) => {
    const o = offer('accent', p.hex), eq = b.accent === p.hex;
    return chip('accent', p.hex, p.name, eq ? 'on' : o.owned ? '' : o.ok ? fmtCr(o.cost) : esc(o.reason), eq, o, p.hex);
  }).join('')}</div></div>`);
  for (const s of SLOTS) {
    rows.push(`<div class="g-row style" data-nav tabindex="-1"><div class="g-slot">${esc(SLOT_NAMES[s] || s)}</div><div class="g-chips">${PARTS.filter((p) => p.slot === s).map((p) => {
      const o = offer('part', p.id), eq = b.parts[s] === p.id;
      return chip('part', p.id, p.name, chipSub(o, eq), eq, o);
    }).join('')}</div></div>`);
  }
  return rows.join('');
}

function p2Html() {
  if (!ctx || !ctx.duel) return '';
  const own = PAINTS.filter((p) => ownsPaint(p.hex)), acc = ACCENTS.filter((p) => ownsAccent(p.hex));
  return `<div class="g-p2"><div class="g-p2h"><b>P2</b> races the same build — pick a paint from your collection</div>
    <div class="g-chips">${own.map((p) => `<button class="g-chip sw own${ctx.p2.paint === p.hex ? ' eq' : ''}" data-p2="paint" data-id="${p.hex}" title="${esc(p.name)}"><span class="sw-dot" style="background:${p.hex}"></span></button>`).join('')}</div>
    <div class="g-chips acc">${acc.map((p) => `<button class="g-chip sw own${ctx.p2.accent === p.hex ? ' eq' : ''}" data-p2="accent" data-id="${p.hex}" title="${esc(p.name)}"><span class="sw-dot" style="background:${p.hex}"></span></button>`).join('')}</div></div>`;
}

export function renderGarage(c) {
  ctx = c;
  const el = $('garageSec');
  el.innerHTML = `
    <div class="g-top">
      <div class="g-credits" id="gCredits"><b>${Math.round(profile.credits).toLocaleString('en-US')}</b><span>CR</span></div>
      <div class="seg g-tabs" role="tablist">
        <button class="seg-btn${G.tab === 'tune' ? ' sel' : ''}" data-gtab="tune">Tune</button>
        <button class="seg-btn${G.tab === 'style' ? ' sel' : ''}" data-gtab="style">Style</button>
      </div>
    </div>
    <div class="g-stats" id="gStats">${statBars()}</div>
    <div class="g-list ${G.tab}" id="gList">${G.tab === 'tune' ? tuneHtml() : styleHtml()}</div>
    <div class="g-hint kbd-only">↑↓ choose · ←→ option · <kbd>Space</kbd> buy / fit · <kbd>Q</kbd><kbd>E</kbd> tune / style · <kbd>Enter</kbd> race</div>
    ${p2Html()}`;
  for (const b of el.querySelectorAll('[data-gtab]')) b.addEventListener('click', () => { setGarageTab(b.dataset.gtab); ctx.refresh(); });
  // tune: hover/focus a row previews its next level; the button buys
  for (const row of el.querySelectorAll('.g-row.tune')) {
    row.addEventListener('pointerenter', () => setPreview(withItem('upgrade', row.dataset.id)));
    row.addEventListener('pointerleave', () => setPreview(null));
    row.querySelector('[data-act=buy]')?.addEventListener('click', () => activate('upgrade', row.dataset.id));
  }
  // style: hover/focus a chip previews it on the car; leaving the list reverts
  for (const ch of el.querySelectorAll('.g-chip[data-kind]')) {
    ch.addEventListener('pointerenter', () => setPreview(withItem(ch.dataset.kind, ch.dataset.id)));
    ch.addEventListener('focus', () => setPreview(withItem(ch.dataset.kind, ch.dataset.id)));
    ch.addEventListener('click', () => activate(ch.dataset.kind, ch.dataset.id));
  }
  $('gList').addEventListener('pointerleave', () => setPreview(null));
  for (const ch of el.querySelectorAll('[data-p2]')) ch.addEventListener('click', () => ctx.onP2(ch.dataset.p2, ch.dataset.id));
  markFocus(false);
}

// ---------------------------------------------------------------- actions
function activate(kind, id) {
  const o = offer(kind, id), key = `${kind}:${id}`;
  if (!o.ok) { ctx.onBought({ ...o, denied: true }); flashRow(key, 'denied'); return; }
  if (o.confirm && !o.owned && G.armed !== key) {
    // pricier items need a second press within 3 s
    G.armed = key; clearTimeout(G.armedTm);
    G.armedTm = setTimeout(() => { G.armed = null; ctx.refresh(); }, 3000);
    ctx.refresh(); return;
  }
  G.armed = null;
  const res = buy(kind, id);
  G.flash = res.bought ? key : null;
  G.preview = null;
  ctx.onBought(res);
  ctx.refresh();
  setTimeout(() => { if (G.flash === key) G.flash = null; }, 900);
}
function flashRow(key, cls) {
  const [kind, id] = key.split(/:(.+)/);
  const el = document.querySelector(`#garageSec [data-kind="${kind}"][data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
}

// keyboard / gamepad: a = 'up' | 'down' | 'left' | 'right' | 'activate' | 'tab'
function navRows() { return [...document.querySelectorAll('#gList [data-nav]')]; }
function markFocus(preview = true) {
  const rows = navRows();
  G.focus = Math.max(0, Math.min(rows.length - 1, G.focus));
  rows.forEach((r, i) => { r.classList.toggle('focus', i === G.focus); if (i !== G.focus) r.querySelectorAll('.kfocus').forEach((c) => c.classList.remove('kfocus')); });
  const row = rows[G.focus];
  if (!row) return;
  if (G.tab === 'style') {
    const chips = [...row.querySelectorAll('.g-chip')];
    if (row._opt == null) row._opt = Math.max(0, chips.findIndex((c) => c.classList.contains('eq')));
    chips.forEach((c, i) => c.classList.toggle('kfocus', i === row._opt));
    if (preview && chips[row._opt]) setPreview(withItem(chips[row._opt].dataset.kind, chips[row._opt].dataset.id));
  } else if (preview) setPreview(withItem('upgrade', row.dataset.id));
  if (preview) row.scrollIntoView({ block: 'nearest' });
}
export function garageKey(a) {
  const rows = navRows();
  if (a === 'tab') { setGarageTab(G.tab === 'tune' ? 'style' : 'tune'); ctx.refresh(); return; }
  if (a === 'up' || a === 'down') { G.focus = (G.focus + (a === 'up' ? -1 : 1) + rows.length) % rows.length; markFocus(); return; }
  const row = rows[G.focus];
  if (!row) return;
  if ((a === 'left' || a === 'right') && G.tab === 'style') {
    const chips = [...row.querySelectorAll('.g-chip')];
    row._opt = ((row._opt ?? 0) + (a === 'left' ? -1 : 1) + chips.length) % chips.length;
    markFocus(); return;
  }
  if (a === 'activate') {
    if (G.tab === 'tune') activate('upgrade', row.dataset.id);
    else { const c = row.querySelectorAll('.g-chip')[row._opt ?? 0]; if (c) { const keep = G.focus; activate(c.dataset.kind, c.dataset.id); G.focus = keep; markFocus(false); } }
  }
}
export const garagePreview = () => G.preview;
export function clearPreview() { if (G.preview) setPreview(null); }
export { CONFIRM_AT, fmtCr };
