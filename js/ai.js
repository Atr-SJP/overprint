/* OVERPRINT — CPU printers.
   Amateur: greedy and careless.  Intermediate: one-ply heuristic with a personality.
   Expert: a patient version of that heuristic shortlists moves, then each one is played
   out and judged by the mobility and placeable squares it leaves for itself and its rivals. */
'use strict';
(function (root) {
  const OP = root.OP;
  const E = OP.E;
  const { N, NN, ORTH, DIAG, EMPTY } = E;

  const LEVELS = ['Amateur', 'Intermediate', 'Expert']; // levels 1, 2, 3

  // how awkward each piece becomes later in the game (by piece id)
  const HARD = [0, 0, 0.2, 0.3, 0.5, 0.6, 0.6, 0.5, 0.7, 1.0, 0.9, 1.0, 1.0, 0.6, 1.0, 1.1, 1.3, 1.2, 1.2, 1.3, 1.5];
  // what spending each power should be worth before the CPU does it
  const POWER_COST = [7, 5, 8];

  const BASE = { size: 1, mob: 1, block: 1, drop: 1, center: 1, noise: 1, hard: 1, open: 1, lost: 1, over: 1, pcost: 1 };
  const STYLES = [
    { ...BASE }, // even-handed
    { ...BASE, mob: 0.9, block: 1.7, center: 1.25, drop: 0.9 }, // blocker
    { ...BASE, size: 1.1, mob: 1.35, block: 0.8, center: 1.1, drop: 0.9 }, // sprawler
    { ...BASE, drop: 1.9, center: 0.9 }, // collector
  ];
  // tuned over a few thousand CPU games: the expert's biggest edge is holding its ink drops
  // until they're worth something (pcost), instead of spending them as soon as it can
  const EXPERT = { ...BASE, block: 0.7, center: 1.1, hard: 1.5, pcost: 3, noise: 0.3 };
  // expert look-ahead: shortlist size, then weights for what each shortlisted move leaves behind
  const DEEP = { top: 24, mob: 5.5, opp: 1.0, fit: 1.0, fitOpp: 0.6, capMine: 400, capOpp: 160 };

  const M = new Uint32Array(NN);
  let mg = 1;
  const S = new Uint32Array(NN);
  let sg = 1;
  const L = new Uint32Array(NN);
  let lg = 1;

  function prepare(g, p) {
    const own = new Uint8Array(NN), opp = new Uint8Array(NN);
    for (let q = 0; q < 4; q++) {
      if (q !== p && g.players[q].out) continue;
      for (const a of E.anchorsFor(g, q, -1)) {
        if (q === p) own[a] = 1;
        else opp[a]++;
      }
    }
    return { own, opp, phase: g.players[p].placed / 21 };
  }

  function evaluate(g, p, pid, cells, n, over, power, ctx, st, rnd) {
    const C = g.cells;
    if (++mg > 0xfffffff0) { M.fill(0); mg = 1; }
    for (let k = 0; k < n; k++) M[cells[k]] = mg;
    const early = 1 - ctx.phase;

    let s = n * (2 + early) * st.size + HARD[pid] * 2.4 * early * st.size * st.hard;

    // fresh corners this opens up, and how much room is around them
    if (++sg > 0xfffffff0) { S.fill(0); sg = 1; }
    let fresh = 0, open = 0;
    for (let k = 0; k < n; k++) {
      const D = DIAG[cells[k]];
      for (let j = 0; j < D.length; j++) {
        const d = D[j];
        if (M[d] === mg || S[d] === sg || C[d] !== EMPTY) continue;
        S[d] = sg;
        const O = ORTH[d];
        let ok = true, e = 0;
        for (let q = 0; q < O.length; q++) {
          const o = O[q];
          if (M[o] === mg || C[o] === p) { ok = false; break; }
          if (C[o] === EMPTY) e++;
        }
        if (!ok || ctx.own[d]) continue;
        fresh++;
        open += e;
      }
    }

    // own corners this placement wastes
    if (++lg > 0xfffffff0) { L.fill(0); lg = 1; }
    let lost = 0;
    for (let k = 0; k < n; k++) {
      const i = cells[k];
      if (ctx.own[i] && L[i] !== lg) { L[i] = lg; lost++; }
      const O = ORTH[i];
      for (let j = 0; j < O.length; j++) {
        const o = O[j];
        if (ctx.own[o] && M[o] !== mg && L[o] !== lg) { L[o] = lg; lost++; }
      }
    }
    s += (fresh * 1.7 + open * 0.22 * st.open) * st.mob - Math.max(0, lost - 1) * 0.8 * st.lost;

    let block = 0, reach = 0, drop = 0;
    for (let k = 0; k < n; k++) {
      const i = cells[k];
      block += ctx.opp[i];
      const r = (i / N) | 0, c = i % N;
      reach += 19 - Math.abs(r - 9.5) - Math.abs(c - 9.5);
      if (g.drops[i] >= 0) drop++;
    }
    s += block * 1.6 * st.block;
    s += (reach / n) * 0.3 * early * st.center;
    s += drop * (5 + 4 * early) * st.drop;
    s += over * 3.4 * st.over;
    if (power >= 0) s -= POWER_COST[power] * (0.45 + 0.55 * early) * st.pcost;
    s += (rnd() - 0.5) * 1.4 * st.noise;
    return s;
  }

  function withCells(m) {
    const O = OP.PIECES[m.pid].orients[m.oi];
    m.cells = O.cells.map(([r, c]) => (m.r0 + r) * N + m.c0 + c);
    return m;
  }

  /* --------------------------------------------------------- intermediate */
  function chooseIntermediate(g, p, rnd, styleIdx) {
    const st = STYLES[styleIdx % STYLES.length];
    const ctx = prepare(g, p);
    const pl = g.players[p];
    let best = null, bestS = -Infinity;
    const run = power => {
      E.forEachMove(g, p, power, (pid, oi, r0, c0, cells, n, info) => {
        if (power >= 0 && !info.uses) return false; // same as a plain move
        const s = evaluate(g, p, pid, cells, n, info.over, power, ctx, st, rnd);
        if (s > bestS) {
          bestS = s;
          best = { pid, oi, r0, c0, cells: Array.from(cells.subarray(0, n)), power, score: s };
        }
        return false;
      });
    };
    run(-1);
    for (let t = 0; t < 3; t++) if (pl.powers[t] > 0) run(t);
    return best;
  }

  /* -------------------------------------------------------------- amateur */
  function chooseAmateur(g, p, rnd) {
    const pl = g.players[p];
    const pool = [];
    const run = power =>
      E.forEachMove(g, p, power, (pid, oi, r0, c0, cells, n, info) => {
        if (power >= 0 && !info.uses) return false;
        let reach = 0;
        for (let k = 0; k < n; k++) {
          const i = cells[k];
          reach += 19 - Math.abs(((i / N) | 0) - 9.5) - Math.abs((i % N) - 9.5);
        }
        // likes big pieces and the middle of the sheet; never looks at anyone else
        pool.push({ s: n * 2 + (reach / n) * 0.15 + rnd() * 6, pid, oi, r0, c0, power });
        return false;
      });
    run(-1);
    // only reaches for an ink drop once it's stuck
    if (!pool.length) for (let t = 0; t < 3; t++) if (pl.powers[t] > 0) run(t);
    if (!pool.length) return null;
    pool.sort((a, b) => b.s - a.s);
    const span = Math.max(1, Math.ceil(pool.length * 0.4));
    return withCells(pool[Math.floor(Math.pow(rnd(), 1.8) * span)]);
  }

  /* --------------------------------------------------------------- expert */
  function countMoves(g, q, cap) {
    let n = 0;
    E.forEachMove(g, q, -1, () => ++n >= cap);
    return n;
  }

  // squares still in hand that have at least one legal spot: points that can still be scored
  function fitSquares(g, q) {
    const pl = g.players[q];
    let s = 0;
    for (let pid = 0; pid < 21; pid++) if (pl.hand[pid] && E.forEachMove(g, q, -1, () => true, pid)) s += OP.PIECES[pid].size;
    return s;
  }

  // play the move on the real board, measure what it leaves everyone, then take it back
  function deepScore(g, p, m) {
    const C = g.cells, pl = g.players[p];
    const prev = m.cells.map(i => C[i]);
    for (const i of m.cells) C[i] = p;
    pl.hand[m.pid] = false;
    pl.handCount--;
    pl.placed++;
    const mine = pl.handCount ? countMoves(g, p, DEEP.capMine) : DEEP.capMine;
    const fit = fitSquares(g, p);
    let opp = 0, oppFit = 0, rivals = 0;
    for (let q = 0; q < 4; q++) {
      if (q === p || g.players[q].out) continue;
      rivals++;
      opp += Math.log1p(countMoves(g, q, DEEP.capOpp));
      oppFit += fitSquares(g, q);
    }
    m.cells.forEach((i, k) => (C[i] = prev[k]));
    pl.hand[m.pid] = true;
    pl.handCount++;
    pl.placed--;
    return DEEP.mob * Math.log1p(mine) - DEEP.opp * opp + DEEP.fit * fit - (DEEP.fitOpp * oppFit) / Math.max(1, rivals);
  }

  function chooseExpert(g, p, rnd) {
    const ctx = prepare(g, p);
    const pl = g.players[p];
    const top = [];
    const run = power =>
      E.forEachMove(g, p, power, (pid, oi, r0, c0, cells, n, info) => {
        if (power >= 0 && !info.uses) return false;
        const s = evaluate(g, p, pid, cells, n, info.over, power, ctx, EXPERT, rnd);
        if (top.length >= DEEP.top && s <= top[top.length - 1].s) return false;
        const m = { s, pid, oi, r0, c0, power, cells: Array.from(cells.subarray(0, n)) };
        let k = top.length;
        top.push(null);
        while (k > 0 && top[k - 1].s < s) {
          top[k] = top[k - 1];
          k--;
        }
        top[k] = m;
        if (top.length > DEEP.top) top.pop();
        return false;
      });
    run(-1);
    for (let t = 0; t < 3; t++) if (pl.powers[t] > 0) run(t);
    if (top.length < 2) return top[0] || null;
    let best = null, bestS = -Infinity;
    for (const m of top) {
      const s = m.s + deepScore(g, p, m);
      if (s > bestS) {
        bestS = s;
        best = m;
      }
    }
    return best;
  }

  /** Best move for player p at the given level (1–3), or null if they have none. */
  function choose(g, p, rnd = Math.random, styleIdx = 0, level = 2) {
    if (level <= 1) return chooseAmateur(g, p, rnd);
    if (level >= 3) return chooseExpert(g, p, rnd);
    return chooseIntermediate(g, p, rnd, styleIdx);
  }

  OP.AI = { choose, STYLES, LEVELS, DEEP, EXPERT };
})(typeof window !== 'undefined' ? window : globalThis);
