/* OVERPRINT — every sound is synthesised live with Web Audio. No samples. */
'use strict';
(function (root) {
  const OP = root.OP;
  const U = OP.U;
  const A = (OP.A = {});

  let ctx = null;
  let master, sfxIn, sfxWet, musicIn, verbIn, noiseBuf;
  let sfxOn = true, musicOn = true;
  let lastTick = 0;
  let musicState = 'title';

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  A.setPrefs = (sfx, music) => {
    sfxOn = sfx;
    musicOn = music;
    if (!ctx) return;
    const t = ctx.currentTime;
    sfxIn.gain.setTargetAtTime(sfxOn ? 1 : 0, t, 0.03);
    sfxWet.gain.setTargetAtTime(sfxOn ? 1 : 0, t, 0.03);
    musicIn.gain.setTargetAtTime(musicOn ? 0.44 : 0, t, 0.25);
  };
  A.prefs = () => ({ sfx: sfxOn, music: musicOn });

  A.init = () => {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -15;
    comp.knee.value = 10;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp);
    comp.connect(ctx.destination);

    // a warm, dark room
    const verb = ctx.createConvolver();
    verb.buffer = impulse(2.6, 2.8);
    verbIn = ctx.createGain();
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.36;
    verbIn.connect(verb);
    verb.connect(verbOut);
    verbOut.connect(master);

    sfxIn = ctx.createGain();
    sfxIn.gain.value = sfxOn ? 1 : 0;
    sfxIn.connect(master);
    const sfxSend = ctx.createGain();
    sfxSend.gain.value = 0.16;
    sfxIn.connect(sfxSend);
    sfxSend.connect(verbIn);
    sfxWet = ctx.createGain(); // extra reverb for bells & chimes
    sfxWet.gain.value = sfxOn ? 1 : 0;
    sfxWet.connect(verbIn);

    musicIn = ctx.createGain();
    musicIn.gain.value = 0;
    const tone = ctx.createBiquadFilter(); // soften the whole band like old tape
    tone.type = 'lowpass';
    tone.frequency.value = 3600;
    tone.Q.value = 0.4;
    musicIn.connect(tone);
    tone.connect(master);
    const musicSend = ctx.createGain();
    musicSend.gain.value = 0.42;
    tone.connect(musicSend);
    musicSend.connect(verbIn);

    noiseBuf = makeNoise(2.5);
    A.setPrefs(sfxOn, musicOn);
    startMusic();
  };

  const ready = () => ctx && ctx.state === 'running';
  const now = () => ctx.currentTime + 0.005;

  function makeNoise(sec) {
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function impulse(sec, decay) {
    const rate = ctx.sampleRate, len = Math.floor(rate * sec);
    const buf = ctx.createBuffer(2, len, rate);
    const pre = Math.floor(rate * 0.012);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / (len - pre);
        const a = 0.55 - t * 0.45; // darker as it decays
        lp += a * (Math.random() * 2 - 1 - lp);
        d[i] = lp * Math.pow(1 - t, decay) * 1.6;
      }
    }
    return buf;
  }

  /* ------------------------------------------------------- primitives */
  function osc(type, f, t, dur) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }
  function amp(t, a, peak, d) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    return g;
  }
  function filt(type, f, q = 1) {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }
  function hiss(t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.start(t, Math.random() * 2);
    s.stop(t + dur + 0.05);
    return s;
  }
  function pan(v) {
    if (!ctx.createStereoPanner) return ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = v;
    return p;
  }

  // pitched body thump (a block landing on a table)
  function thump(t, f0, f1, dur, vol, dest = sfxIn) {
    const o = osc('sine', f0, t, dur);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.55);
    const g = amp(t, 0.003, vol, dur);
    o.connect(g).connect(dest);
  }
  // band of noise
  function noiseHit(t, dur, type, f, q, vol, f2 = 0, dest = sfxIn, attack = 0.002) {
    const s = hiss(t, dur);
    const b = filt(type, f, q);
    b.frequency.setValueAtTime(f, t);
    if (f2) b.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = amp(t, attack, vol, dur);
    s.connect(b).connect(g).connect(dest);
  }

  /* ------------------------------------------------------- instruments */
  function bell(t, f, vol, dur = 1.4, dest = sfxIn, ratio = 3.5, index = 1.4) {
    const c = osc('sine', f, t, dur);
    const m = osc('sine', f * ratio, t, dur);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * index, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.04, t + dur * 0.5);
    m.connect(mg).connect(c.frequency);
    const g = amp(t, 0.002, vol, dur);
    c.connect(g);
    g.connect(dest);
    g.connect(sfxWet);
  }
  function marimba(t, f, vol, dur = 0.7, dest = sfxIn) {
    const o1 = osc('sine', f, t, dur);
    const o2 = osc('sine', f * 3.93, t, dur * 0.25);
    const g1 = amp(t, 0.002, vol, dur);
    const g2 = amp(t, 0.001, vol * 0.4, dur * 0.1);
    o1.connect(g1).connect(dest);
    o2.connect(g2).connect(dest);
    g1.connect(sfxWet);
    noiseHit(t, 0.012, 'bandpass', f * 4, 2, vol * 0.25, 0, dest);
  }
  function kalimba(t, f, vol, dur = 0.9, dest = sfxIn) {
    const o1 = osc('sine', f, t, dur);
    o1.frequency.setValueAtTime(f * 1.015, t);
    o1.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    const o2 = osc('sine', f * 5.95, t, 0.12);
    const o3 = osc('triangle', f * 2.01, t, dur * 0.4);
    const g1 = amp(t, 0.002, vol, dur);
    const g2 = amp(t, 0.001, vol * 0.3, 0.07);
    const g3 = amp(t, 0.002, vol * 0.12, dur * 0.35);
    o1.connect(g1).connect(dest);
    o2.connect(g2).connect(dest);
    o3.connect(g3).connect(dest);
    g1.connect(sfxWet);
  }
  function vibes(t, f, vol, dur = 1.6, dest = sfxIn) {
    const o1 = osc('sine', f, t, dur);
    const o2 = osc('sine', f * 4.0, t, dur * 0.3);
    const g1 = amp(t, 0.004, vol, dur);
    const g2 = amp(t, 0.002, vol * 0.22, dur * 0.2);
    // tremolo multiplies the envelope (motor-driven vibes)
    const tremG = ctx.createGain();
    tremG.gain.value = 0.75;
    const trem = osc('sine', 5.2, t, dur);
    const tg = ctx.createGain();
    tg.gain.value = 0.25;
    trem.connect(tg).connect(tremG.gain);
    o1.connect(g1).connect(tremG).connect(dest);
    tremG.connect(sfxWet);
    o2.connect(g2).connect(dest);
  }

  // each ink sings with its own instrument, always in key
  const PENTA = [0, 2, 4, 7, 9];
  const scaleNote = (idx, base) => base + PENTA[((idx % 5) + 5) % 5] + 12 * Math.floor(idx / 5);
  const VOICE = [
    { base: 72, fn: (t, f, v) => bell(t, f, v * 0.075, 1.3, sfxIn, 3.5, 1.2) },
    { base: 60, fn: (t, f, v) => marimba(t, f, v * 0.2, 0.75) },
    { base: 67, fn: (t, f, v) => kalimba(t, f, v * 0.16, 0.9) },
    { base: 64, fn: (t, f, v) => vibes(t, f, v * 0.11, 1.5) },
  ];
  const melody = [4, 4, 4, 4];
  function motif(p, size, t, vol = 1) {
    const v = VOICE[p];
    melody[p] = U.clamp(melody[p] + [-2, -1, 1, 1, 2, 0][Math.floor(Math.random() * 6)], 1, 7);
    const lo = size >= 5 ? -2 : size >= 4 ? -1 : size === 1 ? 2 : 0;
    const steps = size >= 4 ? [0, 2, 4] : size >= 2 ? [0, 2] : [0];
    steps.forEach((s, k) => v.fn(t + k * 0.058, mtof(scaleNote(melody[p] + lo + s, v.base)), k === steps.length - 1 ? 1 : 0.78));
  }
  A.note = (p, idx, t = 0, vol = 1) => {
    if (!ready()) return;
    const v = VOICE[p];
    v.fn(now() + t, mtof(scaleNote(idx, v.base)), vol);
  };

  /* ---------------------------------------------------------- effects */
  A.tick = (pitch = 1, vol = 1) => {
    if (!ready()) return;
    const t = now();
    if (t - lastTick < 0.028) return;
    lastTick = t;
    noiseHit(t, 0.022, 'bandpass', 3600 * pitch, 7, 0.12 * vol);
    const o = osc('sine', 1700 * pitch, t, 0.03);
    o.connect(amp(t, 0.001, 0.035 * vol, 0.02)).connect(sfxIn);
  };
  A.hover = () => A.tick(0.62, 0.55);

  A.pick = () => {
    if (!ready()) return;
    const t = now();
    noiseHit(t, 0.15, 'bandpass', 700, 1.1, 0.16, 3400, sfxIn, 0.03);
    const o = osc('triangle', 540, t, 0.08);
    o.frequency.exponentialRampToValueAtTime(390, t + 0.06);
    o.connect(amp(t, 0.002, 0.09, 0.07)).connect(sfxIn);
  };
  A.putBack = () => {
    if (!ready()) return;
    const t = now();
    noiseHit(t, 0.14, 'bandpass', 2600, 1.1, 0.12, 600, sfxIn, 0.02);
    thump(t + 0.05, 260, 140, 0.08, 0.12);
  };

  A.rotate = (dir = 1) => {
    if (!ready()) return;
    const t = now();
    for (let k = 0; k < 2; k++) {
      const tt = t + k * 0.024;
      noiseHit(tt, 0.016, 'bandpass', (dir > 0 ? 2500 : 2100) * (k ? 1.3 : 1), 9, 0.2);
    }
    const o = osc('sine', dir > 0 ? 820 : 720, t, 0.07);
    o.frequency.exponentialRampToValueAtTime(dir > 0 ? 1080 : 560, t + 0.06);
    o.connect(amp(t, 0.002, 0.04, 0.06)).connect(sfxIn);
  };

  A.flip = () => {
    if (!ready()) return;
    const t = now();
    const s = hiss(t, 0.2);
    const b = filt('bandpass', 700, 0.9);
    b.frequency.setValueAtTime(600, t);
    b.frequency.exponentialRampToValueAtTime(4200, t + 0.08);
    b.frequency.exponentialRampToValueAtTime(1300, t + 0.17);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    s.connect(b).connect(g).connect(sfxIn);
    noiseHit(t + 0.11, 0.02, 'bandpass', 3200, 6, 0.14);
  };

  /** A piece hits the sheet. size 1–5, over = squares overprinted. */
  A.place = (p, size, over = 0) => {
    if (!ready()) return;
    const t = now();
    const k = (size - 1) / 4;
    thump(t, 175 - k * 55, 46, 0.24 + k * 0.08, 0.5 + k * 0.18);
    const o = osc('triangle', 98 - k * 18, t, 0.09);
    o.connect(amp(t, 0.002, 0.16, 0.08)).connect(sfxIn);
    noiseHit(t, 0.06, 'bandpass', 1300, 0.7, 0.26 + k * 0.06); // paper slap
    noiseHit(t, 0.014, 'highpass', 4200, 0.7, 0.07); // crack
    noiseHit(t + 0.012, 0.13, 'lowpass', 520, 0.8, 0.1, 160); // ink squish
    motif(p, size, t + 0.02);
    if (over > 0) {
      // the press bites into someone else's ink
      const c = osc('sine', 310, t, 0.5);
      const m = osc('sine', 310 * 1.414, t, 0.5);
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(420, t);
      mg.gain.exponentialRampToValueAtTime(8, t + 0.35);
      m.connect(mg).connect(c.frequency);
      const g = amp(t, 0.002, 0.07, 0.45);
      c.connect(g);
      g.connect(sfxIn);
      g.connect(sfxWet);
      thump(t + 0.03, 120, 40, 0.3, 0.35);
      noiseHit(t + 0.02, 0.22, 'bandpass', 900, 2, 0.12, 300);
    }
  };

  A.invalid = () => {
    if (!ready()) return;
    const t = now();
    const lp = filt('lowpass', 480, 1);
    const g = amp(t, 0.004, 0.06, 0.14);
    osc('square', 96, t, 0.16).connect(lp);
    osc('square', 101.5, t, 0.16).connect(lp);
    lp.connect(g).connect(sfxIn);
    thump(t, 130, 72, 0.12, 0.15);
  };

  // collecting an Ink Drop
  A.collect = type => {
    if (!ready()) return;
    const t = now();
    const sets = [[84, 88, 91], [86, 91, 93], [88, 93, 96]];
    sets[type].forEach((m, k) => bell(t + k * 0.065, mtof(m), 0.055, 1.6, sfxIn, 3.5, 1.1));
    for (let k = 0; k < 4; k++) {
      const tt = t + 0.1 + Math.random() * 0.25;
      const o = osc('sine', 3000 + Math.random() * 3000, tt, 0.05);
      const g = amp(tt, 0.001, 0.018, 0.04);
      o.connect(g);
      g.connect(sfxWet);
    }
  };
  A.land = () => {
    if (!ready()) return;
    const t = now();
    bell(t, mtof(96), 0.03, 0.8, sfxIn, 2.7, 0.8);
    noiseHit(t, 0.02, 'bandpass', 3000, 5, 0.1);
  };

  A.arm = () => {
    if (!ready()) return;
    const t = now();
    noiseHit(t, 0.014, 'bandpass', 2400, 8, 0.22);
    noiseHit(t + 0.05, 0.016, 'bandpass', 3400, 8, 0.2);
    const o = osc('sine', 330, t, 0.2);
    o.frequency.exponentialRampToValueAtTime(660, t + 0.16);
    o.connect(amp(t, 0.01, 0.05, 0.18)).connect(sfxIn);
  };
  A.disarm = () => {
    if (!ready()) return;
    const t = now();
    noiseHit(t, 0.014, 'bandpass', 3000, 8, 0.18);
    const o = osc('sine', 600, t, 0.18);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.15);
    o.connect(amp(t, 0.01, 0.04, 0.16)).connect(sfxIn);
  };

  // someone runs out of moves: a rubber stamp and a falling minor third
  A.out = p => {
    if (!ready()) return;
    const t = now();
    thump(t, 110, 42, 0.32, 0.55);
    noiseHit(t, 0.08, 'lowpass', 900, 0.7, 0.22, 200);
    noiseHit(t, 0.03, 'bandpass', 1800, 1, 0.12);
    const v = VOICE[p];
    v.fn(t + 0.16, mtof(v.base + 3), 0.7);
    v.fn(t + 0.36, mtof(v.base), 0.8);
  };
  // printed every piece
  A.finish = p => {
    if (!ready()) return;
    const t = now();
    const v = VOICE[p];
    [0, 4, 7, 12, 16].forEach((s, k) => v.fn(t + k * 0.07, mtof(v.base + s), 0.9));
  };

  A.turn = (p, human) => {
    if (!ready()) return;
    const t = now();
    noiseHit(t, 0.16, 'bandpass', 1800, 0.8, 0.05, 900, sfxIn, 0.04);
    if (human) {
      const v = VOICE[p];
      v.fn(t + 0.02, mtof(v.base), 0.55);
      v.fn(t + 0.1, mtof(v.base + 7), 0.45);
    }
  };

  A.click = () => {
    if (!ready()) return;
    const t = now();
    thump(t, 420, 220, 0.06, 0.16);
    noiseHit(t, 0.02, 'bandpass', 2800, 3, 0.1);
  };
  A.uiHover = () => A.tick(0.8, 0.5);

  A.paper = (up = true) => {
    if (!ready()) return;
    const t = now();
    noiseHit(t, 0.26, 'bandpass', up ? 500 : 2600, 0.8, 0.12, up ? 2600 : 500, sfxIn, 0.06);
  };

  // the press: sheet feed, roller, die-cut punches
  A.feed = () => {
    if (!ready()) return;
    const t = now();
    noiseHit(t, 0.35, 'bandpass', 300, 0.9, 0.12, 1400, sfxIn, 0.08);
    thump(t + 0.32, 140, 60, 0.18, 0.35);
    noiseHit(t + 0.32, 0.04, 'bandpass', 1500, 1, 0.12);
    // roller rumble while the grid prints
    const s = hiss(t + 0.3, 0.6);
    const b = filt('lowpass', 260, 2);
    b.frequency.setValueAtTime(180, t + 0.3);
    b.frequency.linearRampToValueAtTime(380, t + 0.6);
    b.frequency.linearRampToValueAtTime(160, t + 0.88);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.42);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    s.connect(b).connect(g).connect(sfxIn);
    for (let k = 0; k < 6; k++) noiseHit(t + 0.32 + k * 0.08, 0.012, 'bandpass', 2200, 6, 0.05);
  };
  A.punch = (delay = 0) => {
    if (!ready()) return;
    const t = now() + delay;
    noiseHit(t, 0.03, 'highpass', 2200, 0.8, 0.16);
    thump(t, 260, 120, 0.07, 0.2);
  };
  A.pop = (delay = 0, pitch = 1) => {
    if (!ready()) return;
    const t = now() + delay;
    const o = osc('sine', 520 * pitch, t, 0.09);
    o.frequency.exponentialRampToValueAtTime(1100 * pitch, t + 0.06);
    o.connect(amp(t, 0.003, 0.05, 0.07)).connect(sfxIn);
  };

  // end of game
  A.replayTick = (p, k) => {
    if (!ready()) return;
    const t = now();
    const v = VOICE[p];
    v.fn(t, mtof(scaleNote(Math.min(12, 2 + Math.floor(k / 7)), v.base - 12)), 0.5);
    noiseHit(t, 0.02, 'bandpass', 1400, 1, 0.08);
  };
  A.count = k => A.tick(0.9 + Math.min(k, 40) * 0.02, 0.8);
  A.win = () => {
    if (!ready()) return;
    const t = now();
    const seq = [60, 64, 67, 72, 76, 79, 84];
    seq.forEach((m, k) => bell(t + k * 0.075, mtof(m), 0.05, 1.8, sfxIn, 3.5, 1.0));
    [48, 55, 64, 67, 72].forEach(m => {
      const o = osc('triangle', mtof(m), t + 0.5, 2.2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.03, t + 0.75);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      o.connect(g);
      g.connect(sfxIn);
      g.connect(sfxWet);
    });
    thump(t + 0.5, 90, 40, 0.5, 0.4);
    for (let k = 0; k < 10; k++) noiseHit(t + 0.5 + Math.random() * 0.8, 0.05, 'highpass', 5000, 0.7, 0.04);
  };
  A.stamp = () => {
    if (!ready()) return;
    const t = now();
    thump(t, 150, 50, 0.25, 0.5);
    noiseHit(t, 0.06, 'bandpass', 1100, 0.8, 0.2);
  };

  /* ------------------------------------------------------------ music */
  const BPM = 74;
  const BEAT = 60 / BPM;
  const BAR = BEAT * 4;
  // | Fmaj9 | Em7 | Dm9 | Cmaj9 | Fmaj9 | Em7 | Am9 | G9sus4 |
  const PROG = [
    { bass: 41, v: [57, 60, 64, 67] },
    { bass: 40, v: [55, 59, 62, 67] },
    { bass: 38, v: [53, 57, 60, 64] },
    { bass: 36, v: [52, 55, 59, 62] },
    { bass: 41, v: [57, 60, 64, 67] },
    { bass: 40, v: [55, 59, 62, 64] },
    { bass: 45, v: [55, 59, 60, 64] },
    { bass: 43, v: [53, 57, 60, 62] },
  ];
  let nextBar = 0, barIdx = 0, timer = null;

  function epiano(t, midi, vel, dur) {
    const f = mtof(midi);
    const c = osc('sine', f, t, dur);
    const m = osc('sine', f, t, dur);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 1.25 * vel, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.12, t + 1.8);
    m.connect(mg).connect(c.frequency);
    const m2 = osc('sine', f * 14, t, 0.2);
    const mg2 = ctx.createGain();
    mg2.gain.setValueAtTime(f * 0.7 * vel, t);
    mg2.gain.exponentialRampToValueAtTime(1, t + 0.07);
    m2.connect(mg2).connect(c.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.085 * vel, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.03 * vel, t + 1.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pn = pan((Math.random() - 0.5) * 0.5);
    c.connect(g).connect(pn).connect(musicIn);
  }
  function bassNote(t, midi, vel, dur) {
    const f = mtof(midi);
    const lp = filt('lowpass', 380, 0.8);
    osc('triangle', f, t, dur).connect(lp);
    osc('sine', f, t, dur).connect(lp);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2 * vel, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.08 * vel, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g).connect(musicIn);
  }
  function kick(t, vel) {
    thump(t, 105, 44, 0.28, 0.32 * vel, musicIn);
  }
  function brush(t, vel) {
    noiseHit(t, 0.2, 'bandpass', 2400, 0.6, 0.045 * vel, 1600, musicIn, 0.006);
  }
  function shaker(t, vel) {
    noiseHit(t, 0.045, 'highpass', 6800, 0.7, 0.03 * vel, 0, musicIn, 0.006);
  }

  function scheduleBar(i, t) {
    if (!musicOn) return;
    const ch = PROG[i % PROG.length];
    const full = musicState === 'game';
    // chord, gently strummed
    ch.v.forEach((m, k) => epiano(t + k * 0.014 + Math.random() * 0.006, m, 0.85 + Math.random() * 0.15, BAR * 0.98));
    if (i % 2 === 1) epiano(t + BEAT * 2.5, ch.v[3] + 12, 0.45, BEAT * 1.4);
    bassNote(t, ch.bass, 1, BEAT * 1.6);
    bassNote(t + BEAT * 2.5, ch.bass + (i % 4 === 3 ? 7 : 0), 0.75, BEAT * 1.2);
    if (!full) return;
    const swing = BEAT * 0.09;
    kick(t, 1);
    kick(t + BEAT * 2.5, 0.7);
    brush(t + BEAT, 1);
    brush(t + BEAT * 3, 1);
    for (let e = 0; e < 8; e++) shaker(t + e * (BEAT / 2) + (e % 2 ? swing : 0), e % 2 ? 1 : 0.55);
  }

  function sched() {
    if (!ctx) return;
    if (nextBar < ctx.currentTime - 0.1) nextBar = ctx.currentTime + 0.08;
    while (nextBar < ctx.currentTime + 0.4) {
      scheduleBar(barIdx, nextBar);
      nextBar += BAR;
      barIdx++;
    }
  }
  function startMusic() {
    nextBar = ctx.currentTime + 0.2;
    barIdx = 0;
    timer = setInterval(sched, 80);
    sched();
  }
  A.setMusicState = s => {
    musicState = s;
  };

  // go quiet while the tab is hidden
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });
})(window);
