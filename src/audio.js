/**
 * Procedural WebAudio soundscape for the Backrooms.
 * Everything is synthesised at runtime: fluorescent hum, room tone, carpet
 * footsteps, distant entity thuds, tape glitches, heartbeat and the scream.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ready = false;
    this.muted = false;
    this.noiseBuffer = null;
    this.threat = 0;
    this.heartTimer = 0;
    this.creakTimer = 8;
    this.humGain = null;
    this.droneGain = null;
    this.droneFilter = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    try {
      this.ctx = new AC();
    } catch (err) {
      return;
    }

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.0;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 20;
    comp.ratio.value = 4;
    comp.attack.value = 0.006;
    comp.release.value = 0.22;

    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.noiseBuffer = this.makeNoise(4);
    this.buildAmbience();
    this.ready = true;
  }

  resume() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  start() {
    if (!this.ready) return;
    this.resume();
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, t, 0.6);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.03);
    }
    return this.muted;
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = last * 0.86 + white * 0.14;
        d[i] = last * 3.2 + white * 0.18;
      }
    }
    return buf;
  }

  noiseSource(duration, loop = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = loop;
    const offset = Math.random() * Math.max(0.01, this.noiseBuffer.duration - duration - 0.05);
    src.start(0, offset);
    if (!loop) src.stop(this.ctx.currentTime + duration + 0.05);
    return src;
  }

  stereo(pan = 0) {
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (p) p.pan.value = Math.max(-1, Math.min(1, pan));
    return p;
  }

  route(node, pan = 0) {
    const p = this.stereo(pan);
    if (p) {
      node.connect(p);
      p.connect(this.master);
    } else {
      node.connect(this.master);
    }
    return node;
  }

  envelope(peak, attack, decay, t0 = this.ctx.currentTime) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    return g;
  }

  buildAmbience() {
    const ctx = this.ctx;

    const amb = ctx.createGain();
    amb.gain.value = 0.9;
    amb.connect(this.master);

    // 60 Hz mains + 120 Hz fluorescent ballast buzz
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0.5;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 520;
    this.humGain.connect(humFilter);
    humFilter.connect(amb);

    const hum1 = ctx.createOscillator();
    hum1.type = 'sawtooth';
    hum1.frequency.value = 120;
    const hum1g = ctx.createGain();
    hum1g.gain.value = 0.010;
    hum1.connect(hum1g);
    hum1g.connect(this.humGain);
    hum1.start();

    const hum2 = ctx.createOscillator();
    hum2.type = 'sine';
    hum2.frequency.value = 60;
    const hum2g = ctx.createGain();
    hum2g.gain.value = 0.020;
    hum2.connect(hum2g);
    hum2g.connect(this.humGain);
    hum2.start();

    const hum3 = ctx.createOscillator();
    hum3.type = 'triangle';
    hum3.frequency.value = 241;
    const hum3g = ctx.createGain();
    hum3g.gain.value = 0.0035;
    hum3.connect(hum3g);
    hum3g.connect(this.humGain);
    hum3.start();

    // slow ballast wobble
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.17;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.18;
    lfo.connect(lfoGain);
    lfoGain.connect(this.humGain.gain);
    lfo.start();

    const electrical = ctx.createOscillator();
    electrical.type = 'square';
    electrical.frequency.value = 120;
    const elg = ctx.createGain();
    elg.gain.value = 0.0018;
    electrical.connect(elg);
    elg.connect(this.humGain);
    electrical.start();

    // room tone: filtered noise
    const room = this.noiseSource(4, true);
    const roomFilter = ctx.createBiquadFilter();
    roomFilter.type = 'lowpass';
    roomFilter.frequency.value = 420;
    roomFilter.Q.value = 0.4;
    const roomGain = ctx.createGain();
    roomGain.gain.value = 0.024;
    room.connect(roomFilter);
    roomFilter.connect(roomGain);
    roomGain.connect(amb);

    // faint air hiss
    const hiss = this.noiseSource(4, true);
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.frequency.value = 1800;
    hissFilter.Q.value = 0.55;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.006;
    hiss.connect(hissFilter);
    hissFilter.connect(hissGain);
    hissGain.connect(amb);

    // sub drone that swells as the entity gets closer
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 190;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.0;
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.master);

    const d1 = ctx.createOscillator();
    d1.type = 'sine';
    d1.frequency.value = 41.2;
    const d1g = ctx.createGain();
    d1g.gain.value = 0.6;
    d1.connect(d1g);
    d1g.connect(this.droneFilter);
    d1.start();

    const d2 = ctx.createOscillator();
    d2.type = 'sine';
    d2.frequency.value = 58.7;
    const d2g = ctx.createGain();
    d2g.gain.value = 0.42;
    d2.connect(d2g);
    d2g.connect(this.droneFilter);
    d2.start();

    const d3 = ctx.createOscillator();
    d3.type = 'triangle';
    d3.frequency.value = 87.3;
    const d3g = ctx.createGain();
    d3g.gain.value = 0.16;
    d3.connect(d3g);
    d3g.connect(this.droneFilter);
    d3.start();
  }

  /* ------------------------------------------------------------------ */
  /* continuous state                                                    */
  /* ------------------------------------------------------------------ */

  setThreat(proximity, hunting = false) {
    this.threat = Math.max(0, Math.min(1, proximity));
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const target = this.threat * (hunting ? 0.18 : 0.1);
    this.droneGain.gain.setTargetAtTime(target, now, 0.3);
    this.droneFilter.frequency.setTargetAtTime(170 + this.threat * 130, now, 0.4);
  }

  update(dt, state = {}) {
    if (!this.ready) return;
    const threat = state.threat || 0;
    const active = state.active !== false;

    if (active && threat > 0.28) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.heartTimer = Math.max(0.34, 1.05 - threat * 0.55);
        this.heartbeat(0.035 + threat * 0.085);
      }
    } else {
      this.heartTimer = Math.min(this.heartTimer, 0.5);
    }

    if (active) {
      this.creakTimer -= dt;
      if (this.creakTimer <= 0) {
        this.creakTimer = 11 + Math.random() * 19;
        this.creak();
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* one-shots                                                           */
  /* ------------------------------------------------------------------ */

  footstep(running = false) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const vol = running ? 0.085 : 0.055;

    const src = this.noiseSource(0.16);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 420 + Math.random() * 220;
    filt.Q.value = 0.7;
    const g = this.envelope(vol, 0.006, 0.13, t);
    src.connect(filt);
    filt.connect(g);
    this.route(g, (Math.random() - 0.5) * 0.28);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(105, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.1);
    const og = this.envelope(vol * 0.85, 0.004, 0.1, t);
    osc.connect(og);
    this.route(og, 0);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  heartbeat(vol = 0.07) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const at = t + i * 0.19;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(i === 0 ? 58 : 48, at);
      osc.frequency.exponentialRampToValueAtTime(32, at + 0.14);
      const g = this.envelope(vol * (i === 0 ? 1 : 0.66), 0.008, 0.16, at);
      osc.connect(g);
      this.route(g, 0);
      osc.start(at);
      osc.stop(at + 0.24);
    }
  }

  zoom(on = true) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(on ? 340 : 900, t);
    osc.frequency.exponentialRampToValueAtTime(on ? 900 : 300, t + 0.13);
    const g = this.envelope(0.018, 0.01, 0.12, t);
    osc.connect(g);
    this.route(g, 0);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  entityStep(volume = 0.4, pan = 0, hunting = false) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const v = Math.max(0.008, Math.min(0.2, volume * (hunting ? 0.16 : 0.1)));

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(64, t);
    osc.frequency.exponentialRampToValueAtTime(34, t + 0.18);
    const g = this.envelope(v, 0.006, 0.17, t);
    osc.connect(g);
    this.route(g, pan);
    osc.start(t);
    osc.stop(t + 0.24);

    const src = this.noiseSource(0.12);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 240;
    const ng = this.envelope(v * 0.5, 0.004, 0.1, t);
    src.connect(filt);
    filt.connect(ng);
    this.route(ng, pan);
  }

  entitySpawn(distance = 20) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const near = Math.max(0.15, Math.min(1, 1 - distance / 34));

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(96, t);
    osc.frequency.exponentialRampToValueAtTime(27, t + 1.5);
    const g = this.envelope(0.09 * near, 0.12, 1.5, t);
    osc.connect(g);
    this.route(g, 0);
    osc.start(t);
    osc.stop(t + 1.8);

    const src = this.noiseSource(1.3);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(900, t);
    filt.frequency.exponentialRampToValueAtTime(180, t + 1.2);
    filt.Q.value = 0.8;
    const ng = this.envelope(0.045 * near, 0.3, 1.0, t);
    src.connect(filt);
    filt.connect(ng);
    this.route(ng, 0.2);
  }

  entityVanish() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this.noiseSource(0.4);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(2600, t);
    filt.frequency.exponentialRampToValueAtTime(260, t + 0.32);
    filt.Q.value = 1.4;
    const g = this.envelope(0.075, 0.01, 0.3, t);
    src.connect(filt);
    filt.connect(g);
    this.route(g, (Math.random() - 0.5) * 1.2);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.22);
    const og = this.envelope(0.035, 0.005, 0.2, t);
    osc.connect(og);
    this.route(og, 0);
    osc.start(t);
    osc.stop(t + 0.28);
  }

  entityGlitch() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const at = t + i * 0.065 + Math.random() * 0.02;
      const src = this.noiseSource(0.09);
      const filt = ctx.createBiquadFilter();
      filt.type = 'highpass';
      filt.frequency.value = 900 + Math.random() * 2200;
      const g = this.envelope(0.028 + Math.random() * 0.03, 0.004, 0.06, at);
      src.connect(filt);
      filt.connect(g);
      this.route(g, i % 2 ? 0.7 : -0.7);
    }
  }

  sting() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const f of [196, 207.6, 293.7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = this.envelope(0.028, 0.05, 1.6, t);
      osc.connect(g);
      this.route(g, 0);
      osc.start(t);
      osc.stop(t + 1.8);
    }
    const src = this.noiseSource(1.4);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 3200;
    filt.Q.value = 1.8;
    const ng = this.envelope(0.018, 0.2, 1.1, t);
    src.connect(filt);
    filt.connect(ng);
    this.route(ng, 0);
  }

  scream() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 4.5);
    }
    shaper.curve = curve;
    const out = this.envelope(0.4, 0.015, 1.4, t);
    shaper.connect(out);
    this.route(out, 0);

    for (const [type, f0, f1, gain] of [
      ['sawtooth', 240, 62, 0.16],
      ['sawtooth', 247, 65, 0.12],
      ['square', 121, 41, 0.07],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + 1.15);
      const g = ctx.createGain();
      g.gain.value = gain;
      osc.connect(g);
      g.connect(shaper);
      osc.start(t);
      osc.stop(t + 1.5);
    }

    const src = this.noiseSource(1.3);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(2200, t);
    filt.frequency.exponentialRampToValueAtTime(420, t + 1.1);
    filt.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.value = 0.32;
    src.connect(filt);
    filt.connect(ng);
    ng.connect(shaper);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(52, t);
    sub.frequency.exponentialRampToValueAtTime(24, t + 0.9);
    const sg = this.envelope(0.3, 0.01, 0.8, t);
    sub.connect(sg);
    this.route(sg, 0);
    sub.start(t);
    sub.stop(t + 1);
  }

  creak() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this.noiseSource(0.8);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(300 + Math.random() * 500, t);
    filt.frequency.exponentialRampToValueAtTime(130 + Math.random() * 240, t + 0.7);
    filt.Q.value = 5;
    const g = this.envelope(0.012 + Math.random() * 0.018, 0.18, 0.55, t);
    src.connect(filt);
    filt.connect(g);
    this.route(g, (Math.random() - 0.5) * 1.5);
  }

  uiClick() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1250;
    const g = this.envelope(0.014, 0.002, 0.035, t);
    osc.connect(g);
    this.route(g, 0);
    osc.start(t);
    osc.stop(t + 0.06);
  }
}
