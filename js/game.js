/* OVERPRINT — game flow, input, HUD & screens */
'use strict';
(function () {
  const OP = window.OP;
  const { U, THEME, PIECES, E, AI, R, A } = OP;
  const N = E.N;
  const INK = THEME.inks, DEEP = THEME.deep, NAMES = THEME.names;
  const $ = s => document.querySelector(s);

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem('overprint.' + k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('overprint.' + k, JSON.stringify(v));
      } catch (e) {
        /* storage unavailable */
      }
    },
  };

  const LEVEL_BLURB = ['Grabs big pieces and hopes for the best.', 'Solid, with a style of its own.', 'Plans ahead and saves its ink drops.'];

  const POWERS = [
    { name: 'Overprint', text: 'Print over up to two rival squares. They become yours.' },
    { name: 'Bleed', text: 'Your piece may touch your own sides.' },
    { name: 'Offset', text: 'Place your piece anywhere. No corner needed.' },
  ];
  // an ink drop with the power's glyph knocked out of its belly
  const iconSvg = t =>
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="dp" d="${R.DROP_SVG}"/><path class="gl" fill-rule="evenodd" transform="translate(6.6 9.7) scale(.45)" d="${R.ICON[t]}"/></svg>`;

  /* ------------------------------------------------------------- state */
  const stage = $('#stage');
  let W = 0, H = 0, L = null;
  let scene = 'title';
  let clock = 0, lastTs = 0;
  let g = null, V = null;
  let phase = 'idle'; // idle | intro | human | cpu | anim | over
  let held = null;
  let armed = -1;
  let timers = [];
  // each seat: 0 = player, 1–3 = CPU level (amateur, intermediate, expert)
  let seats = (() => {
    const v = store.get('seatLevels', null);
    if (Array.isArray(v) && v.length === 4) return v.map(x => U.clamp(x | 0, 0, 3));
    const old = store.get('seats', null); // true/false from before levels existed
    if (Array.isArray(old) && old.length === 4) return old.map(b => (b ? 2 : 0));
    return [0, 2, 2, 2];
  })();
  // the level a seat goes back to when it's switched from Player to CPU
  const lastLevel = (() => {
    const v = store.get('lastLevels', null);
    return Array.isArray(v) && v.length === 4 ? v.map(x => U.clamp(x | 0, 1, 3)) : seats.map(s => s || 2);
  })();
  let prefs = store.get('prefs', { sfx: true, music: true });
  const seen = store.get('seen', {});
  let menuOpen = false, rulesOpen = false, leaving = false;
  let hoverPid = -1;
  let cpuStyle = [0, 1, 2, 3];
  const ptr = { x: -999, y: -999, lx: 0, ly: 0, type: 'mouse', down: false, sx: 0, sy: 0, drag: false, picked: false, onBoard: false };
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  let replayScores = null;
  let title = { t0: 0, reg: 1, leaveAt: 0 };

  let nextDue = Infinity; // earliest timer, so idle frames skip the queue
  const later = (sec, fn) => {
    const at = clock + sec;
    timers.push({ at, fn });
    if (at < nextDue) nextDue = at;
  };
  const spd = () => (V && V.fast ? 0.5 : 1);
  const humanCount = () => seats.filter(s => s === 0).length;
  const markSeen = k => {
    if (seen[k]) return;
    seen[k] = 1;
    store.set('seen', seen);
  };

  /* ------------------------------------------------------------ boot */
  function boot() {
    R.init(stage);
    const tex = R.cssTextures();
    const root = document.documentElement.style;
    root.setProperty('--paper-tex', `url(${tex.paper})`);
    root.setProperty('--sheet-tex', `url(${tex.sheet})`);
    root.setProperty('--speckle', `url(${tex.speckle})`);
    root.setProperty('--dots-key', `url(${tex.dotsKey.url})`);
    root.setProperty('--dots-light', `url(${tex.dotsLight.url})`);
    root.setProperty('--dots-size', `${tex.dotsKey.size}px`);
    tex.dotsInk.forEach((d, p) => root.setProperty(`--dots-${p}`, `url(${d.url})`));
    tex.dotsLevels.forEach((lv, p) => lv.forEach((d, k) => root.setProperty(`--dots-${p}-${k + 1}`, `url(${d.url})`)));
    INK.forEach((c, p) => {
      root.setProperty(`--ink-${p}`, c);
      // the ink as it actually lands on this stock
      root.setProperty(`--inkp-${p}`, U.multiply(c, THEME.paper));
      root.setProperty(`--deep-${p}`, DEEP[p]);
    });
    A.setPrefs(prefs.sfx, prefs.music);
    buildTitle();
    buildRules();
    wire();
    resize();
    title.t0 = 0;
    requestAnimationFrame(loop);
  }

  let uiZoom = 1;
  let offX = 0, offY = 0; // where the stage sits in the viewport
  function resize() {
    const box = document.body.getBoundingClientRect();
    W = Math.round(box.width);
    H = Math.round(box.height);
    offX = box.left;
    offY = box.top;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // menus scale with the screen so big displays don't get a tiny cluster
    uiZoom = U.clamp(Math.min(W / 1240, H / 780), 0.86, 1.6);
    document.documentElement.style.setProperty('--z', uiZoom.toFixed(3));
    L = R.resize(W, H, dpr);
    if (g) {
      R.bakeInk(g, V.replay ? V.replayCount : V.bakeCount);
      layoutHUD();
      if (held) positionHeld(true);
    }
    sizeLogo();
  }

  /* ------------------------------------------------------------- loop */
  function loop(ts) {
    const dt = Math.min(0.05, lastTs ? (ts - lastTs) / 1000 : 0.016);
    lastTs = ts;
    if (!menuOpen) clock += dt;
    if (timers.length && clock >= nextDue) {
      const due = timers.filter(t => t.at <= clock);
      timers = timers.filter(t => t.at > clock);
      nextDue = Infinity;
      for (const t of timers) if (t.at < nextDue) nextDue = t.at;
      due.forEach(t => t.fn());
    }
    if (scene === 'title') {
      R.drawTitle(clock, ptr.x < 0 ? W / 2 : ptr.x, ptr.y < 0 ? H / 2 : ptr.y);
      drawLogo(dt);
    } else if (V) {
      update(dt);
      R.drawGame(V);
    }
    requestAnimationFrame(loop);
  }

  function update(dt) {
    V.now = clock;
    if (V.stamps.length) for (const st of V.stamps.slice()) {
      if (!st.impacted && clock >= st.impactAt) {
        st.impacted = true;
        st.landed = true;
        st.onImpact();
      }
      if (clock >= st.endAt) {
        V.stamps.splice(V.stamps.indexOf(st), 1);
        st.onDone();
      }
    }
    if (V.ripples.length && V.ripples.some(r => clock - r.t0 >= r.dur)) V.ripples = V.ripples.filter(r => clock - r.t0 < r.dur);
    if (V.tokens.length) for (const tk of V.tokens.slice()) {
      if (clock >= tk.t0 + tk.dur) {
        V.tokens.splice(V.tokens.indexOf(tk), 1);
        if (tk.onLand) tk.onLand();
      }
    }
    const f = Math.exp(-5.5 * dt);
    for (const s of V.specks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= f;
      s.vy *= f;
      s.life -= dt;
    }
    if (V.specks.length) V.specks = V.specks.filter(s => s.life > 0);
    V.shake *= Math.exp(-13 * dt);
    V.shadowT = Math.min(1, V.shadowT + dt * 3.5);
    for (let p = 0; p < 4; p++) {
      const a = V.lift[p], b = V.liftT[p];
      for (let i = 0; i < 21; i++) if (a[i] !== b[i]) a[i] = Math.abs(a[i] - b[i]) < 0.002 ? b[i] : U.damp(a[i], b[i], 16, dt);
    }
    V.logoReg = U.damp(V.logoReg, 1, 3, dt);
    if (held) updateHeld(dt);
    V.held = held;
    if (V.replay && clock >= V.replayNext) {
      stepReplay();
      V.replayNext += V.replayStep;
    }
    // scores roll toward their value
    for (const h of heads) {
      if (h.shown !== h.target) {
        const d = h.target - h.shown;
        h.acc = (h.acc || 0) + dt * Math.max(14, Math.abs(d) * 9);
        while (h.acc >= 1 && h.shown !== h.target) {
          h.acc -= 1;
          h.shown += Math.sign(d);
        }
        h.score.textContent = h.shown;
      }
    }
  }

  /* ------------------------------------------------------------ title */
  const logoCv = $('#logo');
  let logoCtx = null;
  function sizeLogo() {
    // sized in real pixels; the css box is divided by the title's zoom
    const w = Math.min(W * 0.88, 880 * uiZoom);
    // a cell of margin all round, so the plates have room while they settle
    const cs = Math.floor(w / (R.LOGO.w + 2));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = cs * (R.LOGO.w + 2), ch = cs * (R.LOGO.h + 2);
    logoCv.width = Math.round(cw * dpr);
    logoCv.height = Math.round(ch * dpr);
    logoCv.style.width = cw / uiZoom + 'px';
    logoCv.style.height = ch / uiZoom + 'px';
    logoCtx = logoCv.getContext('2d');
    logoCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    logoCv._cs = cs;
    logoLast = null;
  }
  let logoLast = null; // plate offsets last printed: a logo at rest isn't re-printed every frame
  function drawLogo(dt) {
    if (!logoCtx) return;
    const cs = logoCv._cs;
    const x = logoCtx;
    const t = clock - title.t0;
    const target = title.leaveAt ? 0 : 1;
    title.reg = U.damp(title.reg, target, title.leaveAt ? 22 : 4, dt);
    const px = ptr.x < 0 ? 0 : (ptr.x / W - 0.5) * 2, py = ptr.y < 0 ? 0 : (ptr.y / H - 0.5) * 2;
    // always fully printed; on arrival the plates start far out of register and settle,
    // so the very first frame (and any link preview) already shows the name
    const settle = U.easeOutBack(U.clamp(t / 0.95, 0, 1), 1.5);
    const rg = title.reg * U.lerp(4.2, 1, settle);
    const a0 = (-0.1 + px * 0.08) * cs * rg, a1 = (-0.08 + py * 0.06) * cs * rg;
    const b0 = (0.2 - px * 0.08) * cs * rg, b1 = (0.16 - py * 0.06) * cs * rg;
    const L0 = logoLast;
    if (L0 && Math.abs(L0[0] - a0) < 0.01 && Math.abs(L0[1] - a1) < 0.01 && Math.abs(L0[2] - b0) < 0.01 && Math.abs(L0[3] - b1) < 0.01) return;
    logoLast = [a0, a1, b0, b1];
    x.clearRect(0, 0, logoCv.width, logoCv.height);
    R.drawLogo(x, cs, cs, cs, [a0, a1], [b0, b1], INK[0], INK[1]);
    R.applyGrain(x, logoCv.width, logoCv.height);
  }


  // v: 0 = player, 1–3 = CPU level
  function setSeat(p, v) {
    if (v > 0) lastLevel[p] = v;
    store.set('lastLevels', lastLevel);
    if (seats[p] === v) return false;
    seats[p] = v;
    store.set('seatLevels', seats);
    return true;
  }

  function buildTitle() {
    const wrap = $('#seats');
    wrap.innerHTML = '';
    for (let p = 0; p < 4; p++) {
      const el = document.createElement('div');
      el.className = 'seat';
      el.dataset.p = p;
      el.style.setProperty('--ink', `var(--inkp-${p})`);
      const name = NAMES[p];
      el.innerHTML =
        `<button type="button" class="seat-flood" aria-label="${name}: switch between player and CPU">` +
        `<span class="seat-name">${name}</span><span class="seat-corner c${p}" aria-hidden="true"></span></button>` +
        `<div class="seat-mode" role="radiogroup" aria-label="${name} is played by">` +
        `<button type="button" role="radio" data-v="0">Player</button><button type="button" role="radio" data-v="cpu">CPU</button></div>` +
        `<div class="seat-drawer"><div class="seat-drawer-in">` +
        `<div class="seat-level" role="radiogroup" aria-label="${name} CPU level">` +
        AI.LEVELS.map((lv, k) => `<button type="button" role="radio" data-v="${k + 1}">${lv}</button>`).join('') +
        `</div></div></div>`;
      el.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        A.init();
        let v;
        if (b.classList.contains('seat-flood')) v = seats[p] ? 0 : lastLevel[p];
        else if (b.dataset.v === 'cpu') v = seats[p] || lastLevel[p];
        else v = +b.dataset.v;
        if (setSeat(p, v)) {
          A.click();
          // each colour's own instrument, pitched up with the level
          A.note(p, v ? 1 + v * 2 : 0, 0.03, 0.7);
          el.classList.remove('stamp');
          void el.offsetWidth;
          el.classList.add('stamp');
        } else A.tick(0.8, 0.5);
        renderSeats();
      });
      el.addEventListener('pointerenter', () => A.uiHover());
      wrap.appendChild(el);
    }
    renderSeats();
  }
  function renderSeats() {
    document.querySelectorAll('.seat').forEach(el => {
      const p = +el.dataset.p, v = seats[p];
      el.classList.toggle('cpu', v > 0);
      // CPU seats are screened, denser for stronger levels
      el.style.setProperty('--dots', `var(--dots-${p}-${v || lastLevel[p]})`);
      el.querySelectorAll('.seat-mode button').forEach(b =>
        b.setAttribute('aria-checked', String(b.dataset.v === 'cpu' ? v > 0 : v === 0))
      );
      el.querySelectorAll('.seat-level button').forEach(b => b.setAttribute('aria-checked', String(+b.dataset.v === v)));
      // levels only exist for CPU seats: the drawer tucks away (and can't be tabbed into) for players
      const drawer = el.querySelector('.seat-drawer');
      drawer.inert = v === 0;
      drawer.setAttribute('aria-hidden', String(v === 0));
    });
  }

  function startFromTitle() {
    if (leaving) return;
    A.init();
    A.click();
    leaving = true;
    title.leaveAt = clock;
    A.stamp();
    setTimeout(() => {
      $('#title').classList.add('leave');
      A.paper(true);
    }, 220);
    setTimeout(() => {
      $('#title').hidden = true;
      $('#title').classList.remove('leave');
      leaving = false;
      newGame();
    }, 700);
  }

  function toTitle() {
    timers = [];
    g = null;
    V = null;
    held = null;
    armed = -1;
    phase = 'idle';
    scene = 'title';
    title.leaveAt = 0;
    title.reg = 1;
    title.t0 = clock;
    $('#hud').hidden = true;
    $('#results').hidden = true;
    showTools(false);
    hideTip();
    $('#fx').innerHTML = '';
    const t = $('#title');
    t.hidden = false;
    t.classList.add('enter');
    setTimeout(() => t.classList.remove('enter'), 600);
    A.setMusicState('title');
    renderSeats();
  }

  /* ------------------------------------------------------------- game */
  let firstSeat = 0; // the first turn moves one seat clockwise every sheet

  function makeView() {
    V = {
      g,
      now: clock,
      intro: null,
      turnP: -1,
      humanTurn: false,
      shadowFrom: -1,
      shadowTo: -1,
      shadowT: 1,
      anchors: [],
      anchorDelay: [],
      anchorsT0: 0,
      held: null,
      movable: null,
      lift: [0, 1, 2, 3].map(() => new Float32Array(21)),
      liftT: [0, 1, 2, 3].map(() => new Float32Array(21)),
      flyingPid: [-1, -1, -1, -1],
      stamps: [],
      ripples: [],
      specks: [],
      tokens: [],
      hiddenDrops: new Set(),
      spareHidden: [-1, -1, -1, -1], // spare drops not yet handed out on screen
      shake: 0,
      logoReg: 4,
      over: false,
      replay: false,
      replayCount: 0,
      replayHands: null,
      bakeCount: 0,
      fast: false,
    };
    held = null;
    armed = -1;
    hoverPid = -1;
  }

  function showGameUI() {
    scene = 'game';
    $('#title').hidden = true;
    $('#results').hidden = true;
    $('#fx').innerHTML = '';
    buildHeads();
    layoutHUD();
    updateHUD(true);
    const hud = $('#hud');
    hud.hidden = false;
    hud.classList.remove('in');
    void hud.offsetWidth;
    hud.classList.add('in');
    A.setMusicState('game');
  }

  function newGame() {
    timers = [];
    g = E.createGame({ cpu: seats.map(s => s > 0), first: firstSeat });
    g.players.forEach((pl, i) => (pl.level = seats[i]));
    firstSeat = (firstSeat + 1) % 4;
    cpuStyle = U.shuffle([0, 1, 2, 3]);
    makeView();
    V.intro = clock;
    // spare drops are handed out with a flourish once the sheet is in
    V.spareHidden = g.spare.slice();
    R.bakeInk(g, 0);
    phase = 'intro';
    showGameUI();
    A.feed();
    g.holes.forEach((h, k) => A.punch(0.75 + k * 0.045));
    let k = 0;
    for (let i = 0; i < E.NN; i++) {
      if (g.drops[i] < 0) continue;
      const r = (i / N) | 0, c = i % N;
      A.pop(1.0 + ((r * 7 + c * 3) % 12) * 0.03, 1 + (k++ % 3) * 0.2);
    }
    g.spare.forEach((t, p) => {
      if (t < 0) return;
      later(1.25 + (p === (g.turn + 3) % 4 ? 0.14 : 0), () => {
        V.spareHidden[p] = -1;
        renderTokens(p, t);
        A.land();
      });
    });
    later(1.6, () => {
      V.intro = null;
      beginTurn();
    });
  }

  /* ------------------------------------------------------- live updates */
  // When a new version of the page is delivered to an open viewer, the game in progress carries over.
  function snapshot() {
    if (scene !== 'game' || !g) return { scene: 'title' };
    return {
      scene: 'game',
      firstSeat,
      cpuStyle: cpuStyle.slice(),
      g: {
        seed: g.seed,
        cells: Array.from(g.cells),
        drops: Array.from(g.drops),
        initialDrops: Array.from(g.initialDrops),
        pieceOf: Array.from(g.pieceOf),
        holes: g.holes,
        spare: g.spare,
        placements: g.placements,
        players: g.players.map(pl => ({ ...pl, hand: pl.hand.slice(), powers: pl.powers.slice() })),
        turn: g.turn,
        turnCount: g.turnCount,
        over: g.over,
        moved: !!g.moved,
      },
    };
  }

  function restore(d) {
    const s = d.g;
    g = {
      ...s,
      cells: Int8Array.from(s.cells),
      drops: Int8Array.from(s.drops),
      initialDrops: Int8Array.from(s.initialDrops),
      pieceOf: Int16Array.from(s.pieceOf),
    };
    firstSeat = d.firstSeat | 0;
    if (Array.isArray(d.cpuStyle)) cpuStyle = d.cpuStyle;
    timers = [];
    makeView();
    V.bakeCount = g.placements.length;
    R.bakeInk(g, V.bakeCount);
    showGameUI();
    g.players.forEach((pl, p) => {
      if (pl.out && pl.handCount === 0) stampHead(p, 'done');
      else if (pl.out) stampHead(p, 'out');
    });
    if (g.over) endGame();
    else if (g.moved) nextTurn(); // the last move landed but the turn hadn't passed yet
    else beginTurn();
  }

  function setShadow(p) {
    if (V.shadowTo === p) return;
    V.shadowFrom = V.shadowTo;
    V.shadowTo = p;
    V.shadowT = 0;
  }

  function beginTurn() {
    if (!g || g.over) return;
    const p = g.turn, pl = g.players[p];
    setShadow(p);
    V.turnP = p;
    V.anchors = [];
    V.movable = null;
    V.humanTurn = false;
    if (pl.out) {
      nextTurn();
      return;
    }
    if (!E.hasAnyMove(g, p)) {
      pl.out = true;
      phase = 'anim';
      updateHUD();
      stampHead(p, 'out');
      A.out(p);
      later(1.0 * spd(), nextTurn);
      return;
    }
    updateHUD();
    if (pl.cpu) {
      phase = 'cpu';
      A.turn(p, false);
      later((0.26 + Math.random() * 0.18) * spd(), () => cpuTurn(p));
    } else {
      phase = 'human';
      V.humanTurn = true;
      refreshHuman(true);
      A.turn(p, true);
      boxedTip(p);
    }
  }

  function nextTurn() {
    if (!g) return;
    g.moved = false;
    if (E.advance(g) < 0) {
      endGame();
      return;
    }
    V.fast = !g.players.some(pl => !pl.cpu && !pl.out);
    beginTurn();
  }

  function refreshHuman(fresh) {
    const p = g.turn;
    V.movable = E.movablePieces(g, p, armed);
    const an = armed === E.OFFSET ? [] : E.anchorsFor(g, p, armed);
    const corner = E.CORNERS[p], cr = (corner / N) | 0, cc = corner % N;
    V.anchors = an;
    V.anchorDelay = an.map(i => Math.min(0.45, (Math.abs(((i / N) | 0) - cr) + Math.abs((i % N) - cc)) * 0.011));
    if (fresh) V.anchorsT0 = clock;
    if (held) evaluateGhost();
    renderTokens(p);
  }

  function cpuTurn(p) {
    if (!g || phase !== 'cpu' || g.turn !== p) return;
    const m = AI.choose(g, p, Math.random, cpuStyle[p], g.players[p].level);
    if (!m) {
      g.players[p].out = true;
      stampHead(p, 'out');
      A.out(p);
      later(1.0 * spd(), nextTurn);
      return;
    }
    V.liftT[p][m.pid] = 1;
    A.hover();
    later(0.24 * spd(), () => {
      V.liftT[p][m.pid] = 0;
      V.lift[p][m.pid] = 0;
      const T = L.trays[p], slot = T.slots[m.pid];
      const n = R.normCells(m.cells), d = OP.pieceDims(n.cells);
      const from = { x: slot.cx - (d.w * T.cs) / 2, y: slot.cy - (d.h * T.cs) / 2, cs: T.cs };
      V.flyingPid[p] = m.pid;
      if (m.power >= 0) fireToken(p, m.power);
      A.pick();
      commitMove(p, m.pid, m.cells, m.power, from, 0.4 * spd());
    });
  }

  function makeStamp(p, cells, w, h, from, to, flight) {
    const t0 = clock;
    const pre = flight > 0 ? 0.04 : 0.07;
    const slam = 0.085;
    const settle = 0.34;
    const st = { p, cells, w, h, landed: false, impacted: false };
    st.impactAt = t0 + flight + pre + slam;
    st.endAt = st.impactAt + settle;
    st.pose = now => {
      const u = now - t0;
      if (u < flight) {
        const k = U.easeInOutCubic(u / flight);
        return {
          x: U.lerp(from.x, to.x, k),
          y: U.lerp(from.y, to.y, k) - Math.sin(k * Math.PI) * to.cs * 1.1,
          cs: U.lerp(from.cs, to.cs, k),
          lift: 1,
          squash: 0,
          reg: null,
        };
      }
      if (now < st.impactAt - slam) {
        const k = (u - flight) / pre;
        return { x: to.x, y: to.y, cs: to.cs, lift: flight > 0 ? 1 : U.easeOutCubic(k) * 0.75, squash: 0, reg: null };
      }
      if (now < st.impactAt) {
        const k = (now - (st.impactAt - slam)) / slam;
        return { x: to.x, y: to.y, cs: to.cs, lift: (flight > 0 ? 1 : 0.75) * (1 - U.easeInCubic(k)), squash: 0, reg: null };
      }
      const k = Math.min(1, (now - st.impactAt) / settle);
      const sq = Math.exp(-k * 7) * Math.cos(k * 20);
      return { x: to.x, y: to.y, cs: to.cs, lift: 0, squash: sq, reg: to.cs * (0.06 + 0.28 * Math.exp(-k * 5.5) * Math.cos(k * 17)) };
    };
    return st;
  }

  function commitMove(p, pid, cells, power, from, flight) {
    phase = 'anim';
    const b = L.board, n = R.normCells(cells), d = OP.pieceDims(n.cells);
    const to = { x: b.x + n.c0 * b.cs, y: b.y + n.r0 * b.cs, cs: b.cs };
    const st = makeStamp(p, n.cells, d.w, d.h, from, to, flight);
    st.onImpact = () => impact(p, pid, cells, power, n, d);
    st.onDone = () => {
      V.bakeCount = g.placements.length;
      R.bakeInk(g, V.bakeCount);
      later(0.05 * spd(), nextTurn);
    };
    V.stamps.push(st);
  }

  function impact(p, pid, cells, power, n, d) {
    const rec = E.applyMove(g, p, pid, cells, power);
    V.flyingPid[p] = -1;
    if (!rec) return;
    g.moved = true;
    const b = L.board, cs = b.cs, size = cells.length;
    A.place(p, size, rec.over.length);
    V.shake = 2 + size * 0.75 + rec.over.length * 2.5;
    const cx = n.c0 + d.w / 2, cy = n.r0 + d.h / 2;
    V.ripples.push({ p, cx, cy, t0: clock, dur: 0.95, maxR: cs * (5.5 + size * 1.3) });
    spawnSpecks(cells, p, cx, cy);
    const px = b.x + cx * cs, py = b.y + cy * cs;
    floatLabel(px, py - cs * 0.2, '+' + size, DEEP[p]);
    if (rec.used >= 0) floatLabel(px, b.y + n.r0 * cs - cs * 0.9, POWERS[rec.used].name, DEEP[p], 'word');
    if (rec.over.length) {
      const hit = {};
      rec.over.forEach(o => (hit[o.from] = hit[o.from] || []).push(o.i));
      Object.keys(hit).forEach(q => {
        const c = R.cellCenter(hit[q][0]);
        later(0.12, () => floatLabel(c.x, c.y + cs * 0.4, '−' + hit[q].length, DEEP[+q], 'minus'));
        bumpHead(+q);
      });
    }
    rec.collected.forEach((c, k) => {
      const cc = R.cellCenter(c.i);
      const tgt = tokenTarget(p);
      V.tokens.push({
        type: c.type,
        x0: cc.x,
        y0: cc.y,
        x1: tgt.x,
        y1: tgt.y,
        cs,
        t0: clock + 0.1 + k * 0.12,
        dur: 0.72,
        onLand: () => {
          A.land();
          renderTokens(p, c.type);
          powerTip(p, c.type);
        },
      });
      later(0.08 + k * 0.12, () => A.collect(c.type));
    });
    const pl = g.players[p];
    if (!pl.cpu) armed = -1;
    if (pl.handCount === 0) {
      pl.out = true;
      later(0.4, () => {
        stampHead(p, 'done');
        A.finish(p);
        const T = L.trays[p];
        floatLabel(T.x + T.w / 2, T.y + T.h / 2, '+' + E.FULL_BONUS, DEEP[p], 'word');
      });
    }
    updateHUD(false, rec.collected.length ? p : -1);
  }

  function spawnSpecks(cells, p, cx, cy) {
    const b = L.board, cs = b.cs;
    for (const i of cells) {
      const r = (i / N) | 0, c = i % N;
      for (let k = 0; k < 4; k++) {
        const px = b.x + (c + Math.random()) * cs, py = b.y + (r + Math.random()) * cs;
        let ang = Math.atan2(py - (b.y + cy * cs), px - (b.x + cx * cs)) + (Math.random() - 0.5) * 1.2;
        const sp = 70 + Math.random() * 230;
        const life = 0.3 + Math.random() * 0.45;
        V.specks.push({
          x: px,
          y: py,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          r: 0.7 + Math.random() * Math.max(1.2, cs * 0.06),
          life,
          max: life,
          color: Math.random() < 0.82 ? INK[p] : THEME.key,
        });
      }
    }
  }

  /* -------------------------------------------------------- end game */
  function endGame() {
    phase = 'over';
    V.over = true;
    held = null;
    armed = -1;
    V.anchors = [];
    V.turnP = -1;
    V.humanTurn = false;
    setShadow(-1);
    showTools(false);
    hideTip();
    updateHUD();
    A.setMusicState('title');
    later(0.7, startReplay);
  }

  function startReplay() {
    if (!V) return;
    V.replay = true;
    V.replayCount = 0;
    V.replayHands = [0, 1, 2, 3].map(() => new Uint8Array(21).fill(1));
    replayScores = [0, 0, 0, 0];
    heads.forEach(h => {
      h.target = 0;
      h.shown = 0;
      h.score.textContent = '0';
      h.el.classList.remove('done', 'out');
      h.stamp.className = 'head-stamp';
    });
    R.bakeInk(g, 0);
    V.replayStep = U.clamp(3.4 / Math.max(1, g.placements.length), 0.028, 0.08);
    V.replayNext = clock + 0.35;
    A.paper(false);
  }

  function stepReplay() {
    const k = V.replayCount;
    const pl = g.placements[k];
    if (!pl) {
      finishReplay();
      return;
    }
    V.replayCount++;
    V.replayHands[pl.p][pl.pid] = 0;
    replayScores[pl.p] += pl.cells.length;
    pl.over.forEach(o => replayScores[o.from]--);
    heads.forEach((h, p) => (h.target = replayScores[p]));
    R.bakeInk(g, V.replayCount);
    A.replayTick(pl.p, k);
    if (k % 4 === 0) {
      const n = R.normCells(pl.cells), d = OP.pieceDims(n.cells);
      V.ripples.push({ p: pl.p, cx: n.c0 + d.w / 2, cy: n.r0 + d.h / 2, t0: clock, dur: 0.7, maxR: L.board.cs * 4 });
    }
  }

  function finishReplay() {
    if (!V || !V.replay) return;
    V.replay = false;
    V.replayHands = null;
    V.replayCount = g.placements.length;
    R.bakeInk(g, g.placements.length);
    heads.forEach((h, p) => {
      h.target = E.score(g, p);
      if (g.players[p].handCount === 0) stampHead(p, 'done');
    });
    later(0.45, showResults);
  }

  function skipReplay() {
    if (!V || !V.replay) return;
    while (V.replay && V.replayCount < g.placements.length) {
      const pl = g.placements[V.replayCount++];
      V.replayHands[pl.p][pl.pid] = 0;
      replayScores[pl.p] += pl.cells.length;
      pl.over.forEach(o => replayScores[o.from]--);
    }
    heads.forEach((h, p) => (h.target = replayScores[p]));
    A.paper(true);
    finishReplay();
  }

  function showResults() {
    if (!g) return;
    const st = E.standings(g);
    const winners = st.filter(r => r.rank === 1);
    const names = winners.map(r => `<span style="color:${DEEP[r.p]}">${NAMES[r.p]}</span>`);
    const headline = winners.length === 1 ? `${names[0]} wins` : `${names.join(' &amp; ')} tie`;
    const rows = st
      .map(r => {
        const pl = g.players[r.p];
        const who = pl.cpu ? `CPU · ${AI.LEVELS[pl.level - 1]}` : humanCount() === 1 ? 'You' : 'Player';
        const detail = r.left === 0 ? `${r.squares} squares + ${r.bonus} for printing every piece` : `${r.squares} squares · ${r.left} piece${r.left === 1 ? '' : 's'} left`;
        return `<li class="res-row${r.rank === 1 ? ' top' : ''}" style="--ink:${INK[r.p]};--deep:${DEEP[r.p]}">
          <span class="res-rank">${r.rank}</span>
          <span class="res-chip"></span>
          <span class="res-name">${NAMES[r.p]}<small>${who}</small><em>${detail}</em></span>
          <span class="res-score">${r.score}</span>
        </li>`;
      })
      .join('');
    $('#res-title').innerHTML = headline;
    $('#res-list').innerHTML = rows;
    const el = $('#results');
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    A.win();
  }

  /* ------------------------------------------------------ human input */
  function pick(pid) {
    const p = g.turn;
    const rot = R.TRAY_ROT[pid];
    const cells = OP.pieceTransform(PIECES[pid].base, rot, false);
    const d = OP.pieceDims(cells);
    const T = L.trays[p], slot = T.slots[pid];
    held = {
      p,
      pid,
      rot,
      flip: false,
      cells,
      w: d.w,
      h: d.h,
      px: slot.x,
      py: slot.y,
      cs: T.cs,
      onBoard: false,
      r0: -99,
      c0: -99,
      valid: false,
      uses: false,
      rotA: 0,
      flipS: 1,
      nudge: 0,
      shakeT: 0,
      shakeX: 0,
      abs: null,
      badMask: null,
      overMask: null,
      kb: false,
    };
    if (hoverPid >= 0) V.liftT[p][hoverPid] = 0;
    hoverPid = -1;
    A.pick();
    if (ptr.type === 'touch' || coarse) defaultGhost();
    else positionHeld(true);
    showTools(true);
    controlsTip();
  }

  function putBack(silent) {
    if (!held) return;
    held = null;
    if (!silent) A.putBack();
    showTools(false);
    setCursor('');
  }

  function setOrientation(rot, flip) {
    held.rot = rot & 3;
    held.flip = flip;
    held.cells = OP.pieceTransform(PIECES[held.pid].base, held.rot, held.flip);
    const d = OP.pieceDims(held.cells);
    // keep the piece centred where it was
    if (held.onBoard) {
      const cr = held.r0 + held.h / 2, cc = held.c0 + held.w / 2;
      held.w = d.w;
      held.h = d.h;
      const r0 = U.clamp(Math.round(cr - d.h / 2), 0, N - d.h), c0 = U.clamp(Math.round(cc - d.w / 2), 0, N - d.w);
      held.fr = r0;
      held.fc = c0;
      if (held.kb || ptr.type === 'touch' || coarse) setGhost(r0, c0, true);
      else positionHeld(true);
      const b = L.board;
      held.px = b.x + held.c0 * b.cs + (cc - (held.c0 + d.w / 2)) * b.cs;
      held.py = b.y + held.r0 * b.cs + (cr - (held.r0 + d.h / 2)) * b.cs;
    } else {
      held.w = d.w;
      held.h = d.h;
    }
  }

  function rotate(dir) {
    if (!held) return;
    setOrientation(held.rot + (dir > 0 ? 1 : 3), held.flip);
    held.rotA = (-dir * Math.PI) / 2;
    A.rotate(dir);
    markSeen('controls');
    if (tipKey === 'controls') hideTip();
  }

  function flip() {
    if (!held) return;
    setOrientation((4 - held.rot) & 3, !held.flip);
    held.flipS = -1;
    A.flip();
    markSeen('controls');
    if (tipKey === 'controls') hideTip();
  }

  function positionHeld(force) {
    const hd = held;
    if (!hd) return;
    if (hd.kb || ptr.type === 'touch' || coarse) {
      if (hd.r0 === -99) defaultGhost();
      return;
    }
    const b = L.board;
    const col = (ptr.x - b.x) / b.cs, row = (ptr.y - b.y) / b.cs;
    const m = 0.65;
    if (col > -m && row > -m && col < N + m && row < N + m) {
      setGhost(U.clamp(Math.round(row - hd.h / 2), 0, N - hd.h), U.clamp(Math.round(col - hd.w / 2), 0, N - hd.w), force);
    } else {
      hd.onBoard = false;
      hd.r0 = -99;
      hd.c0 = -99;
    }
  }

  // touch / keyboard: start the ghost somewhere it actually fits
  function defaultGhost() {
    const hd = held;
    const oi = OP.orientFor(hd.pid, hd.rot, hd.flip);
    let best = null;
    const tryPower = pw =>
      E.forEachMove(
        g,
        hd.p,
        pw,
        (pid, o, r0, c0) => {
          if (o !== oi) return false;
          best = { r0, c0 };
          return true;
        },
        hd.pid
      );
    tryPower(-1) || (armed >= 0 && tryPower(armed));
    if (!best) {
      const an = E.anchorsFor(g, hd.p, armed);
      const a = an.length ? an[0] : E.CORNERS[hd.p];
      best = { r0: U.clamp(((a / N) | 0) - (hd.h >> 1), 0, N - hd.h), c0: U.clamp((a % N) - (hd.w >> 1), 0, N - hd.w) };
    }
    const b = L.board;
    hd.px = b.x + best.c0 * b.cs;
    hd.py = b.y + best.r0 * b.cs;
    hd.fr = best.r0;
    hd.fc = best.c0;
    setGhost(best.r0, best.c0, true);
  }

  function setGhost(r0, c0, force) {
    const hd = held;
    const was = hd.r0;
    if (!force && r0 === hd.r0 && c0 === hd.c0 && hd.onBoard) return;
    const moved = was !== -99 && (r0 !== hd.r0 || c0 !== hd.c0);
    hd.r0 = r0;
    hd.c0 = c0;
    hd.onBoard = true;
    hd.abs = hd.cells.map(([r, c]) => (r0 + r) * N + c0 + c);
    evaluateGhost();
    if (moved) A.tick(hd.valid ? 1.2 : 0.75, hd.valid ? 0.6 : 0.4);
  }

  function evaluateGhost() {
    const hd = held;
    if (!hd || !hd.abs) return;
    const p = hd.p, C = g.cells;
    const info = { over: 0, uses: false };
    hd.valid = E.check(g, p, hd.abs, hd.abs.length, armed, info);
    hd.uses = info.uses;
    hd.overMask = hd.valid && info.over ? hd.abs.map(i => (C[i] >= 0 && C[i] !== p ? 1 : 0)) : null;
    hd.badMask = null;
    if (!hd.valid) {
      const first = g.players[p].placed === 0;
      hd.badMask = hd.abs.map(i => {
        const v = C[i];
        if (v === E.HOLE || v === p) return 1;
        if (v >= 0 && (armed !== E.OVERPRINT || first)) return 1;
        if (!first && armed !== E.BLEED) for (const o of E.ORTH[i]) if (C[o] === p) return 1;
        return 0;
      });
    }
  }

  function updateHeld(dt) {
    const hd = held, b = L.board;
    let tx, ty;
    if (hd.onBoard) {
      tx = b.x + hd.c0 * b.cs;
      ty = b.y + hd.r0 * b.cs;
    } else {
      tx = ptr.x - (hd.w * b.cs) / 2;
      ty = ptr.y - (hd.h * b.cs) / 2;
    }
    const k = hd.onBoard ? 38 : 28;
    hd.px = U.damp(hd.px, tx, k, dt);
    hd.py = U.damp(hd.py, ty, k, dt);
    hd.cs = U.damp(hd.cs, b.cs, 16, dt);
    hd.rotA = U.damp(hd.rotA, 0, 24, dt);
    hd.flipS = U.damp(hd.flipS, 1, 22, dt);
    if (hd.shakeT > 0) {
      hd.shakeT = Math.max(0, hd.shakeT - dt);
      hd.shakeX = Math.sin(hd.shakeT * 75) * hd.shakeT * 26;
    } else hd.shakeX = 0;
  }

  function tryPlace() {
    if (!held || phase !== 'human' || !held.onBoard) return;
    if (!held.valid) {
      held.shakeT = 0.3;
      A.invalid();
      return;
    }
    const hd = held;
    held = null;
    showTools(false);
    hideTip();
    setCursor('');
    V.anchors = [];
    V.movable = null;
    V.humanTurn = false;
    const power = hd.uses ? armed : -1;
    if (power >= 0) fireToken(hd.p, power);
    V.flyingPid[hd.p] = hd.pid; // it's on its way down: keep its tray slot empty until it lands
    commitMove(hd.p, hd.pid, hd.abs.slice(), power, { x: hd.px, y: hd.py, cs: L.board.cs }, 0);
  }

  function toggleArm(t) {
    if (phase !== 'human' || !g) return;
    const p = g.turn;
    if (!g.players[p].powers[t] || !g.players[p].placed) return;
    armed = armed === t ? -1 : t;
    if (armed >= 0) A.arm();
    else A.disarm();
    if (armed >= 0) markSeen('arm');
    refreshHuman(false);
    hideTip();
    if (held && held.onBoard) evaluateGhost();
  }

  function cyclePiece(dir) {
    if (phase !== 'human') return;
    const p = g.turn, pl = g.players[p];
    const order = [20, 19, 17, 18, 16, 15, 10, 11, 12, 13, 14, 6, 7, 8, 5, 3, 9, 4, 2, 1, 0].filter(i => pl.hand[i] && V.movable && V.movable[i]);
    if (!order.length) return;
    let k = held ? order.indexOf(held.pid) : -1;
    k = (k + dir + order.length) % order.length;
    const keep = held && held.onBoard ? { r: held.r0 + held.h / 2, c: held.c0 + held.w / 2 } : null;
    putBack(true);
    pick(order[k]);
    held.kb = true;
    if (keep) {
      setGhost(U.clamp(Math.round(keep.r - held.h / 2), 0, N - held.h), U.clamp(Math.round(keep.c - held.w / 2), 0, N - held.w), true);
    } else defaultGhost();
  }

  function moveGhost(dr, dc) {
    if (!held) return;
    held.kb = true;
    if (!held.onBoard || held.r0 === -99) {
      defaultGhost();
      return;
    }
    setGhost(U.clamp(held.r0 + dr, 0, N - held.h), U.clamp(held.c0 + dc, 0, N - held.w));
  }

  function trayHit(p, x, y) {
    const T = L.trays[p];
    if (x < T.x || x > T.x + T.w || y < T.y || y > T.y + T.h) return -2;
    const pad = T.cs * 0.45;
    for (const s of T.slots) {
      if (x >= s.x - pad && x <= s.x + s.w * T.cs + pad && y >= s.y - pad && y <= s.y + s.h * T.cs + pad) return s.pid;
    }
    return -1;
  }

  function overBoard(x, y, m = 0) {
    const b = L.board;
    return x > b.x - m * b.cs && y > b.y - m * b.cs && x < b.x + b.size + m * b.cs && y < b.y + b.size + m * b.cs;
  }

  let cursor = '';
  function setCursor(c) {
    if (c === cursor) return;
    cursor = c;
    stage.style.cursor = c;
  }

  function onDown(e) {
    A.init();
    ptr.type = e.pointerType || 'mouse';
    ptr.x = ptr.lx = ptr.sx = e.clientX - offX;
    ptr.y = ptr.ly = ptr.sy = e.clientY - offY;
    ptr.down = true;
    ptr.drag = false;
    ptr.picked = false;
    ptr.onBoard = false;
    if (scene !== 'game' || !V) return;
    if (V.replay) {
      skipReplay();
      return;
    }
    if (phase !== 'human') return;
    const p = g.turn;
    if (e.button === 2) {
      if (held) flip();
      return;
    }
    if (e.button === 1) {
      e.preventDefault();
      if (held) rotate(1);
      return;
    }
    const hit = trayHit(p, ptr.x, ptr.y);
    if (hit >= 0 && g.players[p].hand[hit]) {
      if (held && held.pid === hit) {
        putBack();
        return;
      }
      if (V.movable && !V.movable[hit]) {
        A.invalid();
        V.lift[p][hit] = -0.6;
        if (g.players[p].powers.some(n => n > 0)) boxedTip(p, true);
        return;
      }
      if (held) putBack(true);
      pick(hit);
      ptr.picked = true;
      return;
    }
    if (hit === -1 && held) {
      putBack();
      return;
    }
    if (held && (ptr.type === 'touch' || coarse) && overBoard(ptr.x, ptr.y, 1.5)) ptr.onBoard = true;
  }

  function onMove(e) {
    if (e.pointerType) ptr.type = e.pointerType;
    ptr.x = e.clientX - offX;
    ptr.y = e.clientY - offY;
    if (ptr.down && !ptr.drag && Math.hypot(ptr.x - ptr.sx, ptr.y - ptr.sy) > 7) ptr.drag = true;
    if (scene !== 'game' || !V) return;
    dropHover();
    if (phase !== 'human') {
      setCursor(V.replay ? 'pointer' : '');
      ptr.lx = ptr.x;
      ptr.ly = ptr.y;
      return;
    }
    const p = g.turn;
    if (held) {
      if (ptr.type === 'touch' || coarse) {
        if (ptr.down && ptr.onBoard) {
          const b = L.board;
          held.fr = (held.fr != null ? held.fr : held.r0) + (ptr.y - ptr.ly) / b.cs;
          held.fc = (held.fc != null ? held.fc : held.c0) + (ptr.x - ptr.lx) / b.cs;
          held.fr = U.clamp(held.fr, 0, N - held.h);
          held.fc = U.clamp(held.fc, 0, N - held.w);
          setGhost(Math.round(held.fr), Math.round(held.fc));
        }
      } else {
        held.kb = false;
        positionHeld(false);
      }
    }
    ptr.lx = ptr.x;
    ptr.ly = ptr.y;
    if (ptr.type !== 'touch') {
      const hit = trayHit(p, ptr.x, ptr.y);
      const pid = hit >= 0 && g.players[p].hand[hit] && !(held && held.pid === hit) ? hit : -1;
      if (pid !== hoverPid) {
        if (hoverPid >= 0) V.liftT[p][hoverPid] = 0;
        hoverPid = pid;
        if (pid >= 0 && V.movable && V.movable[pid]) {
          V.liftT[p][pid] = 1;
          A.hover();
        }
      }
      setCursor(pid >= 0 ? (V.movable && V.movable[pid] ? 'pointer' : 'not-allowed') : held ? 'grabbing' : '');
    }
  }

  // name the power under the pointer when hovering an ink drop on the sheet
  let hoverDrop = -1;
  function dropHover() {
    let i = -1;
    if (!held && !V.replay && ptr.type !== 'touch' && overBoard(ptr.x, ptr.y)) {
      const b = L.board;
      const c = Math.floor((ptr.x - b.x) / b.cs), r = Math.floor((ptr.y - b.y) / b.cs);
      const k = r * N + c;
      if (g.drops[k] >= 0) i = k;
    }
    if (i === hoverDrop) return;
    hoverDrop = i;
    if (i >= 0) {
      const t = g.drops[i], cc = R.cellCenter(i);
      tip(`<b>${POWERS[t].name}</b>${POWERS[t].text}<span class="tip-hint">Cover the drop to collect it</span>`, cc.x + offX, cc.y + offY + L.board.cs * 0.7, 4000, 'drop');
    } else if (tipKey === 'drop') hideTip();
  }

  function onUp(e) {
    if (!ptr.down) return;
    ptr.down = false;
    if (scene !== 'game' || !V || phase !== 'human' || !held) return;
    if (ptr.type === 'touch' || coarse) return; // touch confirms with the ✓ button
    if (e.button !== 0) return;
    if (ptr.picked && !ptr.drag) return; // the click that picked it up
    if (held.onBoard) tryPlace();
    else if (ptr.picked && ptr.drag && trayHit(g.turn, ptr.x, ptr.y) !== -2) putBack();
  }

  let wheelAcc = 0, wheelLast = 0, wheelFire = 0;
  function onWheel(e) {
    if (scene !== 'game' || !held) return;
    e.preventDefault();
    const t = performance.now();
    if (t - wheelLast > 250) wheelAcc = 0;
    wheelLast = t;
    wheelAcc += e.deltaY + e.deltaX;
    if (Math.abs(wheelAcc) > 36 && t - wheelFire > 110) {
      rotate(wheelAcc > 0 ? 1 : -1);
      wheelAcc = 0;
      wheelFire = t;
    }
  }

  function onKey(e) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Escape') {
      if (rulesOpen) closeRules();
      else if (menuOpen) closeMenu();
      else if (held) putBack();
      else if (scene === 'game' && !leaving) openMenu();
      return;
    }
    if (rulesOpen || menuOpen) return;
    if (scene === 'title') {
      if (k === 'Enter' && document.activeElement === document.body) startFromTitle();
      return;
    }
    if (!V) return;
    if (k === 'm') {
      setPrefs(prefs.sfx, !prefs.music);
      return;
    }
    if (V.replay) {
      if (k === ' ' || k === 'Enter') skipReplay();
      return;
    }
    if (phase !== 'human') return;
    if (k === 'r' || k === 'e') rotate(e.shiftKey ? -1 : 1);
    else if (k === 'q') rotate(-1);
    else if (k === 'f' || k === 'w') flip();
    else if (k === '1' || k === '2' || k === '3') {
      const pl = g.players[g.turn];
      const list = [0, 1, 2].filter(t => pl.powers[t] > 0);
      const t = list[+k - 1];
      if (t != null) toggleArm(t);
    } else if (k === 'Tab' || k === ']' || k === '[') {
      e.preventDefault();
      cyclePiece(k === '[' || e.shiftKey ? -1 : 1);
    } else if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
      if (!held) return;
      e.preventDefault();
      moveGhost(k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0, k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0);
    } else if (k === 'Enter' || k === ' ') {
      if (!held) return;
      e.preventDefault();
      if (!held.onBoard) {
        held.kb = true;
        defaultGhost();
      } else tryPlace();
    }
  }

  /* --------------------------------------------------------------- HUD */
  let heads = [];
  function buildHeads() {
    const wrap = $('#heads');
    wrap.innerHTML = '';
    heads = [0, 1, 2, 3].map(p => {
      const el = document.createElement('div');
      el.className = 'head';
      el.style.setProperty('--d', 0.5 + p * 0.08 + 's');
      el.style.setProperty('--ink', `var(--inkp-${p})`);
      el.style.setProperty('--deep', DEEP[p]);
      el.innerHTML = `<div class="head-band"></div><div class="head-name"><span class="chip"></span><span class="nm">${NAMES[p]}</span><span class="who"></span></div><div class="head-powers"></div><div class="head-score">0</div><div class="head-stamp"></div>`;
      wrap.appendChild(el);
      const h = {
        el,
        who: el.querySelector('.who'),
        powers: el.querySelector('.head-powers'),
        score: el.querySelector('.head-score'),
        stamp: el.querySelector('.head-stamp'),
        shown: 0,
        target: 0,
        acc: 0,
        html: '',
      };
      h.powers.addEventListener('click', e => {
        const b = e.target.closest('.token');
        if (b && !b.disabled) {
          A.init();
          toggleArm(+b.dataset.t);
        }
      });
      h.powers.addEventListener('pointerover', e => {
        const b = e.target.closest('.token');
        if (!b) return;
        const t = +b.dataset.t, r = b.getBoundingClientRect();
        const pl = g.players[p];
        let hint = '';
        if (!b.disabled) hint = 'Click to arm · key ' + (1 + [0, 1, 2].filter(x => pl.powers[x] > 0).indexOf(t));
        else if (!pl.cpu && !pl.placed) hint = 'Usable once your first piece is down';
        tip(`<b>${POWERS[t].name}</b>${POWERS[t].text}${hint ? `<span class="tip-hint">${hint}</span>` : ''}`, r.left + r.width / 2, r.bottom + 10, 3200, 'token');
      });
      h.powers.addEventListener('pointerout', e => {
        if (e.target.closest('.token') && tipKey === 'token') hideTip();
      });
      h.who.addEventListener('pointerenter', () => {
        const pl = g && g.players[p];
        if (!pl || !pl.cpu) return;
        const r = h.who.getBoundingClientRect();
        tip(`<b>${AI.LEVELS[pl.level - 1]} CPU</b>${LEVEL_BLURB[pl.level - 1]}`, r.left + r.width / 2, r.bottom + 10, 2600, 'who');
      });
      h.who.addEventListener('pointerleave', () => {
        if (tipKey === 'who') hideTip();
      });
      return h;
    });
  }

  function layoutHUD() {
    heads.forEach((h, p) => {
      const T = L.trays[p];
      Object.assign(h.el.style, { left: T.x + 'px', top: T.y + 'px', width: T.w + 'px', height: T.headH + 'px' });
      h.el.style.setProperty('--hh', T.hh + 'px');
      h.el.classList.toggle('two', !!T.two);
      h.el.style.setProperty('--stamp-y', Math.round(T.headH + (T.h - T.headH) * 0.48) + 'px');
    });
    const mb = $('#menu-btn');
    Object.assign(mb.style, { left: L.menu.x + 'px', top: L.menu.y + 'px', width: L.menu.s + 'px', height: L.menu.s + 'px' });
  }

  function updateHUD(instant, popFor = -1) {
    if (!g) return;
    const solo = humanCount() === 1;
    heads.forEach((h, p) => {
      const pl = g.players[p];
      h.el.classList.toggle('active', V.turnP === p && !pl.out && !V.over);
      h.el.classList.toggle('thinking', V.turnP === p && pl.cpu && !pl.out && !V.over);
      h.el.classList.toggle('out', pl.out && pl.handCount > 0);
      // CPU tag carries the level as pips: ■□□ amateur, ■■□ intermediate, ■■■ expert
      const who = pl.cpu ? `CPU<i class="pips" data-l="${pl.level}"><b></b><b></b><b></b></i>` : solo ? 'You' : '';
      if (h.whoHtml !== who) {
        h.who.innerHTML = who;
        h.whoHtml = who;
      }
      h.target = E.score(g, p);
      if (instant) {
        h.shown = h.target;
        h.score.textContent = h.target;
      }
      if (p !== popFor) renderTokens(p);
    });
  }

  function renderTokens(p, popType = -1) {
    const h = heads[p];
    if (!h || !g) return;
    const pl = g.players[p];
    const live = phase === 'human' && g.turn === p && !pl.cpu && pl.placed > 0;
    let html = '';
    for (let t = 0; t < 3; t++) {
      const n = pl.powers[t] - (V && V.spareHidden[p] === t ? 1 : 0);
      if (n <= 0) continue;
      const cls = 'token' + (live && armed === t ? ' armed' : '') + (popType === t ? ' pop' : '') + (live ? ' live' : '');
      html += `<button class="${cls}" data-t="${t}" ${live ? '' : 'disabled tabindex="-1"'} aria-label="${POWERS[t].name}">${iconSvg(t)}${n > 1 ? `<i>${n}</i>` : ''}</button>`;
    }
    if (h.html !== html) {
      h.powers.innerHTML = html;
      h.html = html;
    }
  }

  function fireToken(p, t) {
    const h = heads[p];
    const b = h && h.powers.querySelector(`.token[data-t="${t}"]`);
    if (b) b.classList.add('fire');
    A.arm();
  }

  function tokenTarget(p) {
    const h = heads[p];
    const r = h.powers.getBoundingClientRect();
    const hh = L.trays[p].headH;
    return { x: (r.width ? r.right : r.left) + hh * 0.3 - offX, y: r.top + r.height / 2 - offY };
  }

  function stampHead(p, kind) {
    const h = heads[p];
    h.stamp.textContent = kind === 'out' ? 'Out' : 'All in';
    h.stamp.className = 'head-stamp show ' + kind;
    h.el.classList.toggle('out', kind === 'out');
    h.el.classList.toggle('done', kind === 'done');
    h.el.classList.remove('active', 'thinking');
  }

  function bumpHead(p) {
    const el = heads[p].el;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function floatLabel(x, y, text, color, cls = '') {
    const el = document.createElement('div');
    el.className = 'float ' + cls;
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.color = color;
    $('#fx').appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  /* -------------------------------------------------------------- tips */
  let tipKey = '', tipTimer = 0;
  function tip(html, x, y, ms, key) {
    const el = $('#tip');
    el.innerHTML = html;
    el.hidden = false;
    el.classList.remove('show');
    const r = el.getBoundingClientRect();
    const left = U.clamp(x - r.width / 2, offX + 10, offX + W - r.width - 10);
    const top = U.clamp(y, offY + 10, offY + H - r.height - 10);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    void el.offsetWidth;
    el.classList.add('show');
    tipKey = key;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(hideTip, ms);
  }
  function hideTip() {
    const el = $('#tip');
    el.classList.remove('show');
    tipKey = '';
    clearTimeout(tipTimer);
  }
  function controlsTip() {
    if (seen.controls || ptr.type === 'touch' || coarse) return;
    const b = L.board;
    tip('<b>Aim it</b>Scroll or <kbd>R</kbd> to rotate · right-click or <kbd>F</kbd> to flip · <kbd>Esc</kbd> to put it back', b.x + b.size / 2 + offX, b.y + b.size - 54 + offY, 7000, 'controls');
  }
  function powerTip(p, t) {
    const pl = g.players[p];
    if (pl.cpu || seen['power' + t]) return;
    markSeen('power' + t);
    const r = heads[p].powers.getBoundingClientRect();
    tip(`<b>${POWERS[t].name} collected</b>${POWERS[t].text}<span class="tip-hint">Click it on your turn to arm it.</span>`, r.right - 20, r.bottom + 10, 5200, 'power');
  }
  function boxedTip(p, force) {
    const pl = g.players[p];
    if (pl.cpu || armed >= 0) return;
    const any = V.movable && V.movable.some(v => v);
    if (any && !force) return;
    if (!pl.powers.some(n => n > 0)) return;
    const r = heads[p].powers.getBoundingClientRect();
    tip('<b>Boxed in</b>Arm an Ink Drop to break a rule and keep printing.', r.left + r.width / 2, r.bottom + 10, 4200, 'boxed');
    heads[p].powers.querySelectorAll('.token').forEach(t => {
      t.classList.remove('nudge');
      void t.offsetWidth;
      t.classList.add('nudge');
    });
  }

  /* ------------------------------------------------------------ tools */
  function showTools(on) {
    const el = $('#tools');
    const want = on && (ptr.type === 'touch' || coarse);
    el.hidden = !want;
  }

  /* -------------------------------------------------------- menu/rules */
  function openMenu() {
    if (menuOpen || !V) return;
    menuOpen = true;
    putBack(true);
    syncMenu();
    $('#menu').hidden = false;
    A.paper(true);
  }
  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    $('#menu').hidden = true;
    A.paper(false);
  }
  function syncMenu() {
    $('#m-music').textContent = 'Music: ' + (prefs.music ? 'on' : 'off');
    $('#m-sfx').textContent = 'Sound: ' + (prefs.sfx ? 'on' : 'off');
  }
  function setPrefs(sfx, music) {
    prefs = { sfx, music };
    store.set('prefs', prefs);
    A.setPrefs(sfx, music);
    syncMenu();
  }
  function openRules() {
    rulesOpen = true;
    $('#rules').hidden = false;
    $('#rules').scrollTop = 0;
    A.paper(true);
  }
  function closeRules() {
    rulesOpen = false;
    $('#rules').hidden = true;
    A.paper(false);
  }

  function miniGrid(rows, mark) {
    const cs = 14, h = rows.length, w = rows[0].length;
    const fills = { a: INK[1], b: INK[0], x: THEME.under };
    let cells = '';
    rows.forEach((row, r) =>
      [...row].forEach((ch, c) => {
        if (ch === '.') return;
        cells += `<rect x="${c * cs + 0.5}" y="${r * cs + 0.5}" width="${cs - 1}" height="${cs - 1}" fill="${fills[ch]}"/>`;
      })
    );
    let grid = '';
    for (let i = 1; i < w; i++) grid += `<path d="M${i * cs} 0V${h * cs}"/>`;
    for (let i = 1; i < h; i++) grid += `<path d="M0 ${i * cs}H${w * cs}"/>`;
    const badge =
      mark === 'yes'
        ? `<g class="mk yes"><circle cx="${w * cs - 2}" cy="2" r="9"/><path d="M${w * cs - 6.5} 2l3 3 6-6.5"/></g>`
        : `<g class="mk no"><circle cx="${w * cs - 2}" cy="2" r="9"/><path d="M${w * cs - 6} -2l8 8M${w * cs + 2} -2l-8 8"/></g>`;
    return `<svg class="mini" viewBox="-2 -12 ${w * cs + 14} ${h * cs + 16}" width="${w * cs + 16}" height="${h * cs + 16}" aria-hidden="true"><rect x="0" y="0" width="${w * cs}" height="${h * cs}" class="bg"/><g class="gl">${grid}</g><g style="mix-blend-mode:multiply">${cells}</g><rect x="0" y="0" width="${w * cs}" height="${h * cs}" class="fr"/>${badge}</svg>`;
  }

  function buildRules() {
    $('#rule-diagrams').innerHTML =
      miniGrid(['aa...', 'a....', '..aa.', '..a..'], 'yes') + miniGrid(['aa...', 'a....', 'aa...', '.....'], 'no') + miniGrid(['aa...', 'ab...', '.bb..', '.....'], 'yes');
    $('#rule-drops').innerHTML = POWERS.map(
      (pw, t) => `<li><span class="drop-ic">${iconSvg(t)}</span><span><b>${pw.name}</b>${pw.text}</span></li>`
    ).join('');
  }

  /* ------------------------------------------------------------- wire */
  function wire() {
    let resizeFrame = 0;
    window.addEventListener('resize', () => {
      if (!resizeFrame) resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        resize();
      });
    });
    stage.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', () => (ptr.down = false));
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', () => A.init(), { capture: true });

    $('#start').addEventListener('click', startFromTitle);
    $('#how').addEventListener('click', () => {
      A.init();
      A.click();
      openRules();
    });
    document.querySelectorAll('[data-close-rules]').forEach(b => b.addEventListener('click', () => (A.click(), closeRules())));
    $('#rules').addEventListener('pointerdown', e => {
      if (e.target === $('#rules')) closeRules();
    });
    $('#menu-btn').addEventListener('click', () => (A.click(), openMenu()));
    $('#menu').addEventListener('pointerdown', e => {
      if (e.target === $('#menu')) closeMenu();
    });
    $('#menu').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      A.click();
      const a = b.dataset.a;
      if (a === 'resume') closeMenu();
      else if (a === 'rules') openRules();
      else if (a === 'music') setPrefs(prefs.sfx, !prefs.music);
      else if (a === 'sfx') setPrefs(!prefs.sfx, prefs.music);
      else if (a === 'restart') {
        closeMenu();
        newGame();
      } else if (a === 'quit') {
        closeMenu();
        toTitle();
      }
    });
    $('#results').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      A.click();
      if (b.dataset.a === 'again') {
        $('#results').hidden = true;
        newGame();
      } else if (b.dataset.a === 'title') toTitle();
    });
    $('#tools').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || !held) return;
      const a = b.dataset.a;
      if (a === 'rotl') rotate(-1);
      else if (a === 'rotr') rotate(1);
      else if (a === 'flip') flip();
      else if (a === 'cancel') putBack();
      else if (a === 'place') tryPlace();
    });
    document.querySelectorAll('button').forEach(b => {
      if (b.closest('#seats')) return;
      b.addEventListener('pointerenter', () => A.uiHover());
    });
  }

  function start(data) {
    boot();
    if (data && data.scene === 'game' && data.g) {
      try {
        restore(data);
      } catch (e) {
        toTitle();
      }
    }
  }
  function launch() {
    const hot = window.claude && window.claude.hot;
    if (hot && typeof hot.snapshot === 'function') hot.snapshot(snapshot);
    if (hot && typeof hot.ready === 'function') hot.ready(start);
    else start((hot && hot.data) || {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', launch);
  else launch();
})();
