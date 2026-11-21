// Settings overlay: Sound (+ Music / Effects volume sliders), Ghost and a Controls reference (Keyboard / Gamepad / Touch).
// Opened from the menu's gear, Esc in PLAY, gamepad Y in the menu and Pause > Settings. Keyboard and pad
// navigate it by rows (up / down), left / right toggle a row or switch the controls tab, Enter / A activates.
import { $ } from './util.js';

const CTL_TABS = [['keyboard', 'Keyboard'], ['gamepad', 'Gamepad'], ['touch', 'Touch']];
const S = { open: false, focus: 0, ctl: 'keyboard', ctx: null, opener: null };
// ctx: { muted(), ghostOn(), defaultCtl(), onMute(), onGhost(), onClose(), volume(kind), onVolume(kind, v, final) }
const VOLS = [['music', 'Music'], ['sfx', 'Effects']];

const k = (...xs) => xs.map((x) => `<kbd>${x}</kbd>`).join('');
const table = (rows, head) => `<table class="ctl-table">${head ? `<tr class="hd">${head.map((h) => `<td>${h}</td>`).join('')}</tr>` : ''}${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
const CONTROLS = {
  keyboard: () => `<div class="ctl-h">Solo</div>${table([
    ['Gas / brake', `${k('↑', '↓')} ${k('W', 'S')}`], ['Steer', `${k('←', '→')} ${k('A', 'D')}`], ['Handbrake', k('Space')],
    ['Reset', k('R')], ['Camera', k('C')], ['Pause', k('Esc')], ['Sound / ghost', k('M', 'G')],
  ])}<div class="ctl-h">Duel</div>${table([
    ['Drive', k('W', 'A', 'S', 'D'), k('↑', '←', '↓', '→')], ['Handbrake', k('L-Shift'), `${k('R-Shift')} / ${k('Enter')}`],
    ['Reset', k('R'), k('/')], ['Camera', k('C'), k('.')],
  ], ['', 'P1', 'P2'])}<div class="ctl-h">Menu</div>
    <p class="ctl-line">${k('↑', '↓')} choose · ${k('←', '→')} tab · ${k('Enter')} start · ${k('V')} garage · ${k('1')}/${k('2')} solo / duel · ${k('Esc')} settings</p>
    <p class="ctl-line">Garage: ${k('↑', '↓')} row · ${k('←', '→')} option · ${k('Space')} buy / fit · ${k('Q')}${k('E')} tune / style · ${k('Esc')} back</p>
    <p class="ctl-line">Results: ${k('Enter')} retry / continue · ${k('N')} next · ${k('Esc')} menu</p>`,
  gamepad: () => `<div class="ctl-h">Race</div>${table([
    ['Gas / brake', 'RT / LT'], ['Steer', 'left stick'], ['Handbrake', 'A'], ['Reset', 'Y'], ['Pause', 'Start'],
  ])}<div class="ctl-h">Menu</div>${table([
    ['Choose', 'd-pad'], ['Tabs', 'LB / RB'], ['Select / start', 'A'], ['Back', 'B'], ['Settings', 'Y'], ['Play / Garage', 'Select'], ['Next stage (results)', 'X'],
  ])}<p class="ctl-line">Pads: 1st → P1, 2nd → P2. Duel needs a keyboard or two gamepads.</p>`,
  touch: () => `<p class="ctl-line touch-line">◀ ▶ steer on the left · GAS / BRAKE on the right · HAND for hairpins · RESET puts you back on the road · ‖ pauses</p>`,
};

const seg2 = (row, on) => `<div class="seg set-seg" role="radiogroup"><button class="seg-btn${on ? ' sel' : ''}" data-row="${row}" data-v="on" role="radio" aria-checked="${on}">On</button><button class="seg-btn${on ? '' : ' sel'}" data-row="${row}" data-v="off" role="radio" aria-checked="${!on}">Off</button></div>`;

function rows() { return [...document.querySelectorAll('#settings [data-nav]')]; }
export function renderSettings() {
  if (!S.ctx) return;
  const c = S.ctx, sound = !c.muted(), ghost = c.ghostOn();
  $('setRows').innerHTML = `
    <div class="set-row" data-nav data-row="sound"><span class="set-l">Sound</span>${seg2('sound', sound)}<kbd class="set-k">M</kbd></div>
    ${VOLS.map(([kind, name]) => volRow(kind, name, sound)).join('')}
    <div class="set-row" data-nav data-row="ghost"><span class="set-l">Ghost<small>Race your saved best run (solo only)</small></span>${seg2('ghost', ghost)}<kbd class="set-k">G</kbd></div>
    <div class="set-ctl" data-nav data-row="controls">
      <div class="set-ctl-head"><span class="set-l">Controls</span><div class="seg ctl-tabs" role="tablist">${CTL_TABS.map(([id, n]) => `<button class="seg-btn${S.ctl === id ? ' sel' : ''}" data-ctl="${id}" role="tab" aria-selected="${S.ctl === id}">${n}</button>`).join('')}</div></div>
      <div class="ctl-body">${CONTROLS[S.ctl]()}</div>
    </div>`;
  for (const b of document.querySelectorAll('#setRows [data-v]')) b.addEventListener('click', () => setRow(b.dataset.row, b.dataset.v === 'on'));
  for (const r of document.querySelectorAll('#setRows [data-vol]')) {
    const kind = r.dataset.vol;
    r.addEventListener('pointerdown', () => { S.focus = rows().findIndex((x) => x.dataset.row === kind); markFocus(); });
    r.addEventListener('input', () => { S.ctx.onVolume(kind, r.value / 100, false); paintVol(kind); }); // live while dragging
    r.addEventListener('change', () => { S.ctx.onVolume(kind, r.value / 100, true); paintVol(kind); r.blur(); }); // released
  }
  for (const b of document.querySelectorAll('#setRows [data-ctl]')) b.addEventListener('click', () => { S.ctl = b.dataset.ctl; renderSettings(); });
  markFocus();
}
// volume rows: a 0-100 slider (step 5) and its value; ← → step it when the row has the focus
function volRow(kind, name, sound) {
  const v = Math.round(S.ctx.volume(kind) * 100);
  return `<div class="set-row set-vol${sound ? '' : ' off'}" data-nav data-row="${kind}"><span class="set-l">${name}</span>`
    + `<input class="vol-range" type="range" min="0" max="100" step="5" value="${v}" data-vol="${kind}" tabindex="-1" aria-label="${name} volume" style="--v:${v}%">`
    + `<output class="vol-v" data-volv="${kind}">${v}</output></div>`;
}
function paintVol(kind) {
  const r = document.querySelector(`#setRows [data-vol="${kind}"]`), o = document.querySelector(`#setRows [data-volv="${kind}"]`);
  const v = Math.round(S.ctx.volume(kind) * 100);
  if (r) { if (+r.value !== v) r.value = v; r.style.setProperty('--v', `${v}%`); }
  if (o) o.textContent = v;
}
function stepVol(kind, d) {
  const v = Math.max(0, Math.min(100, Math.round(S.ctx.volume(kind) * 20) * 5 + d * 5));
  S.ctx.onVolume(kind, v / 100, true);
  paintVol(kind);
}
function setRow(row, on) {
  const c = S.ctx;
  if (row === 'sound' && on === c.muted()) c.onMute();
  if (row === 'ghost' && on !== c.ghostOn()) c.onGhost();
  renderSettings();
}
function markFocus() {
  const rs = rows();
  S.focus = Math.max(0, Math.min(rs.length - 1, S.focus));
  rs.forEach((r, i) => r.classList.toggle('focus', i === S.focus && document.body.classList.contains('kbnav')));
}

export const settingsOpen = () => S.open;
export const settingsState = () => ({ open: S.open, focus: rows()[S.focus]?.dataset.row || null, controls: S.ctl, from: S.ctx ? S.ctx.from : null });
export function openSettings(ctx, opener) {
  S.ctx = ctx; S.open = true; S.focus = 0; S.opener = opener || null;
  S.ctl = ctx.defaultCtl();
  renderSettings();
}
export function closeSettings() {
  if (!S.open) return;
  S.open = false;
  const o = S.opener; S.opener = null;
  if (S.ctx) S.ctx.onClose();
  if (o && o.isConnected && o.focus && document.body.classList.contains('kbnav')) o.focus({ preventScroll: true });
}
// a = 'up' | 'down' | 'left' | 'right' | 'activate' | 'tabprev' | 'tabnext' | 'back'
export function settingsKey(a) {
  const rs = rows(), row = rs[S.focus] ? rs[S.focus].dataset.row : 'done';
  if (a === 'back') { closeSettings(); return; }
  if (a === 'up' || a === 'down') { S.focus = (S.focus + (a === 'up' ? -1 : 1) + rs.length) % rs.length; markFocus(); return; }
  const stepCtl = (d) => { const i = CTL_TABS.findIndex((t) => t[0] === S.ctl); S.ctl = CTL_TABS[(i + d + CTL_TABS.length) % CTL_TABS.length][0]; renderSettings(); };
  if (a === 'tabprev' || a === 'tabnext') { stepCtl(a === 'tabprev' ? -1 : 1); return; }
  if (a === 'left' || a === 'right' || a === 'activate') {
    if (row === 'sound') setRow('sound', S.ctx.muted());
    else if (row === 'ghost') setRow('ghost', !S.ctx.ghostOn());
    else if (row === 'music' || row === 'sfx') { if (a !== 'activate') stepVol(row, a === 'left' ? -1 : 1); }
    else if (row === 'controls') stepCtl(a === 'left' ? -1 : 1);
    else if (row === 'done' && a === 'activate') closeSettings();
  }
}
