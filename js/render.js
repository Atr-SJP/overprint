/* OVERPRINT — canvas renderer. Risograph look: spot inks, paper tooth, halftones, misregistered key plate. */
'use strict';
(function (root) {
  const OP = root.OP;
  const { U, THEME, PIECES, E } = OP;
  const N = E.N;

  const R = (OP.R = {});
  let cv, ctx;
  let dpr = 1, W = 0, H = 0;
  let L = null;

  const pats = new Map();
  const outlineCache = new Map();
  let paperTile, sheetTile, grainTile;
  let paperPat, sheetPat;
  let bgCanvas, paperCanvas, sheetCanvas, gridCanvas, inkCanvas, inkCtx;
  let titleCanvas;
  let layoutVersion = 0;

  const KEY = THEME.key;
  const INK = THEME.inks;
  const DEEP = THEME.deep;
  // each ink as it lands on the stock: used where the ink must be opaque (lifted pieces)
  const INKP = INK.map(c => U.multiply(c, THEME.paper));

  /* ------------------------------------------------------------ icons */
  // filled glyphs on a 24-unit grid, shared with the DOM (see game.js)
  R.ICON = [
    'M2.5 2.5h12.5v12.5H2.5z M9 9h12.5v12.5H9z', // overprint: two plates, overlap knocked out
    'M1.5 5.5h9.5v13H1.5z M13 5.5h9.5v13H13z M11 9.5h2v5h-2z', // bleed: two blocks fused at the side
    'M21.5 2.5v10L17.8 8.8 6.7 19.9 4.1 17.3 15.2 6.2 11.5 2.5z', // offset: jump anywhere
  ];
  const ICON_PATHS = R.ICON.map(d => (typeof Path2D !== 'undefined' ? new Path2D(d) : null));

  /* --------------------------------------------------------- textures */
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  function seeded(seed) {
    let s = seed;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  function makePaperTile(size, base, grain, fibres, seed) {
    const c = makeCanvas(size, size), x = c.getContext('2d');
    const rnd = seeded(seed);
    x.fillStyle = base;
    x.fillRect(0, 0, size, size);
    const img = x.getImageData(0, 0, size, size), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * grain;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n * 0.85;
    }
    x.putImageData(img, 0, 0);
    x.lineCap = 'round';
    for (let k = 0; k < fibres; k++) {
      const px = rnd() * size, py = rnd() * size, len = 3 + rnd() * 12, a = rnd() * Math.PI * 2;
      const dark = rnd() < 0.5;
      x.strokeStyle = dark ? 'rgba(96,74,50,0.075)' : 'rgba(255,255,255,0.22)';
      x.lineWidth = 0.5 + rnd() * 0.7;
      const ex = Math.cos(a) * len, ey = Math.sin(a) * len;
      const qx = Math.cos(a + 0.7) * len * 0.5, qy = Math.sin(a + 0.7) * len * 0.5;
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          const sx = px + ox, sy = py + oy;
          if (sx + 20 < 0 || sy + 20 < 0 || sx - 20 > size || sy - 20 > size) continue;
          x.beginPath();
          x.moveTo(sx, sy);
          x.quadraticCurveTo(sx + qx, sy + qy, sx + ex, sy + ey);
          x.stroke();
        }
      }
    }
    return c;
  }

  // alpha mask of where ink failed to transfer: soft mottling + pin-prick specks
  function makeGrainTile(size, seed) {
    const rnd = seeded(seed);
    const c = makeCanvas(size, size), x = c.getContext('2d');
    const m = makeCanvas(18, 18), mx = m.getContext('2d');
    const img = mx.createImageData(18, 18);
    for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] = rnd() * 40;
    mx.putImageData(img, 0, 0);
    const m3 = makeCanvas(54, 54), m3x = m3.getContext('2d');
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) m3x.drawImage(m, a * 18, b * 18);
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(m3, -size, -size, size * 3, size * 3);
    for (let k = 0; k < size * size * 0.0045; k++) {
      x.fillStyle = `rgba(0,0,0,${0.3 + rnd() * 0.65})`;
      x.beginPath();
      x.arc(rnd() * size, rnd() * size, 0.35 + rnd() * 0.85, 0, Math.PI * 2);
      x.fill();
    }
    return c;
  }

  function patternOf(tile) {
    const p = ctx.createPattern(tile, 'repeat');
    if (p.setTransform) p.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, 0, 0]));
    return p;
  }

  // 45° halftone screen. cover = ink coverage 0..1, pitch = dot spacing in css px
  function halftone(color, cover, pitch) {
    const key = color + '|' + cover.toFixed(2) + '|' + pitch + '|' + dpr;
    let p = pats.get(key);
    if (p) return p;
    const T = Math.max(3, Math.round(pitch * Math.SQRT2 * dpr));
    const c = makeCanvas(T, T), x = c.getContext('2d');
    const r = T * Math.sqrt(cover / (2 * Math.PI));
    x.fillStyle = color;
    for (const [px, py] of [[0, 0], [T, 0], [0, T], [T, T], [T / 2, T / 2]]) {
      x.beginPath();
      x.arc(px, py, r, 0, Math.PI * 2);
      x.fill();
    }
    p = patternOf(c);
    pats.set(key, p);
    return p;
  }

  function hatch(color, pitch, width) {
    const key = 'h|' + color + '|' + pitch + '|' + width + '|' + dpr;
    let p = pats.get(key);
    if (p) return p;
    const T = Math.max(3, Math.round(pitch * dpr));
    const c = makeCanvas(T, T), x = c.getContext('2d');
    x.strokeStyle = color;
    x.lineWidth = width * dpr;
    x.lineCap = 'square';
    for (const o of [-T, 0, T]) {
      x.beginPath();
      x.moveTo(o, T);
      x.lineTo(o + T, 0);
      x.stroke();
    }
    p = patternOf(c);
    pats.set(key, p);
    return p;
  }

  /** Data URLs so the DOM layer can share the same paper, speckle and screens. */
  R.cssTextures = () => {
    const out = {};
    out.paper = makePaperTile(360, THEME.paper, 15, 260, 7).toDataURL('image/png');
    out.sheet = makePaperTile(360, THEME.sheet, 10, 220, 31).toDataURL('image/png');
    // speckle mask: opaque with pin-pricks knocked out (use as mask-image on inked DOM shapes)
    const s = 200, c = makeCanvas(s, s), x = c.getContext('2d');
    x.fillStyle = '#000';
    x.fillRect(0, 0, s, s);
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(makeGrainTile(s, 99), 0, 0);
    out.speckle = c.toDataURL('image/png');
    const dots = (color, cover, pitch) => {
      const T = Math.max(3, Math.round(pitch * Math.SQRT2 * 2));
      const d = makeCanvas(T, T), dx = d.getContext('2d');
      const r = T * Math.sqrt(cover / (2 * Math.PI));
      dx.fillStyle = color;
      for (const [px, py] of [[0, 0], [T, 0], [0, T], [T, T], [T / 2, T / 2]]) {
        dx.beginPath();
        dx.arc(px, py, r, 0, Math.PI * 2);
        dx.fill();
      }
      return { url: d.toDataURL('image/png'), size: T / 2 };
    };
    out.dotsKey = dots(KEY, 0.42, 3.4);
    out.dotsLight = dots(KEY, 0.13, 3.4);
    out.dotsInk = INK.map(ink => dots(ink, 0.5, 3.4));
    // CPU seats are screened: the stronger the CPU, the denser the screen
    out.dotsLevels = INK.map(ink => [0.18, 0.4, 0.66].map(cover => dots(ink, cover, 3.4)));
    return out;
  };

  function makeTextures() {
    paperTile = makePaperTile(512, THEME.paper, 15, 380, 11);
    sheetTile = makePaperTile(512, THEME.sheet, 10, 300, 23);
    grainTile = makeGrainTile(512, 5);
  }

  /* ---------------------------------------------------------- outline */
  const outlineByArray = new WeakMap(); // fast path: same array, same outline, no string building
  function outlineOf(cells) {
    let o = outlineByArray.get(cells);
    if (o) return o;
    const key = cells.map(c => c[0] + ',' + c[1]).join(';');
    o = outlineCache.get(key);
    if (o) {
      outlineByArray.set(cells, o);
      return o;
    }
    const set = new Set(cells.map(([r, c]) => r * 1000 + c));
    const has = (r, c) => set.has(r * 1000 + c);
    const edges = new Map();
    const add = (x1, y1, x2, y2) => {
      const k = x1 + ',' + y1;
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push([x2, y2]);
    };
    for (const [r, c] of cells) {
      if (!has(r - 1, c)) add(c, r, c + 1, r);
      if (!has(r, c + 1)) add(c + 1, r, c + 1, r + 1);
      if (!has(r + 1, c)) add(c + 1, r + 1, c, r + 1);
      if (!has(r, c - 1)) add(c, r + 1, c, r);
    }
    const loops = [];
    while (edges.size) {
      const startKey = edges.keys().next().value;
      const pts = [];
      let k = startKey;
      let guard = 0;
      while (edges.has(k) && guard++ < 400) {
        const list = edges.get(k);
        const nx = list.pop();
        if (!list.length) edges.delete(k);
        pts.push(k.split(',').map(Number));
        k = nx[0] + ',' + nx[1];
      }
      // drop collinear points
      const simp = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
        if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) simp.push(b);
      }
      loops.push(simp.length ? simp : pts);
    }
    const seams = [];
    for (const [r, c] of cells) {
      if (has(r, c + 1)) seams.push([c + 1, r, c + 1, r + 1]);
      if (has(r + 1, c)) seams.push([c, r + 1, c + 1, r + 1]);
    }
    o = { loops, seams };
    outlineCache.set(key, o);
    outlineByArray.set(cells, o);
    return o;
  }

  function normCells(abs) {
    let minR = 99, minC = 99;
    const rc = abs.map(i => [(i / N) | 0, i % N]);
    for (const [r, c] of rc) {
      if (r < minR) minR = r;
      if (c < minC) minC = c;
    }
    return { cells: rc.map(([r, c]) => [r - minR, c - minC]).sort((a, b) => a[0] - b[0] || a[1] - b[1]), r0: minR, c0: minC };
  }
  R.normCells = normCells;

  function loopsPath(x, loops, ox, oy, cs) {
    x.beginPath();
    for (const lp of loops) {
      x.moveTo(ox + lp[0][0] * cs, oy + lp[0][1] * cs);
      for (let i = 1; i < lp.length; i++) x.lineTo(ox + lp[i][0] * cs, oy + lp[i][1] * cs);
      x.closePath();
    }
  }

  function seamsPath(x, seams, ox, oy, cs) {
    x.beginPath();
    for (const s of seams) {
      x.moveTo(ox + s[0] * cs, oy + s[1] * cs);
      x.lineTo(ox + s[2] * cs, oy + s[3] * cs);
    }
  }

  const lineW = cs => Math.max(1.15, cs * 0.052);

  /**
   * Draw a piece. mode: solid | screen | dead | blind
   * reg: misregistration of the key plate (css px)
   */
  function drawPiece(x, cells, ox, oy, cs, p, mode, reg = null, alpha = 1) {
    const o = outlineOf(cells);
    const lw = lineW(cs);
    const rg = reg == null ? Math.max(0.8, cs * 0.06) : reg;
    x.save();
    x.globalAlpha = alpha;
    if (mode === 'blind') {
      x.setLineDash([Math.max(1.5, cs * 0.12), Math.max(2, cs * 0.16)]);
      x.strokeStyle = U.rgba(KEY, 0.2);
      x.lineWidth = Math.max(1, lw * 0.7);
      loopsPath(x, o.loops, ox, oy, cs);
      x.stroke();
      x.restore();
      return;
    }
    loopsPath(x, o.loops, ox, oy, cs);
    if (mode === 'lifted') {
      // opaque, so its own shadow can't show through
      x.fillStyle = INKP[p];
    } else {
      x.globalCompositeOperation = 'multiply';
      if (mode === 'solid') x.fillStyle = INK[p];
      else if (mode === 'screen') x.fillStyle = halftone(INK[p], 0.62, Math.max(2.4, cs * 0.2));
      else x.fillStyle = halftone(KEY, 0.16, Math.max(2.4, cs * 0.2));
    }
    x.fill();
    if (mode === 'lifted') mode = 'solid';
    x.globalCompositeOperation = 'source-over';
    x.strokeStyle = mode === 'solid' ? KEY : U.rgba(KEY, mode === 'dead' ? 0.35 : 0.6);
    x.lineWidth = lw;
    x.lineJoin = 'miter';
    if (mode === 'solid' && o.seams.length) {
      x.globalAlpha = alpha * 0.28;
      x.lineWidth = Math.max(1, lw * 0.55);
      seamsPath(x, o.seams, ox + rg, oy + rg * 0.7, cs);
      x.stroke();
      x.globalAlpha = alpha;
      x.lineWidth = lw;
    }
    loopsPath(x, o.loops, ox + rg, oy + rg * 0.7, cs);
    x.stroke();
    x.restore();
  }
  R.drawPiece = drawPiece;

  /* ------------------------------------------------------------ layout */
  const TRAY_ORDER = [20, 19, 17, 18, 16, 15, 10, 11, 12, 13, 14, 6, 7, 8, 5, 3, 9, 4, 2, 1, 0];
  const TRAY_ROT = PIECES.map(P => {
    for (let r = 0; r < 4; r++) {
      const d = OP.pieceDims(OP.pieceTransform(P.base, r, false));
      if (d.w >= d.h) return r;
    }
    return 0;
  });
  R.TRAY_ROT = TRAY_ROT;

  function packTray(maxW) {
    const rows = [];
    let row = null;
    for (const pid of TRAY_ORDER) {
      const cells = OP.pieceTransform(PIECES[pid].base, TRAY_ROT[pid], false);
      const d = OP.pieceDims(cells);
      if (!row || row.w + 1 + d.w > maxW) {
        row = { items: [], w: -1, h: 0 };
        rows.push(row);
      }
      row.items.push({ pid, d, x: row.w + 1 });
      row.w += 1 + d.w;
      row.h = Math.max(row.h, d.h);
    }
    let Hc = -1, Wc = 0;
    for (const r of rows) {
      Hc += r.h + 1;
      Wc = Math.max(Wc, r.w);
    }
    return { rows, W: Wc, H: Hc };
  }

  function layoutTray(t, maxCs) {
    let best = null;
    for (let mw = 6; mw <= 36; mw++) {
      const pk = packTray(mw);
      const cs = Math.min(t.body.w / pk.W, t.body.h / pk.H, maxCs);
      if (!best || cs > best.cs + 0.01) best = { pk, cs };
    }
    const cs = Math.max(4, Math.floor(best.cs * 2) / 2);
    const pk = best.pk;
    const ox = t.body.x + (t.body.w - pk.W * cs) / 2;
    let oy = t.body.y + Math.max(0, (t.body.h - pk.H * cs) * 0.35);
    t.cs = cs;
    t.slots = new Array(21);
    for (const row of pk.rows) {
      const rx = ox + ((pk.W - row.w) / 2) * cs;
      for (const it of row.items) {
        const y = oy + ((row.h - it.d.h) / 2) * cs;
        t.slots[it.pid] = {
          pid: it.pid,
          cells: it.d.cells,
          w: it.d.w,
          h: it.d.h,
          x: rx + it.x * cs,
          y,
          cx: rx + (it.x + it.d.w / 2) * cs,
          cy: y + (it.d.h / 2) * cs,
        };
      }
      oy += (row.h + 1) * cs;
    }
  }

  function computeLayout(w, h) {
    const lay = { W: w, H: h };
    const m = Math.round(U.clamp(Math.min(w, h) * 0.032, 16, 36)); // never closer than 16px to an edge
    lay.m = m;
    const wide = w / h >= 1.12;
    lay.mode = wide ? 'wide' : 'tall';
    if (wide) {
      let S = Math.min(h - 2 * m, (w - 2 * m) * 0.555);
      const cs = Math.floor(S / N);
      S = cs * N;
      const bx = Math.round((w - S) / 2), by = Math.round((h - S) / 2);
      lay.board = { x: bx, y: by, size: S, cs };
      const gap = Math.round(U.clamp(cs * 1.05, 18, 46));
      const colW = bx - gap - m;
      const bar = Math.round(U.clamp(cs * 1.15, 28, 46));
      lay.bar = bar;
      lay.logo = { x: m, y: by, h: bar };
      lay.menu = { x: w - m - bar, y: by, s: bar };
      const top = by + bar + Math.round(gap * 0.6);
      const trayH = (by + S - top - gap) / 2;
      const mk = (x, y) => ({ x, y, w: colW, h: trayH });
      lay.trays = [mk(m, top), mk(bx + S + gap, top), mk(bx + S + gap, top + trayH + gap), mk(m, top + trayH + gap)];
    } else {
      const bar = Math.round(U.clamp(w * 0.09, 30, 44));
      lay.bar = bar;
      lay.logo = { x: m, y: m, h: bar };
      lay.menu = { x: w - m - bar, y: m, s: bar };
      const gapS = Math.round(m * 0.8);
      let S = Math.min(w - 2 * m, (h - 2 * m - bar - gapS) * 0.56);
      const cs = Math.floor(S / N);
      S = cs * N;
      const bx = Math.round((w - S) / 2), by = m + bar + gapS;
      lay.board = { x: bx, y: by, size: S, cs };
      const gap = Math.round(U.clamp(cs * 0.9, 12, 28));
      const top = by + S + gap;
      const tw = (w - 2 * m - gap) / 2, th = (h - m - top - gap) / 2;
      const mk = (x, y) => ({ x, y, w: tw, h: th });
      lay.trays = [mk(m, top), mk(m + tw + gap, top), mk(m + tw + gap, top + th + gap), mk(m, top + th + gap)];
    }
    const cs = lay.board.cs;
    for (const t of lay.trays) {
      t.hh = Math.round(U.clamp(Math.min(cs * 1.35, t.h * 0.2), 30, 56));
      // narrow trays stack the ink drops under the name
      t.two = t.w < 236;
      t.headH = t.two ? Math.round(t.hh * 1.5) : t.hh;
      const pad = Math.round(U.clamp(cs * 0.35, 6, 14));
      t.body = { x: t.x + 2, y: t.y + t.headH + pad, w: t.w - 4, h: t.h - t.headH - pad - 2 };
      layoutTray(t, Math.max(8, cs * 0.62));
    }
    return lay;
  }

  /* ---------------------------------------------------------- statics */
  R.resize = (w, h, ratio) => {
    W = w;
    H = h;
    dpr = ratio;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    pats.clear();
    paperPat = patternOf(paperTile);
    sheetPat = patternOf(sheetTile);
    L = computeLayout(w, h);
    layoutVersion++;
    buildBackground();
    buildSheet();
    inkCanvas = makeCanvas(L.board.size * dpr, L.board.size * dpr);
    inkCtx = inkCanvas.getContext('2d');
    titleCanvas = null;
    return L;
  };

  function buildBackground() {
    paperCanvas = makeCanvas(W * dpr, H * dpr);
    let x = paperCanvas.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = paperPat;
    x.fillRect(0, 0, W, H);
    bgCanvas = makeCanvas(W * dpr, H * dpr);
    x = bgCanvas.getContext('2d');
    x.drawImage(paperCanvas, 0, 0);
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    // crop marks at the sheet corners
    const b = L.board, len = U.clamp(b.cs * 0.55, 8, 18), off = U.clamp(b.cs * 0.28, 5, 12);
    x.strokeStyle = U.rgba(KEY, 0.55);
    x.lineWidth = 1;
    x.beginPath();
    for (const [cx, cy, sx, sy] of [
      [b.x, b.y, -1, -1],
      [b.x + b.size, b.y, 1, -1],
      [b.x + b.size, b.y + b.size, 1, 1],
      [b.x, b.y + b.size, -1, 1],
    ]) {
      x.moveTo(cx + sx * off, cy + 0.5);
      x.lineTo(cx + sx * (off + len), cy + 0.5);
      x.moveTo(cx + 0.5, cy + sy * off);
      x.lineTo(cx + 0.5, cy + sy * (off + len));
    }
    x.stroke();
  }

  function buildSheet() {
    const { size, cs } = L.board;
    sheetCanvas = makeCanvas(size * dpr, size * dpr);
    let x = sheetCanvas.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = sheetPat;
    x.fillRect(0, 0, size, size);
    gridCanvas = makeCanvas(size * dpr, size * dpr);
    x = gridCanvas.getContext('2d');
    x.strokeStyle = U.rgba(KEY, 0.16);
    x.lineWidth = Math.max(1, Math.round(dpr * 0.75));
    x.beginPath();
    for (let i = 1; i < N; i++) {
      const p = Math.round(i * cs * dpr) + 0.5;
      x.moveTo(p, 0);
      x.lineTo(p, size * dpr);
      x.moveTo(0, p);
      x.lineTo(size * dpr, p);
    }
    x.stroke();
    // a slightly firmer line every five squares, like a cutting mat
    x.strokeStyle = U.rgba(KEY, 0.1);
    x.beginPath();
    for (let i = 5; i < N; i += 5) {
      const p = Math.round(i * cs * dpr) + 0.5 + x.lineWidth;
      x.moveTo(p, 0);
      x.lineTo(p, size * dpr);
      x.moveTo(0, p);
      x.lineTo(size * dpr, p);
    }
    x.stroke();
  }

  /* --------------------------------------------------------------- ink */
  function regFor(i, cs) {
    const h = Math.sin(i * 12.9898 + 4.1) * 43758.5453;
    const f = h - Math.floor(h);
    return Math.max(0.9, cs * (0.045 + f * 0.04));
  }

  R.bakeInk = (g, count) => {
    const { size, cs } = L.board;
    const x = inkCtx;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const list = g.placements.slice(0, count);
    const shapes = list.map(pl => normCells(pl.cells));
    x.globalCompositeOperation = 'multiply';
    list.forEach((pl, k) => {
      const s = shapes[k];
      x.fillStyle = INK[pl.p];
      loopsPath(x, outlineOf(s.cells).loops, s.c0 * cs, s.r0 * cs, cs);
      x.fill();
    });
    // ink starvation: speckle & mottle
    x.globalCompositeOperation = 'destination-out';
    x.setTransform(1, 0, 0, 1, 0, 0);
    const gp = x.createPattern(grainTile, 'repeat');
    x.fillStyle = gp;
    x.fillRect(0, 0, inkCanvas.width, inkCanvas.height);
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    // key plate, printed last over everything
    x.globalCompositeOperation = 'source-over';
    const lw = lineW(cs) * 1.05;
    list.forEach((pl, k) => {
      const s = shapes[k];
      const o = outlineOf(s.cells);
      const rg = regFor(k, cs);
      x.strokeStyle = KEY;
      x.lineJoin = 'miter';
      if (o.seams.length) {
        x.globalAlpha = 0.24;
        x.lineWidth = Math.max(1, lw * 0.5);
        seamsPath(x, o.seams, s.c0 * cs + rg, s.r0 * cs + rg * 0.7, cs);
        x.stroke();
      }
      x.globalAlpha = 0.92;
      x.lineWidth = lw;
      loopsPath(x, o.loops, s.c0 * cs + rg, s.r0 * cs + rg * 0.7, cs);
      x.stroke();
    });
    x.globalAlpha = 1;
  };

  /* ------------------------------------------------------------ helpers */
  R.layout = () => L;
  R._ctx = () => ctx;
  R.cellRect = i => {
    const b = L.board, r = (i / N) | 0, c = i % N;
    return { x: b.x + c * b.cs, y: b.y + r * b.cs, s: b.cs };
  };
  R.cellCenter = i => {
    const b = L.board, r = (i / N) | 0, c = i % N;
    return { x: b.x + (c + 0.5) * b.cs, y: b.y + (r + 0.5) * b.cs };
  };

  function drawIcon(x, type, cx, cy, size, color) {
    if (!ICON_PATHS[type]) return;
    x.save();
    x.translate(cx - size / 2, cy - size / 2);
    x.scale(size / 24, size / 24);
    x.fillStyle = color;
    x.fill(ICON_PATHS[type], 'evenodd');
    x.restore();
  }
  R.drawIcon = drawIcon;

  // a literal drop of ink: round belly, pointed top
  function dropPath(x, cx, cy, s) {
    const R0 = s * 0.34, by = cy + s * 0.13, top = cy - s * 0.5;
    x.beginPath();
    x.moveTo(cx, top);
    x.bezierCurveTo(cx + R0 * 0.3, top + R0 * 0.9, cx + R0, by - R0 * 0.55, cx + R0, by);
    x.arc(cx, by, R0, 0, Math.PI);
    x.bezierCurveTo(cx - R0, by - R0 * 0.55, cx - R0 * 0.3, top + R0 * 0.9, cx, top);
    x.closePath();
    return by;
  }

  function drawDrop(x, type, cx, cy, cs, scale = 1, alpha = 1) {
    const s = cs * 0.98 * scale;
    if (s <= 1) return;
    x.save();
    x.globalAlpha = alpha;
    // halftone shadow, a touch off register
    x.fillStyle = halftone(KEY, 0.38, Math.max(2.2, cs * 0.11));
    dropPath(x, cx + s * 0.09, cy + s * 0.08, s);
    x.fill();
    x.fillStyle = KEY;
    const by = dropPath(x, cx, cy, s);
    x.fill();
    drawIcon(x, type, cx, by, s * 0.46, THEME.sheet);
    x.restore();
  }
  R.drawDrop = drawDrop;
  // same drop for the DOM (24-unit box)
  R.DROP_SVG = 'M12 1.2C13.1 4.6 20 8.9 20 15.1a8 8 0 0 1-16 0C4 8.9 10.9 4.6 12 1.2z';

  /* ------------------------------------------------------------- logo */
  const GLYPHS = {
    O: ['####', '#..#', '#..#', '#..#', '####'],
    V: ['#...#', '#...#', '#...#', '.#.#.', '..#..'],
    E: ['####', '#...', '###.', '#...', '####'],
    R: ['###.', '#..#', '###.', '#.#.', '#..#'],
    P: ['###.', '#..#', '###.', '#...', '#...'],
    I: ['###', '.#.', '.#.', '.#.', '###'],
    N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
    T: ['###', '.#.', '.#.', '.#.', '.#.'],
  };
  const LOGO = (() => {
    let x = 0;
    const cells = [];
    for (const ch of 'OVERPRINT') {
      const gl = GLYPHS[ch];
      for (let r = 0; r < 5; r++) for (let c = 0; c < gl[r].length; c++) if (gl[r][c] === '#') cells.push([r, x + c]);
      x += gl[0].length + 1;
    }
    return { cells, w: x - 1, h: 5 };
  })();
  R.LOGO = LOGO;

  /** Two plates (default pink + blue) printed out of register; perfect register = one deep colour. */
  R.drawLogo = (x, ox, oy, cs, offA, offB, inkA = INK[0], inkB = INK[1], reveal = null) => {
    const gap = cs < 9 ? 0 : cs * 0.022;
    x.save();
    x.globalCompositeOperation = 'multiply';
    [[inkA, offA], [inkB, offB]].forEach(([ink, off], plate) => {
      x.fillStyle = ink;
      x.beginPath();
      LOGO.cells.forEach(([r, c], k) => {
        let s = 1;
        if (reveal) {
          s = reveal(c, r, plate);
          if (s <= 0) return;
        }
        const w = (cs - gap * 2) * s;
        const px = ox + c * cs + off[0] + cs / 2, py = oy + r * cs + off[1] + cs / 2;
        x.rect(px - w / 2, py - w / 2, w, w);
      });
      x.fill();
    });
    x.restore();
  };

  /** knock riso grain out of whatever ink is on a canvas */
  const grainPats = new WeakMap();
  R.applyGrain = (x, w, h) => {
    let p = grainPats.get(x);
    if (!p) {
      p = x.createPattern(grainTile, 'repeat');
      grainPats.set(x, p);
    }
    x.save();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'destination-out';
    x.fillStyle = p;
    x.fillRect(0, 0, w, h);
    x.restore();
  };

  /* ------------------------------------------------------------ scenes */
  R.clear = (plain = false) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(plain ? paperCanvas : bgCanvas, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  // Decorative cut-outs behind the title (big pieces off the edges)
  const TITLE_PIECES = [
    { pid: 19, rot: 1, flip: 0, p: 0, fx: -0.04, fy: 0.06, k: 1.0, depth: 14 },
    { pid: 11, rot: 0, flip: 1, p: 2, fx: 0.07, fy: 0.62, k: 0.9, depth: 22 },
    { pid: 16, rot: 2, flip: 0, p: 1, fx: 0.86, fy: 0.02, k: 1.05, depth: 18 },
    { pid: 13, rot: 3, flip: 0, p: 3, fx: 0.9, fy: 0.55, k: 0.95, depth: 12 },
    { pid: 20, rot: 0, flip: 0, p: 2, fx: 0.79, fy: 0.84, k: 0.75, depth: 26 },
    { pid: 7, rot: 1, flip: 0, p: 1, fx: 0.18, fy: 0.86, k: 0.8, depth: 9 },
    { pid: 3, rot: 2, flip: 0, p: 0, fx: 0.25, fy: -0.03, k: 0.7, depth: 20 },
  ];

  for (const tp of TITLE_PIECES) tp.cells = OP.pieceTransform(PIECES[tp.pid].base, tp.rot, !!tp.flip);

  R.drawTitle = (t, mx, my) => {
    R.clear(true);
    const unit = Math.max(26, Math.min(W, H) / 8.2);
    const px = (mx / W - 0.5) * 2, py = (my / H - 0.5) * 2;
    for (const tp of TITLE_PIECES) {
      const cells = tp.cells;
      const cs = unit * tp.k;
      const bob = Math.sin(t * 0.6 + tp.depth) * 3;
      const ox = tp.fx * W - px * tp.depth, oy = tp.fy * H - py * tp.depth + bob;
      drawPiece(ctx, cells, ox, oy, cs, tp.p, 'solid', cs * 0.06 + px * 1.5);
    }
  };

  /* main game scene ---------------------------------------------------- */
  R.drawGame = V => {
    const g = V.g, b = L.board, cs = b.cs, now = V.now;
    R.clear();

    // small masthead
    const lcs = U.clamp(L.bar / 7.2, 2.5, 6);
    const lw = LOGO.w * lcs;
    if (lw < L.board.x - L.m - 10 || L.mode === 'tall') {
      const reg = V.logoReg;
      R.drawLogo(ctx, L.logo.x, L.logo.y + (L.bar - LOGO.h * lcs) / 2, lcs, [0, 0], [reg * lcs * 0.32, reg * lcs * 0.24]);
    }

    const intro = V.intro ? now - V.intro : 99;
    const sheetIn = U.easeOutCubic(U.clamp(intro / 0.45, 0, 1));
    const sx = b.x, sy = b.y + (1 - sheetIn) * (H - b.y + 40);

    ctx.save();
    if (V.shake > 0.01) ctx.translate((Math.random() - 0.5) * V.shake, (Math.random() - 0.5) * V.shake);

    // halftone shadow in the colour of whoever is printing
    const off = Math.round(U.clamp(cs * 0.34, 6, 15));
    const shadowFill = (p, a) => {
      if (a <= 0.01) return;
      ctx.globalAlpha = a;
      ctx.fillStyle = p >= 0 ? halftone(INK[p], 0.52, Math.max(2.6, cs * 0.13)) : halftone(KEY, 0.34, Math.max(2.6, cs * 0.13));
      ctx.beginPath();
      ctx.rect(sx + off, sy + b.size, b.size, off);
      ctx.rect(sx + b.size, sy + off, off, b.size - off);
      ctx.fill();
    };
    shadowFill(V.shadowFrom, 1 - V.shadowT);
    shadowFill(V.shadowTo, V.shadowT);
    ctx.globalAlpha = 1;

    if (intro >= SETTLED) {
      // the sheet, grid, die-cuts and frame don't change during play: one bitmap
      if (baseFor !== g || baseVersion !== layoutVersion) buildBase(g);
      ctx.drawImage(baseCanvas, sx, sy, b.size, b.size);
    } else {
      ctx.drawImage(sheetCanvas, sx, sy, b.size, b.size);
      // grid prints top-down as the sheet runs through
      const wipe = U.clamp((intro - 0.3) / 0.45, 0, 1);
      if (wipe > 0) {
        const hpx = b.size * U.easeInOutCubic(wipe);
        ctx.drawImage(gridCanvas, 0, 0, gridCanvas.width, (hpx / b.size) * gridCanvas.height, sx, sy, b.size, hpx);
      }
      // die-cut holes
      if (g.holes) {
        g.holes.forEach((hole, k) => {
          const t0 = 0.75 + k * 0.045;
          const u = U.clamp((intro - t0) / 0.18, 0, 1);
          if (u <= 0) return;
          drawHole(hole, sx, sy, cs, U.easeOutBack(u, 2.2));
        });
      }
      // sheet frame
      ctx.strokeStyle = KEY;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, b.size - 2, b.size - 2);
    }

    // start corners
    for (let p = 0; p < 4; p++) {
      if (g.players[p].placed > 0 && !(V.replay && V.replayCount < firstPlacementIdx(g, p))) continue;
      const u = U.clamp((intro - 1.05 - p * 0.06) / 0.25, 0, 1);
      if (u <= 0) continue;
      drawStartCorner(p, sx, sy, cs, U.easeOutBack(u), V.turnP === p && V.humanTurn ? now : 0);
    }

    // ink drops
    for (let i = 0; i < E.NN; i++) {
      const type = V.replay ? g.initialDrops[i] : g.drops[i];
      if (type < 0 || V.hiddenDrops.has(i)) continue;
      if (V.replay && dropTakenBy(g, i, V.replayCount)) continue;
      const r = (i / N) | 0, c = i % N;
      const d = 1.0 + ((r * 7 + c * 3) % 12) * 0.03;
      const u = U.clamp((intro - d) / 0.3, 0, 1);
      if (u <= 0) continue;
      const bob = 1 + Math.sin(now * 2.1 + i) * 0.035;
      drawDrop(ctx, type, sx + (c + 0.5) * cs, sy + (r + 0.5) * cs, cs, U.easeOutBack(u, 2.6) * bob);
    }

    // the print itself
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(inkCanvas, sx, sy, b.size, b.size);
    ctx.globalCompositeOperation = 'source-over';

    // where the current human can start a piece
    if (V.anchors && V.anchors.length) {
      const ink = DEEP[V.turnP];
      const age = now - V.anchorsT0;
      ctx.fillStyle = ink;
      for (let k = 0; k < V.anchors.length; k++) {
        const i = V.anchors[k];
        const u = U.clamp((age - (V.anchorDelay[k] || 0)) / 0.28, 0, 1);
        if (u <= 0) continue;
        const r = (i / N) | 0, c = i % N;
        const pulse = 1 + Math.sin(now * 3.2 - k * 0.35) * 0.12;
        const rad = cs * 0.12 * U.easeOutBack(u, 3) * pulse;
        ctx.beginPath();
        const cx = sx + (c + 0.5) * cs, cy = sy + (r + 0.5) * cs;
        ctx.moveTo(cx, cy - rad * 1.3);
        ctx.lineTo(cx + rad * 1.3, cy);
        ctx.lineTo(cx, cy + rad * 1.3);
        ctx.lineTo(cx - rad * 1.3, cy);
        ctx.closePath();
        ctx.fill();
      }
    }

    // halftone ripples from fresh prints
    for (const rp of V.ripples) drawRipple(rp, now, sx, sy, cs);

    // landed prints still settling
    for (const st of V.stamps) if (st.landed) drawStamp(st, now);

    // the piece being aimed
    if (V.held && V.held.onBoard) drawGhost(V.held, now);

    ctx.restore();

    drawTrays(V, intro);

    if (V.held && !V.held.onBoard) drawHeld(V.held);
    for (const st of V.stamps) if (!st.landed) drawStamp(st, now);
    for (const tk of V.tokens) drawToken(tk, now);
    drawSpecks(V.specks);
  };

  // everything in the intro (sheet feed, grid wipe, die-cuts, tray pop-in) is finished by now
  const SETTLED = 1.4;
  let baseCanvas = null, baseFor = null, baseVersion = -1;
  function buildBase(g) {
    const { size, cs, x: bx, y: by } = L.board;
    const px = Math.round(size * dpr);
    if (!baseCanvas || baseCanvas.width !== px) baseCanvas = makeCanvas(px, px);
    const x = baseCanvas.getContext('2d', { alpha: false }); // opaque, like the stage: identical blending
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, px, px);
    x.drawImage(sheetCanvas, 0, 0);
    x.drawImage(gridCanvas, 0, 0);
    // drawn in screen space, so every halftone dot lands exactly where the live drawing put it
    x.setTransform(dpr, 0, 0, dpr, -bx * dpr, -by * dpr);
    if (g.holes) for (const hole of g.holes) drawHole(hole, bx, by, cs, 1, x);
    x.strokeStyle = KEY;
    x.lineWidth = 2;
    x.strokeRect(bx + 1, by + 1, size - 2, size - 2);
    baseFor = g;
    baseVersion = layoutVersion;
  }

  function firstPlacementIdx(g, p) {
    for (let k = 0; k < g.placements.length; k++) if (g.placements[k].p === p) return k + 1;
    return 9999;
  }
  function dropTakenBy(g, i, count) {
    for (let k = 0; k < Math.min(count, g.placements.length); k++) {
      if (g.placements[k].collected.some(c => c.i === i)) return true;
    }
    return false;
  }

  function drawHole(hole, sx, sy, cs, s, ctx = R._ctx()) {
    const n = normCells(hole);
    const o = outlineOf(n.cells);
    const w = Math.max(...n.cells.map(c => c[1])) + 1, h = Math.max(...n.cells.map(c => c[0])) + 1;
    const ox = sx + n.c0 * cs, oy = sy + n.r0 * cs;
    ctx.save();
    ctx.translate(ox + (w * cs) / 2, oy + (h * cs) / 2);
    ctx.scale(s, s);
    ctx.translate(-(w * cs) / 2, -(h * cs) / 2);
    loopsPath(ctx, o.loops, 0, 0, cs);
    ctx.fillStyle = THEME.under;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // the sheet's cut wall throws a shadow along the top & left of the hole
    const set = new Set(n.cells.map(([r, c]) => r * 100 + c));
    const band = Math.max(2.5, cs * 0.27);
    ctx.fillStyle = halftone('#3A2918', 0.62, Math.max(2, cs * 0.1));
    ctx.beginPath();
    for (const [r, c] of n.cells) {
      if (!set.has((r - 1) * 100 + c)) ctx.rect(c * cs, r * cs, cs, band);
      if (!set.has(r * 100 + c - 1)) ctx.rect(c * cs, r * cs, band, cs);
    }
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = KEY;
    ctx.lineWidth = 1.5;
    loopsPath(ctx, o.loops, 0, 0, cs);
    ctx.stroke();
    ctx.restore();
  }

  function drawStartCorner(p, sx, sy, cs, s, pulseT) {
    const corner = E.CORNERS[p];
    const r = (corner / N) | 0, c = corner % N;
    const x0 = sx + c * cs, y0 = sy + r * cs;
    const ax = c === 0 ? x0 : x0 + cs, ay = r === 0 ? y0 : y0 + cs; // outer corner point
    const start = [0, 0.5, 1, 1.5][p] * Math.PI;
    const pulse = pulseT ? 1 + Math.sin(pulseT * 4) * 0.06 : 1;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = halftone(INK[p], 0.5, Math.max(2.4, cs * 0.12));
    ctx.fillRect(x0, y0, cs, cs);
    ctx.fillStyle = INK[p];
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.arc(ax, ay, cs * 0.62 * s * pulse, start, start + Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawRipple(rp, now, sx, sy, cs) {
    const t = (now - rp.t0) / rp.dur;
    if (t <= 0 || t >= 1) return;
    const R0 = U.easeOutCubic(t) * rp.maxR;
    const band = cs * 1.7;
    const cx = sx + rp.cx * cs, cy = sy + rp.cy * cs;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = INK[rp.p];
    ctx.beginPath();
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const px = sx + (c + 0.5) * cs, py = sy + (r + 0.5) * cs;
        const d = Math.hypot(px - cx, py - cy);
        const u = 1 - Math.abs(d - R0) / band;
        if (u <= 0) continue;
        const rad = cs * 0.15 * u * (1 - t);
        if (rad < 0.4) continue;
        ctx.moveTo(px + rad, py);
        ctx.arc(px, py, rad, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    ctx.restore();
  }

  function liftedShadow(cells, ox, oy, cs, lift, x = ctx) {
    if (lift <= 0.01) return;
    const o = outlineOf(cells);
    x.save();
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = halftone(KEY, 0.36 * Math.min(1, lift * 1.3), Math.max(2.2, cs * 0.14));
    loopsPath(x, o.loops, ox + cs * 0.16 * lift, oy + cs * 0.24 * lift, cs);
    x.fill();
    x.restore();
  }

  function drawStamp(st, now) {
    const pose = st.pose(now);
    if (!pose) return;
    const { x, y, cs, lift, squash } = pose;
    const w = st.w * cs, h = st.h * cs;
    ctx.save();
    const cx = x + w / 2, cy = y + h / 2;
    const sc = 1 + lift * 0.09;
    ctx.translate(cx, cy);
    ctx.scale(sc * (1 + squash * 0.05), sc * (1 - squash * 0.05));
    ctx.translate(-cx, -cy);
    liftedShadow(st.cells, x, y, cs, lift);
    const lx = x - cs * 0.06 * lift, ly = y - cs * 0.1 * lift;
    drawPiece(ctx, st.cells, lx, ly, cs, st.p, lift > 0.04 ? 'lifted' : 'solid', pose.reg);
    ctx.restore();
  }

  function drawGhost(hd, now) {
    const b = L.board, cs = b.cs;
    const x = hd.px, y = hd.py;
    const w = hd.w * cs, h = hd.h * cs;
    const o = outlineOf(hd.cells);
    ctx.save();
    const cx = x + w / 2, cy = y + h / 2;
    ctx.translate(cx, cy);
    if (hd.rotA) ctx.rotate(hd.rotA);
    ctx.scale(hd.flipS * (1 + (hd.nudge || 0) * 0.04), 1 + (hd.nudge || 0) * 0.04);
    ctx.translate(-cx + (hd.shakeX || 0), -cy);
    const ink = INK[hd.p];
    if (hd.valid) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = halftone(ink, 0.55, Math.max(2.6, cs * 0.13));
      loopsPath(ctx, o.loops, x, y, cs);
      ctx.fill();
      // squares that will be overprinted show the real overprint colour
      if (hd.overMask) {
        ctx.fillStyle = ink;
        hd.cells.forEach(([r, c], k) => {
          if (hd.overMask[k]) ctx.fillRect(x + c * cs, y + r * cs, cs, cs);
        });
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.setLineDash([cs * 0.22, cs * 0.14]);
      ctx.lineDashOffset = -now * cs * 0.6;
      ctx.strokeStyle = DEEP[hd.p];
      ctx.lineWidth = Math.max(1.5, cs * 0.07);
      loopsPath(ctx, o.loops, x, y, cs);
      ctx.stroke();
    } else {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = hatch(U.rgba(KEY, 0.42), Math.max(4, cs * 0.2), Math.max(1, cs * 0.04));
      loopsPath(ctx, o.loops, x, y, cs);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.setLineDash([cs * 0.16, cs * 0.12]);
      ctx.strokeStyle = U.rgba(KEY, 0.7);
      ctx.lineWidth = Math.max(1.25, cs * 0.05);
      loopsPath(ctx, o.loops, x, y, cs);
      ctx.stroke();
      ctx.setLineDash([]);
      if (hd.badMask) {
        ctx.strokeStyle = KEY;
        ctx.lineWidth = Math.max(1.5, cs * 0.07);
        ctx.lineCap = 'square';
        ctx.beginPath();
        hd.cells.forEach(([r, c], k) => {
          if (!hd.badMask[k]) return;
          const px = x + (c + 0.5) * cs, py = y + (r + 0.5) * cs, a = cs * 0.17;
          ctx.moveTo(px - a, py - a);
          ctx.lineTo(px + a, py + a);
          ctx.moveTo(px + a, py - a);
          ctx.lineTo(px - a, py + a);
        });
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawHeld(hd) {
    const cs = hd.cs;
    const w = hd.w * cs, h = hd.h * cs;
    const x = hd.px, y = hd.py;
    ctx.save();
    const cx = x + w / 2, cy = y + h / 2;
    ctx.translate(cx, cy);
    if (hd.rotA) ctx.rotate(hd.rotA);
    ctx.scale(hd.flipS, 1);
    ctx.translate(-cx, -cy);
    liftedShadow(hd.cells, x, y, cs, 1);
    drawPiece(ctx, hd.cells, x - cs * 0.06, y - cs * 0.1, cs, hd.p, 'lifted');
    ctx.restore();
  }

  // how a tray slot looks right now
  const BLIND = 1, SOLID = 2, SCREEN = 3, DEAD = 4, LIVE = 5;
  const MODE = [null, 'blind', 'solid', 'screen', 'dead'];
  function slotCode(V, pl, p, pid, active) {
    const inHand = V.replayHands ? V.replayHands[p][pid] : pl.hand[pid];
    if (!inHand || (V.held && V.held.p === p && V.held.pid === pid) || (V.flyingPid && V.flyingPid[p] === pid)) return BLIND;
    if (V.lift[p][pid]) return LIVE; // lifted, nudged or settling: drawn every frame
    if (V.over) return SCREEN;
    if (pl.out) return DEAD;
    if (!active) return SCREEN;
    if (V.movable && !V.movable[pid]) return DEAD;
    return SOLID;
  }

  // one piece in its slot, exactly as it has always been drawn
  function drawSlot(x, s, cs, p, mode, lift, appear) {
    if (mode === 'blind') {
      drawPiece(x, s.cells, s.x, s.y, cs, p, 'blind');
      return;
    }
    const sc = U.easeOutBack(appear, 2) * (1 + lift * 0.07);
    const cx = s.cx, cy = s.cy;
    x.save();
    x.translate(cx, cy);
    x.scale(sc, sc);
    if (lift > 0.01) x.rotate(-lift * 0.035);
    x.translate(-cx, -cy);
    if (lift > 0.01) liftedShadow(s.cells, s.x, s.y, cs, lift, x);
    drawPiece(x, s.cells, s.x - cs * 0.06 * lift, s.y - cs * 0.1 * lift, cs, p, mode === 'solid' && lift > 0.01 ? 'lifted' : mode);
    x.restore();
  }

  function liveMode(V, pl, p, pid, active) {
    if (V.over) return 'screen';
    if (pl.out) return 'dead';
    if (!active) return 'screen';
    if (V.movable && !V.movable[pid]) return 'dead';
    return 'solid';
  }

  // Each tray's resting pieces live in a bitmap of that tray, paper included, aligned to device pixels.
  // It is redrawn only when a slot changes; anything in motion is drawn live on top.
  const trayCaches = [null, null, null, null];
  function trayCache(p, T) {
    let c = trayCaches[p];
    if (c && c.version === layoutVersion) return c;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of T.slots) {
      x0 = Math.min(x0, s.x);
      y0 = Math.min(y0, s.y);
      x1 = Math.max(x1, s.x + s.w * T.cs);
      y1 = Math.max(y1, s.y + s.h * T.cs);
    }
    // ink spills past a slot by its outline and misregistration
    const spill = 2 + T.cs * 0.12;
    const m = Math.ceil(spill) + 1;
    let rx0 = Math.max(0, T.x - m), ry0 = Math.max(0, T.y - m);
    let rx1 = Math.min(W, T.x + T.w + m), ry1 = Math.min(H, T.y + T.h + m);
    // keep clear of the board, its live shadow, and how far a hard print shakes it
    const b = L.board, keep = Math.round(U.clamp(b.cs * 0.34, 6, 15)) + 6;
    const bx0 = b.x - 6, by0 = b.y - 6, bx1 = b.x + b.size + keep, by1 = b.y + b.size + keep;
    if (rx1 > bx0 && rx0 < bx1 && ry1 > by0 && ry0 < by1) {
      if (T.x >= b.x + b.size) rx0 = Math.max(rx0, bx1);
      else if (T.x + T.w <= b.x) rx1 = Math.min(rx1, bx0);
      else if (T.y >= b.y + b.size) ry0 = Math.max(ry0, by1);
      else ry1 = Math.min(ry1, by0);
    }
    const dx = Math.ceil(rx0 * dpr), dy = Math.ceil(ry0 * dpr);
    const cw = Math.max(1, Math.floor(rx1 * dpr) - dx), ch = Math.max(1, Math.floor(ry1 * dpr) - dy);
    // on a screen too small for the pieces to fit their tray, that tray is simply drawn live
    const fits = (x0 - spill) * dpr >= dx && (y0 - spill) * dpr >= dy && (x1 + spill) * dpr <= dx + cw && (y1 + spill) * dpr <= dy + ch;
    const canvas = makeCanvas(cw, ch);
    c = { canvas, x: canvas.getContext('2d', { alpha: false }), fits, dx, dy, cw, ch, version: layoutVersion, k0: -1, k1: -1, k2: -1, codes: new Uint8Array(21) };
    trayCaches[p] = c;
    return c;
  }

  function drawTrays(V, intro) {
    const g = V.g;
    const settled = intro >= SETTLED;
    for (let p = 0; p < 4; p++) {
      const T = L.trays[p];
      const pl = g.players[p];
      const active = V.turnP === p;
      const cs = T.cs;
      if (!settled || !trayCache(p, T).fits) {
        // pieces popping in during the intro
        for (const s of T.slots) {
          const pid = s.pid;
          const appear = U.clamp((intro - 0.45 - p * 0.08 - TRAY_ORDER.indexOf(pid) * 0.022) / 0.22, 0, 1);
          if (appear <= 0) continue;
          const code = slotCode(V, pl, p, pid, active);
          const mode = code === BLIND ? 'blind' : liveMode(V, pl, p, pid, active);
          drawSlot(ctx, s, cs, p, mode, code === LIVE ? V.lift[p][pid] : 0, appear);
        }
        continue;
      }
      const c = trayCache(p, T);
      const codes = c.codes;
      let k0 = 0, k1 = 0, k2 = 0, live = false;
      for (let pid = 0; pid < 21; pid++) {
        const code = slotCode(V, pl, p, pid, active);
        codes[pid] = code;
        if (code === LIVE) live = true;
        if (pid < 10) k0 = k0 * 8 + code;
        else if (pid < 20) k1 = k1 * 8 + code;
        else k2 = code;
      }
      if (k0 !== c.k0 || k1 !== c.k1 || k2 !== c.k2) {
        const x = c.x;
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.globalAlpha = 1;
        x.globalCompositeOperation = 'source-over';
        x.drawImage(bgCanvas, c.dx, c.dy, c.cw, c.ch, 0, 0, c.cw, c.ch); // the paper under this tray
        x.setTransform(dpr, 0, 0, dpr, -c.dx, -c.dy); // screen space, so halftones line up
        for (const s of T.slots) {
          const code = codes[s.pid];
          if (code !== LIVE) drawSlot(x, s, cs, p, MODE[code], 0, 1);
        }
        c.k0 = k0;
        c.k1 = k1;
        c.k2 = k2;
      }
      ctx.drawImage(c.canvas, c.dx / dpr, c.dy / dpr, c.cw / dpr, c.ch / dpr);
      if (live) {
        for (const s of T.slots) {
          if (codes[s.pid] === LIVE) drawSlot(ctx, s, cs, p, liveMode(V, pl, p, s.pid, active), V.lift[p][s.pid], 1);
        }
      }
    }
  }

  function drawToken(tk, now) {
    const t = U.clamp((now - tk.t0) / tk.dur, 0, 1);
    if (t <= 0) return;
    const e = U.easeInOutCubic(t);
    const mx = (tk.x0 + tk.x1) / 2, my = Math.min(tk.y0, tk.y1) - 80;
    const bx = (1 - e) * (1 - e) * tk.x0 + 2 * (1 - e) * e * mx + e * e * tk.x1;
    const by = (1 - e) * (1 - e) * tk.y0 + 2 * (1 - e) * e * my + e * e * tk.y1;
    const s = t < 0.15 ? U.easeOutBack(t / 0.15, 3) * 1.35 : U.lerp(1.35, 0.7, U.easeInCubic((t - 0.15) / 0.85));
    // dotted trail
    ctx.fillStyle = KEY;
    for (let k = 1; k <= 4; k++) {
      const te = Math.max(0, e - k * 0.045);
      const tx = (1 - te) * (1 - te) * tk.x0 + 2 * (1 - te) * te * mx + te * te * tk.x1;
      const ty = (1 - te) * (1 - te) * tk.y0 + 2 * (1 - te) * te * my + te * te * tk.y1;
      ctx.beginPath();
      ctx.arc(tx, ty, Math.max(0.6, tk.cs * 0.07 * (1 - k / 5)), 0, Math.PI * 2);
      ctx.fill();
    }
    drawDrop(ctx, tk.type, bx, by, tk.cs, s);
  }

  function drawSpecks(list) {
    if (!list.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (const s of list) {
      ctx.globalAlpha = U.clamp(s.life / s.max, 0, 1);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  R.init = canvas => {
    cv = canvas;
    ctx = cv.getContext('2d', { alpha: false });
    makeTextures();
  };
})(window);
