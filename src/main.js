// Dustline — conductor: renderer, scene & conditions, stage lifecycle, game states, actions, loop, rendering.
// Module map: util / storage / catalog (stages, regions, daily) / fx (dust, rain, headlights) /
// player (racer + cameras) / hud (panes + result panels) / menu / input.
import * as THREE from 'three';
import { Stage, clamp } from './track.js';
import { autopilot } from './car.js';
import { Sound } from './audio.js';
import { $, params } from './util.js';
import { store, getBest, setBest } from './storage.js';
import { REGIONS, menuIds, getDef, regionOf, nextId, isDaily, dailyDef, conditions, lengthOf } from './catalog.js';
import { Dust, Rain } from './fx.js';
import { Player, CAMS, updateCamera, aimSun } from './player.js';
import { PAINTS, ACCENTS, DEFAULT_BUILD, normalizeBuild, buildStats } from './carapi.js';
import { profile, offer, buy as buyItem, earn, countRun, setBuild as setProfileBuild, stageEarnings, rallyEarnings, anythingAffordable, ownsPaint, ownsAccent, EARN, costs } from './economy.js';
import { renderGarage, garageKey, garagePreview, clearPreview, setGarageTab, garageTab, garageCar, setGarageCar } from './garage.js';
import { setStockLights } from './fx.js';
import { Rules, GateMarker, roughOf, penaltyHtml } from './rules.js';
import { showNotice, preparePanes, updatePanes, flashSplit, paneFinished, renderFinish, renderDuelResults, renderRallyStage, renderRallyResults, earningsBlock } from './hud.js';
import { renderMenu, playTabs, tabEntries, startLabel } from './menu.js';
import { openSettings as openSettingsPanel, closeSettings, settingsOpen, settingsKey, settingsState, renderSettings } from './settings.js';
import { defaultFocus, moveFocus, activateFocus } from './nav.js';
import { medalPoints, medalTimes, medalFor, medalRank, medalUp, rallyStages, rallyPar, parOf, trophyFor, getRallyBest, setRallyBest, medalSummary } from './progress.js';
import { GhostRecorder, GhostPlayer, loadGhost, saveGhost, pruneDailyGhosts, GHOST_ON_KEY } from './ghost.js';
import { pose } from './player.js';
import { keys, HOLD, readInput, pollPads, connectedPads, bindKeyboard, bindTouch } from './input.js';
import { platform } from './platform/index.js';
import { naturalBreak, breakActive, forcedMute, onForcedMute, noteRunEnd } from './adbreak.js';

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
  if (!soundBank[key]) { soundBank[key] = new Sound(opts); soundBank[key].setMuted(muted || forcedMute()); }
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
onForcedMute(() => { for (const s of allSounds()) s.setMuted(muted || forcedMute()); }); // ad breaks / portal mute; the player's own setting comes back after

// ---------------------------------------------------------------- players & state
const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const hasFinePointer = window.matchMedia && window.matchMedia('(any-pointer: fine)').matches;
if (isTouch) document.body.classList.add('touch');
setStockLights(buildStats(DEFAULT_BUILD).lights); // headlights of a stock build look exactly as before upgrades
const players = [new Player(0, scene, $('panes')), new Player(1, scene, $('panes'))];
for (const p of players) { p.marker = new GateMarker(scene); p.rules = null; p.pen = 0; }
let racers = [players[0]];
let state = 'boot', paused = false;
let auto = params.get('auto') === '1';
let mode = 'solo';
let sel = null; // the stage the menu shows / START would load (for a rally entry: its first stage)
// PLAY list model: one tab per region + DAILY; the pick is the tab's selected entry (a stage id or 'rally')
let pick = { tab: null, entry: null };
const lastEntry = {}; // remembered entry per tab
let cdT = 0, cdShown = null, finishT = 0, lastRun = null, hintsT = 0;
let cond = { night: false, rain: false, sun: 1, ambient: 1 };
// championship: { region, ids, idx, phase: 'stage' | 'inter' | 'final', totals: [p0, p1], times: [[], []], medals: [[], []], newMedals: [[], []] }
let rally = null;
// garage: one car (the Rook) upgraded with credits; the menu car is the showroom (it shows previews live)
let menuView = 'play';
// duel: both players race P1's build (same performance and parts); P2 only chooses paint + accent (owned colours)
const P2_KEY = 'dustline.p2look';
const p2Look = (() => {
  const v = store.get(P2_KEY, null) || {}, b = profile.build;
  const paint = ownsPaint(v.paint) && v.paint !== b.paint ? v.paint : (PAINTS.find((p) => ownsPaint(p.hex) && p.hex !== b.paint) || PAINTS[1]).hex;
  const accent = ownsAccent(v.accent) ? v.accent : b.accent;
  return { paint, accent };
})();
const p2Build = () => normalizeBuild({ ...profile.build, paint: p2Look.paint === profile.build.paint ? (PAINTS.find((p) => ownsPaint(p.hex) && p.hex !== profile.build.paint) || PAINTS[1]).hex : p2Look.paint, accent: p2Look.accent });
const menuIdx = () => (menuView === 'garage' ? Math.min(stage.startIdx + 22, stage.finishIdx - 5) : stage.startIdx);
// the showroom shows the car being edited: P2's colours while Garage > Style > Car is P2 (duel)
const showroomCar = () => (menuView === 'garage' && mode === 'duel' && garageCar() === 'p2' ? 'p2' : 'p1');
function showroom() { players[0].setBuild(garagePreview() || (showroomCar() === 'p2' ? p2Build() : profile.build)); }
function setView(v) {
  const was = menuView;
  menuView = v === 'garage' ? 'garage' : 'play'; // 'stages' (the old name) is accepted as PLAY
  if (menuView !== 'garage') clearPreview();
  // the garage parks the car on a clear stretch past the start gate (the gate pillars would block the turntable)
  if (state === 'menu' && was !== menuView && stage) { players[0].place(stage, menuIdx()); players[0].camSnap = false; }
  if (state === 'menu') { showroom(); showMenu(); }
}
const garageCtx = () => ({
  duel: mode === 'duel', p2: p2Look, p2Build,
  onPreview: () => showroom(),
  onBought: (res) => {
    const s0 = soundFor('c', { pan: 0, gain: 1 });
    if (res.denied) { s0.beep(220, 0.12); return; }
    if (res.bought) { s0.beep(880, 0.08); setTimeout(() => s0.beep(1175, 0.08), 90); setTimeout(() => s0.beep(1568, 0.22), 180); }
    else s0.beep(660, 0.06);
    showroom();
  },
  onP2: (kind, hex) => { p2Look[kind] = hex; store.set(P2_KEY, p2Look); soundFor('c', { pan: 0, gain: 1 }).beep(660, 0.06); showroom(); showMenu(); },
  refresh: () => { showroom(); showMenu(); },
});
// ghost of the best run (solo only): recorded every run, saved on a new stage best, replayed on the next
let ghostOn = params.get('ghost') === '0' ? false : store.get(GHOST_ON_KEY, true) !== false;
const recorder = new GhostRecorder();
let ghost = null, ghostT = 0, ghostDelta = null, ghostDeltaT = 0;
function clearGhost() { if (ghost) { ghost.dispose(); ghost = null; } ghostDelta = null; }
function spawnGhost(def) {
  clearGhost();
  if (!ghostOn || racers.length !== 1) return;
  const rec = loadGhost(def.id);
  if (!rec) return;
  try { ghost = new GhostPlayer(rec, scene); } catch (e) { ghost = null; }
}

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
// the overlay on top right now (for focus and the confirm guard): settings > pause > results
let overlayId = null, overlayAt = 0;
const CONFIRM_GUARD = 400; // ms: confirm actions are ignored this long after an overlay appears (P2's Enter is a handbrake)
const guarded = () => performance.now() - overlayAt < CONFIRM_GUARD;
function setScreen() {
  const racing = state === 'countdown' || state === 'race' || state === 'finish';
  const duel = racers.length === 2, showResults = state === 'finish' && finishT > 1.1;
  const setOpen = settingsOpen();
  document.body.classList.toggle('duel', duel && racing);
  document.body.classList.toggle('results', showResults); // the results panels hide the HUD behind them
  $('menu').classList.toggle('hidden', state !== 'menu');
  $('hud').classList.toggle('hidden', !racing);
  $('settings').classList.toggle('hidden', !setOpen);
  $('pause').classList.toggle('hidden', !paused || setOpen);
  $('finish').classList.toggle('hidden', !(showResults && !duel && !rally));
  $('duelFinish').classList.toggle('hidden', !(showResults && duel && !rally));
  $('rally').classList.toggle('hidden', !(showResults && rally));
  // in a rally, pausing offers Resume / Settings / Abandon rally
  $('restartBtn').classList.toggle('hidden', !!rally);
  $('pMenuBtn').textContent = rally ? 'Abandon rally' : 'Quit to menu';
  $('touch').classList.toggle('hidden', !(isTouch && !duel && (state === 'countdown' || state === 'race') && !paused));
  const ov = setOpen ? 'settings' : paused ? 'pause' : showResults ? (rally ? 'rally' : duel ? 'duelFinish' : 'finish') : null;
  if (ov !== overlayId) {
    const back = overlayId === 'settings' && ov === 'pause'; // closing Settings returns focus to Pause › Settings
    overlayId = ov; overlayAt = performance.now();
    if (ov && ov !== 'settings' && !back) defaultFocus($(ov));
  }
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
    c.fov = c.userData.baseFov = c.aspect < 0.8 ? 62 : c.aspect < 1.1 ? 56 : 50; // camera presets add to this base
    // solo menu / results: nudge the car out from under the panel (right on wide screens, up on portrait)
    const side = !duel && (state === 'menu' || (state === 'finish' && finishT > 1.1));
    if (side && W > 720) c.setViewOffset(W, H, -Math.min(W * 0.2, 300), 0, W, H);
    // phone: the menu is a bottom sheet, so lift the car into the top band (about 22 % down the screen)
    else if (!duel && state === 'menu') c.setViewOffset(W, H, 0, H * MENU_LIFT, W, H);
    else c.clearViewOffset();
    c.updateProjectionMatrix();
  }
}
const MENU_LIFT = 0.3;
window.addEventListener('resize', layout);

function showMenu(scroll = false) {
  players[1].setBuild(p2Build()); // P2's look (P1's build, P2's paint/accent)
  renderMenu({
    pick, mode, duelAvailable: duelAvailable(), scroll,
    view: menuView, garage: garageCtx(),
    onPick: (tab, entry) => setPick(tab, entry), onStart: () => startPick(),
    onP2: () => openP2Colours(),
  });
}

function setMode(m) {
  mode = m === 'duel' && duelAvailable() ? 'duel' : 'solo';
  store.set('dustline.mode', mode);
  if (mode !== 'duel') setGarageCar('p1');
  if (state === 'menu') { showroom(); showMenu(); }
}
// PLAY > Duel note "P2 colours ›": Garage > Style with P2 selected
function openP2Colours() {
  if (mode !== 'duel') return;
  setGarageTab('style'); setGarageCar('p2');
  if (menuView === 'garage') { showroom(); showMenu(); } else setView('garage');
}

// ---------------------------------------------------------------- PLAY list: tabs = selection
const tabOfStage = (id) => (isDaily(id) ? 'daily' : regionOf(id));
const pickStage = (p = pick) => (p.entry === 'rally' ? rallyStages(p.tab)[0] : p.entry);
const pickKey = (p = pick) => (p.entry === 'rally' ? 'rally:' + p.tab : p.tab === 'daily' ? 'daily' : p.entry);
// stored 'dustline.stage': a stage id, 'daily', 'rally:<regionId>' or an old numeric index
function parsePick(v) {
  if (v == null || v === '') return null;
  const k = String(v);
  if (k.startsWith('rally:')) { const r = k.slice(6); return rallyStages(r).length ? { tab: r, entry: 'rally' } : null; }
  const d = getDef(k);
  if (!d) return null;
  return isDaily(d.id) ? { tab: 'daily', entry: dailyDef().id } : { tab: tabOfStage(d.id), entry: d.id };
}
function setPick(tab, entry, { persist = true, quiet = false } = {}) {
  const ents = tabEntries(tab);
  if (!ents.length) return;
  if (entry == null) entry = lastEntry[tab] ?? ents[0];
  if (!ents.includes(entry)) entry = ents[0];
  const same = pick.tab === tab && pick.entry === entry;
  pick = { tab, entry }; lastEntry[tab] = entry;
  sel = pickStage();
  if (persist) store.set('dustline.stage', pickKey());
  if (state !== 'menu' || quiet) return;
  if (!same) soundFor('c', { pan: 0, gain: 1 }).beep(520, 0.03);
  showMenu(true);
  previewSel();
}
// the attract preview follows the selection; debounced so rapid tabbing doesn't build every stage on the way
let previewTm = 0;
function previewSel() {
  clearTimeout(previewTm);
  previewTm = setTimeout(() => {
    const def = getDef(sel);
    if (state !== 'menu' || !def || (stage && stage.def.id === def.id)) return;
    withLoading(def, () => { if (state === 'menu' && sel === def.id) { loadStage(def); showroom(); players[0].place(stage, menuIdx()); players[0].camSnap = false; } });
  }, 150);
}
function pickEntry(dir) { const e = tabEntries(pick.tab), i = Math.max(0, e.indexOf(pick.entry)); setPick(pick.tab, e[(i + dir + e.length) % e.length]); }
function pickTab(dir) { const t = playTabs(), i = Math.max(0, t.indexOf(pick.tab)); setPick(t[(i + dir + t.length) % t.length], null); }
function startPick() { if (pick.entry === 'rally') startRally(pick.tab); else startStage(pick.entry); }

// ---------------------------------------------------------------- game flow
function startStage(key) {
  const def = getDef(key) || getDef(sel);
  if (settingsOpen()) closeSettings();
  clearTimeout(previewTm);
  // the menu comes back on what was played last
  if (rally) setPick(rally.region, 'rally', { quiet: true });
  else setPick(tabOfStage(def.id), isDaily(def.id) ? dailyDef().id : def.id, { quiet: true });
  withLoading(def, () => {
    sel = def.id;
    loadStage(def);
    racers = mode === 'duel' ? players : [players[0]];
    racers.forEach((p, k) => {
      p.setBuild(k ? p2Build() : profile.build);
      p.lights.setEnabled(cond.night);
      p.resetRun();
      p.place(stage, stage.startIdx, racers.length === 2 ? (k === 0 ? 1.6 : -1.6) : 0); // P1 on the left, P2 on the right
      p.rules = new Rules(stage); p.pen = 0; p.penFlashT = 0; p.roughOn = false;
      p.marker.setGate(p.rules.nextGate, stage); p.marker.active = true;
    });
    preparePanes(racers, stage, cond, { targets: racers.length === 1 ? medalTimes(def) : null });
    recorder.reset(); ghostT = 0; ghostDeltaT = 0;
    spawnGhost(def);
    dust.clear();
    state = 'countdown'; paused = false;
    cdT = -0.5; cdShown = null; finishT = 0; hintsT = 0;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    setScreen();
  });
}

function toMenu() {
  paused = false;
  if (settingsOpen()) closeSettings();
  for (const p of players) { p.rules = null; p.marker.active = false; p.marker.show(false); }
  rally = null;
  clearGhost();
  platform.gameplayStop();
  state = 'menu';
  racers = [players[0]];
  $('countdown').textContent = '';
  sel = pickStage();
  const def = getDef(sel);
  clearPreview();
  const enter = () => { loadStage(def); showroom(); players[0].lights.setEnabled(cond.night); players[0].place(stage, menuIdx()); dust.clear(); };
  if (built.has(def.id)) enter(); else withLoading(def, () => { if (state === 'menu') enter(); });
  showMenu(true);
  setScreen();
}
function toGarage() { toMenu(); setView('garage'); }

function setPaused(p, hidden = false) {
  if (!(state === 'countdown' || state === 'race')) p = false;
  if (!p && settingsOpen()) closeSettings();
  paused = p;
  if (p && !hidden) platform.gameplayStop(); else if (!p && state === 'race') platform.gameplayStart();
  if (p) {
    $('pauseKicker').textContent = rally ? `Paused \u00b7 Rally ${rally.idx + 1}/${rally.ids.length}` : 'Paused';
    $('pauseStage').textContent = stage.def.daily ? 'Today\u2019s stage' : stage.def.name;
    keys.clear();
  }
  setScreen();
}

function resetPlayer(p, notice, auto = false) {
  const idx = clamp(p.car.idx | 0, 0, stage.n - 1);
  // penalties: a reset costs RESET_PENALTY (not in the first seconds, not for a pointless reset, never twice per incident)
  // and any unpassed gates it jumps over count as missed
  if (p.rules && state === 'race' && !p.done) {
    const { ev, charge } = p.rules.reset(idx, p.time - p.pen, p.car, auto);
    gateEvents(p, ev);
    if (charge) penalize(p, charge, `RESET +${charge.toFixed(1)}`);
  }
  p.place(stage, idx);
  if (notice) showNotice(p, notice, 1.4);
}
// add seconds to a player's stage time (stage time = clock + penalties) and flash the chip
function penalize(p, sec, label) {
  p.time += sec; p.pen += sec;
  if (racers.length === 1) recorder.penalty(p.time - p.pen, p.pen); // ghost: penalty event on the raw clock
  p.penFlash = label; p.penFlashT = 2.5;
  soundOf(p).beep(150, 0.28);
}
function gateEvents(p, ev) {
  for (const e of ev) {
    if (e.type === 'pass') { soundOf(p).beep(1568, 0.05); p.marker.flash(e.gate, stage, true); }
    else {
      p.marker.flash(e.gate, stage, false);
      penalize(p, e.pen, `MISSED GATE +${e.pen.toFixed(1)}`);
      if (!store.get('dustline.hint.gates', false)) { store.set('dustline.hint.gates', true); showNotice(p, 'Stay between the flags \u2014 missed gates cost 5 s', 4.5, 'hint'); }
    }
  }
  if (ev.length) p.marker.setGate(p.rules.nextGate, stage);
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
  const nextName = isDaily(stage.def.id) ? null : getDef(nextId(stage.def.id)).name; // no Next from the Daily Stage
  if (racers.length === 1) {
    const id = stage.def.id, prev = getBest(id), t = p.time, s = p.splits.slice(0, 2);
    const isBest = !prev || t < prev.t;
    if (isBest) setBest(id, { t, s }); // solo only (rally stages count too); the daily stage is keyed by its dated id
    // medals are derived from the best time, so an upgrade is "this run's medal beats the old best's medal"
    const prevMedal = prev ? medalFor(stage.def, prev.t) : null, medal = medalFor(stage.def, t);
    const newMedal = medalRank(medal) > medalRank(prevMedal);
    // credits: solo finishes only (duel and abandoned runs earn nothing)
    const firstEver = profile.stats.runs === 0;
    const pen = p.rules ? p.rules.summary() : null, clean = !!pen && pen.total === 0;
    const e = stageEarnings({ km: lengthOf(stage.def) / 1000, medal, prevMedal, isBest, hadPrev: !!prev, daily: isDaily(id), dateStr: stage.def.date, clean });
    earn(e.total, { daily: isDaily(id) ? stage.def.date : null }); countRun();
    lastRun = { t, s, prev, isBest, medal, newMedal, up: medalUp(stage.def, t, medal), ghostSaved: false, earn: e, pen };
    recorder.sample(t - p.pen, p.car, true); // raw clock
    if (isBest) {
      const rec = recorder.build({ build: p.build, paint: p.paint.hex, time: t, splits: s });
      if (rec) lastRun.ghostSaved = saveGhost(id, rec) > 0;
    }
    renderFinish(stage.def, lastRun, nextName);
    const hint = firstEver ? 'Spend credits in the' : anythingAffordable() ? 'Something new is affordable \u2014' : '';
    lastRun.hint = hint;
    $('finEarn').innerHTML = earningsBlock(e, profile.credits, hint);
    $('finPen').innerHTML = penaltyHtml(pen);
  } else paneFinished(racers);
  if (racers.every((q) => q.done)) {
    state = 'finish'; finishT = 0;
    platform.gameplayStop(); noteRunEnd();
    if (racers.length === 1 && lastRun && lastRun.newMedal) platform.happytime();
    if (rally) rallyStageDone();
    else if (racers.length === 2) renderDuelResults(stage.def, racers, nextName);
  }
  setScreen();
}

// ---------------------------------------------------------------- rally (championship): a region's stages back to back
function startRally(regionId) {
  const ids = rallyStages(regionId);
  if (!ids.length) return;
  rally = { region: regionId, ids, idx: 0, phase: 'stage', totals: [0, 0], base: [0, 0], times: [[], []], medals: [[], []], newMedals: [[], []] };
  startStage(ids[0]);
}

function rallyStageDone() {
  const k = rally.idx, solo = racers.length === 1;
  racers.forEach((p, i) => {
    rally.times[i][k] = p.time; rally.totals[i] += p.time; // stage times include penalties
    rally.pens = rally.pens || [0, 0]; rally.pens[i] += p.pen;
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
      racers: racers.map((p, i) => ({ name: p.name, hex: p.paint.hex, time: rally.times[i][k], total: rally.totals[i], medal: rally.medals[i][k], newMedal: rally.newMedals[i][k], up: solo ? lastRun.up : null, pen: p.pen, penHtml: penaltyHtml(p.rules && p.rules.summary()) })),
      earnHtml: solo ? earningsBlock(lastRun.earn, profile.credits, lastRun.hint) : '',
    });
  } else {
    rally.phase = 'final';
    let prev = null, isBest = false, trophy = null;
    if (solo) {
      prev = getRallyBest(rally.region); trophy = trophyFor(rally.region, rally.totals[0]);
      isBest = !prev || rally.totals[0] < prev.t;
      if (isBest) setRallyBest(rally.region, { t: rally.totals[0], stages: rally.times[0].slice() }); // solo only
      if (trophy && medalRank(trophy) > medalRank(prev ? trophyFor(rally.region, prev.t) : null)) platform.happytime();
    }
    let earnHtml = '';
    if (solo) {
      // last stage's earnings plus the rally bonus, shown together
      const re = rallyEarnings(trophy);
      earn(re.total);
      const both = { total: lastRun.earn.total + re.total, lines: [...lastRun.earn.lines, ...re.lines] };
      earnHtml = earningsBlock(both, profile.credits, anythingAffordable() ? 'Something new is affordable \u2014' : '');
    }
    renderRallyResults({
      earnHtml,
      regionName: region.name, ids: rally.ids, names, parTotal, trophy, prev, isBest,
      racers: racers.map((p, i) => ({ name: p.name, hex: p.paint.hex, times: rally.times[i], total: rally.totals[i], medals: rally.medals[i], pen: rally.pens ? rally.pens[i] : 0 })),
    });
  }
}

function rallyContinue() {
  if (!rally || rally.phase !== 'inter') return;
  naturalBreak(rallyContinueNow);
}
function rallyContinueNow() {
  if (!rally || rally.phase !== 'inter') return;
  rally.idx++; rally.phase = 'stage'; rally.base = rally.totals.slice();
  startStage(rally.ids[rally.idx]);
}

// ---------------------------------------------------------------- settings overlay
const settingsCtx = (from) => ({
  from,
  muted: () => muted, ghostOn: () => ghostOn,
  // Touch on touch-only devices, Gamepad when a pad is connected, otherwise Keyboard
  defaultCtl: () => (isTouch && !hasFinePointer ? 'touch' : connectedPads().length ? 'gamepad' : 'keyboard'),
  onMute: () => toggleMute(), onGhost: () => toggleGhost(),
  onClose: () => setScreen(), // from Pause, closing shows the pause panel again (still paused)
});
function openSettings(opener) {
  if (settingsOpen() || !(state === 'menu' || paused)) return false;
  openSettingsPanel(settingsCtx(paused ? 'pause' : 'menu'), opener || null);
  setScreen();
  return true;
}
$('gearBtn').addEventListener('click', () => openSettings($('gearBtn')));
$('pSettingsBtn').addEventListener('click', () => openSettings($('pSettingsBtn')));
$('settings').addEventListener('click', (e) => {
  if (e.target === $('settings') || (e.target.closest && e.target.closest('[data-act=close]'))) closeSettings();
});

// menu toast: M / G give feedback in the menu now that their buttons live in Settings
let toastTm = 0;
function menuToast(text) {
  const t = $('menuToast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTm); toastTm = setTimeout(() => t.classList.remove('show'), 1000);
}
function toggleMute() {
  muted = !muted; for (const s of allSounds()) s.setMuted(muted || forcedMute());
  store.set('dustline.muted', muted);
  if (settingsOpen()) renderSettings();
  else if (state === 'menu') menuToast(muted ? 'SOUND OFF' : 'SOUND ON');
}
function toggleGhost() {
  ghostOn = !ghostOn; store.set(GHOST_ON_KEY, ghostOn);
  if (ghost) ghost.setVisible(ghostOn);
  if (settingsOpen()) renderSettings();
  else if (state === 'menu') menuToast(ghostOn ? 'GHOST ON' : 'GHOST OFF');
  else if (racers.length === 1 && !paused) showNotice(racers[0], ghostOn ? 'GHOST ON' : 'GHOST OFF', 0.9, 'alt');
}

// ---------------------------------------------------------------- actions & input
// one screen at a time decides what a key means (3.5): Enter/Space/A activate, Esc/B go back (in PLAY: Settings)
function screenName() {
  if (settingsOpen()) return 'settings';
  if (state === 'menu') return menuView === 'garage' ? 'garage' : 'play';
  if (paused) return 'pause';
  if (state === 'countdown' || state === 'race') return 'race';
  if (state === 'finish') {
    if (finishT <= 1.1) return 'finishing';
    if (rally) return rally.phase === 'inter' ? 'rallyinter' : 'rallyfinal';
    return racers.length === 2 ? 'duelres' : 'finish';
  }
  return 'none';
}
function doRetry() { if (state !== 'finish') return; if (rally) { if (rally.phase === 'final') naturalBreak(() => startRally(rally.region)); } else naturalBreak(() => startStage(stage.def.id)); }
function doNext() {
  if (state !== 'finish' || rally || isDaily(stage.def.id)) return;
  naturalBreak(() => startStage(nextId(stage.def.id)));
}
const OVERLAY_OF = { pause: 'pause', finish: 'finish', duelres: 'duelFinish', rallyinter: 'rally', rallyfinal: 'rally' };

// a: up down left right | confirm (Enter) | space | activate (pad A) | back (Esc, P, pad B) | start (pad Start) | settings (pad Y)
//    tabprev tabnext (Q E) | lb rb | view (V, pad Select) | solo duel | mute ghost | retry (R) | next (N, pad X) | camera (C) | reset (pad Y in race)
function onAction(a, who = 0) {
  resumeAudio();
  if (a === 'mute') { toggleMute(); return; }
  if (a === 'ghost') { toggleGhost(); return; }
  const sc = screenName();
  if (sc === 'settings') {
    if (a === 'confirm' || a === 'space' || a === 'activate') settingsKey('activate');
    else if (a === 'back' || a === 'start') settingsKey('back');
    else if (a === 'lb' || a === 'tabprev') settingsKey('tabprev');
    else if (a === 'rb' || a === 'tabnext') settingsKey('tabnext');
    else if (['up', 'down', 'left', 'right'].includes(a)) settingsKey(a);
    return;
  }
  if (sc === 'play') {
    if (a === 'up') pickEntry(-1);
    else if (a === 'down') pickEntry(1);
    else if (a === 'left' || a === 'tabprev' || a === 'lb') pickTab(-1);
    else if (a === 'right' || a === 'tabnext' || a === 'rb') pickTab(1);
    else if (a === 'confirm' || a === 'space' || a === 'activate' || a === 'start') startPick();
    else if (a === 'back' || a === 'settings') openSettings(null);
    else if (a === 'view') setView('garage');
    else if (a === 'solo' || a === 'duel') setMode(a);
    return;
  }
  if (sc === 'garage') {
    if (['up', 'down', 'left', 'right'].includes(a)) garageKey(a);
    else if (a === 'space' || a === 'activate') garageKey('activate');
    else if (a === 'tabprev' || a === 'lb') { if (garageTab() !== 'tune') garageKey('tab'); }
    else if (a === 'tabnext' || a === 'rb') { if (garageTab() !== 'style') garageKey('tab'); }
    else if (a === 'confirm' || a === 'start') startPick();
    else if (a === 'back' || a === 'view') setView('play');
    else if (a === 'settings') openSettings(null);
    else if (a === 'solo' || a === 'duel') setMode(a);
    return;
  }
  if (sc === 'race') {
    if (a === 'back' || a === 'start') setPaused(true);
    else if ((a === 'retry' || a === 'reset') && state === 'race' && racers[who] && !racers[who].done) resetPlayer(racers[who]);
    else if (a === 'camera') { const p = racers[who]; if (p) { p.camMode = (p.camMode + 1) % CAMS.length; showNotice(p, CAMS[p.camMode].name + ' CAM', 0.9, 'alt'); } }
    return;
  }
  if (sc === 'pause') {
    const el = $('pause');
    if (a === 'up' || a === 'left') moveFocus(el, -1);
    else if (a === 'down' || a === 'right') moveFocus(el, 1);
    else if (a === 'confirm' || a === 'space' || a === 'activate') activateFocus(el);
    else if (a === 'back' || a === 'start') setPaused(false);
    return;
  }
  const el = $(OVERLAY_OF[sc] || 'finish');
  if (!OVERLAY_OF[sc]) return; // 'finishing': the panel is not up yet
  if (a === 'up' || a === 'left') { moveFocus(el, -1); return; }
  if (a === 'down' || a === 'right') { moveFocus(el, 1); return; }
  if (guarded()) return; // fresh presses only, 400 ms after the panel appears
  if (a === 'confirm' || a === 'activate') activateFocus(el);
  else if (a === 'start') { defaultFocus(el); activateFocus(el); } // Start = the primary button
  else if (sc === 'rallyinter') return; // Abandon is mouse / focus only (destructive)
  else if (a === 'back') toMenu();
  else if (a === 'retry' || (a === 'settings' && (sc === 'finish' || sc === 'duelres'))) doRetry();
  else if (a === 'next' && (sc === 'finish' || sc === 'duelres')) doNext();
  else if (a === 'view') toGarage();
}

const KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Enter: 'confirm', NumpadEnter: 'confirm', Space: 'space', Escape: 'back', KeyP: 'back', KeyQ: 'tabprev', KeyE: 'tabnext',
  KeyV: 'view', Digit1: 'solo', Digit2: 'duel', KeyM: 'mute', KeyG: 'ghost', KeyR: 'retry', KeyN: 'next', KeyC: 'camera',
};
const NAV_KEYS = new Set(['up', 'down', 'left', 'right', 'tabprev', 'tabnext']);
bindKeyboard((e) => {
  const c = e.code, sc = screenName();
  if (sc === 'race' && racers.length === 2) {
    if (c === 'Slash' || c === 'Backspace') { onAction('reset', 1); return; }
    if (c === 'Period') { onAction('camera', 1); return; }
    if (c === 'Enter' || c === 'NumpadEnter') return; // P2 handbrake
  }
  const a = KEYS[c];
  if (!a) return;
  if (sc !== 'race' && NAV_KEYS.has(a)) document.body.classList.add('kbnav');
  onAction(a, 0);
});
window.addEventListener('pointerdown', () => document.body.classList.remove('kbnav'), { passive: true });
bindTouch($('touch'), { onPress: resumeAudio, onReset: () => onAction('retry') });
// gamepads: 0 -> P1, 1 -> P2 in a race; pad 0 alone drives the menus and panels
const PAD = { 12: 'up', 13: 'down', 14: 'left', 15: 'right', 4: 'lb', 5: 'rb', 0: 'activate', 1: 'back', 2: 'next', 3: 'settings', 9: 'start', 8: 'view' };
const onPadEdge = (k, b) => {
  const sc = screenName();
  if (sc === 'race') {
    if (b === 3) onAction('reset', k);
    else if (b === 9) onAction('start', k);
    return;
  }
  if (k !== 0 || !(b in PAD)) return;
  if (sc === 'play' && b === 1) return; // B has no level to go back to in PLAY (Y opens Settings)
  if (b >= 12 || b === 4 || b === 5) document.body.classList.add('kbnav');
  onAction(PAD[b], 0);
};
document.addEventListener('visibilitychange', () => { if (document.hidden && (state === 'race' || state === 'countdown')) setPaused(true, true); });
window.addEventListener('pointerdown', resumeAudio, { passive: true });
window.addEventListener('gamepadconnected', () => { if (state === 'menu') showMenu(); });
window.addEventListener('gamepaddisconnected', () => { if (state === 'menu') { if (!duelAvailable()) setMode('solo'); showMenu(); } });
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && e.detail > 0) b.blur(); });
// keyboard-generated clicks (a focused button + Enter) on a panel that just appeared count as confirms too
document.addEventListener('click', (e) => {
  if (e.detail === 0 && overlayId && overlayId !== 'settings' && guarded() && e.target.closest && e.target.closest('.overlay')) { e.stopPropagation(); e.preventDefault(); }
}, true);

$('startBtn').addEventListener('click', () => { if (state === 'menu') startPick(); });
$('pauseBtn').addEventListener('click', () => { if (state === 'countdown' || state === 'race') setPaused(!paused); });
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('restartBtn').addEventListener('click', () => { if (paused && !rally) startStage(stage.def.id); });
$('pMenuBtn').addEventListener('click', toMenu);
$('retryBtn').addEventListener('click', doRetry);
$('nextBtn').addEventListener('click', doNext);
$('fMenuBtn').addEventListener('click', toMenu);
$('dfRematch').addEventListener('click', doRetry);
$('dfNext').addEventListener('click', doNext);
$('dfMenu').addEventListener('click', toMenu);
$('finish').addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-act=garage]')) toGarage(); });
$('rally').addEventListener('click', (e) => {
  const act = e.target.closest && e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act;
  if (act === 'continue') rallyContinue();
  else if (act === 'abandon' || act === 'menu') toMenu();
  else if (act === 'again' && rally) doRetry();
  else if (act === 'garage') toGarage();
});
for (const b of document.querySelectorAll('.seg-btn[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
for (const b of document.querySelectorAll('.view-btn')) b.addEventListener('click', () => setView(b.dataset.view));

// ---------------------------------------------------------------- simulation
function stepPhysics(dt) {
  for (const p of racers) {
    const car = p.car;
    let input;
    if (state === 'menu') input = menuView === 'garage' ? HOLD : autopilot(car, stage); // the garage parks the car on a turntable
    else if (state === 'countdown') input = HOLD;
    else if (p.done) input = { ...autopilot(car, stage), throttle: 0, brake: car.vf > 1 ? 0.55 : 0, hand: car.vf <= 1 }; // stop, never reverse
    else if (auto) { input = autopilot(car, stage); if (p.i === 1) input = { ...input, throttle: input.throttle * 0.86 }; }
    else input = readInput(p.i, racers.length === 1);
    car.step(dt, input, stage);
    if (state === 'race' && !p.done) { p.time += dt; if (p.rules) gateEvents(p, p.rules.update(car)); checkProgress(p); }
  }
}

function watchdog(p, dt) {
  if (state === 'countdown') return;
  const car = p.car;
  if (car.roadDist > 60 || !Number.isFinite(car.x) || car.y < -200) {
    if (state === 'menu') p.place(stage, stage.startIdx);
    else resetPlayer(p, 'OFF COURSE', true);
    return;
  }
  // coast stages: the seabed under the sea plane is drivable terrain, so treat going under water as off course
  const sea = stage.def.seaLevel;
  if (typeof sea === 'number' && car.y < sea - 0.6) {
    if (state === 'menu') p.place(stage, clamp(car.idx | 0, 0, stage.n - 1));
    else { resetPlayer(p, null, true); showNotice(p, 'IN THE DRINK', 1.6, 'splash'); }
  }
  if (state === 'menu') {
    if (car.idx >= stage.finishIdx) p.place(stage, stage.startIdx); // attract mode loops the stage
    p.stuckT = car.speed < 1 && menuView !== 'garage' ? p.stuckT + dt : 0;
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
    state = 'race'; hintsT = 0; ghostT = 0;
    platform.gameplayStart();
    for (const p of racers) p.time = 0;
    setTimeout(() => { if (cdShown === 'GO') el.textContent = ''; }, 700);
    setScreen();
  } else if (n != null) beepAll(440, 0.12);
}

function renderPane(p) {
  for (const q of players) q.marker.setVisibleFor(q === p && (state === 'race' || state === 'countdown'));
  p.marker.fit(p.cam);
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
  if (!stage || breakActive()) return; // an ad break freezes the game (sim, sound, render)
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
      dust.emitFrom(p.car, p.carry, dt, state === 'race' || state === 'finish' ? roughOf(p.car) : 0);
    }
    // ghost: record the solo run, replay the stored best on the race clock
    if (racers.length === 1 && state === 'race' && !racers[0].done) recorder.sample(racers[0].time - racers[0].pen, racers[0].car); // raw clock
    // the ghost replays on the player's RAW clock, so it moves smoothly whoever is penalised; penalties enter the delta only
    if (state === 'race' && racers.length === 1 && !racers[0].done) ghostT = racers[0].time - racers[0].pen;
    else if (state === 'race' || state === 'finish') ghostT += dt;
    dust.step(dt);
    rain.step(dt);
  } else acc = 0;
  for (const p of players) {
    p.marker.update(running ? dt : 0);
    if (p.penFlashT > 0) p.penFlashT -= dt;
    if (p.roughHold > 0) p.roughHold -= dt;
    // deep rough: a shake scaled by rough x speed, and the OFF ROAD indicator (with hysteresis); the verge stays calm
    p.rough = racers.includes(p) && state !== 'menu' ? roughOf(p.car) : 0;
    if (running && p.rough > 0.05 && p.car.grounded !== false) p.shake = Math.max(p.shake, p.rough * Math.min(1, p.car.speed / 22) * 0.42);
    p.roughOn = p.roughOn ? p.rough > 0.4 : p.rough > 0.5;
  }
  const snds = modeSounds();
  racers.forEach((p, k) => {
    const car = p.car;
    if (car.impact > 0) {
      if (state !== 'menu') { snds[k].impact(car.impact); p.shake = Math.min(1.2, p.shake + car.impact / 10); }
      car.impact = 0;
    }
    updateCamera(p, dt, stage, state === 'menu' ? (menuView === 'garage' ? 'garage' : 'menu') : p.done && p.doneT > 1.1 ? 'finish' : null);
  });
  if (ghost) {
    const me = racers[0];
    ghost.place(ghostT, pose(me.car));
    ghost.setVisible(ghostOn);
    // live delta at the player's track position, ~5x per second
    ghostDeltaT -= dt;
    if (ghostDeltaT <= 0 && state === 'race' && !me.done) {
      ghostDeltaT = 0.2;
      const gt = ghost.totalAtIdx(me.car.idx); // ghost raw time there + its penalties so far
      ghostDelta = gt == null || me.car.idx <= stage.startIdx ? null : me.time - gt;
    }
  }
  if (state !== 'menu' && state !== 'boot') {
    updatePanes(racers, stage, state, rally ? { n: rally.idx + 1, of: rally.ids.length, totals: rally.base } : null, // base = totals before this stage, so the HUD never double counts
      ghost && ghostOn && state === 'race' ? ghostDelta : undefined);
    if (state === 'race' && !paused) hintsT += dt;
    // key hints: only for the first few runs (the full list lives in Settings > Controls)
    $('hints').classList.toggle('show', state === 'race' && racers.length === 1 && hintsT < 6 && profile.stats.runs < 3);
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
  get car() { return players[0].car; },
  get cars() { return racers.map((p) => p.car); },
  get stage() { return stage; },
  get stages() { return menuIds(); },
  get conditions() { return { ...cond }; },
  get info() { return { ...renderer.info.memory, builtStages: [...built.keys()] }; },
  startStage(key) { rally = null; startStage(key); },
  startRally: (regionId) => startRally(regionId),
  get rally() { return rally ? { region: rally.region, stages: rally.ids.slice(), stage: rally.idx + 1, of: rally.ids.length, phase: rally.phase, totals: rally.totals.slice(0, racers.length), times: rally.times.slice(0, racers.length).map((a) => a.slice()) } : null; },
  medals: () => medalSummary(),
  get ghost() { return ghost ? { time: ghost.time, build: ghost.rec.build || null, carId: ghost.rec.carId || null, active: ghostOn && ghost.car.group.visible, delta: ghostDelta, t: ghostT, v: ghost.rec.v, pens: ghost.rec.pens || [], pos: ghost.car.group.position.toArray() } : null; },
  get ghostOn() { return ghostOn; },
  get penalties() { return racers.map((p) => (p.rules ? p.rules.summary() : null)); },
  get gates() { return stage ? (racers[0].rules ? racers[0].rules.gates.map((g) => ({ ...g })) : null) : null; },
  get profile() { return JSON.parse(JSON.stringify(profile)); },
  get builds() { return racers.map((p) => p.build); },
  buy(kind, id) { const r = buyItem(kind, id); if (state === 'menu') { showroom(); showMenu(); } return r; },
  offer,
  setBuild(b) { setProfileBuild(b); if (state === 'menu') { showroom(); showMenu(); } return profile.build; },
  earn(n) { const c = earn(n); if (state === 'menu') showMenu(); return c; },
  get earnTable() { return EARN; },
  costs,
  setView,
  get view() { return menuView; },
  setGarageTab(t) { setGarageTab(t); if (state === 'menu') showMenu(); },
  setGarageCar(c) { setGarageCar(c); if (state === 'menu') { showroom(); showMenu(); } return garageCar(); },
  // selects a stage in the PLAY list (switching to its tab); 'daily' or an id
  selectStage(key) { const d = getDef(key); if (!d) return false; setPick(tabOfStage(d.id), isDaily(d.id) ? dailyDef().id : d.id); return d.id; },
  // selects a list entry: (tab, entry) with entry a stage id, 'rally' or null (the tab's remembered entry)
  selectEntry(tab, entry = null) { setPick(tab, entry); return { ...pick }; },
  get pick() { return { ...pick, key: pickKey(), label: startLabel(pick, mode === 'duel').join(' \u00b7 ') }; },
  openSettings: () => openSettings(null),
  closeSettings: () => closeSettings(),
  get settings() { return { ...settingsState(), sound: !muted, ghost: ghostOn }; },
  get screen() { return screenName(); },
  padPress: (k, b) => onPadEdge(k, b), // drive the gamepad edge handler (tests)
  get muted() { return muted; },
  setMode,
  get time() { return players[0].time; },
  get times() { return racers.map((p) => p.time); },
  setAuto(b) { auto = !!b; },
  get adBreak() { return breakActive(); },
  get audioMuted() { return allSounds()[0].muted; }, // what the speakers do (player setting, ad break or portal mute)
};

function boot() {
  pruneDailyGhosts();
  // ?rally=<id> preselects that rally; ?stage= takes an id, 'daily' or a 0-based index; the saved selection
  // ('dustline.stage') may be a stage id, 'daily', 'rally:<regionId>' or an old numeric index
  const pr = params.get('rally'), ps = params.get('stage');
  const first = REGIONS[0].stages[0];
  const p0 = (pr && rallyStages(pr).length ? { tab: pr, entry: 'rally' } : null) || parsePick(ps) || parsePick(store.get('dustline.stage', null)) || parsePick(first);
  setPick(p0.tab, p0.entry, { persist: !params.get('stage') && !pr, quiet: true });
  mode = (params.get('mode') || store.get('dustline.mode', 'solo')) === 'duel' && duelAvailable() ? 'duel' : 'solo';
  loadStage(getDef(sel));
  players[0].setBuild(profile.build); players[0].lights.setEnabled(cond.night);
  players[0].place(stage, stage.startIdx);
  if (params.get('start') === '1') startPick();
  else toMenu();
  $('loading').classList.add('fade');
  platform.loadingStop();
  requestAnimationFrame(frame);
}
requestAnimationFrame(() => setTimeout(boot, 30));
