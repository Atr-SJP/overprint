/* OVERPRINT — rules engine (pure logic, no DOM) */
'use strict';
(function (root) {
  const OP = root.OP;
  const { U, PIECES } = OP;

  const N = 20;
  const NN = N * N;
  const EMPTY = -1;
  const HOLE = -2;
  const OVERPRINT = 0;
  const BLEED = 1;
  const OFFSET = 2;
  const MAX_OVER = 2; // rival squares an Overprint may cover
  const FULL_BONUS = 10; // for printing every piece
  const CORNERS = [0, N - 1, NN - 1, NN - N]; // TL, TR, BR, BL — clockwise

  const ORTH = new Array(NN);
  const DIAG = new Array(NN);
  for (let i = 0; i < NN; i++) {
    const r = (i / N) | 0, c = i % N;
    const o = [], d = [];
    if (r > 0) o.push(i - N);
    if (r < N - 1) o.push(i + N);
    if (c > 0) o.push(i - 1);
    if (c < N - 1) o.push(i + 1);
    if (r > 0 && c > 0) d.push(i - N - 1);
    if (r > 0 && c < N - 1) d.push(i - N + 1);
    if (r < N - 1 && c > 0) d.push(i + N - 1);
    if (r < N - 1 && c < N - 1) d.push(i + N + 1);
    ORTH[i] = Int16Array.from(o);
    DIAG[i] = Int16Array.from(d);
  }

  // quarter turn of the whole sheet; maps each player's corner onto the next one
  const rot90 = i => {
    const r = (i / N) | 0, c = i % N;
    return c * N + (N - 1 - r);
  };

  /* ---------------------------------------------------------------- sheet */

  const HOLE_SHAPES = [
    [[0, 0]],
    [[0, 0], [0, 1]],
    [[0, 0], [0, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [1, 0], [1, 1]],
    [[0, 1], [1, 0], [1, 1], [1, 2]],
    [[0, 0], [1, 0], [1, 1], [2, 1]],
  ];

  // where each player's three Ink Drops may sit (in the top-left quadrant, then rotated)
  const DROP_ZONES = [
    (r, c) => r >= 3 && c >= 3 && r + c >= 7 && r + c <= 10 && Math.abs(r - c) <= 3, // home
    (r, c) => r >= 1 && r <= 4 && c >= 7 && c <= 9, // flank, toward the next player
    // inner: deep in your own quadrant, so moving first doesn't let you sweep the middle
    (r, c) => r >= 5 && c >= 5 && r <= 8 && c <= 8 && r + c >= 12 && r + c <= 14,
  ];

  function generateSheet(g, rnd) {
    for (let attempt = 0; attempt < 800; attempt++) {
      const cells = new Int8Array(NN).fill(EMPTY);
      const drops = new Int8Array(NN).fill(-1);
      const holes = [];

      const placeSym = shape => {
        const copies = [shape];
        for (let k = 1; k < 4; k++) copies.push(copies[k - 1].map(rot90));
        const all = new Set(copies.flat());
        if (all.size !== shape.length * 4) return false;
        for (const cp of copies) {
          const own = new Set(cp);
          for (const i of cp) {
            if (cells[i] !== EMPTY) return false;
            for (const nb of [...ORTH[i], ...DIAG[i]]) {
              if (own.has(nb)) continue;
              if (cells[nb] === HOLE || all.has(nb)) return false;
            }
          }
        }
        for (const cp of copies) {
          for (const i of cp) cells[i] = HOLE;
          holes.push(cp.slice());
        }
        return true;
      };

      // an occasional die-cut window right in the middle
      if (rnd() < 0.25) {
        const mid = [9 * N + 9, 9 * N + 10, 10 * N + 9, 10 * N + 10];
        mid.forEach(i => (cells[i] = HOLE));
        holes.push(mid);
      }

      const want = 1 + (rnd() < 0.3 ? 1 : 0);
      let placed = 0;
      for (let tries = 0; tries < 120 && placed < want; tries++) {
        const base = HOLE_SHAPES[Math.floor(rnd() * HOLE_SHAPES.length)];
        const sh = OP.pieceTransform(base, Math.floor(rnd() * 4), rnd() < 0.5);
        const r0 = Math.floor(rnd() * 10), c0 = Math.floor(rnd() * 10);
        const abs = [];
        let ok = true;
        for (const [dr, dc] of sh) {
          const r = r0 + dr, c = c0 + dc;
          if (r > 9 || c > 9 || r + c < 8 || Math.max(r, c) < 5) {
            ok = false;
            break;
          }
          abs.push(r * N + c);
        }
        if (ok && placeSym(abs)) placed++;
      }
      if (placed < want) continue;

      // Ink Drops: one of each power per quadrant, mirrored for fairness
      const types = U.shuffle([OVERPRINT, BLEED, OFFSET], rnd);
      let dropsOk = true;
      for (let z = 0; z < 3 && dropsOk; z++) {
        const cand = [];
        for (let r = 0; r < 10; r++) {
          for (let c = 0; c < 10; c++) {
            if (!DROP_ZONES[z](r, c)) continue;
            let i = r * N + c, good = true;
            for (let k = 0; k < 4 && good; k++) {
              if (cells[i] !== EMPTY || drops[i] >= 0) good = false;
              for (const nb of [...ORTH[i], ...DIAG[i]]) if (cells[nb] === HOLE || drops[nb] >= 0) good = false;
              i = rot90(i);
            }
            if (good) cand.push(r * N + c);
          }
        }
        if (!cand.length) {
          dropsOk = false;
          break;
        }
        let i = cand[Math.floor(rnd() * cand.length)];
        for (let k = 0; k < 4; k++) {
          drops[i] = types[z];
          i = rot90(i);
        }
      }
      if (!dropsOk) continue;

      // every open square must stay reachable
      const seen = new Uint8Array(NN);
      const stack = [0];
      seen[0] = 1;
      let count = 0;
      while (stack.length) {
        const i = stack.pop();
        count++;
        for (const nb of ORTH[i]) {
          if (!seen[nb] && cells[nb] !== HOLE) {
            seen[nb] = 1;
            stack.push(nb);
          }
        }
      }
      let open = 0;
      for (let i = 0; i < NN; i++) if (cells[i] !== HOLE) open++;
      if (count !== open) continue;

      g.cells = cells;
      g.drops = drops;
      g.holes = holes;
      return;
    }
    // fallback: plain sheet
    g.cells = new Int8Array(NN).fill(EMPTY);
    g.drops = new Int8Array(NN).fill(-1);
    g.holes = [];
  }

  /* ----------------------------------------------------------------- game */

  function createGame(opts = {}) {
    const seed = opts.seed != null ? opts.seed : (Math.random() * 2147483647) | 0;
    const rnd = U.rng(seed);
    const g = {
      seed,
      cells: null,
      drops: null,
      holes: null,
      pieceOf: new Int16Array(NN).fill(-1),
      players: [0, 1, 2, 3].map(i => ({
        i,
        cpu: !!(opts.cpu && opts.cpu[i]),
        hand: new Array(21).fill(true),
        handCount: 21,
        powers: [0, 0, 0],
        out: false,
        placed: 0,
        lastPiece: -1,
        squares: 0,
      })),
      placements: [],
      turn: 0,
      turnCount: 0,
      over: false,
    };
    generateSheet(g, rnd);
    g.initialDrops = Int8Array.from(g.drops);
    // turn order starts at `first`; the third and fourth printers get a spare drop to even out moving late
    const first = opts.first ? opts.first & 3 : 0;
    g.turn = first;
    g.spare = [-1, -1, -1, -1];
    for (const k of [2, 3]) {
      const p = (first + k) % 4, t = Math.floor(rnd() * 3);
      g.players[p].powers[t]++;
      g.spare[p] = t;
    }
    return g;
  }

  /* ---------------------------------------------------------------- rules */

  const MARK = new Uint32Array(NN);
  let markGen = 1;

  /**
   * Is it legal for player p to print these squares, with an optional power armed?
   * Fills out.over (rival squares covered) and out.uses (whether the power is actually needed).
   */
  function check(g, p, cells, n, power, out) {
    const C = g.cells;
    if (++markGen > 0xfffffff0) {
      MARK.fill(0);
      markGen = 1;
    }
    for (let k = 0; k < n; k++) MARK[cells[k]] = markGen;
    let over = 0, edge = false, corner = false, start = false;
    for (let k = 0; k < n; k++) {
      const i = cells[k], v = C[i];
      if (v !== EMPTY) {
        if (v === HOLE || v === p || power !== OVERPRINT) return false;
        if (++over > MAX_OVER) return false;
      }
      if (i === CORNERS[p]) start = true;
      const O = ORTH[i];
      for (let j = 0; j < O.length; j++) if (C[O[j]] === p && MARK[O[j]] !== markGen) edge = true;
      const D = DIAG[i];
      for (let j = 0; j < D.length; j++) if (C[D[j]] === p && MARK[D[j]] !== markGen) corner = true;
    }
    if (g.players[p].placed === 0) {
      if (!start || over > 0) return false;
      if (out) {
        out.over = 0;
        out.uses = false;
      }
      return true;
    }
    if (edge && power !== BLEED) return false;
    if (power === BLEED) {
      if (!edge && !corner) return false;
    } else if (power !== OFFSET && !corner) return false;
    if (out) {
      out.over = over;
      out.uses = power === OVERPRINT ? over > 0 : power === BLEED ? edge : power === OFFSET ? !corner : false;
    }
    return true;
  }

  // each orientation as flat offsets (r * N + c), so a placement is just base + offset
  for (const P of PIECES) {
    for (const O of P.orients) {
      O.off = Int16Array.from(O.cells.map(([r, c]) => r * N + c));
      O.dr = Int8Array.from(O.cells.map(([r]) => r));
      O.dc = Int8Array.from(O.cells.map(([, c]) => c));
    }
  }

  /**
   * Everything legality depends on for player p in the current position, worked out once:
   * which squares sit beside or diagonal to their ink, and where a new piece could start.
   * Only valid until the board changes.
   */
  function moveContext(g, p, power = -1) {
    const C = g.cells, pl = g.players[p];
    const orth = new Uint8Array(NN), diag = new Uint8Array(NN);
    for (let i = 0; i < NN; i++) {
      if (C[i] !== p) continue;
      const O = ORTH[i];
      for (let j = 0; j < O.length; j++) orth[O[j]] = 1;
      const D = DIAG[i];
      for (let j = 0; j < D.length; j++) diag[D[j]] = 1;
    }
    let anchors = null; // null = anywhere (Offset)
    if (pl.placed === 0) anchors = C[CORNERS[p]] === EMPTY ? [CORNERS[p]] : [];
    else if (power !== OFFSET) {
      anchors = [];
      for (let i = 0; i < NN; i++) {
        const v = C[i];
        if (v === HOLE || v === p) continue;
        if (v !== EMPTY && power !== OVERPRINT) continue;
        if (power === BLEED ? diag[i] || orth[i] : diag[i] && !orth[i]) anchors.push(i);
      }
    }
    return { C, p, power, orth, diag, anchors, first: pl.placed === 0 };
  }

  /** Squares where player p could anchor a new piece (diagonal to their ink, never beside it). */
  function anchorsFor(g, p, power = -1) {
    return moveContext(g, p, power === OFFSET ? -1 : power).anchors;
  }

  // check() for the enumeration hot path: the same rules, read from a move context
  function checkCtx(ctx, cells, n, power, out) {
    const C = ctx.C, p = ctx.p, orth = ctx.orth, diag = ctx.diag, home = CORNERS[p];
    let over = 0, edge = false, corner = false, start = false;
    for (let k = 0; k < n; k++) {
      const i = cells[k], v = C[i];
      if (v !== EMPTY) {
        if (v === HOLE || v === p || power !== OVERPRINT) return false;
        if (++over > MAX_OVER) return false;
      }
      if (i === home) start = true;
      if (orth[i]) edge = true;
      if (diag[i]) corner = true;
    }
    if (ctx.first) {
      if (!start || over > 0) return false;
      out.over = 0;
      out.uses = false;
      return true;
    }
    if (edge && power !== BLEED) return false;
    if (power === BLEED) {
      if (!edge && !corner) return false;
    } else if (power !== OFFSET && !corner) return false;
    out.over = over;
    out.uses = power === OVERPRINT ? over > 0 : power === BLEED ? edge : power === OFFSET ? !corner : false;
    return true;
  }

  const SEEN = new Uint32Array(NN);
  let seenGen = 1;
  const BUF = new Int16Array(5);
  const INFO = { over: 0, uses: false };

  /**
   * Visit every legal placement. fn(pid, orient, r0, c0, cells, n, info) — return true to stop.
   * `cells` is a shared buffer: copy it if you keep it. Pass a moveContext for this player,
   * power and position to skip recomputing it.
   */
  function forEachMove(g, p, power, fn, onlyPid = -1, ctx = null) {
    const pl = g.players[p];
    if (pl.handCount === 0) return false;
    if (pl.placed === 0 && power >= 0) return false;
    if (!ctx || ctx.p !== p || ctx.power !== power) ctx = moveContext(g, p, power);
    const anchors = ctx.anchors;
    if (anchors && !anchors.length) return false;
    for (let pid = onlyPid >= 0 ? onlyPid : 0; pid < 21; pid++) {
      if (onlyPid >= 0 && pid !== onlyPid) break;
      if (!pl.hand[pid]) continue;
      const P = PIECES[pid];
      for (let oi = 0; oi < P.orients.length; oi++) {
        const O = P.orients[oi], off = O.off, dr = O.dr, dc = O.dc, n = off.length, h = O.h, w = O.w;
        if (!anchors) {
          for (let r0 = 0; r0 + h <= N; r0++) {
            for (let c0 = 0; c0 + w <= N; c0++) {
              const base = r0 * N + c0;
              for (let k = 0; k < n; k++) BUF[k] = base + off[k];
              if (checkCtx(ctx, BUF, n, power, INFO) && fn(pid, oi, r0, c0, BUF, n, INFO)) return true;
            }
          }
        } else {
          if (++seenGen > 0xfffffff0) {
            SEEN.fill(0);
            seenGen = 1;
          }
          for (let a = 0; a < anchors.length; a++) {
            const ar = (anchors[a] / N) | 0, ac = anchors[a] % N;
            for (let k = 0; k < n; k++) {
              const r0 = ar - dr[k], c0 = ac - dc[k];
              if (r0 < 0 || c0 < 0 || r0 + h > N || c0 + w > N) continue;
              const base = r0 * N + c0;
              if (SEEN[base] === seenGen) continue;
              SEEN[base] = seenGen;
              for (let q = 0; q < n; q++) BUF[q] = base + off[q];
              if (checkCtx(ctx, BUF, n, power, INFO) && fn(pid, oi, r0, c0, BUF, n, INFO)) return true;
            }
          }
        }
      }
    }
    return false;
  }

  const yes = () => true;

  function hasAnyMove(g, p) {
    const pl = g.players[p];
    if (pl.handCount === 0) return false;
    if (forEachMove(g, p, -1, yes)) return true;
    for (let t = 0; t < 3; t++) if (pl.powers[t] > 0 && forEachMove(g, p, t, yes)) return true;
    return false;
  }

  /** Which pieces in hand have at least one legal spot (with the armed power, if any). */
  function movablePieces(g, p, power = -1) {
    const res = new Uint8Array(21);
    const pl = g.players[p];
    const plain = moveContext(g, p, -1);
    const armed = power >= 0 && pl.placed > 0 ? moveContext(g, p, power) : null;
    for (let pid = 0; pid < 21; pid++) {
      if (!pl.hand[pid]) continue;
      res[pid] = forEachMove(g, p, -1, yes, pid, plain) || (armed && forEachMove(g, p, power, yes, pid, armed)) ? 1 : 0;
    }
    return res;
  }

  function applyMove(g, p, pid, cells, power = -1) {
    const info = { over: 0, uses: false };
    if (!check(g, p, cells, cells.length, power, info)) return null;
    const pl = g.players[p];
    const idx = g.placements.length;
    const over = [], collected = [];
    for (const i of cells) {
      const prev = g.cells[i];
      if (prev >= 0) {
        over.push({ i, from: prev });
        g.players[prev].squares--;
      }
      g.cells[i] = p;
      g.pieceOf[i] = idx;
      pl.squares++;
      if (g.drops[i] >= 0) {
        collected.push({ i, type: g.drops[i] });
        g.drops[i] = -1;
      }
    }
    const used = info.uses ? power : -1;
    if (used >= 0) pl.powers[used]--;
    for (const c of collected) pl.powers[c.type]++;
    pl.hand[pid] = false;
    pl.handCount--;
    pl.placed++;
    pl.lastPiece = pid;
    const rec = { p, pid, cells: Array.from(cells), over, used, collected, turn: g.turnCount };
    g.placements.push(rec);
    g.turnCount++;
    return rec;
  }

  function score(g, p) {
    const pl = g.players[p];
    return pl.squares + (pl.handCount === 0 ? FULL_BONUS : 0);
  }

  /** Pass the turn to the next player still in the game; -1 when everyone is out. */
  function advance(g) {
    for (let k = 1; k <= 4; k++) {
      const q = (g.turn + k) % 4;
      if (!g.players[q].out) {
        g.turn = q;
        return q;
      }
    }
    g.over = true;
    return -1;
  }

  function standings(g) {
    const rows = g.players.map(pl => ({
      p: pl.i,
      squares: pl.squares,
      bonus: pl.handCount === 0 ? FULL_BONUS : 0,
      score: score(g, pl.i),
      left: pl.handCount,
    }));
    rows.sort((a, b) => b.score - a.score || a.left - b.left || a.p - b.p);
    let rank = 0, prev = null;
    rows.forEach((r, k) => {
      if (prev === null || r.score !== prev) rank = k + 1;
      r.rank = rank;
      prev = r.score;
    });
    return rows;
  }

  OP.E = {
    N, NN, EMPTY, HOLE, OVERPRINT, BLEED, OFFSET, MAX_OVER, FULL_BONUS, CORNERS, ORTH, DIAG,
    rot90, createGame, check, moveContext, anchorsFor, forEachMove, hasAnyMove, movablePieces, applyMove,
    score, advance, standings,
  };
})(typeof window !== 'undefined' ? window : globalThis);
