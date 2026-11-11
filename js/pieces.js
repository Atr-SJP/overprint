/* OVERPRINT — the 21 free polyominoes of size 1–5 and their orientations */
'use strict';
(function (root) {
  const OP = root.OP;

  const RAW = [
    ['I1', [[0, 0]]],
    ['I2', [[0, 0], [0, 1]]],
    ['I3', [[0, 0], [0, 1], [0, 2]]],
    ['V3', [[0, 0], [1, 0], [1, 1]]],
    ['I4', [[0, 0], [0, 1], [0, 2], [0, 3]]],
    ['O4', [[0, 0], [0, 1], [1, 0], [1, 1]]],
    ['T4', [[0, 0], [0, 1], [0, 2], [1, 1]]],
    ['L4', [[0, 0], [1, 0], [2, 0], [2, 1]]],
    ['S4', [[0, 1], [0, 2], [1, 0], [1, 1]]],
    ['I5', [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]],
    ['L5', [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]]],
    ['Y5', [[0, 1], [1, 0], [1, 1], [2, 1], [3, 1]]],
    ['N5', [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1]]],
    ['P5', [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]]],
    ['U5', [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]]],
    ['V5', [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]],
    ['W5', [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]]],
    ['T5', [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1]]],
    ['Z5', [[0, 0], [0, 1], [1, 1], [2, 1], [2, 2]]],
    ['F5', [[0, 1], [0, 2], [1, 0], [1, 1], [2, 1]]],
    ['X5', [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]]],
  ];

  function normalize(cells) {
    let minR = Infinity, minC = Infinity;
    for (const [r, c] of cells) {
      if (r < minR) minR = r;
      if (c < minC) minC = c;
    }
    const out = cells.map(([r, c]) => [r - minR, c - minC]);
    out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return out;
  }

  // flip mirrors left/right first, then rot quarter-turns clockwise
  function transform(cells, rot, flip) {
    let out = cells.map(([r, c]) => [r, flip ? -c : c]);
    for (let i = 0; i < (rot & 3); i++) out = out.map(([r, c]) => [c, -r]);
    return normalize(out);
  }

  function dims(cells) {
    let w = 0, h = 0;
    for (const [r, c] of cells) {
      if (r + 1 > h) h = r + 1;
      if (c + 1 > w) w = c + 1;
    }
    return { cells, w, h };
  }

  const keyOf = cells => cells.map(([r, c]) => r + ',' + c).join(';');

  const PIECES = RAW.map(([name, cells], id) => {
    const base = normalize(cells);
    const orients = [];
    const seen = new Map();
    const tmap = new Array(8);
    for (let flip = 0; flip < 2; flip++) {
      for (let rot = 0; rot < 4; rot++) {
        const t = transform(base, rot, flip);
        const k = keyOf(t);
        if (!seen.has(k)) {
          seen.set(k, orients.length);
          orients.push(dims(t));
        }
        tmap[flip * 4 + rot] = seen.get(k);
      }
    }
    return { id, name, size: base.length, base, orients, tmap };
  });

  // orientation index for a (rotation, flip) pair as the player sees it
  function orientFor(pid, rot, flip) {
    return PIECES[pid].tmap[(flip ? 4 : 0) + (rot & 3)];
  }

  OP.PIECES = PIECES;
  OP.pieceTransform = transform;
  OP.pieceDims = dims;
  OP.orientFor = orientFor;
})(typeof window !== 'undefined' ? window : globalThis);
