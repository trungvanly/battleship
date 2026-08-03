# Battleship — Test Spec & Bug-Finding Report

Scope: `index.html` (prototype, single file). Companion to `SPEC.md`.

## 1. How the bugs were found

**Method used: static review of the game's state machine, not automated tests.**
Full disclosure — none of the bugs below were reproduced in a live browser session yet.
They were derived by reading the code against the rules in `SPEC.md` and tracing each
state transition. Section 4 gives the manual repro for each so they can be confirmed (or
falsified) before any fix lands.

The review followed four passes:

1. **Lifecycle / async pass** — find every place where state is mutated outside the
   synchronous click handler. There is exactly one: the `setTimeout(enemyTurn, 600)` in
   `onFireClick`. Any timer that reads a mutable global (`state`) and is never cleared is
   a candidate for a stale-callback bug, so `newGame()` was checked for a cancel — there
   is none. → Bug 1.
2. **Return-contract pass** — for each function, compare what it can return against what
   callers assume. `fire()` returns `null` for an already-shot cell; `onFireClick` checks
   for it, `enemyTurn` does not. → Bug 2.
3. **Rule-conformance pass** — read each `SPEC.md` rule and locate the code that enforces
   it. Placement legality, alternating turns, sink announcement, and win detection all
   check out. The AI's hunt/target contract does not: the queue is cleared on any sink and
   carries no direction state. → Bug 3.
4. **Surface pass** — UI strings, event listeners, and dead code. → Bugs 4, 6, 7. Bug 5
   (enemy fleet readable from the console) comes from the fact that the target grid's
   hidden information lives in the same object graph the page scripts can reach.

What this method does **not** cover, and which the tests below are designed to add:
randomized/long-run play, timing races, and rendering correctness.

## 2. Test environment

- Open `file:///.../battleship/index.html` in Chrome. No build step, no server.
- DevTools console is the test harness for state assertions (`state`, `state.player`,
  `state.enemy`, `state.ai`).
- Reset between cases with **New game** (except where a case tests New game itself).

Helper snippets used in assertions:

```js
const shipAt = (b, r, c) => b.grid[r][c] && b.grid[r][c].name;
const shotCount = (b) => b.shots.flat().filter(Boolean).length;
const hitCount  = (b) => b.shots.flat().filter(s => s === "hit").length;
```

## 3. Regression suite (behavior that must hold)

Each case is `id — action → expected`.

### Placement

| id | Action | Expected |
|---|---|---|
| P1 | Click A1 with Carrier pending, horizontal | Carrier occupies A1–E1; status advances to Battleship |
| P2 | Click H1 with Carrier pending, horizontal | Rejected, log shows the invalid-placement message, Carrier still pending |
| P3 | Click A1 with Carrier pending, vertical | Carrier occupies A1–A5 |
| P4 | Place Carrier at A1, then click B1 for Battleship | Rejected (overlap), Battleship still pending |
| P5 | Press `R` / click Rotate | Button label and subsequent placement orientation both flip |
| P6 | Place all five | Log "Fleet ready", status "Your turn", enemy grid becomes clickable |
| P7 | Click the enemy grid before placement is finished | Nothing happens; no shot recorded |
| P8 | After placement, click own ocean grid | Nothing happens; no ship moves (ships are immutable once set) |

### Firing and turn order

| id | Action | Expected |
|---|---|---|
| F1 | Fire an empty cell | Log "miss", cell white, `shotCount(state.enemy)` +1, AI replies once |
| F2 | Fire a ship cell | Log "HIT", cell red, that ship's `hits` +1 |
| F3 | Fire the final cell of a ship | Log "You sank their X", all of its cells dark red, fleet list shows SUNK |
| F4 | Click an already-fired cell | No-op: no log line, no AI reply, `shotCount` unchanged |
| F5 | Click rapidly on two cells | Exactly one player shot per AI shot; `shotCount(enemy) - shotCount(player) ∈ {0,1}` at all times |
| F6 | Click the enemy grid during the ~600ms AI delay | Ignored |
| F7 | Sink all 5 enemy ships | Status "You win", enemy grid no longer clickable, no further AI shot |
| F8 | Let the AI sink all 5 player ships | Status shows the AI win, board locked |
| F9 | Enemy fleet damage before a sink | Enemy fleet list never shows a hit count (no information leak) |

### AI

| id | Action | Expected |
|---|---|---|
| A1 | Observe 20 AI shots in hunt mode | Never repeats a coordinate; all on `(r+c) % 2 === 0` until a hit |
| A2 | AI scores a hit | Its next shot is orthogonally adjacent to that hit |
| A3 | AI sinks a ship | It returns to parity hunting |
| A4 | Two ships placed adjacently, AI sinks one while the other is already damaged | It should resume on the damaged ship, not restart hunting (**currently fails — Bug 3**) |
| A5 | Play a full game to completion 50x (scripted) | No exception thrown, a winner is always declared, `hitCount == 17` for the loser |

### Lifecycle

| id | Action | Expected |
|---|---|---|
| L1 | New game mid-placement | Both boards empty, log cleared, Carrier pending |
| L2 | New game mid-battle | Both boards empty, new random enemy fleet |
| L3 | Fire, then click New game within 600ms | No AI shot ever appears in the new game's log (**currently fails — Bug 1**) |
| L4 | Reload the page | Fresh game (no persistence is expected) |

### Sound

| id | Action | Expected |
|---|---|---|
| A1 | Click the sound button | Label and `aria-pressed` toggle, `sound.muted` follows, log records it |
| A2 | Place the fleet and fire a shot | A `place` effect per ship, then `fire` plus a hit/miss/sunk effect |
| A4 | Place the fleet, then click New game | The battle theme starts once firing unlocks and stops again on the new game |
| A5 | Mute, then unmute, mid-battle | The theme stops and resumes with the mute setting |

## 4. Bug reproductions

### B1 — Stale AI shot survives "New game" (high)
`onFireClick` schedules `setTimeout(enemyTurn, 600)`; `newGame()` replaces `state` but never
clears the timer, and `enemyTurn` reads the global `state`.

Repro: fire any shot → click **New game** within 600ms → observe.
Expected: nothing. Actual (predicted): a line "Enemy fires at ..." in the fresh log, and a
marked cell on the empty player board during placement.

Consequence: place a ship over that pre-marked cell and `fire()` rejects the cell as
already shot, so it can never be hit — that ship becomes unsinkable and the AI cannot win.
Assertion: `shotCount(state.player) === 0` at all times while `placingSpec()` is non-null.

### B2 — `enemyTurn` doesn't handle a null `fire()` result (latent)
`fire()` returns `null` for a repeat shot; `enemyTurn` immediately reads `res.result`.
Unreachable today because `aiChoose` filters fired cells, but any change to the AI turns it
into a `TypeError`.
Repro (fault injection): in the console, `state.ai.queue.push([0,0])` after `A1` has already
been shot at, force the queue path, and the handler throws.

### B3 — AI discards live targets on a sink (medium)
`enemyTurn` sets `state.ai.queue = []` on any sink, and the queue holds no direction state.
Repro: place two ships adjacent (e.g. Destroyer at A1–A2 and Cruiser at B1–B3), let the AI
hit the Cruiser, then sink the Destroyer; the AI reverts to random hunting with a damaged
Cruiser on the board. Also observable: after two collinear hits it still probes
perpendicular neighbours.

### B4 — "You wins!" (cosmetic)
`render()` builds the banner as `state.winner + " wins!"` with `winner = "You"`.
Repro: win a game.

### B5 — Enemy fleet is readable from the console (design, prototype-acceptable)
`state.enemy.grid` exposes every enemy ship position. Repro: open DevTools, print it.
Mitigation if it ever matters: keep the opponent's board behind a worker/server boundary.

### B6 — Dead code
`makeAI()` creates `tried: new Set()`, never read or written.

### B7 — Input handling nits
The `r` hotkey has no modifier guard (Ctrl+R page reload is unaffected, but any future
text input will conflict), `e.key.toLowerCase()` throws when `e.key` is undefined, and the
invalid-placement message doesn't distinguish off-board from overlap.

## 5. Automation (implemented)

The inline `<script>` was split into `game.js` (pure rules + AI, no DOM, exported for both
`require()` and the browser) and `ui.js` (rendering, input, turn sequencing), so the logic
is testable headlessly.

```
npm install
npm test        # node --test  — unit, property, and simulation tests (game.js)
npm run test:ui # playwright   — DOM tests against index.html
npm run test:all
```

- **`test/game.test.js`** (`node --test`, no dependencies): `coord` mapping; `canPlace`
  overhang/overlap/adjacency; `fire` miss/hit/sunk/repeat-null; `allSunk`; a property test
  over 5000 random fleets (always 5 axis-aligned, on-board, non-overlapping ships covering
  exactly 17 cells); AI cases A2, A3, A4 and collinear line-end targeting; and A5 — 2000
  simulated games asserting every game terminates, the AI never repeats a shot or runs out
  of targets, and the average stays in the hunt/target band. Measured: **~52 shots average,
  worst 69** (pure random would be ~95), which doubles as the regression guard on Bug 3.
- **`test/ui.spec.js`** (Playwright, Chromium): P1–P8, F1–F9, L1–L4. Supporting hooks added
  to the app for testability: every cell carries `data-coord="A5"`, `window.__battleship`
  exposes the live state plus `render()`, and `?delay=0` removes the AI's thinking pause so
  tests don't race it. L3 deliberately runs with the real 600ms delay so the cancelled-timer
  regression is exercised for real.

Coverage was extended alongside the SPEC.md open items:

| id | Case |
|---|---|
| S1–S2 | Random placement fills the fleet legally, and only the ships still unplaced |
| S3–S4 | Undo removes the last ship; disabled with an empty board and after the first shot |
| S5 | Hover preview is green when legal and red when it would overhang or overlap |
| S6–S7 | Dragging a ship from the fleet list places it; placed ships stop being draggable |
| D1–D2 | The difficulty selector (easy/normal/hard/devin) drives the AI and locks at first fire; New game keeps it |
| D3–D4 | Stats appear with the first shot and track accuracy; winning prints a summary |

Logic side, additionally: `accuracy`, the AI's sunk-cell/remaining-fleet memory, easy-mode
uniform fire, hard-mode density behaviour, devin-mode parity-masked hunting (parity-only
hunt shots at the densest parity cell, target-queue drain before hunting, and the
no-parity-left fallback), a fairness test asserting the density map is identical for two
different hidden fleets with the same shot history, and a difficulty ordering test
(measured: easy ~96, normal ~52, hard ~46, devin ~46 shots per board).

- **`test/ui.test.js`** (`node --test` + jsdom): headless unit tests for `ui.js`, which had
  no coverage outside the browser suite. It boots `index.html` in jsdom and drives the DOM
  layer directly — grid and label rendering, placement/rejection logging, rotate (button and
  `R` hotkey, including modified keypresses), random placement, undo, hover and drag previews,
  firing, stats, both end-of-game paths, and the cancelled-timer regression. Run
  `npm run test:coverage` for the line/branch report: `game.js` and `ui.js` are both at 100%
  of lines.

CI (`.github/workflows/test.yml`) runs both suites on every push to main and every PR.

Current status: 17/17 logic tests, 27/27 jsdom tests, and 29/29 Playwright DOM tests pass.

Not yet automated: visual/CSS regression, and touch-based drag placement.
