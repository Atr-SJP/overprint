/* OVERPRINT — shared helpers & theme */
'use strict';
(function (root) {
  const OP = (root.OP = root.OP || {});

  const U = {};
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  // frame-rate independent exponential smoothing
  U.damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
  U.easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  U.easeInCubic = t => t * t * t;
  U.easeOutQuint = t => 1 - Math.pow(1 - t, 5);
  U.easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  U.easeOutBack = (t, s = 1.70158) => {
    const c = s + 1;
    return 1 + c * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
  };
  U.easeOutElastic = t =>
    t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;

  // small, fast seeded RNG
  U.rng = seed => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  U.shuffle = (arr, rnd = Math.random) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  };

  U.hexToRgb = hex => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  U.rgba = (hex, a) => {
    const [r, g, b] = U.hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  };
  // simulate two inks overprinting (multiply)
  U.multiply = (h1, h2) => {
    const a = U.hexToRgb(h1), b = U.hexToRgb(h2);
    const m = a.map((v, i) => Math.round((v * b[i]) / 255));
    return '#' + m.map(v => v.toString(16).padStart(2, '0')).join('');
  };
  U.shade = (hex, f) => {
    const [r, g, b] = U.hexToRgb(hex);
    const s = v => Math.round(U.clamp(v * f, 0, 255)).toString(16).padStart(2, '0');
    return '#' + s(r) + s(g) + s(b);
  };

  OP.U = U;

  // Risograph-style spot inks on warm stock
  OP.THEME = {
    paper: '#EDE6D6',
    sheet: '#F7F2E7',
    key: '#25211E',
    under: '#AD9270', // kraft board showing through a die-cut
    inks: ['#FF48B0', '#0078BF', '#FFB511', '#00A95C'],
    // deeper tone of each ink, for lines & text that must stay legible
    deep: ['#D4187F', '#005A93', '#C27C00', '#00804A'],
    names: ['Pink', 'Blue', 'Yellow', 'Green'],
  };
})(typeof window !== 'undefined' ? window : globalThis);
