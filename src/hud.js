// Per-pane HUD (timer, gap, splits, progress, speed plate, notices) and the solo / duel result panels.
import { STEP, clamp } from './track.js';
import { $, fmt, fmtDelta, deltaClass, esc } from './util.js';

const PANE_HTML = `
  <div class="hud-tl">
    <div class="hud-stage"><b class="pl-tag"></b><span class="st-name"></span><span class="st-cond"></span></div>
    <div class="hud-time">0:00.000</div>
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
    el, tag: q('.pl-tag'), stage: q('.st-name'), cond: q('.st-cond'), time: q('.hud-time'), gap: q('.hud-gap'), split: q('.hud-split'),
    fill: q('.prog-fill'), ticks: q('.prog-ticks'), cars: q('.prog-cars'), speed: q('.spd'), gear: q('.gear'), rpm: q('.rpm-fill'),
    msg: q('.pane-msg'), msgK: q('.pm-kicker'), msgT: q('.pm-time'), msgW: q('.pm-wait'), notice: q('.notice'),
    last: '', gapTxt: '', markers: [],
  };
}

export function showNotice(p, text, dur = 1.4, cls = '') {
  const n = p.ui.notice;
  n.textContent = text; n.className = 'notice show ' + cls;
  clearTimeout(p.noticeTm);
  p.noticeTm = setTimeout(() => hideNotice(p), dur * 1000);
}
export function hideNotice(p) { p.ui.notice.classList.remove('show'); }

export function preparePanes(racers, stage, cond) {
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
    // one marker per racer in their paint; this pane's own car sits on top
    u.cars.innerHTML = racers.map((q) => `<i class="${q === p ? 'me' : ''}" style="background:${q.paint.hex}"></i>`).join('');
    u.markers = [...u.cars.children];
    hideNotice(p);
  }
}

const progressOf = (p, stage) => clamp((p.car.idx - stage.startIdx) / (stage.finishIdx - stage.startIdx), 0, 1);
export function updatePanes(racers, stage, state) {
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
  const { t, s, prev, isBest } = run;
  $('finStage').textContent = def.name + ' · complete';
  $('finTime').textContent = fmt(t);
  $('finBest').innerHTML = isBest
    ? `<span class="newbest">NEW BEST</span>${prev ? ` &nbsp;${fmtDelta(t - prev.t)} on ${fmt(prev.t)}` : ''}`
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
