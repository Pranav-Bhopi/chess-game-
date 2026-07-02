// ---- Chess UI: home screen + chess.com-style game view ----

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1]; // top row first (rank 8) down to rank 1

// Map an engine piece code (e.g. 'P','n') to its SVG asset path.
// Files are named like wP.svg / bN.svg in assets/pieces/.
function pieceAsset(code) {
  const color = Chess.colorOf(code) === Chess.WHITE ? 'w' : 'b';
  return `assets/pieces/${color}${code.toUpperCase()}.svg`;
}

// Standard piece values for material-advantage display.
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

// ---- Audio cues (HTML5 Audio) ----
// Preload one Audio element per cue. Kept subtle via a modest volume.
const SOUNDS = {
  move: new Audio('assets/sounds/Move.mp3'),
  capture: new Audio('assets/sounds/Capture.mp3'),
  check: new Audio('assets/sounds/Check.mp3'),
};
for (const a of Object.values(SOUNDS)) {
  a.preload = 'auto';
  a.volume = 0.5;
}
// Restore the user's mute preference (defaults to on). Wrapped because
// localStorage can throw in some sandboxed contexts.
let soundEnabled = true;
try {
  soundEnabled = localStorage.getItem('chess.sound') !== 'off';
} catch (_) { /* ignore */ }

// Play the cue that best matches a completed move record. Check takes priority
// over capture, which takes priority over a plain move. Rewinds first so rapid
// moves (e.g. the AI's reply) always retrigger. Errors are swallowed because
// audio playback can reject if the window hasn't been interacted with yet.
function playMoveSound(rec) {
  if (!soundEnabled || !rec) return;
  const inCheck = game.status().check; // status reflects the position after rec
  const key = inCheck ? 'check' : (rec.captured || rec.enPassant) ? 'capture' : 'move';
  const clip = SOUNDS[key];
  try {
    clip.currentTime = 0;
    const p = clip.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) { /* ignore */ }
}

const game = new Chess.Game();
const boardEl = document.getElementById('board');
const squareEls = []; // squareEls[row][col] -> DOM element

// Interaction state.
let selected = null;      // { r, c } of the currently selected piece
let legalTargets = [];    // legal move objects from the selected square
let lastMove = null;      // { from:[r,c], to:[r,c] } for highlight
let dragInfo = null;      // active drag state

// Game settings.
const settings = {
  opponent: 'computer',   // 'human' | 'computer'
  aiColor: Chess.BLACK,   // color the computer plays when opponent === 'computer'
  humanColor: Chess.WHITE,// color the human plays (vs computer)
  difficulty: 3,
  timeControl: null,      // { baseMs, incMs } or null for no clock
};
let orientation = Chess.WHITE; // which color is at the bottom of the board
let aiThinking = false;

const DIFF_NAMES = { 1: 'Easy', 2: 'Medium', 3: 'Hard', 4: 'Expert' };

// ---- Chess clock ----
// Time control: base seconds + Fisher increment per move, or null for no clock.
// clock.remaining is in milliseconds per color; the active side ticks down.
const clock = {
  enabled: false,
  baseMs: 0,
  incMs: 0,
  remaining: { w: 0, b: 0 },
  running: false,     // whether the interval is actively counting
  activeColor: null,  // color currently being charged
  lastTick: 0,        // timestamp of the last tick (ms)
  intervalId: null,
};
// Set when a player flags (runs out of time). { winner: color, loser: color }.
let clockGameOver = null;
// Set when the game ends by agreement or resignation, before the board rules
// force it. { winner: color|null (null = draw), reason: 'resign'|'draw' }.
let adjudicated = null;
// A pending draw offer awaiting a human response, or null. Holds the color that
// offered so the responder is unambiguous in hotseat play.
let pendingDrawOffer = null;

// Parse a time-control value like "300+3" (5 min + 3s) or "none".
function parseTimeControl(value) {
  if (!value || value === 'none') return null;
  const [base, inc] = value.split('+').map(Number);
  return { baseMs: base * 1000, incMs: (inc || 0) * 1000 };
}

// True when the side to move is the computer.
function isAITurn() {
  return settings.opponent === 'computer' && game.turn === settings.aiColor;
}

// The game is over either by the rules (checkmate/draw) or on time.
function isGameOver() {
  return game.status().gameOver || clockGameOver !== null || adjudicated !== null;
}

// The board is locked while the AI thinks or when it's the AI's turn.
function boardLocked() {
  return aiThinking || isAITurn() || isGameOver();
}

// ---- Board construction (respects orientation) ----
function buildBoard() {
  boardEl.innerHTML = '';
  squareEls.length = 0;
  for (let r = 0; r < 8; r++) squareEls[r] = [];

  // Visual iteration: top-to-bottom, left-to-right. Map each visual cell to
  // engine coordinates based on orientation so we can flip the board.
  for (let vr = 0; vr < 8; vr++) {
    for (let vc = 0; vc < 8; vc++) {
      const row = orientation === Chess.WHITE ? vr : 7 - vr;
      const col = orientation === Chess.WHITE ? vc : 7 - vc;

      const square = document.createElement('div');
      const isLight = (row + col) % 2 === 0;
      square.className = `square ${isLight ? 'light' : 'dark'}`;
      square.dataset.row = row;
      square.dataset.col = col;
      square.dataset.square = `${FILES[col]}${RANKS[row]}`;

      // Coordinate labels along the visual bottom row and left column.
      if (vr === 7) {
        const file = document.createElement('span');
        file.className = 'coord file';
        file.textContent = FILES[col];
        square.appendChild(file);
      }
      if (vc === 0) {
        const rank = document.createElement('span');
        rank.className = 'coord rank';
        rank.textContent = RANKS[row];
        square.appendChild(rank);
      }

      square.addEventListener('click', onSquareClick);
      square.addEventListener('mousedown', onSquareMouseDown);

      boardEl.appendChild(square);
      squareEls[row][col] = square;
    }
  }
}

// ---- Rendering the current position ----
function renderPosition() {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = squareEls[row][col];
      const existing = square.querySelector('.piece');
      if (existing) existing.remove();

      const code = game.get(row, col);
      if (code) {
        const piece = document.createElement('div');
        const isWhite = Chess.colorOf(code) === Chess.WHITE;
        piece.className = `piece ${isWhite ? 'white' : 'black'}`;
        piece.style.backgroundImage = `url("${pieceAsset(code)}")`;
        square.appendChild(piece);
      }
    }
  }
  renderHighlights();
}

// ---- Highlights (selection, legal targets, last move, check) ----
function renderHighlights() {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = squareEls[row][col];
      sq.classList.remove('selected', 'target', 'target-capture', 'last-move', 'in-check');
    }
  }

  if (lastMove) {
    squareEls[lastMove.from[0]][lastMove.from[1]].classList.add('last-move');
    squareEls[lastMove.to[0]][lastMove.to[1]].classList.add('last-move');
  }

  if (selected) {
    squareEls[selected.r][selected.c].classList.add('selected');
    for (const m of legalTargets) {
      const [tr, tc] = m.to;
      const isCapture = game.get(tr, tc) !== '' || m.enPassant;
      squareEls[tr][tc].classList.add(isCapture ? 'target-capture' : 'target');
    }
  }

  const status = game.status();
  if (status.check) {
    const king = game.findKing(status.turn);
    if (king) squareEls[king[0]][king[1]].classList.add('in-check');
  }
}

// ---- Selection helpers ----
function selectSquare(r, c) {
  const code = game.get(r, c);
  if (code && Chess.colorOf(code) === game.turn) {
    selected = { r, c };
    legalTargets = game.legalMoves(r, c);
  } else {
    clearSelection();
  }
  renderHighlights();
}

function clearSelection() {
  selected = null;
  legalTargets = [];
}

function targetAt(r, c) {
  return legalTargets.find((m) => m.to[0] === r && m.to[1] === c);
}

// ---- Click-to-move ----
function onSquareClick(e) {
  if (boardLocked()) return;
  const row = Number(e.currentTarget.dataset.row);
  const col = Number(e.currentTarget.dataset.col);

  if (selected) {
    const move = targetAt(row, col);
    if (move) {
      attemptMove(selected, { r: row, c: col });
      return;
    }
    if (selected.r === row && selected.c === col) {
      clearSelection();
      renderHighlights();
      return;
    }
  }
  selectSquare(row, col);
}

// ---- Drag-and-drop ----
function onSquareMouseDown(e) {
  if (boardLocked()) return;
  if (e.button !== 0) return;
  const square = e.currentTarget;
  const row = Number(square.dataset.row);
  const col = Number(square.dataset.col);
  const code = game.get(row, col);
  if (!code || Chess.colorOf(code) !== game.turn) return;

  e.preventDefault();
  selectSquare(row, col);

  const pieceEl = square.querySelector('.piece');
  if (!pieceEl) return;

  const rect = pieceEl.getBoundingClientRect();
  const ghost = pieceEl.cloneNode(true);
  ghost.classList.add('dragging');
  ghost.style.width = rect.width + 'px';
  ghost.style.height = rect.height + 'px';
  document.body.appendChild(ghost);

  pieceEl.classList.add('drag-source');

  dragInfo = {
    from: { r: row, c: col },
    ghost,
    pieceEl,
    offsetX: rect.width / 2,
    offsetY: rect.height / 2,
    moved: false,
  };
  moveGhost(e.clientX, e.clientY);

  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
}

function moveGhost(x, y) {
  const g = dragInfo.ghost;
  g.style.left = x - dragInfo.offsetX + 'px';
  g.style.top = y - dragInfo.offsetY + 'px';
}

function onDragMove(e) {
  if (!dragInfo) return;
  dragInfo.moved = true;
  moveGhost(e.clientX, e.clientY);
}

function onDragEnd(e) {
  if (!dragInfo) return;
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragEnd);

  const info = dragInfo;
  dragInfo = null;
  info.ghost.remove();
  if (info.pieceEl) info.pieceEl.classList.remove('drag-source');

  const el = document.elementFromPoint(e.clientX, e.clientY);
  const squareEl = el && el.closest('.square');
  if (squareEl) {
    const row = Number(squareEl.dataset.row);
    const col = Number(squareEl.dataset.col);
    const move = targetAt(row, col);
    if (move) {
      attemptMove(info.from, { r: row, c: col });
      return;
    }
  }
  renderPosition();
}

// ---- Making a move (handles promotion) ----
function attemptMove(from, to) {
  const move = legalTargets.find((m) => m.to[0] === to.r && m.to[1] === to.c);
  if (!move) return;

  if (move.promotion) {
    promptPromotion(game.turn, (choice) => finalizeMove(from, to, choice));
    return;
  }
  finalizeMove(from, to);
}

function finalizeMove(from, to, promotion) {
  const rec = game.move([from.r, from.c], [to.r, to.c], promotion);
  if (!rec) return;
  // Making a move withdraws/declines any outstanding draw offer.
  if (pendingDrawOffer) { pendingDrawOffer = null; hideDrawOffer(); }
  lastMove = { from: rec.from, to: rec.to };
  playMoveSound(rec);
  advanceClockAfterMove(rec.color);
  clearSelection();
  renderPosition();
  updatePanel();
  maybeTriggerAI();
}

// ---- Computer opponent ----
function maybeTriggerAI() {
  if (!isAITurn() || isGameOver()) return;
  aiThinking = true;
  updateThinking();
  // Defer so the human's move paints before the (blocking) search runs.
  setTimeout(runAIMove, 30);
}

function runAIMove() {
  const result = ChessAI.bestMove(game, settings.difficulty, Math.random);
  aiThinking = false;
  updateThinking();
  if (!result) return;

  const { move } = result;
  const rec = game.move(move.from, move.to, move.promotion);
  if (!rec) return;
  lastMove = { from: rec.from, to: rec.to };
  playMoveSound(rec);
  advanceClockAfterMove(rec.color);
  renderPosition();
  updatePanel();
}

// Called when either side completes a move: charge/increment the mover, then
// hand the clock to the opponent (unless the game just ended).
function advanceClockAfterMove(moverColor) {
  if (!clock.enabled) return;
  pauseClockAfterMove(moverColor);
  if (!isGameOver()) startClockForTurn();
}

function updateThinking() {
  thinkingEl.classList.toggle('hidden', !aiThinking);
  updateControls();
}

// ---- Promotion picker ----
const promoOverlay = document.getElementById('promo-overlay');
const promoPicker = document.getElementById('promo-picker');

function promptPromotion(color, cb) {
  promoPicker.innerHTML = '';
  const isWhite = color === Chess.WHITE;
  for (const t of ['q', 'r', 'b', 'n']) {
    const code = isWhite ? t.toUpperCase() : t;
    const btn = document.createElement('button');
    btn.className = 'promo-choice';
    btn.style.backgroundImage = `url("${pieceAsset(code)}")`;
    btn.addEventListener('click', () => {
      promoOverlay.classList.add('hidden');
      cb(t);
    });
    promoPicker.appendChild(btn);
  }
  promoOverlay.classList.remove('hidden');
}

// ---- Side panel: status, move list, controls ----
const turnDot = document.getElementById('turn-dot');
const turnText = document.getElementById('turn-text');
const statusMessage = document.getElementById('status-message');
const moveList = document.getElementById('move-list');
const thinkingEl = document.getElementById('thinking');
const takebackBtn = document.getElementById('takeback');
const resignBtn = document.getElementById('resign');
const offerDrawBtn = document.getElementById('offer-draw');
const drawOfferEl = document.getElementById('draw-offer');
const drawOfferText = document.getElementById('draw-offer-text');

function updatePanel() {
  const status = game.status();
  const whiteToMove = status.turn === Chess.WHITE;

  turnDot.className = `dot ${whiteToMove ? 'white' : 'black'}`;
  turnText.textContent = whiteToMove ? 'White to move' : 'Black to move';

  let msg = '';
  if (adjudicated) {
    if (adjudicated.reason === 'draw') msg = 'Draw by agreement';
    else {
      const winnerName = adjudicated.winner === Chess.WHITE ? 'White' : 'Black';
      const loserName = adjudicated.winner === Chess.WHITE ? 'Black' : 'White';
      msg = `${loserName} resigned — ${winnerName} wins`;
    }
  } else if (clockGameOver) {
    const winnerName = clockGameOver.winner === Chess.WHITE ? 'White' : 'Black';
    const loserName = clockGameOver.loser === Chess.WHITE ? 'White' : 'Black';
    msg = `${loserName} ran out of time — ${winnerName} wins`;
  } else if (status.checkmate) msg = `Checkmate — ${whiteToMove ? 'Black' : 'White'} wins`;
  else if (status.stalemate) msg = 'Stalemate — draw';
  else if (status.fiftyMove) msg = 'Draw — 50-move rule';
  else if (status.insufficient) msg = 'Draw — insufficient material';
  else if (status.repetition) msg = 'Draw — threefold repetition';
  else if (status.check) msg = 'Check';
  statusMessage.textContent = msg;
  statusMessage.classList.toggle('game-over', isGameOver());

  updateControls();
  renderMoveList();
  renderPlayerBars();
  renderClocks();
  maybeShowGameOver();
}

// ---- Game-over modal ----
const gameoverOverlay = document.getElementById('gameover-overlay');
const gameoverCard = gameoverOverlay.querySelector('.modal-card');
const gameoverIcon = document.getElementById('gameover-icon');
const gameoverTitle = document.getElementById('gameover-title');
const gameoverSub = document.getElementById('gameover-sub');
let gameOverShown = false; // guard so the modal only pops once per game

// Derive a human-readable outcome from the current game/clock state.
// Returns { title, sub, tone, winner } or null if the game isn't over.
function describeOutcome() {
  const status = game.status();

  // Winner color (null for a draw).
  let winner = null;
  let title = '';
  if (adjudicated) {
    if (adjudicated.reason === 'draw') {
      return { title: 'Draw', sub: 'Draw by agreement', tone: 'draw', winner: null };
    }
    winner = adjudicated.winner;
    title = 'Resignation';
  } else if (clockGameOver) {
    winner = clockGameOver.winner;
    title = 'Time out';
  } else if (status.checkmate) {
    winner = status.turn === Chess.WHITE ? Chess.BLACK : Chess.WHITE; // side to move is mated
    title = 'Checkmate';
  } else if (status.stalemate) {
    title = 'Stalemate';
  } else if (status.fiftyMove) {
    title = 'Draw';
  } else if (status.insufficient) {
    title = 'Draw';
  } else if (status.repetition) {
    title = 'Draw';
  } else {
    return null; // not over
  }

  // Draw?
  if (!winner) {
    let sub = 'Draw';
    if (status.stalemate) sub = 'Stalemate — nobody can move';
    else if (status.fiftyMove) sub = 'Draw by the 50-move rule';
    else if (status.insufficient) sub = 'Draw — insufficient material';
    else if (status.repetition) sub = 'Draw by threefold repetition';
    return { title, sub, tone: 'draw', winner: null };
  }

  // Decide phrasing based on mode.
  let who;
  if (settings.opponent === 'computer') {
    who = winner === settings.humanColor ? 'You win' : 'Computer wins';
  } else {
    who = `${winner === Chess.WHITE ? 'White' : 'Black'} wins`;
  }
  const reason = adjudicated ? 'by resignation'
    : clockGameOver ? 'on time'
    : status.checkmate ? 'by checkmate' : '';
  const sub = reason ? `${who} ${reason}` : who;

  // Tone from the human's perspective when vs computer, else neutral "win".
  let tone = 'win';
  if (settings.opponent === 'computer') {
    tone = winner === settings.humanColor ? 'win' : 'lose';
  }
  return { title, sub, tone, winner };
}

function maybeShowGameOver() {
  if (gameOverShown) return;
  if (!isGameOver()) return;
  const outcome = describeOutcome();
  if (!outcome) return;
  gameOverShown = true;

  gameoverTitle.textContent = outcome.title;
  gameoverSub.textContent = outcome.sub;
  gameoverCard.classList.remove('win', 'lose', 'draw');
  gameoverCard.classList.add(outcome.tone);

  // Icon: winner's king, or a handshake-ish glyph for a draw.
  if (outcome.winner === Chess.WHITE) gameoverIcon.textContent = '♔';
  else if (outcome.winner === Chess.BLACK) gameoverIcon.textContent = '♚';
  else gameoverIcon.textContent = '½';

  // Small delay so the final move/highlight paints before the modal appears.
  setTimeout(() => gameoverOverlay.classList.remove('hidden'), 260);
}

function hideGameOver() {
  gameoverOverlay.classList.add('hidden');
}

function updateControls() {
  const over = isGameOver();
  if (takebackBtn) {
    takebackBtn.disabled = aiThinking || game.history.length === 0 ||
      clockGameOver !== null || adjudicated !== null;
  }
  // Resign / draw are only meaningful in an ongoing game and not mid-search.
  if (resignBtn) resignBtn.disabled = over || aiThinking;
  if (offerDrawBtn) offerDrawBtn.disabled = over || aiThinking || pendingDrawOffer !== null;
}

function renderMoveList() {
  moveList.innerHTML = '';
  const h = game.history;
  for (let i = 0; i < h.length; i += 2) {
    const li = document.createElement('li');
    const num = document.createElement('span');
    num.className = 'move-num';
    num.textContent = (i / 2 + 1) + '.';
    li.appendChild(num);

    const white = document.createElement('span');
    white.className = 'move-san';
    white.textContent = h[i].san;
    li.appendChild(white);

    if (h[i + 1]) {
      const black = document.createElement('span');
      black.className = 'move-san';
      black.textContent = h[i + 1].san;
      li.appendChild(black);
    }
    moveList.appendChild(li);
  }
  moveList.scrollTop = moveList.scrollHeight;
}

// ---- Chess clock engine ----
const clockTopEl = document.getElementById('clock-top');
const clockBottomEl = document.getElementById('clock-bottom');

// Format milliseconds as M:SS, or MM:SS.t (tenths) under 10 seconds.
function formatClock(ms) {
  const clamped = Math.max(0, ms);
  const totalSec = clamped / 1000;
  if (clamped < 10000) {
    // Show tenths in the final countdown.
    const s = Math.floor(totalSec);
    const tenths = Math.floor((totalSec - s) * 10);
    return `${s}.${tenths}`;
  }
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Configure the clock for a new game from the chosen time control.
function setupClock(tc) {
  stopClockInterval();
  if (!tc) {
    clock.enabled = false;
    clock.running = false;
    clock.activeColor = null;
    clockTopEl.classList.add('hidden');
    clockBottomEl.classList.add('hidden');
    return;
  }
  clock.enabled = true;
  clock.baseMs = tc.baseMs;
  clock.incMs = tc.incMs;
  clock.remaining = { w: tc.baseMs, b: tc.baseMs };
  clock.running = false;
  clock.activeColor = null;
  clockTopEl.classList.remove('hidden');
  clockBottomEl.classList.remove('hidden');
  renderClocks();
}

// Begin charging the side to move (called when a game starts and after each
// move). White's clock starts running as soon as the game begins.
function startClockForTurn() {
  if (!clock.enabled || isGameOver()) return;
  clock.activeColor = game.turn;
  clock.running = true;
  clock.lastTick = performance.now();
  if (!clock.intervalId) {
    clock.intervalId = setInterval(tickClock, 100);
  }
  renderClocks();
}

// Pause the active clock (e.g. between finishing a move and the next start),
// and apply the Fisher increment to the player who just moved.
function pauseClockAfterMove(moverColor) {
  if (!clock.enabled) return;
  chargeElapsed();
  clock.running = false;
  // If the mover's time expired during their own move (e.g. a long AI search
  // that the tick interval couldn't observe), they flag — no increment.
  if (clock.remaining[moverColor] <= 0) {
    clock.remaining[moverColor] = 0;
    onFlag(moverColor);
    return;
  }
  if (clock.incMs) clock.remaining[moverColor] += clock.incMs;
  renderClocks();
}

// Subtract real elapsed time from the active clock since the last tick.
function chargeElapsed() {
  if (!clock.running || !clock.activeColor) return;
  const now = performance.now();
  const elapsed = now - clock.lastTick;
  clock.lastTick = now;
  clock.remaining[clock.activeColor] -= elapsed;
}

function tickClock() {
  if (!clock.running) return;
  chargeElapsed();
  if (clock.remaining[clock.activeColor] <= 0) {
    clock.remaining[clock.activeColor] = 0;
    onFlag(clock.activeColor);
  }
  renderClocks();
}

function stopClockInterval() {
  if (clock.intervalId) {
    clearInterval(clock.intervalId);
    clock.intervalId = null;
  }
  clock.running = false;
}

// A player ran out of time.
function onFlag(loser) {
  const winner = Chess.opposite(loser);
  clockGameOver = { winner, loser };
  stopClockInterval();
  clearSelection();
  renderHighlights();
  updatePanel();
}

// Map clock DOM elements to colors based on orientation, then paint.
function renderClocks() {
  if (!clock.enabled) return;
  const bottomColor = orientation;
  const topColor = Chess.opposite(orientation);
  paintClock(clockBottomEl, bottomColor);
  paintClock(clockTopEl, topColor);
}

function paintClock(el, color) {
  const ms = clock.remaining[color];
  el.textContent = formatClock(ms);
  const isActive = clock.running && clock.activeColor === color && !isGameOver();
  const flagged = clockGameOver && clockGameOver.loser === color;
  el.classList.toggle('active', !!isActive);
  el.classList.toggle('low', ms <= 20000 && ms > 0);
  el.classList.toggle('urgent', isActive && ms <= 10000);
  el.classList.toggle('flagged', !!flagged);
}

// ---- Player bars + captured pieces ----
const nameTop = document.getElementById('name-top');
const nameBottom = document.getElementById('name-bottom');
const avatarTop = document.getElementById('avatar-top');
const avatarBottom = document.getElementById('avatar-bottom');
const capturedTop = document.getElementById('captured-top');
const capturedBottom = document.getElementById('captured-bottom');

// Display name for a given color under the current settings.
function playerName(color) {
  if (settings.opponent === 'computer') {
    return color === settings.aiColor
      ? `Computer (${DIFF_NAMES[settings.difficulty]})`
      : 'You';
  }
  return color === Chess.WHITE ? 'White' : 'Black';
}

// Count captured pieces for each side and the material advantage.
// Returns { w: {p,n,...}, b: {...}, lead: {color, value} }.
function computeCaptured() {
  const capturedBy = { w: {}, b: {} }; // pieces captured BY white / by black
  let whitePts = 0;
  let blackPts = 0;
  for (const rec of game.history) {
    if (!rec.captured) continue;
    const t = Chess.typeOf(rec.captured);
    const capturerIsWhite = rec.color === Chess.WHITE;
    const bucket = capturerIsWhite ? capturedBy.w : capturedBy.b;
    bucket[t] = (bucket[t] || 0) + 1;
    if (capturerIsWhite) whitePts += PIECE_VALUE[t] || 0;
    else blackPts += PIECE_VALUE[t] || 0;
  }
  const diff = whitePts - blackPts;
  const lead = diff === 0 ? null
    : { color: diff > 0 ? Chess.WHITE : Chess.BLACK, value: Math.abs(diff) };
  return { capturedBy, lead };
}

// Render a captured tray: `capturerColor` shows the enemy pieces it has taken.
function renderTray(container, capturerColor, data) {
  container.innerHTML = '';
  const bucket = capturerColor === Chess.WHITE ? data.capturedBy.w : data.capturedBy.b;
  // Captured pieces are the opponent's color.
  const takenColor = capturerColor === Chess.WHITE ? 'b' : 'w';
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    const n = bucket[t] || 0;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('span');
      el.className = 'cap';
      el.style.backgroundImage = `url("assets/pieces/${takenColor}${t.toUpperCase()}.svg")`;
      container.appendChild(el);
    }
  }
  if (data.lead && data.lead.color === capturerColor) {
    const lead = document.createElement('span');
    lead.className = 'lead';
    lead.textContent = `+${data.lead.value}`;
    container.appendChild(lead);
  }
}

function renderPlayerBars() {
  const bottomColor = orientation;                 // player at the bottom
  const topColor = Chess.opposite(orientation);    // player at the top

  nameBottom.textContent = playerName(bottomColor);
  nameTop.textContent = playerName(topColor);
  avatarBottom.textContent = bottomColor === Chess.WHITE ? '♙' : '♟';
  avatarTop.textContent = topColor === Chess.WHITE ? '♙' : '♟';

  const data = computeCaptured();
  renderTray(capturedBottom, bottomColor, data);
  renderTray(capturedTop, topColor, data);
}

// ---- Sound toggle ----
const soundToggleBtn = document.getElementById('sound-toggle');

function renderSoundToggle() {
  soundToggleBtn.textContent = soundEnabled ? '🔊' : '🔇';
  soundToggleBtn.classList.toggle('muted', !soundEnabled);
  soundToggleBtn.title = soundEnabled ? 'Mute sound' : 'Unmute sound';
}

soundToggleBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  try { localStorage.setItem('chess.sound', soundEnabled ? 'on' : 'off'); } catch (_) { /* ignore */ }
  renderSoundToggle();
});
renderSoundToggle();

// ---- In-game controls ----
document.getElementById('new-game').addEventListener('click', startNewGame);

document.getElementById('flip').addEventListener('click', () => {
  orientation = Chess.opposite(orientation);
  buildBoard();
  renderPosition();
  renderPlayerBars();
  renderClocks();
});

takebackBtn.addEventListener('click', () => {
  if (aiThinking) return;
  const undone = game.takeback();
  if (!undone) return;
  // If we just undid the computer's move, also undo the human's move before it.
  if (settings.opponent === 'computer' && game.turn === settings.aiColor) {
    game.takeback();
  }
  syncLastMove();
  clearSelection();
  // Hand the clock back to whoever is now to move. (Remaining times are kept
  // as-is rather than rewound — a takeback doesn't refund spent time.)
  if (clock.enabled) {
    chargeElapsed();
    clock.running = false;
    startClockForTurn();
  }
  renderPosition();
  updatePanel();
});

// ---- Resign & draw offers ----
// End the game by agreement or resignation. `result` is { winner, reason }.
function endGame(result) {
  adjudicated = result;
  pendingDrawOffer = null;
  hideDrawOffer();
  if (clock.enabled) { chargeElapsed(); stopClockInterval(); }
  clearSelection();
  renderHighlights();
  updatePanel();
}

resignBtn.addEventListener('click', () => {
  if (isGameOver() || aiThinking) return;
  // Versus the computer the human resigns; in hotseat the side to move resigns.
  const loser = settings.opponent === 'computer' ? settings.humanColor : game.turn;
  endGame({ winner: Chess.opposite(loser), reason: 'resign' });
});

offerDrawBtn.addEventListener('click', () => {
  if (isGameOver() || aiThinking || pendingDrawOffer) return;
  if (settings.opponent === 'computer') {
    // The engine accepts only if it isn't clearly better in the current position.
    const evalWhite = ChessAI.evaluate(game);
    const aiScore = settings.aiColor === Chess.WHITE ? evalWhite : -evalWhite;
    if (aiScore <= 50) endGame({ winner: null, reason: 'draw' });
    else flashStatus('Computer declines the draw');
  } else {
    // Hotseat: the side to move offers; the opponent accepts or declines.
    pendingDrawOffer = game.turn;
    const offerer = game.turn === Chess.WHITE ? 'White' : 'Black';
    drawOfferText.textContent = `${offerer} offers a draw`;
    drawOfferEl.classList.remove('hidden');
    updateControls();
  }
});

document.getElementById('draw-accept').addEventListener('click', () => {
  if (!pendingDrawOffer) return;
  endGame({ winner: null, reason: 'draw' });
});

document.getElementById('draw-decline').addEventListener('click', () => {
  pendingDrawOffer = null;
  hideDrawOffer();
  updateControls();
});

function hideDrawOffer() {
  drawOfferEl.classList.add('hidden');
}

// Briefly show a message in the status line, then restore the normal panel.
let flashTimer = null;
function flashStatus(text) {
  statusMessage.textContent = text;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashTimer = null; updatePanel(); }, 1800);
}

function syncLastMove() {
  const h = game.history;
  lastMove = h.length ? { from: h[h.length - 1].from, to: h[h.length - 1].to } : null;
}

// Reset the game and reflect current settings (orientation + AI first move).
function startNewGame() {
  game.reset();
  selected = null;
  legalTargets = [];
  lastMove = null;
  aiThinking = false;
  clockGameOver = null;
  adjudicated = null;
  pendingDrawOffer = null;
  hideDrawOffer();
  gameOverShown = false;
  hideGameOver();

  orientation = settings.opponent === 'computer' ? settings.humanColor : Chess.WHITE;

  setupClock(settings.timeControl);

  buildBoard();
  renderPosition();
  updateThinking();
  updatePanel();
  startClockForTurn();  // White's clock begins
  maybeTriggerAI();     // in case the computer plays White
}

// ============ Screen navigation + home screen ============
const homeScreen = document.getElementById('home-screen');
const gameScreen = document.getElementById('game-screen');
const homeOptions = document.getElementById('home-options');
const homeColor = document.getElementById('home-color');
const homeDifficulty = document.getElementById('home-difficulty');
const homeTime = document.getElementById('home-time');
const modeCards = document.querySelectorAll('.mode-card');

let homeMode = 'computer';   // selected mode on the home screen
let homeColorChoice = 'w';   // 'w' | 'r' | 'b'

function showScreen(which) {
  homeScreen.classList.toggle('hidden', which !== 'home');
  gameScreen.classList.toggle('hidden', which !== 'game');
}

// Mode cards.
modeCards.forEach((card) => {
  card.addEventListener('click', () => {
    modeCards.forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
    homeMode = card.dataset.mode;
    // Color/difficulty only matter versus the computer.
    homeOptions.classList.toggle('hidden', homeMode !== 'computer');
  });
});

// Color segmented control.
homeColor.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  homeColor.querySelectorAll('.seg').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  homeColorChoice = btn.dataset.color;
});

// Play button: commit home selections into settings and start.
document.getElementById('play-btn').addEventListener('click', () => {
  settings.opponent = homeMode;
  settings.difficulty = Number(homeDifficulty.value);
  settings.timeControl = parseTimeControl(homeTime.value);

  if (homeMode === 'computer') {
    let human = homeColorChoice;
    if (human === 'r') human = Math.random() < 0.5 ? 'w' : 'b';
    settings.humanColor = human === 'w' ? Chess.WHITE : Chess.BLACK;
    settings.aiColor = Chess.opposite(settings.humanColor);
  }

  showScreen('game');
  startNewGame();
});

// Back to home.
document.getElementById('home-btn').addEventListener('click', () => {
  stopClockInterval();
  hideGameOver();
  hideDrawOffer();
  showScreen('home');
});

// ---- Game-over modal buttons ----
document.getElementById('gameover-newgame').addEventListener('click', startNewGame);

document.getElementById('gameover-home').addEventListener('click', () => {
  stopClockInterval();
  hideGameOver();
  showScreen('home');
});

// Dismiss lets the player inspect the final position (modal can be reopened via
// the panel state; New game / Home remain in the side panel).
document.getElementById('gameover-dismiss').addEventListener('click', hideGameOver);

// ============ Custom titlebar window controls ============
// windowControls is exposed by preload.js over the contextBridge.
(function initTitlebar() {
  const wc = window.windowControls;
  const titlebar = document.getElementById('titlebar');
  const minBtn = document.getElementById('win-min');
  const maxBtn = document.getElementById('win-max');
  const closeBtn = document.getElementById('win-close');

  // If the bridge is missing (e.g. opened outside Electron), hide controls.
  if (!wc) {
    if (titlebar) titlebar.style.display = 'none';
    document.documentElement.style.setProperty('--titlebar-h', '0px');
    return;
  }

  minBtn.addEventListener('click', () => wc.minimize());
  maxBtn.addEventListener('click', () => wc.toggleMaximize());
  closeBtn.addEventListener('click', () => wc.close());

  // Reflect the maximize state on the titlebar (swaps the max/restore icon).
  const applyMaxState = (isMax) => titlebar.classList.toggle('maximized', !!isMax);
  wc.isMaximized().then(applyMaxState);
  wc.onMaximizedChanged(applyMaxState);
})();

// ---- Splash sound synth (Web Audio) ----
// The whoosh (launch) and thud (landing) are synthesized so the app needs no
// extra audio assets. Kept soft and gated by the same sound toggle as the game
// cues. A single shared AudioContext is created lazily.
let splashAudioCtx = null;
function splashAudio() {
  if (splashAudioCtx) return splashAudioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    splashAudioCtx = new Ctx();
  } catch (_) { return null; }
  return splashAudioCtx;
}

// Soft airy whoosh: bandpass-swept white noise with a quick swell and fade.
function playWhoosh(ctx, when) {
  const dur = 0.28;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(500, when);
  bp.frequency.exponentialRampToValueAtTime(1600, when + dur * 0.5);
  bp.frequency.exponentialRampToValueAtTime(400, when + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.11, when + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(bp).connect(gain).connect(ctx.destination);
  src.start(when);
  src.stop(when + dur);
}

// Firm-but-soft thud: a low sine drop for body plus a short filtered click.
function playThud(ctx, when) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(165, when);
  osc.frequency.exponentialRampToValueAtTime(55, when + 0.14);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, when);
  og.gain.exponentialRampToValueAtTime(0.26, when + 0.012);
  og.gain.exponentialRampToValueAtTime(0.0001, when + 0.2);
  osc.connect(og).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.22);

  const nlen = Math.ceil(ctx.sampleRate * 0.05);
  const nb = ctx.createBuffer(1, nlen, ctx.sampleRate);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nlen);
  const ns = ctx.createBufferSource();
  ns.buffer = nb;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.08, when);
  ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  ns.connect(lp).connect(ng).connect(ctx.destination);
  ns.start(when);
  ns.stop(when + 0.05);
}

// Schedule a whoosh on each piece's launch and a thud on its landing, matching
// the CSS timings: stagger 0.31s between pieces, touchdown at ~84% of the jump.
function playSplashSounds() {
  if (!soundEnabled) return;
  const ctx = splashAudio();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const t0 = ctx.currentTime + 0.03;
  const STAGGER = 0.425; // matches animation-delay
  const LAND = 0.714;    // ~84% of the 0.85s jump = touchdown
  for (let i = 0; i < 3; i++) {
    playWhoosh(ctx, t0 + i * STAGGER);
    playThud(ctx, t0 + i * STAGGER + LAND);
  }
}

// ---- Splash / entrance animation ----
// The home menu is mounted immediately underneath; the splash overlays it and
// plays the staggered three-piece jump (CSS driven), then slides up to reveal
// the menu. Click-to-skip, and shortened for reduced-motion users.
(function initSplash() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;

  const reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Rook settles at ~1.7s; hold a beat before revealing. Short-circuit if the
  // user prefers reduced motion.
  const HOLD_MS = reduce ? 350 : 2000;

  if (!reduce) playSplashSounds();

  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    // Cut any scheduled whoosh/thud if the splash is skipped early.
    if (splashAudioCtx) {
      try { splashAudioCtx.close(); } catch (_) { /* ignore */ }
      splashAudioCtx = null;
    }
    splash.classList.add('splash-hide');
    // Remove after the slide/fade transition so it can't trap clicks.
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    // Fallback removal in case transitionend doesn't fire.
    setTimeout(() => splash.remove(), 800);
  }

  const timer = setTimeout(dismiss, HOLD_MS);
  splash.addEventListener('click', dismiss); // allow skipping
})();

// ---- Boot ----
showScreen('home');
