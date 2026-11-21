// Dustline — fully procedural WebAudio sound (no assets, no dependencies).
//
// Several Sound instances (e.g. split-screen duel) share ONE AudioContext,
// ONE master chain and ONE noise buffer, created lazily on the first resume().
//
// Per instance:
//   PeriodicWave A ─┐
//   PeriodicWave B ─┼─> amGain ─> lowpass ─> engineGain ─┐
//   sine sub      ─┘     ^ (gentle LFO)                  │
//   noise ─> bandpass ─> lowpass ─> gravelGain ──────────┼─> out (opts.gain) ─> panner (opts.pan) ─┐
//   noise ─> bandpass ─> slideGain ──────────────────────┤                                         │
//   impacts / beeps (one-shot) ──────────────────────────┘                                         │
// Shared:                                                                                          │
//   sfxBus (Effects volume) <──────────────────────────────────────────────────────────────────────┘
//   sfxBus ───┐
//   musicBus ─┴─> master (0.3, mute) ─> high-shelf −6 dB @3.2 kHz ─> lowpass 7 kHz ─> compressor ─> destination
//
// Volumes: setVolume('sfx' | 'music', 0..1) sets each bus to v² (perceptual), defaults sfx 0.8, music 0.6.
// The mute (setMuted on any Sound) silences the master, so it overrides both.
// The procedural music engine (export `music`) lives at the bottom of this file.

const MASTER_LEVEL = 0.3;

// Module-level shared state.
const shared = {
  ctx: null,
  failed: false,
  muted: false,
  master: null,
  sfxBus: null,
  musicBus: null,
  noiseBuf: null,
  wave: null,
};

const vol = { sfx: 0.8, music: 0.6 };
const busGain = (v) => v * v;

function clamp(v, lo, hi) {
  v = Number(v);
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

function ensureShared() {
  if (shared.ctx) return shared.ctx;
  if (shared.failed) return null;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) {
    shared.failed = true;
    return null;
  }
  const ctx = new AC();
  const t = ctx.currentTime;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 14;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.25;
  comp.connect(ctx.destination);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 7000;
  lp.Q.value = 0.5;
  lp.connect(comp);

  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 3200;
  shelf.gain.value = -6;
  shelf.connect(lp);

  const master = ctx.createGain();
  master.gain.value = 0;
  master.gain.setTargetAtTime(shared.muted ? 0 : MASTER_LEVEL, t, 0.15);
  master.connect(shelf);

  const sfxBus = ctx.createGain();
  sfxBus.gain.value = busGain(vol.sfx);
  sfxBus.connect(master);
  const musicBus = ctx.createGain();
  musicBus.gain.value = busGain(vol.music);
  musicBus.connect(master);

  // Pink-ish → brown-ish noise: Paul Kellet's pink filter, then a gentle one-pole lowpass.
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, lpState = 0, peak = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    lpState += 0.35 * (pink - lpState);
    d[i] = lpState;
    const a = Math.abs(lpState);
    if (a > peak) peak = a;
  }
  // Remove DC and normalise; crossfade the loop seam.
  let mean = 0;
  for (let i = 0; i < len; i++) mean += d[i];
  mean /= len;
  const norm = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < len; i++) d[i] = (d[i] - mean) * norm;
  const fade = Math.floor(ctx.sampleRate * 0.02);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = d[i] * k + d[len - fade + i] * (1 - k);
  }

  // Band-limited, rolled-off harmonic series for a rounded engine tone.
  const N = 14;
  const real = new Float32Array(N + 1);
  const imag = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) {
    // Odd harmonics a bit stronger (4-cyl "purr"), steep roll-off.
    const odd = n % 2 === 1 ? 1 : 0.7;
    imag[n] = (odd / Math.pow(n, 1.7)) * (n === 2 ? 1.2 : 1);
  }
  const wave = ctx.createPeriodicWave(real, imag);

  shared.ctx = ctx;
  shared.master = master;
  shared.sfxBus = sfxBus;
  shared.musicBus = musicBus;
  shared.noiseBuf = buf;
  shared.wave = wave;
  return ctx;
}

function applyMasterMute() {
  if (!shared.ctx || !shared.master) return;
  const t = shared.ctx.currentTime;
  const g = shared.master.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.setTargetAtTime(shared.muted ? 0 : MASTER_LEVEL, t, 0.1);
}

// Effects / music volume (0..1). Safe before resume(): the value is kept and applied when the graph exists.
export function setVolume(kind, v) {
  if (kind !== 'sfx' && kind !== 'music') return;
  vol[kind] = clamp(v, 0, 1);
  const bus = kind === 'sfx' ? shared.sfxBus : shared.musicBus;
  if (!shared.ctx || !bus) return;
  try {
    const t = shared.ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.setTargetAtTime(busGain(vol[kind]), t, 0.06);
  } catch (e) {
    /* ignore */
  }
}
export function getVolume(kind) {
  return kind === 'sfx' || kind === 'music' ? vol[kind] : undefined;
}

export class Sound {
  constructor(opts = {}) {
    const o = opts && typeof opts === 'object' ? opts : {};
    this._pan = o.pan === undefined ? 0 : clamp(o.pan, -1, 1);
    this._gain = o.gain === undefined ? 1 : clamp(o.gain, 0, 4);
    this.ctx = null;
    this._built = false;
    this._lastImpactTime = -1;
    this._lastImpactStrength = 0;
  }

  // Mute state is shared by all instances (it drives the shared master gain),
  // so reading `muted` on any instance reflects the global state.
  get muted() {
    return shared.muted;
  }
  set muted(v) {
    this.setMuted(v);
  }

  resume() {
    try {
      const ctx = ensureShared();
      if (!ctx) return;
      if (!this._built) {
        this.ctx = ctx;
        this._build();
        this._built = true;
      }
      if (ctx.state === 'suspended') {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch (e) {
      /* never throw from a user gesture handler */
    }
  }

  setMuted(m) {
    shared.muted = !!m;
    try {
      applyMasterMute();
    } catch (e) {
      /* ignore */
    }
  }

  _build() {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // --- Instance output: gain → panner → shared SFX bus ---
    this.out = ctx.createGain();
    this.out.gain.value = this._gain;
    let tail = this.out;
    if (typeof ctx.createStereoPanner === 'function') {
      this.panner = ctx.createStereoPanner();
      this.panner.pan.value = this._pan;
      this.out.connect(this.panner);
      tail = this.panner;
    }
    tail.connect(shared.sfxBus);

    // --- Engine ---
    const f0 = 55;
    this.oscA = ctx.createOscillator();
    this.oscA.setPeriodicWave(shared.wave);
    this.oscA.frequency.value = f0;
    this.oscB = ctx.createOscillator();
    this.oscB.setPeriodicWave(shared.wave);
    this.oscB.frequency.value = f0;
    this.oscB.detune.value = 5;
    this.oscSub = ctx.createOscillator();
    this.oscSub.type = 'sine';
    this.oscSub.frequency.value = f0 * 0.5;

    const gA = ctx.createGain();
    gA.gain.value = 0.42;
    const gB = ctx.createGain();
    gB.gain.value = 0.3;
    const gSub = ctx.createGain();
    gSub.gain.value = 0.45;

    this.amGain = ctx.createGain();
    this.amGain.gain.value = 1;
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = f0 * 0.5;
    this.amDepth = ctx.createGain();
    this.amDepth.gain.value = 0.08;
    this.lfo.connect(this.amDepth);
    this.amDepth.connect(this.amGain.gain);

    this.oscA.connect(gA);
    this.oscB.connect(gB);
    this.oscSub.connect(gSub);
    gA.connect(this.amGain);
    gB.connect(this.amGain);
    gSub.connect(this.amGain);

    this.engineLP = ctx.createBiquadFilter();
    this.engineLP.type = 'lowpass';
    this.engineLP.frequency.value = 350;
    this.engineLP.Q.value = 0.6;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    this.amGain.connect(this.engineLP);
    this.engineLP.connect(this.engineGain);
    this.engineGain.connect(this.out);

    // --- Gravel / surface bed ---
    this.gravelSrc = ctx.createBufferSource();
    this.gravelSrc.buffer = shared.noiseBuf;
    this.gravelSrc.loop = true;
    this.gravelBP = ctx.createBiquadFilter();
    this.gravelBP.type = 'bandpass';
    this.gravelBP.frequency.value = 300;
    this.gravelBP.Q.value = 0.6;
    this.gravelLP = ctx.createBiquadFilter();
    this.gravelLP.type = 'lowpass';
    this.gravelLP.frequency.value = 1000;
    this.gravelLP.Q.value = 0.5;
    this.gravelGain = ctx.createGain();
    this.gravelGain.gain.value = 0;
    this.gravelSrc.connect(this.gravelBP);
    this.gravelBP.connect(this.gravelLP);
    this.gravelLP.connect(this.gravelGain);
    this.gravelGain.connect(this.out);

    // --- Tyre slide scrub ---
    this.slideSrc = ctx.createBufferSource();
    this.slideSrc.buffer = shared.noiseBuf;
    this.slideSrc.loop = true;
    this.slideSrc.playbackRate.value = 1.13;
    this.slideBP = ctx.createBiquadFilter();
    this.slideBP.type = 'bandpass';
    this.slideBP.frequency.value = 800;
    this.slideBP.Q.value = 1.2;
    this.slideGain = ctx.createGain();
    this.slideGain.gain.value = 0;
    this.slideSrc.connect(this.slideBP);
    this.slideBP.connect(this.slideGain);
    this.slideGain.connect(this.out);

    // Random loop offsets so two instances don't phase-align.
    const off = Math.random() * 1.8;
    this.oscA.start(t);
    this.oscB.start(t);
    this.oscSub.start(t);
    this.lfo.start(t);
    this.gravelSrc.start(t, off);
    this.slideSrc.start(t, (off + 0.9) % 1.9);
  }

  update(dt, s) {
    if (!this._built || !this.engineGain) return;
    try {
      s = s || {};
      const t = this.ctx.currentTime;
      const active = s.active !== false;
      const rpm = clamp(s.rpm, 0, 1);
      const thr = clamp(s.throttle, 0, 1);
      const speed = clamp(s.speed, 0, 80);
      const slip = clamp(s.slip, 0, 40);
      const off = clamp(s.offroad, 0, 1);
      const grounded = s.grounded !== false;

      // --- Engine: warm purr, slow glides ---
      const f = 55 + rpm * 205;
      const tcPitch = 0.08;
      this.oscA.frequency.setTargetAtTime(f, t, tcPitch);
      this.oscB.frequency.setTargetAtTime(f * 1.002, t, tcPitch);
      this.oscSub.frequency.setTargetAtTime(f * 0.5, t, tcPitch);
      this.lfo.frequency.setTargetAtTime(f * 0.5, t, tcPitch);

      // Off throttle: slightly deeper, smooth burble; darker and quieter.
      this.amDepth.gain.setTargetAtTime(0.05 + (1 - thr) * 0.09, t, 0.2);
      const cutoff = 320 + rpm * 520 + thr * 420; // ceiling ≈ 1260 Hz
      this.engineLP.frequency.setTargetAtTime(cutoff, t, 0.15);

      const engLevel = active ? 0.13 + rpm * 0.06 + thr * 0.1 : 0;
      this.engineGain.gain.setTargetAtTime(engLevel, t, active ? 0.12 : 0.3);

      // --- Gravel bed ---
      const sp = Math.min(speed / 40, 1);
      let gravel = 0;
      if (active && grounded) gravel = Math.pow(sp, 0.9) * (0.16 + off * 0.16);
      this.gravelGain.gain.setTargetAtTime(gravel, t, 0.18);
      this.gravelBP.frequency.setTargetAtTime(260 + sp * 260 + off * 380, t, 0.2);
      this.gravelLP.frequency.setTargetAtTime(900 + off * 700, t, 0.2);

      // --- Slide scrub ---
      const sl = clamp((slip - 2) / 8, 0, 1);
      let slide = 0;
      if (active && grounded) {
        slide = sl * sl * (3 - 2 * sl) * (0.14 + off * 0.04) * Math.min(1, speed / 6 + 0.2);
      }
      this.slideGain.gain.setTargetAtTime(slide, t, 0.15);
      this.slideBP.frequency.setTargetAtTime(700 + sl * 400 - off * 150, t, 0.2);
    } catch (e) {
      /* never break the game loop */
    }
  }

  impact(strength) {
    if (!this._built || !this.out) return;
    try {
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const st = clamp(strength, 0, 25);
      if (st < 0.5) return;
      if (t - this._lastImpactTime < 0.1 && st <= this._lastImpactStrength) return;
      this._lastImpactTime = t;
      this._lastImpactStrength = st;
      const k = Math.min(st / 20, 1);
      const amp = 0.25 + k * 0.6;

      // Dull low thud
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(72 + k * 18, t);
      o.frequency.setTargetAtTime(38, t, 0.08);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(0.8 * amp, t + 0.012);
      og.gain.setTargetAtTime(0, t + 0.02, 0.08 + k * 0.08);
      o.connect(og);
      og.connect(this.out);
      o.start(t);
      o.stop(t + 1.0);

      // Small muffled crunch
      const n = ctx.createBufferSource();
      n.buffer = shared.noiseBuf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(450 + k * 900, t);
      lp.frequency.setTargetAtTime(200, t, 0.08);
      lp.Q.value = 0.5;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(0.28 * amp, t + 0.01);
      ng.gain.setTargetAtTime(0, t + 0.02, 0.05 + k * 0.05);
      n.connect(lp);
      lp.connect(ng);
      ng.connect(this.out);
      n.start(t, Math.random() * 1.5);
      n.stop(t + 1.0);
    } catch (e) {
      /* ignore */
    }
  }

  beep(freq = 440, dur = 0.12) {
    if (!this._built || !this.out) return;
    try {
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const f = clamp(freq, 40, 8000);
      const d = clamp(dur, 0.03, 3);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      const g = ctx.createGain();
      const rel = Math.max(0.015, d - 0.04);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.015);
      g.gain.setValueAtTime(0.22, t + rel);
      g.gain.setTargetAtTime(0, t + rel, 0.035);
      o.connect(g);
      g.connect(this.out);
      o.start(t);
      o.stop(t + d + 0.3);
    } catch (e) {
      /* ignore */
    }
  }
}

// ====================================================================== procedural music
// A small look-ahead sequencer on the AudioContext clock (setInterval ~100 ms, notes scheduled ~0.3 s ahead).
// Every note is a one-shot voice (oscillator → filter → gain) that disconnects itself when it ends, so nothing
// accumulates. A scene is a "layer" (its own lowpass + crossfade gain); changing scene crossfades layers.
//
//   voices ─> layer lowpass ─> layer out (crossfade) ─┬──────────────> musicIn ─> duck ─> musicBus
//                                                     └─> send ─> delay (dotted 8th, lowpassed feedback) ─┘

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};
// Per-region flavour. progs are 4-chord progressions of scale degrees (0-based), all avoiding diminished chords.
const FLAVOURS = {
  forest: { root: 50, mode: 'dorian', bpm: 108, pluck: 'wood', cut: 2100, send: 0.22, density: 0.9, sev: true,
    progs: [[0, 6, 2, 3], [0, 3, 4, 6], [0, 4, 6, 3], [2, 6, 0, 0], [3, 0, 6, 4]] },
  desert: { root: 52, mode: 'mixolydian', bpm: 116, pluck: 'twang', cut: 2700, send: 0.18, density: 1, sev: false,
    progs: [[0, 6, 3, 0], [0, 4, 6, 3], [0, 5, 6, 3], [0, 6, 4, 3], [3, 6, 0, 0]] },
  snow: { root: 57, mode: 'lydian', bpm: 104, pluck: 'glass', cut: 2300, send: 0.34, density: 0.5, sev: true,
    progs: [[0, 1, 5, 4], [0, 4, 1, 0], [5, 1, 0, 4], [0, 1, 2, 5]] },
  coast: { root: 55, mode: 'ionian', bpm: 112, pluck: 'reed', cut: 2500, send: 0.26, density: 0.8, sev: false,
    progs: [[0, 4, 5, 3], [0, 5, 3, 4], [3, 0, 4, 5], [0, 3, 1, 4], [5, 3, 0, 4]] },
  menu: { root: 53, mode: 'ionian', bpm: 84, pluck: 'wood', cut: 1700, send: 0.3, density: 0.32, sev: true,
    progs: [[0, 5, 3, 4], [3, 4, 2, 5], [0, 2, 3, 4], [5, 3, 0, 4]] },
};
const REGION_IDS = ['forest', 'desert', 'snow', 'coast'];
const _ = null;
const ARPS = [
  [0, _, 2, _, 1, _, 3, _, 2, _, 4, _, 3, _, 2, _],
  [0, _, _, 3, _, _, 2, _, 4, _, _, 3, _, _, 1, _],
  [3, _, 2, _, 1, _, 0, _, 1, _, 2, _, 4, _, 3, _],
  [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 1, 3, 2, 4, 5, 3],
];
const BASSES = [
  [0, _, 0, _, _, _, 0, _, 0, _, _, _, 12, _, 0, _],
  [0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _],
  [0, _, _, 0, _, _, 0, _, _, _, 0, _, 7, _, _, _],
  [0, _, _, _, 0, _, _, _, 0, _, _, _, 0, _, _, _],
];
const KICKS = [
  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0],
];
// race arrangement: six 8-bar sections (≈ 1:45 at 110 bpm), then it cycles with the arps rotated
const PLAN = [
  { p: 0, arp: 0, bass: 0, kick: 0, hat: 1 },
  { p: 0, arp: 1, bass: 1, kick: 1, hat: 1 },
  { p: 1, arp: 2, bass: 2, kick: 2, hat: 1 },
  { p: 0, arp: 1, bass: -1, kick: -1, hat: 0, breakdown: true },
  { p: 1, arp: 3, bass: 0, kick: 1, hat: 1 },
  { p: 0, arp: 0, bass: 1, kick: 2, hat: 1 },
];

function hashStr(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MUSIC_TRIM = 0.5;
const DUCK = 0.316; // −10 dB
const M = {
  built: false, playing: false, timer: 0,
  inp: null, duckG: null, dIn: null, delay: null, hatBuf: null, waves: null,
  layers: [], key: '', want: { scene: 'menu', region: null, night: false, rain: false, seed: 0 },
  shown: { scene: null, region: null }, lastRace: null,
  intensity: 0, iSmooth: 0, ducked: false,
  created: 0, live: 0,
};

function makeWave(ctx, n, amp) {
  const re = new Float32Array(n + 1), im = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) im[k] = amp(k);
  return ctx.createPeriodicWave(re, im);
}

function buildMusic(ctx) {
  if (M.built) return;
  M.waves = {
    soft: makeWave(ctx, 8, (k) => 1 / (k * k)),
    reed: makeWave(ctx, 12, (k) => (k % 2 ? 1 : 0.25) / Math.pow(k, 1.4)),
    twang: makeWave(ctx, 16, (k) => 1 / Math.pow(k, 1.15)),
  };
  M.inp = ctx.createGain();
  M.inp.gain.value = MUSIC_TRIM;
  M.duckG = ctx.createGain();
  M.duckG.gain.value = M.ducked ? DUCK : 1;
  M.duckSet = true;
  M.inp.connect(M.duckG);
  M.duckG.connect(shared.musicBus);
  // delay send: highpass → delay ⟲ (lowpass, feedback) → wet → musicIn
  M.dIn = ctx.createBiquadFilter();
  M.dIn.type = 'highpass';
  M.dIn.frequency.value = 280;
  M.delay = ctx.createDelay(1.5);
  M.delay.delayTime.value = 0.42;
  const fbLP = ctx.createBiquadFilter();
  fbLP.type = 'lowpass';
  fbLP.frequency.value = 1700;
  const fb = ctx.createGain();
  fb.gain.value = 0.32;
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  M.dIn.connect(M.delay);
  M.delay.connect(fbLP);
  fbLP.connect(fb);
  fb.connect(M.delay);
  fbLP.connect(wet);
  wet.connect(M.inp);
  // short white-noise buffer for the soft hat
  const n = Math.floor(ctx.sampleRate * 0.25);
  M.hatBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = M.hatBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  M.built = true;
}

// --- voices (each one-shot; cleans itself up on 'ended') ---
function own(src, nodes) {
  M.created++;
  M.live++;
  src.onended = () => {
    for (const x of nodes) {
      try { x.disconnect(); } catch (e) { /* ignore */ }
    }
    M.live--;
  };
}
function vPluck(L, t, midi, v) {
  const ctx = shared.ctx, f = mtof(midi), kind = L.fl.pluck;
  const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  const nodes = [o, lp, g];
  let dec = 0.2, f0 = f * 6, f1 = f * 1.6;
  if (kind === 'wood') { o.setPeriodicWave(M.waves.soft); dec = 0.16; f0 = f * 5; f1 = f * 1.4; }
  else if (kind === 'twang') {
    o.setPeriodicWave(M.waves.twang); dec = 0.22; f0 = Math.min(3200, f * 8); f1 = f * 2;
    o.detune.setValueAtTime(30, t); o.detune.setTargetAtTime(0, t, 0.03);
  } else if (kind === 'reed') { o.setPeriodicWave(M.waves.reed); dec = 0.2; f0 = f * 5; f1 = f * 1.8; }
  else { // glass: sine with a quiet inharmonic partial, long ring
    o.type = 'sine'; dec = 0.42; f0 = 3000; f1 = 2000;
    const o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o2.type = 'sine'; o2.frequency.value = f * 2.76;
    g2.gain.setValueAtTime(0.12, t); g2.gain.setTargetAtTime(0, t, 0.12);
    o2.connect(g2); g2.connect(lp);
    o2.start(t); o2.stop(t + 1);
    nodes.push(o2, g2);
  }
  o.frequency.value = f;
  lp.type = 'lowpass';
  lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(Math.min(f0, 4000), t);
  lp.frequency.setTargetAtTime(f1, t, dec * 0.5);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + 0.005);
  g.gain.setTargetAtTime(0, t + 0.006, dec);
  o.connect(lp); lp.connect(g); g.connect(L.filt);
  o.start(t);
  o.stop(t + dec * 7 + 0.05);
  own(o, nodes);
}
function vPad(L, t, midi, v, dur) {
  const ctx = shared.ctx, f = mtof(midi);
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
  o.setPeriodicWave(M.waves.soft); o2.setPeriodicWave(M.waves.soft);
  o.frequency.value = f; o2.frequency.value = f;
  o.detune.value = -5; o2.detune.value = 6;
  const att = Math.min(0.7, dur * 0.3);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + att);
  g.gain.setValueAtTime(v, t + dur);
  g.gain.setTargetAtTime(0, t + dur, 0.4);
  o.connect(g); o2.connect(g); g.connect(L.filt);
  o.start(t); o2.start(t);
  o.stop(t + dur + 2.4); o2.stop(t + dur + 2.4);
  own(o, [o, o2, g]);
}
function vBass(L, t, midi, v, dur) {
  const ctx = shared.ctx, f = mtof(midi);
  const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  o.setPeriodicWave(M.waves.soft);
  o.frequency.value = f;
  lp.type = 'lowpass'; lp.Q.value = 0.5;
  lp.frequency.setValueAtTime(Math.min(900, f * 6), t);
  lp.frequency.setTargetAtTime(f * 2.5, t, 0.08);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + 0.008);
  g.gain.setTargetAtTime(v * 0.55, t + 0.01, 0.12);
  g.gain.setTargetAtTime(0, t + dur, 0.05);
  o.connect(lp); lp.connect(g); g.connect(L.filt);
  o.start(t);
  o.stop(t + dur + 0.4);
  own(o, [o, lp, g]);
}
function vKick(L, t, v) {
  const ctx = shared.ctx;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(105, t);
  o.frequency.setTargetAtTime(44, t, 0.035);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + 0.004);
  g.gain.setTargetAtTime(0, t + 0.01, 0.1);
  o.connect(g); g.connect(L.filt);
  o.start(t);
  o.stop(t + 0.7);
  own(o, [o, g]);
}
function vHat(L, t, v) {
  const ctx = shared.ctx;
  const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = M.hatBuf;
  bp.type = 'bandpass'; bp.frequency.value = 5200; bp.Q.value = 0.9;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.003, 0.018);
  s.connect(bp); bp.connect(g); g.connect(L.filt);
  s.start(t, Math.random() * 0.1);
  s.stop(t + 0.14);
  own(s, [s, bp, g]);
}

// --- harmony helpers ---
function noteOf(fl, deg, oct = 0) {
  const md = MODES[fl.mode], o = Math.floor(deg / 7), i = ((deg % 7) + 7) % 7;
  return fl.root + 12 * (o + oct) + md[i];
}
function padNotes(fl, c) {
  const ns = [0, 2, 4].concat(fl.sev ? [6] : []).map((k) => {
    let n = noteOf(fl, c + k, 1);
    while (n > fl.root + 23) n -= 12; // keep the pad in one warm octave band
    return n;
  });
  return ns;
}
function arpTone(fl, c, i, lift) {
  const steps = [0, 2, 4, 7, 9, 11];
  return noteOf(fl, c + steps[Math.min(i, 5)], 1 + lift);
}

// --- layers ---
function flavourFor(region, seed) {
  if (FLAVOURS[region] && region !== 'menu') return FLAVOURS[region];
  return FLAVOURS[REGION_IDS[hashStr(String(region) + ':' + seed) % REGION_IDS.length]];
}
function makeLayer(kind, fl, opt) {
  const ctx = shared.ctx, now = ctx.currentTime;
  const seed = hashStr(`${kind}|${opt.region}|${opt.seed}`);
  const rnd = rng32(seed);
  const night = !!opt.night, rain = !!opt.rain;
  let bpm = fl.bpm * (night ? 0.94 : 1) + (kind === 'race' ? Math.floor(rnd() * 5) - 2 : 0);
  const L = {
    kind, fl, rnd, night, rain, bpm,
    stepDur: 60 / bpm / 4, step: 0, next: now + 0.12, t0: now, dead: false, handed: false,
    cutMul: (night ? 0.62 : 1) * (rain ? 0.75 : 1),
    densMul: (night ? 0.75 : 1) * (rain ? 0.8 : 1),
    out: ctx.createGain(), filt: ctx.createBiquadFilter(), send: ctx.createGain(),
  };
  // per-stage variant: two progressions and an arp rotation picked from the seed
  const ps = fl.progs.slice();
  const a = Math.floor(rnd() * ps.length);
  let b = Math.floor(rnd() * (ps.length - 1));
  if (b >= a) b++;
  L.progs = [ps[a], ps[b]];
  L.arpRot = Math.floor(rnd() * ARPS.length);
  L.filt.type = 'lowpass';
  L.filt.Q.value = 0.5;
  L.filt.frequency.value = layerCut(L);
  L.out.gain.value = 0;
  L.send.gain.value = fl.send * (rain ? 1.3 : 1);
  L.filt.connect(L.out);
  L.out.connect(M.inp);
  L.out.connect(L.send);
  L.send.connect(M.dIn);
  try {
    M.delay.delayTime.setTargetAtTime(Math.min(1.2, (60 / bpm) * 0.75), now, 0.3);
  } catch (e) { /* ignore */ }
  return L;
}
function layerCut(L) {
  const i = L.kind === 'race' ? M.iSmooth : 0.3;
  return Math.max(500, Math.min(4200, L.fl.cut * L.cutMul * (0.62 + 0.55 * i)));
}
function fadeIn(L, tc = 0.45) {
  L.out.gain.setTargetAtTime(1, shared.ctx.currentTime, tc);
}
function retire(L, tc = 0.45) {
  if (L.dead) return;
  L.dead = true;
  try {
    const t = shared.ctx.currentTime;
    L.out.gain.cancelScheduledValues(t);
    L.out.gain.setValueAtTime(L.out.gain.value, t);
    L.out.gain.setTargetAtTime(0, t, tc);
  } catch (e) { /* ignore */ }
  setTimeout(() => {
    for (const x of [L.out, L.filt, L.send]) {
      try { x.disconnect(); } catch (e) { /* ignore */ }
    }
    M.layers = M.layers.filter((y) => y !== L);
  }, tc * 9 * 1000);
}
function switchTo(L, tc = 0.45) {
  for (const old of M.layers) retire(old, tc);
  M.layers.push(L);
  fadeIn(L, tc);
}

// --- per-step composition ---
function stepRace(L, s, t) {
  const fl = L.fl, st = s % 16, bar = Math.floor(s / 16), sec = Math.floor(bar / 8);
  const cyc = Math.floor(sec / PLAN.length), sp = PLAN[sec % PLAN.length];
  const prog = L.progs[sp.p], c = prog[bar % 4];
  const barDur = L.stepDur * 16;
  const I = M.iSmooth;
  if (st === 0) {
    for (const n of padNotes(fl, c)) vPad(L, t, n, sp.breakdown ? 0.05 : 0.04, barDur * 0.97);
  }
  if (sp.breakdown) {
    if (st === 0) { vBass(L, t, noteOf(fl, c, -1), 0.24, barDur * 0.9); if (bar % 2 === 0) vKick(L, t, 0.32); }
  } else {
    const bp = BASSES[sp.bass][st];
    if (bp !== null) vBass(L, t, noteOf(fl, c, -1) + bp, st === 0 ? 0.3 : 0.24, L.stepDur * 1.6);
    const kp = KICKS[sp.kick][st] || (bar % 8 === 7 && st === 14 ? 0.6 : 0);
    if (kp) vKick(L, t, 0.42 * kp);
    if (sp.hat && I > 0.25) {
      const hv = 0.05 * Math.min(1, (I - 0.25) / 0.6);
      if (st % 4 === 2) vHat(L, t, hv);
      else if (I > 0.7 && st % 2 === 1 && !L.rain) vHat(L, t, hv * 0.35);
    }
  }
  const arp = ARPS[(sp.arp + L.arpRot + cyc) % ARPS.length];
  const ai = arp[st];
  if (ai !== null) {
    if (L.rain && st % 2 === 1) return;
    const dens = fl.density * L.densMul;
    if (st % 4 === 0 || L.rnd() < dens) {
      const lift = fl.pluck === 'glass' ? 1 : 0;
      vPluck(L, t, arpTone(fl, c, ai, lift), (0.085 + 0.03 * I) * (st % 4 === 0 ? 1 : 0.8));
    }
  }
}
function stepMenu(L, s, t) {
  const fl = L.fl, st = s % 16, bar = Math.floor(s / 16);
  const prog = L.progs[Math.floor(bar / 8) % 2], c = prog[Math.floor(bar / 2) % 4];
  const barDur = L.stepDur * 16;
  if (st === 0 && bar % 2 === 0) {
    for (const n of padNotes(fl, c)) vPad(L, t, n, 0.045, barDur * 1.95);
    vBass(L, t, noteOf(fl, c, -1), 0.16, barDur * 1.8);
  }
  if (st % 2 === 0) {
    const p = st === 0 ? 0.6 : fl.density * L.densMul;
    if (L.rnd() < p) {
      const i = Math.floor(L.rnd() * 5);
      vPluck(L, t, arpTone(fl, c, i, 0), 0.06 + 0.03 * L.rnd());
    }
  }
}
function sting(L) {
  const fl = L.fl, t = shared.ctx.currentTime + 0.08;
  for (const k of [0, 2, 4, 7, 8]) vPad(L, t, noteOf(fl, k, 1), 0.045, 2.2);
  vBass(L, t, noteOf(fl, 0, -1), 0.28, 2.2);
  vKick(L, t, 0.35);
  [0, 2, 4, 7].forEach((k, j) => vPluck(L, t + 0.11 * j, noteOf(fl, k, 1), 0.09));
}

function tick() {
  try {
    const ctx = shared.ctx;
    if (!M.playing || !ctx) return;
    const now = ctx.currentTime;
    const ahead = typeof document !== 'undefined' && document.hidden ? 1.6 : 0.3;
    M.iSmooth += (M.intensity - M.iSmooth) * 0.08;
    for (const L of M.layers) {
      if (L.dead) continue;
      try { L.filt.frequency.setTargetAtTime(layerCut(L), now, 1.0); } catch (e) { /* ignore */ }
      if (L.kind === 'results') {
        if (!L.handed && now - L.t0 > 3.2) {
          L.handed = true;
          switchTo(makeLayer('menu', FLAVOURS.menu, { region: 'menu', seed: 0 }), 0.9);
        }
        continue;
      }
      if (L.next < now - 0.05) { // timer starved (background tab): skip ahead, keep the bar position
        const skip = Math.ceil((now + 0.02 - L.next) / L.stepDur);
        L.step += skip;
        L.next += skip * L.stepDur;
      }
      while (L.next < now + ahead) {
        (L.kind === 'race' ? stepRace : stepMenu)(L, L.step, L.next);
        L.step++;
        L.next += L.stepDur;
      }
    }
  } catch (e) {
    /* never break */
  }
}

function sceneKey(w) {
  return w.scene === 'race' ? `race|${w.region}|${w.night ? 1 : 0}|${w.rain ? 1 : 0}|${w.seed}` : w.scene;
}
function applyScene() {
  const w = M.want, key = sceneKey(w);
  if (key === M.key) return;
  M.key = key;
  let L;
  if (w.scene === 'race') {
    L = makeLayer('race', flavourFor(w.region, w.seed), w);
    M.lastRace = { fl: L.fl, night: w.night, rain: w.rain };
  } else if (w.scene === 'results') {
    const lr = M.lastRace || { fl: FLAVOURS.menu };
    L = makeLayer('results', lr.fl, { region: 'results', seed: 0, night: lr.night, rain: lr.rain });
    sting(L);
  } else {
    // results already drifted into the menu bed: keep it playing rather than restarting it
    if (M.layers.some((x) => !x.dead && x.kind === 'menu')) return;
    L = makeLayer('menu', FLAVOURS.menu, { region: 'menu', seed: 0 });
  }
  switchTo(L);
}

export const music = {
  // Starts the scheduler (creates the shared AudioContext if needed). Call from a user gesture.
  start() {
    try {
      const ctx = ensureShared();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
      buildMusic(ctx);
      if (M.playing) return;
      M.playing = true;
      M.key = '';
      M.timer = setInterval(tick, 100);
      applyScene();
      tick();
    } catch (e) { /* never throw */ }
  },
  stop() {
    try {
      if (!M.playing) return;
      M.playing = false;
      clearInterval(M.timer);
      M.timer = 0;
      for (const L of M.layers) retire(L, 0.35);
      M.key = '';
    } catch (e) { /* ignore */ }
  },
  // { scene: 'menu' | 'race' | 'results', region, night, rain, seed? } — identical calls are free (call every frame if you like)
  setScene(o) {
    try {
      o = o || {};
      const scene = o.scene === 'race' || o.scene === 'results' ? o.scene : 'menu';
      M.want = { scene, region: o.region == null ? null : String(o.region), night: !!o.night, rain: !!o.rain, seed: o.seed == null ? '' : String(o.seed) };
      M.shown = { scene, region: scene === 'race' ? M.want.region : scene === 'results' ? M.shown.region : null };
      if (M.playing) applyScene();
    } catch (e) { /* ignore */ }
  },
  setIntensity(x) {
    M.intensity = clamp(x, 0, 1);
  },
  duck(on) {
    if (!!on === M.ducked && M.duckSet) return; // cheap to call every frame
    M.ducked = !!on;
    if (!M.duckG) return;
    M.duckSet = true;
    try {
      const t = shared.ctx.currentTime;
      M.duckG.gain.setTargetAtTime(M.ducked ? DUCK : 1, t, 0.25);
    } catch (e) { /* ignore */ }
  },
  get info() {
    return {
      scene: M.shown.scene, region: M.shown.region, playing: M.playing, ducked: M.ducked,
      intensity: M.intensity, layers: M.layers.length, voices: M.live, created: M.created,
    };
  },
};

// Test/diagnostic handles (not part of the game API).
export const _audioDebug = {
  get ctx() { return shared.ctx; },
  get master() { return shared.master; },
  get sfxBus() { return shared.sfxBus; },
  get musicBus() { return shared.musicBus; },
};
