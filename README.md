# Chess

A desktop chess game with a Chess.com-style dark UI, built with **Electron**.
Play against a built-in engine or a friend on the same board — complete with a
chess clock, move list, captured-material tray, and an animated entrance splash.

> Piece graphics: **Cburnett** set (GPLv2+) via Lichess — see [`CREDITS.md`](CREDITS.md).
> App by **Pranav Bhopi**.

---

## Quick start (Windows)

1. Install [Node.js LTS](https://nodejs.org/) (v18 or newer).
2. Double-click **`install.bat`** — it checks your setup and installs dependencies.
3. Double-click **`run.bat`** to launch the game.

### Or from a terminal (any OS)

```bash
npm install     # install dependencies (downloads Electron on first run)
npm start       # launch the app
```

---

## Features

- **Play vs Computer** — alpha-beta engine with four levels (Easy → Expert),
  choose your color (White / Black / Random).
- **Play a Friend** — two players, one board (hot-seat).
- **Full chess rules** — castling, en passant, promotion, check/checkmate,
  stalemate, 50-move rule, insufficient material, and **threefold repetition**.
- **Chess clock** — bullet/blitz/rapid/classical presets with increment.
- **Board controls** — drag-and-drop or click-to-move, legal-move highlights,
  takeback, board flip, **resign**, and **offer draw**.
- **Sound** — move/capture/check cues plus a synthesized entrance whoosh/thud,
  with a mute toggle (remembered between sessions).
- **Animated splash** — three Staunton pieces (Knight, Pawn, Rook) perform a
  staggered, gravity-weighted jump before revealing the menu.

---

## Documentation

Detailed guides live in the [`instructions/`](instructions/) folder:

| Guide | What it covers |
|-------|----------------|
| [INSTALL.md](instructions/INSTALL.md) | Installing prerequisites and dependencies (Windows + other OSes). |
| [USAGE.md](instructions/USAGE.md) | How to play — modes, controls, clocks, draws. |
| [BUILD.md](instructions/BUILD.md) | Packaging a distributable with electron-builder. |

See [`REQUIREMENTS.md`](REQUIREMENTS.md) for the full prerequisite / dependency list.

---

## Project layout

```
index.html     Screens (splash, home menu, game) + overlays
styles.css     Chess.com-style theme, board, and animations
engine.js      Chess rules engine (move gen, SAN, status)
ai.js          Computer opponent (alpha-beta + piece-square tables)
renderer.js    UI wiring: board, clock, panels, splash + sounds
main.js        Electron main process (window + titlebar IPC)
preload.js     Secure contextBridge for window controls
assets/        Piece SVGs and sound files
install.bat    Windows dependency installer
run.bat        Windows launcher
```

## License

MIT (application code). Piece artwork is GPLv2+ — see [`CREDITS.md`](CREDITS.md).
