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
//   master (0.3, mute) ─> high-shelf −6 dB @3.2 kHz ─> lowpass 7 kHz ─> compressor ─> destination <┘

const MASTER_LEVEL = 0.3;

// Module-level shared state.
const shared = {
  ctx: null,
  failed: false,
  muted: false,
  master: null,
  noiseBuf: null,
  wave: null,
};

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

    // --- Instance output: gain → panner → shared master ---
    this.out = ctx.createGain();
    this.out.gain.value = this._gain;
    let tail = this.out;
    if (typeof ctx.createStereoPanner === 'function') {
      this.panner = ctx.createStereoPanner();
      this.panner.pan.value = this._pan;
      this.out.connect(this.panner);
      tail = this.panner;
    }
    tail.connect(shared.master);

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
