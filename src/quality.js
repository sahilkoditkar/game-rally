// Automatic quality scaler: watches frame times and steps the render quality down when frames run long,
// and back up (cautiously) when there is headroom. Pure logic, no three.js: main.js applies the levels.
//
// Levels (0 = lowest). Each one only ever lowers cost against the one above it:
//   pr     cap on the device pixel ratio (the renderer never exceeds the screen's own ratio)
//   shadow shadow map size (0 = the sun casts no shadows)
//   draw   scale on fog / camera far distance (less distant scenery to draw)
//   dust   scale on how many dust puffs the cars throw
export const LEVELS = [
  { name: 'low', pr: 1, shadow: 0, draw: 0.72, dust: 0.45 },
  { name: 'low+', pr: 1, shadow: 1024, draw: 0.85, dust: 0.65 },
  { name: 'med', pr: 1.25, shadow: 1024, draw: 1, dust: 0.85 },
  { name: 'med+', pr: 1.5, shadow: 2048, draw: 1, dust: 1 },
  { name: 'high', pr: 2, shadow: 2048, draw: 1, dust: 1 },
];
export const HIGH = LEVELS.length - 1;
// ?quality=low|med|high pins a level; auto (default) scales
export const NAMED = { low: 0, med: 2, high: HIGH };

// tuning (ms / s)
export const Q = {
  window: 1.5,      // s of frames per verdict
  slowMs: 24,       // a window whose 80th percentile frame is slower than this (~42 fps) is "slow"
  okMs: 19,         // ... at or under this (a steady 60 fps display, allowing jitter) is "smooth"
  downAfter: 2,     // consecutive slow windows before stepping down (3 s)
  upAfter: 6,       // consecutive smooth windows before trying one level up (9 s)
  coolDown: 4,      // s after any change during which no further change is made
  probe: 8,         // s after a step up: a step back down within this marks that level as too much
  hugeMs: 250,      // frames longer than this are hitches (tab switch, GC, loading) and are ignored
};

export class QualityScaler {
  // start: initial level; fixed: true pins it (no scaling)
  constructor(start = HIGH, fixed = false) {
    this.level = Math.max(0, Math.min(HIGH, start | 0));
    this.fixed = !!fixed;
    this.buf = []; this.acc = 0;
    this.slow = 0; this.smooth = 0;
    this.t = 0; this.lastChange = -1e9; this.lastUp = -1e9;
    this.ceiling = HIGH;   // levels above this proved too slow this session
    this.history = [];     // [{ t, from, to, why }]
  }
  // feed one frame interval (ms). Returns the new level when it changed, else -1.
  // Only feed frames that represent real play (visible tab, not paused, not loading).
  sample(ms) {
    if (!(ms > 0)) return -1;
    this.t += ms / 1000;
    if (ms > Q.hugeMs) return -1;
    this.buf.push(ms); this.acc += ms / 1000;
    if (this.acc < Q.window) return -1;
    const s = this.buf.slice().sort((a, b) => a - b), p80 = s[Math.min(s.length - 1, Math.floor(s.length * 0.8))];
    this.buf.length = 0; this.acc = 0;
    if (this.fixed) return -1;
    if (p80 > Q.slowMs) { this.slow++; this.smooth = 0; } else if (p80 <= Q.okMs) { this.smooth++; this.slow = 0; } else { this.slow = 0; this.smooth = 0; }
    if (this.t - this.lastChange < Q.coolDown) return -1;
    if (this.slow >= Q.downAfter && this.level > 0) {
      // a step up that did not hold: that level is the session's ceiling from now on (no thrash)
      if (this.t - this.lastUp < Q.probe) this.ceiling = this.level - 1;
      return this.set(this.level - 1, 'slow', p80);
    }
    if (this.smooth >= Q.upAfter && this.level < Math.min(HIGH, this.ceiling)) {
      this.lastUp = this.t;
      return this.set(this.level + 1, 'headroom', p80);
    }
    return -1;
  }
  set(level, why = 'set', p80 = 0) {
    const from = this.level;
    this.level = Math.max(0, Math.min(HIGH, level));
    this.slow = this.smooth = 0; this.lastChange = this.t;
    this.history.push({ t: +this.t.toFixed(2), from, to: this.level, why, p80: +(+p80).toFixed(1) });
    if (this.history.length > 40) this.history.shift();
    return this.level;
  }
  // forget the partial window (after a pause, a stage load, a tab switch)
  reset() { this.buf.length = 0; this.acc = 0; this.slow = this.smooth = 0; }
  get settings() { return LEVELS[this.level]; }
}
