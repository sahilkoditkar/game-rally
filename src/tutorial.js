// First-run guide: a single PLAY on the very first launch, then a few one-line coach marks in the first race
// (the goal, this device's controls, gates, pace notes) and one line on the first finish panel.
// Saved as `dustline.tutorial` = { v, hero, shown: [step ids], done, skipped }. Settings > Tips re-arms it.
import { store } from './storage.js';
import { $ } from './util.js';

export const TUTORIAL_KEY = 'dustline.tutorial';
// in-race coach marks, in the order they normally appear; 'finish' is the line on the first finish panel
export const STEPS = ['goal', 'controls', 'gates', 'notes', 'finish'];
const DUR = 4.2;      // s a coach mark stays up
const MIN_DUR = 2.6;  // s before a waiting one may replace it

function load() {
  const r = store.get(TUTORIAL_KEY, null);
  if (!r || typeof r !== 'object') return null;
  return { v: 1, hero: !!r.hero, shown: Array.isArray(r.shown) ? r.shown.filter((s) => STEPS.includes(s)) : [], done: !!r.done, skipped: !!r.skipped };
}

export class Tutorial {
  // fresh: no saved record and no runs on the profile (a returning player from before the guide existed never sees it)
  constructor(profileRuns) {
    this.rec = load();
    // the hero (big PLAY instead of the full menu) is for this first session only
    this.heroNow = !this.rec && !(profileRuns > 0);
    if (!this.rec) {
      this.rec = { v: 1, hero: true, shown: profileRuns > 0 ? [...STEPS] : [], done: profileRuns > 0, skipped: false };
      this.save();
    }
    this.cur = null; this.curT = 0; this.queue = []; this.run = false;
    this.el = $('coach'); this.txt = $('coachTxt');
  }
  save() { store.set(TUTORIAL_KEY, this.rec); }
  get done() { return this.rec.done; }
  has(id) { return this.rec.shown.includes(id); }
  // anything left to show in a race (the coach marks, or the line on the first finish panel)
  get pending() { return !this.rec.done && STEPS.some((s) => !this.has(s)); }
  mark(id) {
    if (!this.has(id)) this.rec.shown.push(id);
    if (STEPS.every((s) => this.has(s))) this.rec.done = true;
    this.save();
  }
  endHero() { this.heroNow = false; }
  skip() {
    this.rec.shown = [...STEPS]; this.rec.done = true; this.rec.skipped = true; this.save();
    this.heroNow = false; this.hide(); this.queue.length = 0;
  }
  // Settings > Tips: show the guide again from the next race (hero: also the first-launch PLAY screen)
  reset(hero = false) {
    this.rec = { v: 1, hero: true, shown: [], done: false, skipped: false }; this.save();
    this.heroNow = !!hero; this.hide(); this.queue.length = 0;
  }
  // a race starts: is this run guided?
  begin(guided) { this.run = !!guided && this.pending; this.queue.length = 0; this.hide(); }
  end() { this.run = false; this.queue.length = 0; this.hide(); }
  // ask for a coach mark; it shows now or after the current one
  want(id, text, opts = {}) {
    if (!this.run || this.has(id) || (this.cur && this.cur.id === id) || this.queue.some((q) => q.id === id)) return false;
    this.queue.push({ id, text, ...opts });
    return true;
  }
  // per frame while the race runs (not while paused)
  update(dt) {
    if (this.cur) {
      this.curT += dt;
      const dur = this.cur.dur || DUR;
      if (this.curT >= dur || (this.queue.length && this.curT >= MIN_DUR && !this.cur.hold)) this.hide();
    }
    if (!this.cur && this.queue.length && this.run) this.show(this.queue.shift());
  }
  show(m) {
    this.cur = m; this.curT = 0;
    this.mark(m.id);
    if (!this.el) return;
    this.txt.innerHTML = m.text;
    this.el.className = 'coach show' + (m.cls ? ' ' + m.cls : '');
    this.el.dataset.step = m.id;
    if (m.onShow) m.onShow();
  }
  hide() {
    if (this.cur && this.cur.onHide) this.cur.onHide();
    this.cur = null;
    if (this.el) { this.el.classList.remove('show'); }
  }
  get step() { return this.cur ? this.cur.id : null; }
  get state() {
    return { active: this.run, heroNow: this.heroNow, step: this.step, shown: this.rec.shown.slice(), done: this.rec.done, skipped: this.rec.skipped, queued: this.queue.map((q) => q.id) };
  }
}
