// Dustline — fully procedural WebAudio sound (no assets, no dependencies).
//
// Graph (built lazily on first resume()):
//
//   saw A ─┐
//   saw B ─┼─> amGain ─> shaper ─> lowpass ─> engineGain ─┐
//   sub   ─┘     ^ (LFO at half firing rate)              │
//                                                         ├─> master ─> compressor ─> destination
//   noise ─> bandpass ─> lowpass ─> gravelGain ───────────┤
//   noise ─> bandpass (resonant) ─> slideGain ────────────┤
//   impacts / beeps (one-shot nodes) ─────────────────────┘

const MASTER_LEVEL = 0.35;

function clamp(v, lo, hi) {
  v = Number(v);
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

function makeShaperCurve(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // Soft asymmetric clip: a little even-harmonic rasp.
    curve[i] = Math.tanh(k * x + 0.15 * x * x) / Math.tanh(k + 0.15);
  }
  return curve;
}

export class Sound {
  constructor() {
    this.muted = false;
    this.ctx = null;
    this._failed = false;
    this._lastImpactTime = -1;
    this._lastImpactStrength = 0;
  }

  resume() {
    try {
      if (!this.ctx) {
        if (this._failed) return;
        const AC =
          typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) {
          this._failed = true;
          return;
        }
        this.ctx = new AC();
        this._build();
      }
      if (this.ctx.state === 'suspended') {
        const p = this.ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch (e) {
      // Never throw from a user gesture handler.
      if (!this.ctx) this._failed = true;
    }
  }

  setMuted(m) {
    this.muted = !!m;
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const g = this.master.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.setTargetAtTime(this.muted ? 0 : MASTER_LEVEL, t, 0.08);
    } catch (e) {
      /* ignore */
    }
  }

  _build() {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // --- Output chain ---
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.2;
    this.comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_LEVEL, t, 0.1);
    this.master.connect(this.comp);

    // --- Engine ---
    const f0 = 55;
    this.oscA = ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscA.frequency.value = f0;
    this.oscB = ctx.createOscillator();
    this.oscB.type = 'sawtooth';
    this.oscB.frequency.value = f0;
    this.oscB.detune.value = 11; // cents, slow beating = raspy
    this.oscSub = ctx.createOscillator();
    this.oscSub.type = 'square';
    this.oscSub.frequency.value = f0 * 0.5;

    const gA = ctx.createGain();
    gA.gain.value = 0.4;
    const gB = ctx.createGain();
    gB.gain.value = 0.32;
    const gSub = ctx.createGain();
    gSub.gain.value = 0.22;

    this.amGain = ctx.createGain();
    this.amGain.gain.value = 1;
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'triangle';
    this.lfo.frequency.value = f0 * 0.5;
    this.amDepth = ctx.createGain();
    this.amDepth.gain.value = 0.25;
    this.lfo.connect(this.amDepth);
    this.amDepth.connect(this.amGain.gain);

    this.oscA.connect(gA);
    this.oscB.connect(gB);
    this.oscSub.connect(gSub);
    gA.connect(this.amGain);
    gB.connect(this.amGain);
    gSub.connect(this.amGain);

    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = makeShaperCurve(2.2);
    this.shaper.oversample = '2x';

    this.engineLP = ctx.createBiquadFilter();
    this.engineLP.type = 'lowpass';
    this.engineLP.frequency.value = 500;
    this.engineLP.Q.value = 0.9;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;

    this.amGain.connect(this.shaper);
    this.shaper.connect(this.engineLP);
    this.engineLP.connect(this.engineGain);
    this.engineGain.connect(this.master);

    // --- Noise buffer (2 s white, looped) ---
    const len = Math.floor(ctx.sampleRate * 2);
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Gravel / surface rumble
    this.gravelSrc = ctx.createBufferSource();
    this.gravelSrc.buffer = this.noiseBuf;
    this.gravelSrc.loop = true;
    this.gravelBP = ctx.createBiquadFilter();
    this.gravelBP.type = 'bandpass';
    this.gravelBP.frequency.value = 600;
    this.gravelBP.Q.value = 0.7;
    this.gravelLP = ctx.createBiquadFilter();
    this.gravelLP.type = 'lowpass';
    this.gravelLP.frequency.value = 1800;
    this.gravelGain = ctx.createGain();
    this.gravelGain.gain.value = 0;
    this.gravelSrc.connect(this.gravelBP);
    this.gravelBP.connect(this.gravelLP);
    this.gravelLP.connect(this.gravelGain);
    this.gravelGain.connect(this.master);

    // Tyre slide scrub
    this.slideSrc = ctx.createBufferSource();
    this.slideSrc.buffer = this.noiseBuf;
    this.slideSrc.loop = true;
    this.slideSrc.playbackRate.value = 0.93; // decorrelate from gravel path
    this.slideBP = ctx.createBiquadFilter();
    this.slideBP.type = 'bandpass';
    this.slideBP.frequency.value = 1500;
    this.slideBP.Q.value = 2.2;
    this.slideGain = ctx.createGain();
    this.slideGain.gain.value = 0;
    this.slideSrc.connect(this.slideBP);
    this.slideBP.connect(this.slideGain);
    this.slideGain.connect(this.master);

    // Start everything; levels stay at zero until update() says otherwise.
    this.oscA.start(t);
    this.oscB.start(t);
    this.oscSub.start(t);
    this.lfo.start(t);
    this.gravelSrc.start(t, 0);
    this.slideSrc.start(t, 0.97);
  }

  update(dt, s) {
    if (!this.ctx || !this.engineGain) return;
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

      // --- Engine ---
      const f = 55 + rpm * 205;
      const tcPitch = 0.04;
      this.oscA.frequency.setTargetAtTime(f, t, tcPitch);
      this.oscB.frequency.setTargetAtTime(f * 1.004, t, tcPitch);
      this.oscSub.frequency.setTargetAtTime(f * 0.5, t, tcPitch);
      this.lfo.frequency.setTargetAtTime(f * 0.5, t, tcPitch);

      // Off throttle: more burble (deeper AM), darker, quieter.
      this.amDepth.gain.setTargetAtTime(0.14 + (1 - thr) * 0.26, t, 0.08);
      const cutoff = 380 + rpm * 1300 + thr * 1700;
      this.engineLP.frequency.setTargetAtTime(cutoff, t, 0.06);
      this.engineLP.Q.setTargetAtTime(0.8 + thr * 1.2, t, 0.1);

      const engLevel = active ? 0.16 + rpm * 0.12 + thr * 0.22 : 0;
      this.engineGain.gain.setTargetAtTime(engLevel, t, active ? 0.06 : 0.25);

      // --- Gravel ---
      const sp = Math.min(speed / 40, 1);
      let gravel = 0;
      if (active && grounded) gravel = Math.pow(sp, 0.8) * (0.22 + off * 0.3);
      this.gravelGain.gain.setTargetAtTime(gravel, t, grounded ? 0.08 : 0.05);
      this.gravelBP.frequency.setTargetAtTime(420 + sp * 600 + off * 900, t, 0.1);
      this.gravelLP.frequency.setTargetAtTime(1400 + off * 2400, t, 0.1);

      // --- Slide scrub ---
      const sl = clamp((slip - 2) / 8, 0, 1);
      let slide = 0;
      if (active && grounded) slide = sl * sl * (3 - 2 * sl) * (0.26 + off * 0.08) * Math.min(1, speed / 6 + 0.2);
      this.slideGain.gain.setTargetAtTime(slide, t, 0.07);
      this.slideBP.frequency.setTargetAtTime(1300 + sl * 900 - off * 300, t, 0.12);
    } catch (e) {
      /* never break the game loop */
    }
  }

  impact(strength) {
    if (!this.ctx || !this.master) return;
    try {
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const st = clamp(strength, 0, 25);
      if (st < 0.5) return;
      // Rate-limit: don't stack many hits within a few frames unless stronger.
      if (t - this._lastImpactTime < 0.08 && st <= this._lastImpactStrength) return;
      this._lastImpactTime = t;
      this._lastImpactStrength = st;
      const k = Math.min(st / 20, 1);
      const amp = 0.25 + k * 0.75;

      // Low thud
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(95 + k * 30, t);
      o.frequency.setTargetAtTime(42, t, 0.06);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(0.9 * amp, t + 0.006);
      og.gain.setTargetAtTime(0, t + 0.01, 0.07 + k * 0.08);
      o.connect(og);
      og.connect(this.master);
      o.start(t);
      o.stop(t + 0.8);

      // Noise crunch
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900 + k * 2600, t);
      lp.frequency.setTargetAtTime(300, t, 0.1);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(0.55 * amp, t + 0.004);
      ng.gain.setTargetAtTime(0, t + 0.01, 0.05 + k * 0.07);
      n.connect(lp);
      lp.connect(ng);
      ng.connect(this.master);
      n.start(t, Math.random() * 1.5);
      n.stop(t + 0.8);
    } catch (e) {
      /* ignore */
    }
  }

  beep(freq = 440, dur = 0.12) {
    if (!this.ctx || !this.master) return;
    try {
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const f = clamp(freq, 40, 8000);
      const d = clamp(dur, 0.02, 3);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.008);
      g.gain.setValueAtTime(0.5, t + Math.max(0.01, d - 0.03));
      g.gain.setTargetAtTime(0, t + Math.max(0.01, d - 0.03), 0.02);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + d + 0.2);
    } catch (e) {
      /* ignore */
    }
  }
}
