// ---- Part 3: computer opponent (alpha-beta search) ----
//
// A self-contained search AI that plays either color. It relies on the engine's
// applyMove/undoMove/allLegalMoves so search mutates one board in place rather
// than cloning positions. Difficulty maps to search depth (plus a little
// randomness at the easiest level so it isn't perfectly repeatable).

(function (global) {
  'use strict';

  const { WHITE, colorOf, typeOf } = global.Chess;

  // Material values in centipawns.
  const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  // Piece-square tables from White's perspective (row 0 = rank 8 = Black's
  // back rank). For Black we mirror vertically. Encourages sensible placement:
  // knights toward the center, pawns advancing, king castled early, etc.
  const PST = {
    p: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [50, 50, 50, 50, 50, 50, 50, 50],
      [10, 10, 20, 30, 30, 20, 10, 10],
      [5, 5, 10, 25, 25, 10, 5, 5],
      [0, 0, 0, 20, 20, 0, 0, 0],
      [5, -5, -10, 0, 0, -10, -5, 5],
      [5, 10, 10, -20, -20, 10, 10, 5],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ],
    n: [
      [-50, -40, -30, -30, -30, -30, -40, -50],
      [-40, -20, 0, 0, 0, 0, -20, -40],
      [-30, 0, 10, 15, 15, 10, 0, -30],
      [-30, 5, 15, 20, 20, 15, 5, -30],
      [-30, 0, 15, 20, 20, 15, 0, -30],
      [-30, 5, 10, 15, 15, 10, 5, -30],
      [-40, -20, 0, 5, 5, 0, -20, -40],
      [-50, -40, -30, -30, -30, -30, -40, -50],
    ],
    b: [
      [-20, -10, -10, -10, -10, -10, -10, -20],
      [-10, 0, 0, 0, 0, 0, 0, -10],
      [-10, 0, 5, 10, 10, 5, 0, -10],
      [-10, 5, 5, 10, 10, 5, 5, -10],
      [-10, 0, 10, 10, 10, 10, 0, -10],
      [-10, 10, 10, 10, 10, 10, 10, -10],
      [-10, 5, 0, 0, 0, 0, 5, -10],
      [-20, -10, -10, -10, -10, -10, -10, -20],
    ],
    r: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [5, 10, 10, 10, 10, 10, 10, 5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [0, 0, 0, 5, 5, 0, 0, 0],
    ],
    q: [
      [-20, -10, -10, -5, -5, -10, -10, -20],
      [-10, 0, 0, 0, 0, 0, 0, -10],
      [-10, 0, 5, 5, 5, 5, 0, -10],
      [-5, 0, 5, 5, 5, 5, 0, -5],
      [0, 0, 5, 5, 5, 5, 0, -5],
      [-10, 5, 5, 5, 5, 5, 0, -10],
      [-10, 0, 5, 0, 0, 0, 0, -10],
      [-20, -10, -10, -5, -5, -10, -10, -20],
    ],
    // Middlegame king table: stay tucked away, castled.
    k: [
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-20, -30, -30, -40, -40, -30, -30, -20],
      [-10, -20, -20, -20, -20, -20, -20, -10],
      [20, 20, 0, 0, 0, 0, 20, 20],
      [20, 30, 10, 0, 0, 10, 30, 20],
    ],
  };

  const MATE = 1000000;

  // Static evaluation from White's perspective (positive favors White).
  function evaluate(game) {
    let score = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const code = game.board[r][c];
        if (!code) continue;
        const t = typeOf(code);
        const white = colorOf(code) === WHITE;
        const material = VALUE[t];
        // PST is White-oriented; mirror the row for Black pieces.
        const pst = PST[t][white ? r : 7 - r][c];
        score += white ? material + pst : -(material + pst);
      }
    }
    return score;
  }

  // Order moves so captures (and promotions) are tried first — this makes
  // alpha-beta pruning far more effective. MVV-LVA: value the victim highly,
  // the attacker cheaply.
  function orderMoves(game, moves) {
    const scored = moves.map((m) => {
      let s = 0;
      const victim = game.board[m.to[0]][m.to[1]];
      if (victim) {
        const attacker = game.board[m.from[0]][m.from[1]];
        s += 10 * VALUE[typeOf(victim)] - VALUE[typeOf(attacker)];
      }
      if (m.enPassant) s += 10 * VALUE.p;
      if (m.promotion) s += VALUE[m.promotion];
      return { m, s };
    });
    scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.m);
  }

  // Negamax with alpha-beta. Returns the score from the perspective of the
  // side to move in `game`.
  function search(game, depth, alpha, beta) {
    const moves = game.allLegalMoves();

    if (moves.length === 0) {
      // Checkmate (bad for side to move) or stalemate (draw).
      if (game.isInCheck(game.turn)) return -MATE - depth; // prefer faster mates
      return 0;
    }
    if (depth === 0) {
      const evalWhite = evaluate(game);
      return game.turn === WHITE ? evalWhite : -evalWhite;
    }

    let best = -Infinity;
    for (const m of orderMoves(game, moves)) {
      const undo = game.applyMove(m);
      const score = -search(game, depth - 1, -beta, -alpha);
      game.undoMove(undo);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break; // beta cutoff
    }
    return best;
  }

  // Difficulty levels -> search depth.
  const LEVELS = {
    1: { depth: 1, randomness: 120 }, // "Easy" — shallow, noisy
    2: { depth: 2, randomness: 40 },  // "Medium"
    3: { depth: 3, randomness: 0 },   // "Hard"
    4: { depth: 4, randomness: 0 },   // "Expert"
  };

  // Pick the best move for the side to move. `rng` is an optional () => [0,1)
  // used only to break ties / add noise at easy levels; callers pass one so the
  // engine stays free of Math.random (which is unavailable in some contexts).
  function bestMove(game, level = 3, rng = Math.random) {
    const cfg = LEVELS[level] || LEVELS[3];
    const moves = orderMoves(game, game.allLegalMoves());
    if (moves.length === 0) return null;

    let alpha = -Infinity;
    const beta = Infinity;
    const scored = [];

    for (const m of moves) {
      const undo = game.applyMove(m);
      const score = -search(game, cfg.depth - 1, -beta, -alpha);
      game.undoMove(undo);
      scored.push({ m, score });
      if (score > alpha) alpha = score;
    }

    // Apply randomness: consider all moves within `randomness` of the best.
    const bestScore = Math.max(...scored.map((s) => s.score));
    const pool = scored.filter((s) => s.score >= bestScore - cfg.randomness);
    const choice = pool[Math.floor(rng() * pool.length)] || scored[0];
    return { move: choice.m, score: choice.score, considered: scored.length };
  }

  global.ChessAI = { bestMove, evaluate, LEVELS };
})(typeof window !== 'undefined' ? window : globalThis);
