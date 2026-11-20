// Dustline — conductor: renderer, scene & conditions, stage lifecycle, game states, actions, loop, rendering.
// Module map: util / storage / catalog (stages, regions, daily) / fx (dust, rain, headlights) /
// player (racer + cameras) / hud (panes + result panels) / menu / input.
import * as THREE from 'three';
import { Stage, clamp } from './track.js';
import { autopilot } from './car.js';
import { Sound } from './audio.js';
import { $, params } from './util.js';
import { store, getBest, setBest } from './storage.js';
import { REGIONS, menuIds, getDef, regionOf, nextId, isDaily, dailyDef, conditions } from './catalog.js';
import { Dust, Rain } from './fx.js';
import { Player, CAMS, paintKey, updateCamera, aimSun } from './player.js';
import { showNotice, preparePanes, updatePanes, flashSplit, paneFinished, renderFinish, renderDuelResults, renderRallyStage, renderRallyResults } from './hud.js';
import { renderMenu, renderMute, getViewRegion } from './menu.js';
import { medalTimes, medalFor, medalRank, medalUp, rallyStages, rallyPar, parOf, trophyFor, getRallyBest, setRallyBest, medalSummary } from './progress.js';
import { keys, HOLD, readInput, pollPads, connectedPads, bindKeyboard, bindTouch } from './input.js';

const FIXED = 1 / 120;
const SUN_BASE = 2.5, HEMI_BASE = 1.7;

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, HEMI_BASE);
const sun = new THREE.DirectionalLight(0xffffff, SUN_BASE);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 320 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.06;
scene.add(hemi, sun, sun.target);
const sunDir = new THREE.Vector3(0.6, 0.7, 0.3).normalize();

const dust = new Dust(); scene.add(dust.mesh);
const rain = new Rain(); scene.add(rain.mesh);

function skyTexture(top, horizon) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(0.72, horizon); gr.addColorStop(1, horizon);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- sound (one centred instance solo, two panned in duel)
let muted = !!store.get('dustline.muted', false);
const soundBank = {};
function soundFor(key, opts) {
  if (!soundBank[key]) { soundBank[key] = new Sound(opts); soundBank[key].setMuted(muted); }
  return soundBank[key];
}
const allSounds = () => Object.values(soundBank);
const resumeAudio = () => { for (const s of allSounds()) s.resume(); };
const modeSounds = () => (racers.length === 2
  ? [soundFor('l', { pan: -0.5, gain: 0.85 }), soundFor('r', { pan: 0.5, gain: 0.85 })]
  : [soundFor('c', { pan: 0, gain: 1 })]);
const soundOf = (p) => modeSounds()[racers.length === 2 ? p.i : 0];
const beepAll = (f, d) => { for (const s of modeSounds()) s.beep(f, d); };
soundFor('c', { pan: 0, gain: 1 });

// ---------------------------------------------------------------- players & state
const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const hasFinePointer = window.matchMedia && window.matchMedia('(any-pointer: fine)').matches;
if (isTouch) document.body.classList.add('touch');
const players = [new Player(0, scene, $('panes')), new Player(1, scene, $('panes'))];
let racers = [players[0]];
let state = 'boot', paused = false;
let auto = params.get('auto') === '1';
let mode = 'solo';
let sel = null; // selected stage id (menu order includes today's daily stage)
let cdT = 0, cdShown = null, finishT = 0, lastRun = null, hintsT = 0;
let cond = { night: false, rain: false, sun: 1, ambient: 1 };
// championship: { region, ids, idx, phase: 'stage' | 'inter' | 'final', totals: [p0, p1], times: [[], []], medals: [[], []], newMedals: [[], []] }
let rally = null;

// split-screen needs two sets of controls: a keyboard, or two gamepads
const duelAvailable = () => !isTouch || hasFinePointer || connectedPads().length >= 2;

// ---------------------------------------------------------------- stage lifecycle (at most 2 built: current + previous)
const built = new Map(); // id -> Stage, oldest first
let stage = null;
function loadStage(def) {
  if (stage && stage.def.id === def.id) return;
  if (stage) scene.remove(stage.group);
  let s = built.get(def.id);
  if (s) built.delete(def.id); else s = new Stage(def);
  built.set(def.id, s);
  while (built.size > 2) {
    const [id, old] = built.entries().next().value;
    built.delete(id);
    old.dispose();
  }
  stage = s;
  scene.add(stage.group);
  applyConditions(stage.def);
}

const RAIN_TINT = new THREE.Color('#9fb2c8'), NIGHT_TINT = new THREE.Color('#1d2740');
function applyConditions(d) {
  cond = conditions(d);
  // a stage forced to night via ?cond= keeps its day palette, so darken it here; real night defs bring their own
  const forcedNight = cond.night && !d.night;
  const col = (hex) => { const c = new THREE.Color(hex); if (forcedNight) c.lerp(NIGHT_TINT, 0.82); return '#' + c.getHexString(); };
  if (scene.background) scene.background.dispose();
  scene.background = skyTexture(col(d.sky[0]), col(d.sky[1]));
  const fogNear = d.fogRange[0] * (cond.rain ? 0.7 : 1), fogFar = d.fogRange[1] * (cond.rain ? 0.75 : 1);
  scene.fog = new THREE.Fog(col(d.fog), fogNear, fogFar);
  hemi.color.set(d.ambient[0]); hemi.groundColor.set(d.ambient[1]);
  sun.color.set(d.sun);
  if (cond.rain) { sun.color.lerp(RAIN_TINT, 0.4); hemi.color.lerp(RAIN_TINT, 0.3); }
  sun.intensity = SUN_BASE * cond.sun * (cond.rain ? 0.7 : 1);
  hemi.intensity = HEMI_BASE * cond.ambient * (cond.rain ? 0.85 : 1);
  sunDir.set(d.sunPos[0], d.sunPos[1], d.sunPos[2]).normalize();
  dust.setStyle(d.dust, cond);
  dust.clear();
  rain.setEnabled(cond.rain, cond.night);
  for (const p of players) p.lights.setEnabled(cond.night);
}

// build a stage behind a small loading veil (yield a frame first so the veil paints)
function withLoading(def, fn) {
  if (built.has(def.id)) { fn(); return; }
  const l = $('loading');
  l.classList.remove('fade'); if (state !== 'boot') l.classList.add('soft');
  requestAnimationFrame(() => setTimeout(() => { try { fn(); } finally { l.classList.add('fade'); } }, 30));
}

// ---------------------------------------------------------------- screens & layout
function setScreen() {
  const racing = state === 'countdown' || state === 'race' || state === 'finish';
  const duel = racers.length === 2, showResults = state === 'finish' && finishT > 1.1;
  document.body.classList.toggle('duel', duel && racing);
  $('menu').classList.toggle('hidden', state !== 'menu');
  $('hud').classList.toggle('hidden', !racing);
  $('pause').classList.toggle('hidden', !paused);
  $('finish').classList.toggle('hidden', !(showResults && !duel && !rally));
  $('duelFinish').classList.toggle('hidden', !(showResults && duel && !rally));
  $('rally').classList.toggle('hidden', !(showResults && rally));
  // in a rally, pausing offers Resume / Abandon rally only
  $('restartBtn').classList.toggle('hidden', !!rally);
  $('pMenuBtn').textContent = rally ? 'Abandon rally' : 'Menu';
  $('touch').classList.toggle('hidden', !(isTouch && !duel && (state === 'countdown' || state === 'race') && !paused));
  players[1].car.group.visible = duel && racing;
  for (const p of players) {
    p.ui.el.classList.toggle('hidden', !racers.includes(p));
    p.ui.msg.classList.toggle('hidden', !(duel && p.done && !showResults));
  }
  layout();
}

// viewports: one full-screen pane, or two side by side (landscape) / stacked (portrait)
function layout() {
  const W = window.innerWidth, H = window.innerHeight, duel = racers.length === 2;
  const pr = Math.min(window.devicePixelRatio || 1, duel ? 1.5 : 2);
  if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);
  renderer.setSize(W, H);
  const land = W >= H;
  if (!duel) players[0].view = { x: 0, y: 0, w: W, h: H };
  else if (land) { const a = Math.floor(W / 2); players[0].view = { x: 0, y: 0, w: a, h: H }; players[1].view = { x: a, y: 0, w: W - a, h: H }; }
  else { const a = Math.floor(H / 2); players[0].view = { x: 0, y: 0, w: W, h: a }; players[1].view = { x: 0, y: a, w: W, h: H - a }; }
  $('divider').className = 'divider' + (land ? ' v' : ' h') + (!duel || state === 'menu' ? ' hidden' : '');
  document.body.classList.toggle('stacked', duel && !land);
  for (const p of racers) {
    const v = p.view, c = p.cam, s = p.ui.el.style;
    s.left = v.x + 'px'; s.top = v.y + 'px'; s.width = v.w + 'px'; s.height = v.h + 'px';
    c.aspect = v.w / v.h;
    c.fov = c.aspect < 0.8 ? 62 : c.aspect < 1.1 ? 56 : 50;
    // solo menu / results: nudge the car out from under the panel (right on wide screens, up on portrait)
    const side = !duel && (state === 'menu' || (state === 'finish' && finishT > 1.1));
    if (side && W > 720) c.setViewOffset(W, H, -Math.min(W * 0.2, 300), 0, W, H);
    else if (!duel && state === 'menu') c.setViewOffset(W, H, 0, H * 0.12, W, H);
    else c.clearViewOffset();
    c.updateProjectionMatrix();
  }
}
window.addEventListener('resize', layout);

function showMenu(scroll = false) {
  renderMenu({
    sel, mode, duelAvailable: duelAvailable(), players, muted, scroll,
    onSelect: (id) => select(id), onStart: (id) => { select(id); startStage(id); },
    onRally: (regionId) => startRally(regionId),
    onMode: (m) => setMode(m),
    onPaint: (i, idx) => { players[i].setPaint(idx); store.set(paintKey(i), idx); showMenu(); },
  });
}

function setMode(m) {
  mode = m === 'duel' && duelAvailable() ? 'duel' : 'solo';
  store.set('dustline.mode', mode);
  if (state === 'menu') showMenu();
}

// ---------------------------------------------------------------- game flow
function startStage(key) {
  const def = getDef(key) || getDef(sel);
  withLoading(def, () => {
    sel = def.id;
    loadStage(def);
    racers = mode === 'duel' ? players : [players[0]];
    racers.forEach((p, k) => {
      p.resetRun();
      p.place(stage, stage.startIdx, racers.length === 2 ? (k === 0 ? 1.6 : -1.6) : 0); // P1 on the left, P2 on the right
    });
    preparePanes(racers, stage, cond, { targets: racers.length === 1 ? medalTimes(def) : null });
    dust.clear();
    state = 'countdown'; paused = false;
    cdT = -0.5; cdShown = null; finishT = 0; hintsT = 0;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    setScreen();
  });
}

function toMenu() {
  paused = false;
  rally = null;
  state = 'menu';
  racers = [players[0]];
  $('countdown').textContent = '';
  const def = getDef(sel);
  const enter = () => { loadStage(def); players[0].place(stage, stage.startIdx); dust.clear(); };
  if (built.has(def.id)) enter(); else withLoading(def, () => { if (state === 'menu') enter(); });
  showMenu(true);
  setScreen();
}

function select(id) {
  const def = getDef(id);
  if (!def || (def.id === sel && stage && stage.def.id === def.id)) return;
  sel = def.id;
  store.set('dustline.stage', isDaily(sel) ? 'daily' : sel);
  if (state !== 'menu') return;
  showMenu(true);
  withLoading(def, () => { if (state === 'menu' && sel === def.id) { loadStage(def); players[0].place(stage, stage.startIdx); } });
}
// ←/→ walk the whole menu order; ↑/↓ (Q/E) jump to the same slot in the neighbouring region
function stepStage(dir) { const ids = menuIds(), i = ids.indexOf(sel); select(ids[(i + dir + ids.length) % ids.length]); }
function stepRegion(dir) {
  const nav = [...REGIONS.map((r) => r.id), 'daily'], cur = regionOf(sel);
  const r0 = REGIONS.find((r) => r.id === cur), pos = r0 ? r0.stages.indexOf(sel) : 0;
  const nr = nav[(nav.indexOf(cur) + dir + nav.length) % nav.length];
  if (nr === 'daily') { select(dailyDef().id); return; }
  const r = REGIONS.find((x) => x.id === nr);
  select(r.stages[Math.min(Math.max(pos, 0), r.stages.length - 1)]);
}

function setPaused(p) {
  if (!(state === 'countdown' || state === 'race')) p = false;
  paused = p;
  if (p) { $('pauseStage').textContent = stage.def.name; keys.clear(); }
  setScreen();
}

function resetPlayer(p, notice) {
  p.place(stage, clamp(p.car.idx | 0, 0, stage.n - 1));
  if (notice) showNotice(p, notice, 1.4);
}

function checkProgress(p) {
  while (p.nextSplit < stage.splits.length && p.car.idx >= stage.splits[p.nextSplit]) {
    const k = p.nextSplit;
    p.splits[k] = p.time;
    let d = null, vs = null;
    if (racers.length === 1) { const b = getBest(stage.def.id); if (b && b.s && b.s[k] != null) d = p.time - b.s[k]; }
    else { const o = racers[1 - p.i]; vs = o.name; if (o.splits[k] != null) d = p.time - o.splits[k]; }
    flashSplit(p, k, d, vs);
    soundOf(p).beep(740, 0.12);
    p.nextSplit++;
  }
  if (p.car.idx >= stage.finishIdx) playerFinish(p);
}

function playerFinish(p) {
  p.done = true; p.doneT = 0;
  const snd = soundOf(p);
  snd.beep(988, 0.25); setTimeout(() => snd.beep(1318, 0.4), 160);
  showNotice(p, 'FINISH', 1.2, 'alt');
  const nextName = getDef(nextId(stage.def.id)).name;
  if (racers.length === 1) {
    const id = stage.def.id, prev = getBest(id), t = p.time, s = p.splits.slice(0, 2);
    const isBest = !prev || t < prev.t;
    if (isBest) setBest(id, { t, s }); // solo only (rally stages count too); the daily stage is keyed by its dated id
    // medals are derived from the best time, so an upgrade is "this run's medal beats the old best's medal"
    const prevMedal = prev ? medalFor(stage.def, prev.t) : null, medal = medalFor(stage.def, t);
    const newMedal = medalRank(medal) > medalRank(prevMedal);
    lastRun = { t, s, prev, isBest, medal, newMedal, up: medalUp(stage.def, t, medal) };
    renderFinish(stage.def, lastRun, nextName);
  } else paneFinished(racers);
  if (racers.every((q) => q.done)) {
    state = 'finish'; finishT = 0;
    if (rally) rallyStageDone();
    else if (racers.length === 2) renderDuelResults(stage.def, racers, nextName);
  }
  setScreen();
}

// ---------------------------------------------------------------- rally (championship): a region's stages back to back
function startRally(regionId) {
  const ids = rallyStages(regionId);
  if (!ids.length) return;
  rally = { region: regionId, ids, idx: 0, phase: 'stage', totals: [0, 0], times: [[], []], medals: [[], []], newMedals: [[], []] };
  startStage(ids[0]);
}

function rallyStageDone() {
  const k = rally.idx, solo = racers.length === 1;
  racers.forEach((p, i) => {
    rally.times[i][k] = p.time; rally.totals[i] += p.time;
    rally.medals[i][k] = solo ? lastRun.medal : null;
    rally.newMedals[i][k] = solo ? lastRun.newMedal : false;
  });
  const region = REGIONS.find((r) => r.id === rally.region), names = rally.ids.map((id) => getDef(id).name);
  const parTotal = rallyPar(rally.region);
  if (k < rally.ids.length - 1) {
    rally.phase = 'inter';
    const parSoFar = parTotal == null ? null : rally.ids.slice(0, k + 1).reduce((s, id) => s + parOf(getDef(id)), 0);
    renderRallyStage({
      regionName: region.name, n: k + 1, of: rally.ids.length, stageName: names[k], nextName: names[k + 1], parTotal: parSoFar,
      racers: racers.map((p, i) => ({ name: p.name, hex: p.paint.hex, time: rally.times[i][k], total: rally.totals[i], medal: rally.medals[i][k], newMedal: rally.newMedals[i][k] })),
    });
  } else {
    rally.phase = 'final';
    let prev = null, isBest = false, trophy = null;
    if (solo) {
      prev = getRallyBest(rally.region); trophy = trophyFor(rally.region, rally.totals[0]);
      isBest = !prev || rally.totals[0] < prev.t;
      if (isBest) setRallyBest(rally.region, { t: rally.totals[0], stages: rally.times[0].slice() }); // solo only
    }
    renderRallyResults({
      regionName: region.name, ids: rally.ids, names, parTotal, trophy, prev, isBest,
      racers: racers.map((p, i) => ({ name: p.name, hex: p.paint.hex, times: rally.times[i], total: rally.totals[i], medals: rally.medals[i] })),
    });
  }
}

function rallyContinue() {
  if (!rally || rally.phase !== 'inter') return;
  rally.idx++; rally.phase = 'stage';
  startStage(rally.ids[rally.idx]);
}

// ---------------------------------------------------------------- actions & input
function onAction(a, who = 0) {
  resumeAudio();
  if (a === 'mute') {
    muted = !muted; for (const s of allSounds()) s.setMuted(muted);
    store.set('dustline.muted', muted); renderMute(muted); return;
  }
  if (a === 'camera') {
    const p = racers[who];
    if (state !== 'menu' && p) { p.camMode = (p.camMode + 1) % CAMS.length; showNotice(p, CAMS[p.camMode].name + ' CAM', 0.9, 'alt'); }
    return;
  }
  if (state === 'menu') {
    if (a === 'left') stepStage(-1);
    else if (a === 'right') stepStage(1);
    else if (a === 'up') stepRegion(-1);
    else if (a === 'down') stepRegion(1);
    else if (a === 'confirm') startStage(sel);
    else if (a === 'solo' || a === 'duel') setMode(a);
    else if (a === 'rally') startRally(getViewRegion() || regionOf(sel));
  } else if (paused) {
    if (a === 'pause') setPaused(false);
  } else if (state === 'countdown' || state === 'race') {
    if (a === 'pause') setPaused(true);
    else if (a === 'reset' && state === 'race' && racers[who] && !racers[who].done) resetPlayer(racers[who]);
  } else if (state === 'finish' && rally) {
    // no retries inside a rally: Enter continues (or leaves after the final results), R restarts a finished rally
    if (a === 'confirm') { if (rally.phase === 'inter') rallyContinue(); else if (rally.phase === 'final') toMenu(); }
    else if ((a === 'retry' || (a === 'reset' && who === 0)) && rally.phase === 'final') startRally(rally.region);
  } else if (state === 'finish') {
    if (a === 'retry' || (a === 'reset' && who === 0)) startStage(stage.def.id);
    else if (a === 'next') { const n = nextId(stage.def.id); sel = n; store.set('dustline.stage', n); startStage(n); }
    else if (a === 'confirm' || a === 'pause') toMenu();
  }
}

const KEYMAP = { KeyM: 'mute', KeyC: 'camera', Escape: 'pause', KeyP: 'pause', KeyR: 'reset', KeyN: 'next', Enter: 'confirm', NumpadEnter: 'confirm' };
const MENUKEYS = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyQ: 'up', ArrowDown: 'down', KeyE: 'down', Space: 'confirm', Digit1: 'solo', Digit2: 'duel', KeyT: 'rally',
};
bindKeyboard((e) => {
  let a = KEYMAP[e.code], who = 0;
  if (racers.length === 2 && (state === 'countdown' || state === 'race')) {
    if (e.code === 'Slash' || e.code === 'Backspace') { a = 'reset'; who = 1; }
    if (e.code === 'Period') { a = 'camera'; who = 1; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') a = null; // P2 handbrake
  }
  if (state === 'menu' && MENUKEYS[e.code]) a = MENUKEYS[e.code];
  if (a) onAction(a, who);
});
bindTouch($('touch'), { onPress: resumeAudio, onReset: () => onAction('reset') });
// gamepad 0 -> P1, gamepad 1 -> P2 (in solo, the first pad drives)
const onPadEdge = (k, b) => {
  if (b === 9) onAction(state === 'menu' || state === 'finish' ? 'confirm' : 'pause');
  if (state === 'menu') { if (b === 0) onAction('confirm'); if (b === 14) onAction('left'); if (b === 15) onAction('right'); if (b === 12) onAction('up'); if (b === 13) onAction('down'); }
  if (b === 3) onAction('reset', k);
  if (b === 1 && state === 'finish') onAction('retry');
};
document.addEventListener('visibilitychange', () => { if (document.hidden && (state === 'race' || state === 'countdown')) setPaused(true); });
window.addEventListener('pointerdown', resumeAudio, { passive: true });
window.addEventListener('gamepadconnected', () => { if (state === 'menu') showMenu(); });
window.addEventListener('gamepaddisconnected', () => { if (state === 'menu') { if (!duelAvailable()) setMode('solo'); showMenu(); } });
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && e.detail > 0) b.blur(); });

$('startBtn').addEventListener('click', () => onAction('confirm'));
$('muteBtn').addEventListener('click', () => onAction('mute'));
$('pauseBtn').addEventListener('click', () => onAction('pause'));
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('restartBtn').addEventListener('click', () => startStage(stage.def.id));
$('pMenuBtn').addEventListener('click', toMenu);
$('retryBtn').addEventListener('click', () => onAction('retry'));
$('nextBtn').addEventListener('click', () => onAction('next'));
$('fMenuBtn').addEventListener('click', toMenu);
$('dfRematch').addEventListener('click', () => onAction('retry'));
$('dfNext').addEventListener('click', () => onAction('next'));
$('dfMenu').addEventListener('click', toMenu);
$('rally').addEventListener('click', (e) => {
  const act = e.target.closest && e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act;
  if (act === 'continue') rallyContinue();
  else if (act === 'abandon' || act === 'menu') toMenu();
  else if (act === 'again' && rally) startRally(rally.region);
});
for (const b of document.querySelectorAll('.seg-btn')) b.addEventListener('click', () => onAction(b.dataset.mode));

// ---------------------------------------------------------------- simulation
function stepPhysics(dt) {
  for (const p of racers) {
    const car = p.car;
    let input;
    if (state === 'menu') input = autopilot(car, stage);
    else if (state === 'countdown') input = HOLD;
    else if (p.done) input = { ...autopilot(car, stage), throttle: 0, brake: car.vf > 1 ? 0.55 : 0, hand: car.vf <= 1 }; // stop, never reverse
    else if (auto) { input = autopilot(car, stage); if (p.i === 1) input = { ...input, throttle: input.throttle * 0.86 }; }
    else input = readInput(p.i, racers.length === 1);
    car.step(dt, input, stage);
    if (state === 'race' && !p.done) { p.time += dt; checkProgress(p); }
  }
}

function watchdog(p, dt) {
  if (state === 'countdown') return;
  const car = p.car;
  if (car.roadDist > 60 || !Number.isFinite(car.x) || car.y < -200) {
    if (state === 'menu') p.place(stage, stage.startIdx);
    else resetPlayer(p, 'OFF COURSE');
    return;
  }
  // coast stages: the seabed under the sea plane is drivable terrain, so treat going under water as off course
  const sea = stage.def.seaLevel;
  if (typeof sea === 'number' && car.y < sea - 0.6) {
    if (state === 'menu') p.place(stage, clamp(car.idx | 0, 0, stage.n - 1));
    else { resetPlayer(p); showNotice(p, 'IN THE DRINK', 1.6, 'splash'); }
  }
  if (state === 'menu') {
    if (car.idx >= stage.finishIdx) p.place(stage, stage.startIdx); // attract mode loops the stage
    p.stuckT = car.speed < 1 ? p.stuckT + dt : 0;
    if (p.stuckT > 4) p.place(stage, Math.min(car.idx + 6, stage.finishIdx - 1));
  }
}

function updateCountdown(dt) {
  const el = $('countdown');
  cdT += dt;
  const n = cdT < 0 ? null : cdT < 3 ? 3 - Math.floor(cdT) : 'GO';
  if (n === cdShown) return;
  cdShown = n;
  el.textContent = n == null ? '' : n;
  el.className = 'countdown' + (n === 'GO' ? ' go' : '');
  void el.offsetWidth; // restart animation
  if (n != null) el.classList.add('pop');
  if (n === 'GO') {
    beepAll(880, 0.35);
    state = 'race'; hintsT = 0;
    for (const p of racers) p.time = 0;
    setTimeout(() => { if (cdShown === 'GO') el.textContent = ''; }, 700);
    setScreen();
  } else if (n != null) beepAll(440, 0.12);
}

function renderPane(p) {
  aimSun(p, sun, sunDir);
  dust.layout(p.cam.position);
  rain.layout(p.cam.position);
  renderer.render(scene, p.cam);
}
function render() {
  const H = window.innerHeight;
  if (racers.length === 1) {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, H);
    renderPane(racers[0]);
    return;
  }
  renderer.setScissorTest(true);
  for (const p of racers) {
    const v = p.view, y = H - v.y - v.h; // three.js viewports start bottom-left
    renderer.setViewport(v.x, y, v.w, v.h);
    renderer.setScissor(v.x, y, v.w, v.h);
    renderPane(p);
  }
  renderer.setScissorTest(false);
}

let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
  if (!stage) return;
  pollPads(onPadEdge);
  const running = !paused && state !== 'boot';
  if (running) {
    if (state === 'countdown') updateCountdown(dt);
    acc += dt;
    while (acc >= FIXED) { stepPhysics(FIXED); acc -= FIXED; }
    if (state === 'finish') {
      const was = finishT; finishT += dt;
      if (was <= 1.1 && finishT > 1.1) setScreen();
      if (auto && rally && rally.phase === 'inter' && was <= 2.6 && finishT > 2.6) rallyContinue(); // hands-free test runs
    }
    for (const p of racers) {
      if (p.done) p.doneT += dt;
      watchdog(p, dt);
      p.car.updateVisual(dt);
      dust.emitFrom(p.car, p.carry, dt);
    }
    dust.step(dt);
    rain.step(dt);
  } else acc = 0;
  const snds = modeSounds();
  racers.forEach((p, k) => {
    const car = p.car;
    if (car.impact > 0) {
      if (state !== 'menu') { snds[k].impact(car.impact); p.shake = Math.min(1.2, p.shake + car.impact / 10); }
      car.impact = 0;
    }
    updateCamera(p, dt, stage, state === 'menu' ? 'menu' : p.done && p.doneT > 1.1 ? 'finish' : null);
  });
  if (state !== 'menu' && state !== 'boot') {
    updatePanes(racers, stage, state, rally ? { n: rally.idx + 1, of: rally.ids.length, totals: rally.totals } : null);
    if (state === 'race' && !paused) hintsT += dt;
    $('hints').classList.toggle('show', state === 'race' && racers.length === 1 && hintsT < 6);
  }
  const active = state !== 'menu' && state !== 'boot' && !paused;
  for (const s of allSounds()) {
    const k = snds.indexOf(s), car = k >= 0 ? racers[k].car : players[0].car;
    s.update(dt, {
      rpm: car.rpm, throttle: car.throttle, speed: car.speed, slip: car.slip, offroad: car.offroad, grounded: car.grounded,
      active: active && k >= 0,
    });
  }
  render();
}

// ---------------------------------------------------------------- boot & test hook
window.__game = {
  get state() { return paused ? 'paused' : state; },
  get mode() { return mode; },
  car: players[0].car,
  get cars() { return racers.map((p) => p.car); },
  get stage() { return stage; },
  get stages() { return menuIds(); },
  get conditions() { return { ...cond }; },
  get info() { return { ...renderer.info.memory, builtStages: [...built.keys()] }; },
  startStage(key) { rally = null; startStage(key); },
  startRally: (regionId) => startRally(regionId),
  get rally() { return rally ? { region: rally.region, stages: rally.ids.slice(), stage: rally.idx + 1, of: rally.ids.length, phase: rally.phase, totals: rally.totals.slice(0, racers.length), times: rally.times.slice(0, racers.length).map((a) => a.slice()) } : null; },
  medals: () => medalSummary(),
  selectStage(key) { const d = getDef(key); if (!d) return false; if (state === 'menu') select(d.id); else sel = d.id; return d.id; },
  setMode,
  get time() { return players[0].time; },
  get times() { return racers.map((p) => p.time); },
  setAuto(b) { auto = !!b; },
};

function boot() {
  const ps = params.get('stage');
  const saved = store.get('dustline.stage', null);
  // ?stage= takes an id, 'daily' or a 0-based index; the saved selection may be an id, 'daily' or an old numeric index
  sel = (getDef(ps != null ? ps : saved != null ? saved : 0) || getDef(0)).id;
  mode = (params.get('mode') || store.get('dustline.mode', 'solo')) === 'duel' && duelAvailable() ? 'duel' : 'solo';
  loadStage(getDef(sel));
  players[0].place(stage, stage.startIdx);
  const pr = params.get('rally');
  if (pr && params.get('start') === '1' && rallyStages(pr).length) startRally(pr);
  else if (params.get('start') === '1') startStage(sel);
  else toMenu();
  $('loading').classList.add('fade');
  requestAnimationFrame(frame);
}
requestAnimationFrame(() => setTimeout(boot, 30));
