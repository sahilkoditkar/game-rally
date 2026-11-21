// Per-pane HUD (timer, gap, splits, progress, speed plate, notices) and the solo / duel result panels.
import { STEP, clamp } from './track.js';
import { $, fmt, fmtDelta, deltaClass, esc } from './util.js';
import { MEDAL, MEDALS, nextTarget, medalRank } from './progress.js';

// short clock for targets: m:ss.s
export const fmtShort = (t) => (t >= 0 ? `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}` : '-:--.-');
// medal badge (inline SVG); id null draws an empty outline
// the Ace is a star inside an open ring, so it reads differently from the round medals, not just by colour
const ACE_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle class="ring" cx="10" cy="10" r="8.4"/><path class="star" d="M10 2.6l2.1 4.8 5.2.5-3.9 3.5 1.1 5.1L10 13.9l-4.5 2.6 1.1-5.1-3.9-3.5 5.2-.5z"/></svg>';
export const medalIcon = (id, cls = '') => `<span class="medal ${id || 'none'} ${cls}" title="${id ? MEDAL[id].name : 'No medal yet'}">${id === 'ace' ? ACE_SVG : '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.2"/><path d="M10 5.2l1.4 2.9 3.2.45-2.3 2.25.55 3.2L10 12.5l-2.85 1.5.55-3.2-2.3-2.25 3.2-.45z"/></svg>'}</span>`;
export const targetsHtml = (times) => (times ? MEDALS.map((m) => `<span class="tgt">${medalIcon(m.id, 'sm')}${fmtShort(times[m.id])}</span>`).join('') : '');

const PANE_HTML = `
  <div class="hud-tl">
    <div class="hud-stage"><b class="pl-tag"></b><span class="st-name"></span><span class="st-cond"></span></div>
    <div class="hud-time">0:00.000</div>
    <div class="hud-sub"><span class="hud-rally"></span><span class="hud-ghost"></span><span class="hud-target"></span></div>
    <div class="hud-gap"></div>
    <div class="hud-split"></div>
  </div>
  <div class="hud-progress"><div class="prog"><div class="prog-fill"></div><div class="prog-ticks"></div><div class="prog-cars"></div></div></div>
  <div class="hud-br">
    <div class="speed"><span class="spd">0</span><small>km/h</small></div>
    <div class="gearrow"><span class="gear">1</span><div class="rpm"><div class="rpm-fill"></div></div></div>
  </div>
  <div class="pane-msg hidden"><div class="pm-kicker"></div><div class="pm-time"></div><div class="pm-wait"></div></div>
  <div class="notice"></div>`;

// condition badges (inline SVG, inherit currentColor)
export const ICON = {
  night: '<svg class="ico" viewBox="0 0 16 16" aria-label="night"><path d="M10.5 1.5a6.5 6.5 0 1 0 4 11.6A7 7 0 0 1 10.5 1.5z" fill="currentColor"/></svg>',
  rain: '<svg class="ico" viewBox="0 0 16 16" aria-label="rain"><path d="M8 1.5C6 5 4 7.2 4 9.8a4 4 0 0 0 8 0C12 7.2 10 5 8 1.5z" fill="currentColor"/></svg>',
};
export const condIcons = (c) => (c.night ? `<span class="cond n" title="Night">${ICON.night}</span>` : '') + (c.rain ? `<span class="cond r" title="Rain">${ICON.rain}</span>` : '');

export function createPane(i, parent) {
  const el = document.createElement('div');
  el.className = 'pane'; el.dataset.p = String(i); el.innerHTML = PANE_HTML;
  parent.appendChild(el);
  const q = (s) => el.querySelector(s);
  return {
    el, ghost: q('.hud-ghost'), target: q('.hud-target'), rally: q('.hud-rally'), tag: q('.pl-tag'), stage: q('.st-name'), cond: q('.st-cond'), time: q('.hud-time'), gap: q('.hud-gap'), split: q('.hud-split'),
    fill: q('.prog-fill'), ticks: q('.prog-ticks'), cars: q('.prog-cars'), speed: q('.spd'), gear: q('.gear'), rpm: q('.rpm-fill'),
    msg: q('.pane-msg'), msgK: q('.pm-kicker'), msgT: q('.pm-time'), msgW: q('.pm-wait'), notice: q('.notice'),
    last: '', gapTxt: '', tgtTxt: '', rallyTxt: '', ghostTxt: '', markers: [],
  };
}

export function showNotice(p, text, dur = 1.4, cls = '') {
  const n = p.ui.notice;
  n.textContent = text; n.className = 'notice show ' + cls;
  clearTimeout(p.noticeTm);
  p.noticeTm = setTimeout(() => hideNotice(p), dur * 1000);
}
export function hideNotice(p) { p.ui.notice.classList.remove('show'); }

// opts: { targets: medal times or null (solo only), rally: { n, of } or null }
export function preparePanes(racers, stage, cond, opts = {}) {
  const span = stage.finishIdx - stage.startIdx;
  const ticks = stage.splits.map((i) => `<i style="left:${((i - stage.startIdx) / span) * 100}%"></i>`).join('') + '<i class="end" style="left:100%"></i>';
  for (const p of racers) {
    const u = p.ui;
    u.stage.textContent = stage.def.name;
    u.cond.innerHTML = condIcons(cond);
    u.tag.textContent = racers.length === 2 ? p.name : '';
    u.split.classList.remove('show');
    u.gap.textContent = ''; u.gapTxt = ''; u.gap.classList.remove('show');
    u.ticks.innerHTML = ticks;
    p.targets = racers.length === 1 ? opts.targets || null : null;
    u.tgtTxt = u.rallyTxt = ''; u.target.innerHTML = ''; u.rally.innerHTML = '';
    // one marker per racer in their paint; this pane's own car sits on top
    u.cars.innerHTML = racers.map((q) => `<i class="${q === p ? 'me' : ''}" style="background:${q.paint.hex}"></i>`).join('');
    u.markers = [...u.cars.children];
    hideNotice(p);
  }
}

const progressOf = (p, stage) => clamp((p.car.idx - stage.startIdx) / (stage.finishIdx - stage.startIdx), 0, 1);
// rally: { n, of, totals: [p0, p1] } or null
// ghostDelta: undefined = no ghost; null = ghost but no comparable point yet; number = player minus ghost (s)
export function updatePanes(racers, stage, state, rally, ghostDelta) {
  const duel = racers.length === 2;
  for (const p of racers) {
    const u = p.ui, car = p.car;
    const txt = fmt(state === 'countdown' ? 0 : p.time);
    if (txt !== u.last) { u.time.textContent = txt; u.last = txt; }
    u.speed.textContent = Math.round(Math.abs(car.vf != null ? car.vf : car.speed) * 3.6);
    u.gear.textContent = car.gear === 0 ? 'R' : String(car.gear | 0 || 1);
    u.rpm.style.width = (clamp(car.rpm, 0, 1) * 100).toFixed(1) + '%';
    u.fill.style.width = (progressOf(p, stage) * 100).toFixed(2) + '%';
    racers.forEach((q, k) => { if (u.markers[k]) u.markers[k].style.left = (progressOf(q, stage) * 100).toFixed(2) + '%'; });
    // next medal still in reach, switching down as the clock passes each target
    const gd = ghostDelta === undefined || p.i ? '' : `<b>GHOST</b> <span class="${ghostDelta == null ? 'd-none' : deltaClass(ghostDelta)}">${ghostDelta == null ? '\u2014' : (ghostDelta < 0 ? '\u2212' : '+') + Math.abs(ghostDelta).toFixed(2)}</span>`;
    if (gd !== u.ghostTxt) { u.ghost.innerHTML = gd; u.ghostTxt = gd; u.ghost.classList.toggle('show', !!gd); }
    const nt = !p.done && state !== 'finish' ? nextTarget(p.targets, p.time) : null;
    const tg = nt ? `${medalIcon(nt.id, 'sm')}<b>${nt.name}</b> ${fmtShort(nt.t)}` : '';
    if (tg !== u.tgtTxt) { u.target.innerHTML = tg; u.tgtTxt = tg; u.target.classList.toggle('show', !!tg); }
    const rt = rally ? `<b>STAGE ${rally.n} / ${rally.of}</b> \u03a3 ${fmt(rally.totals[p.i] + (state === 'countdown' ? 0 : p.time))}` : '';
    if (rt !== u.rallyTxt) { u.rally.innerHTML = rt; u.rallyTxt = rt; u.rally.classList.toggle('show', !!rt); }
    if (!duel) continue;
    // live gap: distance along the road to the other car (cheap and stable)
    const o = racers[1 - p.i];
    let g = '';
    if (state === 'race' && !p.done) {
      if (o.done) g = `<span class="lbl">${o.name}</span> ${fmt(o.time)}`;
      else {
        const d = Math.round((car.idx - o.car.idx) * STEP);
        g = `<span class="lbl">GAP</span><span class="${d > 0 ? 'd-good' : d < 0 ? 'd-bad' : 'd-none'}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)} m</span>`;
      }
    }
    if (g !== u.gapTxt) { u.gap.innerHTML = g; u.gapTxt = g; u.gap.classList.toggle('show', !!g); }
  }
}

// split flash: d = delta vs reference (solo best or the other player), vs = optional opponent name
export function flashSplit(p, k, d, vs) {
  const el = p.ui.split;
  el.innerHTML = `<span class="lbl">SPLIT ${k + 1}</span><span class="${deltaClass(d)}">${d == null ? fmt(p.time) : fmtDelta(d)}</span>${vs && d != null ? ` <span class="lbl">vs ${vs}</span>` : ''}`;
  el.classList.add('show');
  clearTimeout(p.splitTm);
  p.splitTm = setTimeout(() => el.classList.remove('show'), 3200);
}

export function paneFinished(racers) {
  for (const q of racers) {
    if (!q.done) continue;
    const o = racers[1 - q.i];
    q.ui.msgK.textContent = `${q.name} finished`;
    q.ui.msgT.textContent = fmt(q.time);
    q.ui.msgW.textContent = o.done ? '' : `waiting for ${o.name}…`;
  }
}

export function renderFinish(def, run, nextName) {
  const { t, s, prev, isBest, medal, newMedal, up } = run;
  $('finMedal').innerHTML = medalBlock(medal, newMedal, up);
  $('finStage').textContent = def.name + ' · complete';
  $('finTime').textContent = fmt(t);
  $('finBest').innerHTML = isBest
    ? `<span class="newbest">NEW BEST</span>${prev ? ` &nbsp;${fmtDelta(t - prev.t)} on ${fmt(prev.t)}` : ''}${run.ghostSaved ? ' <span class="ghost-saved">ghost saved</span>' : ''}`
    : `Best ${fmt(prev.t)} &nbsp;<span style="color:var(--bad)">${fmtDelta(t - prev.t)}</span>`;
  const rows = [['Split 1', s[0], prev && prev.s ? prev.s[0] : null], ['Split 2', s[1], prev && prev.s ? prev.s[1] : null], ['Finish', t, prev ? prev.t : null]];
  $('finSplits').innerHTML = rows.map(([n, v, b]) => {
    const d = v != null && b != null ? v - b : null;
    return `<tr><td>${n}</td><td>${fmt(v)}</td><td class="${deltaClass(d)}">${d == null ? '—' : fmtDelta(d)}</td></tr>`;
  }).join('');
  $('nextBtn').innerHTML = `Next: ${esc(nextName)}<span class="btn-key">N</span>`;
}

export function renderDuelResults(def, racers, nextName) {
  const [a, b] = racers, gap = Math.abs(a.time - b.time), tie = gap < 0.0005;
  const w = a.time <= b.time ? a : b;
  $('dfStage').textContent = def.name + ' · duel';
  const win = $('dfWinner');
  win.style.setProperty('--pc', tie ? 'var(--mustard)' : w.paint.hex);
  win.innerHTML = tie ? '<span class="w-name">DEAD HEAT</span>' : `<span class="w-chip"></span><span class="w-name">${w.name} WINS</span><span class="w-paint">${w.paint.name}</span>`;
  $('dfGap').textContent = tie ? 'identical to the millisecond' : `by ${gap.toFixed(3)} s`;
  const chip = (p) => `<span class="pchip" style="background:${p.paint.hex}"></span>${p.name}`;
  const rows = [['Split 1', a.splits[0], b.splits[0]], ['Split 2', a.splits[1], b.splits[1]], ['Finish', a.time, b.time]];
  $('dfTable').innerHTML = `<tr class="hd"><td></td><td>${chip(a)}</td><td>${chip(b)}</td><td>Gap</td></tr>` + rows.map(([n, x, y]) => {
    const both = x != null && y != null, fa = both && x < y, fb = both && y < x;
    return `<tr><td>${n}</td><td class="${fa ? 'win' : ''}">${fmt(x)}</td><td class="${fb ? 'win' : ''}">${fmt(y)}</td><td>${both ? Math.abs(x - y).toFixed(3) : '—'}</td></tr>`;
  }).join('');
  $('dfNext').innerHTML = `Next: ${esc(nextName)}<span class="btn-key">N</span>`;
}

// earned medal with a CSS flourish, NEW MEDAL tag and the gap to the next one up
export function medalBlock(medal, isNew, up) {
  const head = medal
    ? `<div class="medal-big ${medal}">${medalIcon(medal)}<span class="mb-name">${MEDAL[medal].name}</span>${isNew ? '<span class="newmedal">NEW MEDAL</span>' : ''}</div>`
    : '<div class="medal-big none">' + medalIcon(null) + '<span class="mb-name">No medal</span></div>';
  const next = up ? `<div class="medal-up">${up.gap > 0 ? `${up.gap.toFixed(3)} s to ${up.name}` : `${up.name} reached`}</div>` : (medal === 'ace' ? '<div class="medal-up">top medal</div>' : '');
  return head + next;
}

// ---------------------------------------------------------------- rally panels (interstitial + final results)
// info: { regionName, n, of, stageName, nextName, racers:[{name, hex, time, total, medal, newMedal}], parTotal, auto }
export function renderRallyStage(info) {
  const solo = info.racers.length === 1, a = info.racers[0];
  let body;
  if (solo) {
    const d = info.parTotal != null ? a.total - info.parTotal : null;
    body = `<div class="fin-time">${fmt(a.time)}</div>
      <div class="rally-medal">${medalBlock(a.medal, a.newMedal, a.up)}</div>${info.earnHtml || ''}
      <div class="rally-cum"><span class="lbl">Total</span> <b>${fmt(a.total)}</b>${d != null ? ` <span class="lbl">vs par ${fmt(info.parTotal)}</span> <span class="${deltaClass(d)}">${fmtDelta(d)}</span>` : ''}</div>`;
  } else {
    body = `<table class="splits duel-splits"><tr class="hd"><td></td>${info.racers.map((r) => `<td><span class="pchip" style="background:${r.hex}"></span>${r.name}</td>`).join('')}</tr>
      <tr><td>Stage</td>${info.racers.map((r) => `<td>${fmt(r.time)}</td>`).join('')}</tr>
      <tr><td>Total</td>${info.racers.map((r, k) => `<td class="${r.total < info.racers[1 - k].total ? 'win' : ''}">${fmt(r.total)}</td>`).join('')}</tr></table>`;
  }
  $('rallyBody').innerHTML = `<div class="panel-kicker">Rally \u00b7 ${esc(info.regionName)} \u00b7 stage ${info.n} / ${info.of}</div>
    <div class="panel-title">${esc(info.stageName)}</div>${body}
    <div class="rally-next">Next: <b>${esc(info.nextName)}</b></div>
    <div class="panel-btns"><button class="btn primary" data-act="continue">Continue<span class="btn-key">Enter</span></button><button class="btn ghost" data-act="abandon">Abandon rally</button></div>`;
}

// info: { regionName, ids, names, racers:[{name, hex, times:[...], total, medals:[...]}], parTotal, trophy, prev, isBest }
export function renderRallyResults(info) {
  const solo = info.racers.length === 1, a = info.racers[0];
  let head;
  if (solo) {
    const d = info.prev ? a.total - info.prev.t : null;
    head = `<div class="fin-time">${fmt(a.total)}</div>
      <div class="fin-best">${info.isBest ? `<span class="newbest">NEW BEST</span>${info.prev ? ` &nbsp;${fmtDelta(d)} on ${fmt(info.prev.t)}` : ''}` : `Best ${fmt(info.prev.t)} &nbsp;<span style="color:var(--bad)">${fmtDelta(d)}</span>`}</div>
      <div class="rally-medal">${trophyBlock(info.trophy)}</div>${info.earnHtml || ''}`;
  } else {
    const [p, q] = info.racers, gap = Math.abs(p.total - q.total), w = p.total <= q.total ? p : q;
    head = `<div class="winner" style="--pc:${gap < 0.0005 ? 'var(--mustard)' : w.hex}">${gap < 0.0005 ? '<span class="w-name">DEAD HEAT</span>' : `<span class="w-chip"></span><span class="w-name">${w.name} WINS</span>`}</div>
      <div class="df-gap">${gap < 0.0005 ? 'identical totals' : `by ${gap.toFixed(3)} s over ${info.ids.length} stages`}</div>`;
  }
  const cols = info.racers.map((r) => `<td>${solo ? 'Time' : `<span class="pchip" style="background:${r.hex}"></span>${r.name}`}</td>`).join('');
  const rows = info.names.map((n, k) => `<tr><td>${esc(n)}</td>${info.racers.map((r) => `<td>${fmt(r.times[k])}${solo ? ' ' + medalIcon(r.medals[k], 'sm') : ''}</td>`).join('')}</tr>`).join('');
  const total = `<tr class="tot"><td>Total</td>${info.racers.map((r) => `<td>${fmt(r.total)}</td>`).join('')}</tr>`;
  const par = solo && info.parTotal ? `<tr><td>Par</td><td>${fmt(info.parTotal)}</td></tr>` : '';
  $('rallyBody').innerHTML = `<div class="panel-kicker">Rally complete \u00b7 ${esc(info.regionName)}</div>${head}
    <table class="splits duel-splits rally-table"><tr class="hd"><td>Stage</td>${cols}</tr>${rows}${total}${par}</table>
    <div class="panel-btns"><button class="btn primary" data-act="again">Rally again<span class="btn-key">R</span></button><button class="btn ghost" data-act="menu">Menu<span class="btn-key">Enter</span></button></div>`;
}

export function trophyBlock(id) {
  return `<div class="medal-big trophy ${id || 'none'}"><span class="medal ${id || 'none'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v3h3v2a5 5 0 0 1-4.6 5A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 8.6 13 5 5 0 0 1 4 8V6h3zm-1 5c0 1.4.9 2.6 2 3V8zm12 0h-2v3c1.1-.4 2-1.6 2-3z"/></svg></span><span class="mb-name">${id ? MEDAL[id].name + ' trophy' : 'No trophy'}</span></div>`;
}

// credits earned on a run: "+ 310 CR" with its lines, and an optional nudge towards the garage
export function earningsBlock(e, balance, hint) {
  if (!e || !e.total) return '';
  return `<div class="earn"><div class="earn-h"><span class="earn-t">+ ${e.total.toLocaleString('en-US')} CR</span><span class="earn-bal">balance ${Math.round(balance).toLocaleString('en-US')} CR</span></div>
    <div class="earn-lines">${e.lines.map(([l, n]) => `<span><i>${esc(l)}</i><b>+${n}</b></span>`).join('')}</div>${hint ? `<div class="earn-hint">${hint}</div>` : ''}</div>`;
}
