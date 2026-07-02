# Requirements

This is an **Electron** (Node.js) desktop app. It has no Python/`pip`
requirements — everything is installed through `npm`. This document lists what
you need before running `install.bat` (or `npm install`).

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | 18 LTS or newer (tested on 20/22/24) | Includes `npm`. Get it from https://nodejs.org/ |
| **npm** | 9 or newer | Ships with Node.js. |
| **OS** | Windows 10/11 for the `.bat` scripts | The app itself is cross-platform (macOS/Linux via `npm start`). |
| **Internet** | Required for the first install | `npm install` downloads the Electron binary (~one-time). |
| **Disk** | ~300–400 MB | Mostly the Electron runtime under `node_modules/`. |

## Dependencies (installed by `npm install`)

These come from `package.json` — you do **not** install them by hand.

**devDependencies**

| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | ^31.0.0 | Desktop runtime (Chromium + Node). |
| `electron-builder` | ^24.13.3 | Packages the app into a Windows installer. |

**Runtime dependencies:** none — the game is plain HTML/CSS/JS running inside
Electron. Piece images and sounds are bundled in `assets/`.

## Verify your setup

```bash
node -v      # should print v18.x or higher
npm -v       # should print 9.x or higher
```

If both print a version, you're ready — run `install.bat` or `npm install`.
