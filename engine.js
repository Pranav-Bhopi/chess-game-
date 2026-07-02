// ---- Part 2: chess rules engine ----
//
// Board is an 8x8 array of rows. Row 0 is rank 8 (top), row 7 is rank 1
// (bottom); col 0 is file 'a', col 7 is file 'h' — matching the renderer.
// A square holds a piece code (uppercase = white, lowercase = black) or ''.

(function (global) {
  'use strict';

  const WHITE = 'w';
  const BLACK = 'b';

  const START_POSITION = [
    ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
    ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
    ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'],
  ];

  const colorOf = (code) => (code === code.toUpperCase() ? WHITE : BLACK);
  const typeOf = (code) => code.toLowerCase();
  const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

  // Sliding directions.
  const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const QUEEN_DIRS = ROOK_DIRS.concat(BISHOP_DIRS);
  const KNIGHT_MOVES = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
  ];
  const KING_MOVES = QUEEN_DIRS;

  class Game {
    constructor() {
      this.reset();
    }

    reset() {
      this.board = START_POSITION.map((row) => row.slice());
      this.turn = WHITE;
      // Castling rights: whether the king/rooks are still eligible.
      this.castling = { wK: true, wQ: true, bK: true, bQ: true };
      // Target square [r, c] available for en passant capture, or null.
      this.enPassant = null;
      this.history = []; // list of move records (see makeMove)
      this.halfmoveClock = 0; // for 50-move rule
      // Occurrence count per position (board+turn+castling+ep) for threefold
      // repetition. Only the real game line is tracked — search's applyMove/
      // undoMove deliberately don't touch this.
      this.positionCounts = {};
      this.positionCounts[this.positionKey()] = 1;
    }

    get(r, c) {
      return this.board[r][c];
    }

    // A compact string identifying a position for repetition detection. Two
    // positions are "the same" only if the pieces, side to move, castling
    // rights, and en-passant target all match (per the FIDE repetition rule).
    positionKey() {
      let s = '';
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) s += this.board[r][c] || '.';
      }
      s += ' ' + this.turn;
      s += ' ' + ((this.castling.wK ? 'K' : '') + (this.castling.wQ ? 'Q' : '') +
                  (this.castling.bK ? 'k' : '') + (this.castling.bQ ? 'q' : '') || '-');
      s += ' ' + (this.enPassant ? this.enPassant[0] + ',' + this.enPassant[1] : '-');
      return s;
    }

    // ---- Pseudo-legal move generation (ignores leaving own king in check) ----
    pseudoMoves(r, c) {
      const code = this.board[r][c];
      if (!code) return [];
      const color = colorOf(code);
      const type = typeOf(code);
      const moves = [];

      const pushIfEmpty = (tr, tc) => {
        if (inBounds(tr, tc) && this.board[tr][tc] === '') {
          moves.push({ from: [r, c], to: [tr, tc] });
          return true;
        }
        return false;
      };
      const pushIfCapture = (tr, tc) => {
        if (inBounds(tr, tc) && this.board[tr][tc] !== '' &&
            colorOf(this.board[tr][tc]) !== color) {
          moves.push({ from: [r, c], to: [tr, tc] });
        }
      };
      const slide = (dirs) => {
        for (const [dr, dc] of dirs) {
          let tr = r + dr;
          let tc = c + dc;
          while (inBounds(tr, tc)) {
            const target = this.board[tr][tc];
            if (target === '') {
              moves.push({ from: [r, c], to: [tr, tc] });
            } else {
              if (colorOf(target) !== color) moves.push({ from: [r, c], to: [tr, tc] });
              break;
            }
            tr += dr;
            tc += dc;
          }
        }
      };

      if (type === 'p') {
        const dir = color === WHITE ? -1 : 1; // white moves up (row decreases)
        const startRow = color === WHITE ? 6 : 1;
        // Single push.
        if (inBounds(r + dir, c) && this.board[r + dir][c] === '') {
          this.addPawnMove(moves, r, c, r + dir, c, color);
          // Double push from start.
          if (r === startRow && this.board[r + 2 * dir][c] === '') {
            moves.push({ from: [r, c], to: [r + 2 * dir, c], double: true });
          }
        }
        // Captures.
        for (const dc of [-1, 1]) {
          const tr = r + dir;
          const tc = c + dc;
          if (!inBounds(tr, tc)) continue;
          const target = this.board[tr][tc];
          if (target !== '' && colorOf(target) !== color) {
            this.addPawnMove(moves, r, c, tr, tc, color);
          } else if (this.enPassant && this.enPassant[0] === tr && this.enPassant[1] === tc) {
            moves.push({ from: [r, c], to: [tr, tc], enPassant: true });
          }
        }
      } else if (type === 'n') {
        for (const [dr, dc] of KNIGHT_MOVES) {
          const tr = r + dr;
          const tc = c + dc;
          if (!pushIfEmpty(tr, tc)) pushIfCapture(tr, tc);
        }
      } else if (type === 'b') {
        slide(BISHOP_DIRS);
      } else if (type === 'r') {
        slide(ROOK_DIRS);
      } else if (type === 'q') {
        slide(QUEEN_DIRS);
      } else if (type === 'k') {
        for (const [dr, dc] of KING_MOVES) {
          const tr = r + dr;
          const tc = c + dc;
          if (!pushIfEmpty(tr, tc)) pushIfCapture(tr, tc);
        }
        this.addCastlingMoves(moves, r, c, color);
      }

      return moves;
    }

    addPawnMove(moves, r, c, tr, tc, color) {
      const promoRow = color === WHITE ? 0 : 7;
      if (tr === promoRow) {
        for (const promo of ['q', 'r', 'b', 'n']) {
          moves.push({ from: [r, c], to: [tr, tc], promotion: promo });
        }
      } else {
        moves.push({ from: [r, c], to: [tr, tc] });
      }
    }

    addCastlingMoves(moves, r, c, color) {
      // King must be on its home square and not in check; squares between must
      // be empty and not attacked.
      const homeRow = color === WHITE ? 7 : 0;
      if (r !== homeRow || c !== 4) return;
      if (this.isSquareAttacked(r, c, opposite(color))) return;

      const kingSide = color === WHITE ? this.castling.wK : this.castling.bK;
      const queenSide = color === WHITE ? this.castling.wQ : this.castling.bQ;

      // King side: squares f,g empty and not attacked; rook on h.
      if (kingSide &&
          this.board[homeRow][5] === '' && this.board[homeRow][6] === '' &&
          !this.isSquareAttacked(homeRow, 5, opposite(color)) &&
          !this.isSquareAttacked(homeRow, 6, opposite(color))) {
        moves.push({ from: [r, c], to: [homeRow, 6], castle: 'K' });
      }
      // Queen side: squares b,c,d empty; c,d not attacked; rook on a.
      if (queenSide &&
          this.board[homeRow][1] === '' && this.board[homeRow][2] === '' &&
          this.board[homeRow][3] === '' &&
          !this.isSquareAttacked(homeRow, 3, opposite(color)) &&
          !this.isSquareAttacked(homeRow, 2, opposite(color))) {
        moves.push({ from: [r, c], to: [homeRow, 2], castle: 'Q' });
      }
    }

    // Is square (r,c) attacked by any piece of `byColor`?
    isSquareAttacked(r, c, byColor) {
      // Pawns.
      const pawnDir = byColor === WHITE ? -1 : 1; // direction the pawn moves
      // A pawn of byColor attacks the square in front of it diagonally, so the
      // square is attacked from row (r - pawnDir).
      for (const dc of [-1, 1]) {
        const pr = r - pawnDir;
        const pc = c + dc;
        if (inBounds(pr, pc)) {
          const p = this.board[pr][pc];
          if (p && colorOf(p) === byColor && typeOf(p) === 'p') return true;
        }
      }
      // Knights.
      for (const [dr, dc] of KNIGHT_MOVES) {
        const pr = r + dr;
        const pc = c + dc;
        if (inBounds(pr, pc)) {
          const p = this.board[pr][pc];
          if (p && colorOf(p) === byColor && typeOf(p) === 'n') return true;
        }
      }
      // King (adjacency).
      for (const [dr, dc] of KING_MOVES) {
        const pr = r + dr;
        const pc = c + dc;
        if (inBounds(pr, pc)) {
          const p = this.board[pr][pc];
          if (p && colorOf(p) === byColor && typeOf(p) === 'k') return true;
        }
      }
      // Sliders: rook/queen orthogonally, bishop/queen diagonally.
      const checkRay = (dirs, types) => {
        for (const [dr, dc] of dirs) {
          let pr = r + dr;
          let pc = c + dc;
          while (inBounds(pr, pc)) {
            const p = this.board[pr][pc];
            if (p) {
              if (colorOf(p) === byColor && types.includes(typeOf(p))) return true;
              break;
            }
            pr += dr;
            pc += dc;
          }
        }
        return false;
      };
      if (checkRay(ROOK_DIRS, ['r', 'q'])) return true;
      if (checkRay(BISHOP_DIRS, ['b', 'q'])) return true;
      return false;
    }

    findKing(color) {
      const target = color === WHITE ? 'K' : 'k';
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if (this.board[r][c] === target) return [r, c];
        }
      }
      return null;
    }

    isInCheck(color) {
      const king = this.findKing(color);
      if (!king) return false;
      return this.isSquareAttacked(king[0], king[1], opposite(color));
    }

    // Legal moves from a square: pseudo-legal filtered so the mover's king is
    // not left in check.
    legalMoves(r, c) {
      const code = this.board[r][c];
      if (!code || colorOf(code) !== this.turn) return [];
      const color = colorOf(code);
      return this.pseudoMoves(r, c).filter((move) => {
        const undo = this.applyMove(move);
        const bad = this.isInCheck(color);
        this.undoMove(undo);
        return !bad;
      });
    }

    // All legal moves for the side to move.
    allLegalMoves(color = this.turn) {
      const moves = [];
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const code = this.board[r][c];
          if (code && colorOf(code) === color) {
            moves.push(...this.legalMoves(r, c));
          }
        }
      }
      return moves;
    }

    // Apply a move to the board without validation; returns an undo record.
    // Used internally for check testing and by makeMove.
    applyMove(move) {
      const [fr, fc] = move.from;
      const [tr, tc] = move.to;
      const piece = this.board[fr][fc];
      const captured = this.board[tr][tc];

      const undo = {
        move,
        piece,
        captured,
        capturedSquare: [tr, tc],
        castling: { ...this.castling },
        enPassant: this.enPassant,
        halfmoveClock: this.halfmoveClock,
        turn: this.turn,
      };

      // Move the piece.
      this.board[tr][tc] = piece;
      this.board[fr][fc] = '';

      // En passant capture removes the pawn behind the target square.
      if (move.enPassant) {
        const dir = colorOf(piece) === WHITE ? 1 : -1; // captured pawn is behind
        undo.captured = this.board[tr + dir][tc];
        undo.capturedSquare = [tr + dir, tc];
        this.board[tr + dir][tc] = '';
      }

      // Promotion.
      if (move.promotion) {
        this.board[tr][tc] = colorOf(piece) === WHITE
          ? move.promotion.toUpperCase()
          : move.promotion;
      }

      // Castling: move the rook too.
      if (move.castle === 'K') {
        this.board[tr][5] = this.board[tr][7];
        this.board[tr][7] = '';
      } else if (move.castle === 'Q') {
        this.board[tr][3] = this.board[tr][0];
        this.board[tr][0] = '';
      }

      // Update castling rights.
      const type = typeOf(piece);
      if (type === 'k') {
        if (colorOf(piece) === WHITE) { this.castling.wK = false; this.castling.wQ = false; }
        else { this.castling.bK = false; this.castling.bQ = false; }
      }
      // Rook moved or captured — revoke the relevant right.
      this.revokeRookRight(fr, fc);
      this.revokeRookRight(tr, tc);

      // En passant target: only set on a double pawn push.
      if (move.double) {
        const dir = colorOf(piece) === WHITE ? -1 : 1;
        this.enPassant = [fr + dir, fc];
      } else {
        this.enPassant = null;
      }

      // Halfmove clock (reset on pawn move or capture).
      if (type === 'p' || captured || move.enPassant) this.halfmoveClock = 0;
      else this.halfmoveClock++;

      this.turn = opposite(this.turn);
      return undo;
    }

    revokeRookRight(r, c) {
      if (r === 7 && c === 0) this.castling.wQ = false;
      else if (r === 7 && c === 7) this.castling.wK = false;
      else if (r === 0 && c === 0) this.castling.bQ = false;
      else if (r === 0 && c === 7) this.castling.bK = false;
    }

    undoMove(undo) {
      const [fr, fc] = undo.move.from;
      const [tr, tc] = undo.move.to;
      const move = undo.move;

      // Restore the moving piece to its origin.
      this.board[fr][fc] = undo.piece;
      this.board[tr][tc] = '';

      // Restore rook for castling.
      if (move.castle === 'K') {
        this.board[tr][7] = this.board[tr][5];
        this.board[tr][5] = '';
      } else if (move.castle === 'Q') {
        this.board[tr][0] = this.board[tr][3];
        this.board[tr][3] = '';
      }

      // Restore captured piece (handles en passant square offset).
      if (undo.captured) {
        const [cr, cc] = undo.capturedSquare;
        this.board[cr][cc] = undo.captured;
      }

      this.castling = undo.castling;
      this.enPassant = undo.enPassant;
      this.halfmoveClock = undo.halfmoveClock;
      this.turn = undo.turn;
    }

    // Public: attempt a move. `from`/`to` are [r,c]. `promotion` is one of
    // 'q','r','b','n' when a pawn reaches the last rank. Returns the applied
    // move record (with SAN and resulting status) or null if illegal.
    move(from, to, promotion) {
      const legal = this.legalMoves(from[0], from[1]);
      const candidate = legal.find((m) =>
        m.to[0] === to[0] && m.to[1] === to[1] &&
        (!m.promotion || m.promotion === (promotion || 'q')));
      if (!candidate) return null;

      const san = this.toSAN(candidate);
      const undo = this.applyMove(candidate);
      // Record the resulting position for repetition tracking.
      const key = this.positionKey();
      this.positionCounts[key] = (this.positionCounts[key] || 0) + 1;
      const record = {
        ...candidate,
        san,
        color: colorOf(undo.piece),
        piece: undo.piece,
        captured: undo.captured,
        undo, // kept so takeback() can reverse this move
      };
      // Append check/mate marker to SAN.
      const status = this.status();
      if (status.checkmate) record.san += '#';
      else if (status.check) record.san += '+';
      this.history.push(record);
      return record;
    }

    // Undo the most recent move, restoring the previous position and turn.
    // Returns the undone move record, or null if there is nothing to undo.
    takeback() {
      const record = this.history.pop();
      if (!record) return null;
      // Drop this position's occurrence before rewinding the board.
      const key = this.positionKey();
      if (this.positionCounts[key]) this.positionCounts[key]--;
      this.undoMove(record.undo);
      return record;
    }

    // Standard Algebraic Notation for a candidate move (before it is applied).
    toSAN(move) {
      const [fr, fc] = move.from;
      const [tr, tc] = move.to;
      const piece = this.board[fr][fc];
      const type = typeOf(piece);
      const dest = squareName(tr, tc);

      if (move.castle === 'K') return 'O-O';
      if (move.castle === 'Q') return 'O-O-O';

      const isCapture = this.board[tr][tc] !== '' || move.enPassant;

      if (type === 'p') {
        let san = '';
        if (isCapture) san += FILES[fc] + 'x';
        san += dest;
        if (move.promotion) san += '=' + move.promotion.toUpperCase();
        return san;
      }

      // Disambiguation: other same-type pieces that can also reach dest.
      const letter = type.toUpperCase();
      let disamb = '';
      const rivals = [];
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if (r === fr && c === fc) continue;
          const p = this.board[r][c];
          if (p && p === piece) {
            if (this.pseudoMoves(r, c).some((m) => m.to[0] === tr && m.to[1] === tc)) {
              rivals.push([r, c]);
            }
          }
        }
      }
      if (rivals.length) {
        const sameFile = rivals.some(([, c]) => c === fc);
        const sameRank = rivals.some(([r]) => r === fr);
        if (!sameFile) disamb = FILES[fc];
        else if (!sameRank) disamb = String(RANKS[fr]);
        else disamb = FILES[fc] + String(RANKS[fr]);
      }

      return letter + disamb + (isCapture ? 'x' : '') + dest;
    }

    // Current game status for the side to move.
    status() {
      const check = this.isInCheck(this.turn);
      const hasMoves = this.allLegalMoves(this.turn).length > 0;
      const checkmate = check && !hasMoves;
      const stalemate = !check && !hasMoves;
      const fiftyMove = this.halfmoveClock >= 100;
      const insufficient = this.insufficientMaterial();
      const repetition = (this.positionCounts[this.positionKey()] || 0) >= 3;
      const draw = stalemate || fiftyMove || insufficient || repetition;
      let result = null;
      if (checkmate) result = this.turn === WHITE ? '0-1' : '1-0';
      else if (draw) result = '1/2-1/2';
      return {
        turn: this.turn,
        check,
        checkmate,
        stalemate,
        fiftyMove,
        insufficient,
        repetition,
        draw,
        gameOver: checkmate || draw,
        result,
      };
    }

    insufficientMaterial() {
      const pieces = [];
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = this.board[r][c];
          if (p && typeOf(p) !== 'k') pieces.push({ p, r, c });
        }
      }
      if (pieces.length === 0) return true; // K vs K
      if (pieces.length === 1) {
        const t = typeOf(pieces[0].p);
        return t === 'b' || t === 'n'; // K+B or K+N vs K
      }
      if (pieces.length === 2) {
        // K+B vs K+B with bishops on same color squares.
        if (pieces.every((x) => typeOf(x.p) === 'b')) {
          const sq0 = (pieces[0].r + pieces[0].c) % 2;
          const sq1 = (pieces[1].r + pieces[1].c) % 2;
          return sq0 === sq1;
        }
      }
      return false;
    }
  }

  const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const RANKS = [8, 7, 6, 5, 4, 3, 2, 1];
  const squareName = (r, c) => FILES[c] + RANKS[r];
  const opposite = (color) => (color === WHITE ? BLACK : WHITE);

  global.Chess = { Game, WHITE, BLACK, colorOf, typeOf, squareName, opposite };
})(typeof window !== 'undefined' ? window : globalThis);
