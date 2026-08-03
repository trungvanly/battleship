# Battleship vs AI — Game Spec

Version 1.0 — describes the prototype in `index.html` and the intended behavior for future work.

## 1. Overview

Single-player, browser-based Battleship. One human player vs a computer opponent on
10x10 grids. The player wins by sinking all five AI ships before the AI sinks theirs.
No backend, no persistence: one game lives entirely in the page.

## 2. Board and Coordinates

- Grid: 10 x 10.
- Columns labeled `A`–`J` (left to right), rows labeled `1`–`10` (top to bottom).
- A coordinate is written column-then-row, e.g. `A5`, `J10`.
- Internally cells are `(row, col)` with 0-based indices; `coord(r, c) = LETTERS[c] + (r + 1)`.

Two boards are shown:

| Board | Contents | Interactive |
|---|---|---|
| Target grid (enemy waters) | Player's shots at the AI: hits, misses, sunk ships. AI ships are never revealed until hit. | Yes — click to fire |
| Your ocean grid | Player's own ships plus AI shots against them | Yes during placement only |

## 3. Fleet

Each side has the same five ships:

| Ship | Length |
|---|---|
| Carrier | 5 |
| Battleship | 4 |
| Cruiser | 3 |
| Submarine | 3 |
| Destroyer | 2 |

Total 17 occupied cells per side.

## 4. Placement Rules

- Ships are placed horizontally or vertically only; never diagonally.
- Ships must fit entirely on the board (no overhang).
- Ships may not overlap. (Touching/adjacency is allowed.)
- Once placed, a ship cannot be moved for the rest of the game.

### Player placement flow
1. Clicking places ships in fleet order: Carrier → Battleship → Cruiser → Submarine →
   Destroyer. Dragging places whichever ship was dragged, in any order.
2. The status bar shows the ship currently being placed and its length.
3. Orientation is toggled with the **Rotate** button or the `R` key; the button label
   always reads the current orientation.
4. Clicking a cell on the player's ocean grid anchors the ship's bow at that cell and
   extends right (horizontal) or down (vertical).
5. Hovering (or dragging over) the ocean grid previews the footprint: green when the
   placement is legal, red when it would overhang or overlap.
6. **Random placement** fills every ship still unplaced with a legal random position.
   **Undo last ship** removes the most recently placed ship; it is disabled once the
   first shot has been fired.
7. An illegal placement is rejected with a log message naming the reason (overhang vs
   overlap) and no state change; the same ship remains pending.
8. When all five are placed, the log reads "Fleet ready. Fire at will!" and firing unlocks.
   Rotate, Random placement and the difficulty selector lock at that point.

### AI placement
Random placement at game start: for each ship, pick a random orientation and anchor until
a legal position is found. AI ship positions are hidden from the DOM-visible state only in
rendering (the prototype does not attempt anti-cheat).

## 5. Turn Structure

1. **Player turn** — the player clicks one un-fired cell on the target grid.
   - Clicking an already-fired cell is a no-op (the turn is not consumed).
   - The result (`miss` / `HIT` / `HIT ... sank their X`) is appended to the log.
2. Win check: if all AI ships are sunk, the game ends immediately with a player win.
3. **AI turn** — after a ~600 ms delay, the AI fires exactly one shot, logged the same way.
4. Win check: if all player ships are sunk, the game ends with an AI win.
5. Control returns to the player.

Turns strictly alternate — a hit does **not** grant an extra shot.

## 6. Shot Resolution

For a shot at `(r, c)` on a board:

- If the cell was already fired at → invalid, ignored.
- If no ship occupies the cell → `miss`; cell marked white.
- If a ship occupies the cell → `hit`; the ship's hit counter increments; cell marked red.
- If the ship's hits now equal its length → `sunk`; all of its cells render dark red and
  the sinking is announced in the log ("You sank their Carrier!" / "Your Carrier is sunk!").

Ship-status lists show `n/len hits` for the player's own fleet and only sunk/not-sunk for
the enemy fleet, so the enemy's damage state is never leaked before a sink.

## 7. AI Opponent

Difficulty is chosen before placement finishes and is fixed for the game.

| Level | Strategy | Avg shots to clear a board (2000-game simulation) |
|---|---|---|
| Easy | Uniform random fire, no follow-up | ~96 |
| Normal | Parity hunt + adjacency targeting (below) | ~52 |
| Hard | Probability density over every legal remaining placement | ~46 |
| Devin | Parity-masked probability density + predictive line targeting | ~46 |

**Devin mode** combines the other two. While a damaged ship is unresolved it drains the
target queue, so two collinear hits are finished predictively from the line's two ends. In
hunt mode it builds the same density map as Hard but scores only the parity cells
(`(row + col)` even), firing at the densest of them; that keeps every ship of length ≥ 2
reachable while spending shots where placements are most concentrated. If no parity cell is
left it falls back to the densest open cell, then to a random one.

**Hard** rebuilds, before each shot, a map of how many legal placements of the ships still
afloat could cover each un-fired cell, weighting placements that would explain an
unresolved hit (×25 per covered hit) so it finishes damaged ships first, then fires at the
highest-scoring cell. It uses only information a real opponent has — its own hit/miss
results and the sinkings announced to it — never the hidden grid.

**Normal** is a two-mode "hunt / target" strategy:

- **Hunt mode** (no unresolved hits): fire at a random un-fired cell where `(row + col)`
  is even. This parity grid guarantees every ship of length ≥ 2 is eventually intersected
  while halving the search space. If the parity cells are exhausted, fall back to any
  un-fired cell.
- **Target mode**: after a hit, the four orthogonal neighbours of that cell are pushed onto
  a target queue. While the queue is non-empty, the AI pops from it, skipping cells that
  are off-board or already fired at.
- Once two hits are collinear and contiguous, targeting locks to the two ends of that line.
- On a sink, only that ship's hits are discarded; any other damaged ship is still pursued.

## 8. Game End

- The game ends the moment one fleet's 17 cells are all hit.
- The status bar reads "You win!" / "Enemy wins!", further firing is disabled, and both the
  log and the stats panel record a summary: shots, hits and accuracy for each side plus
  the difficulty played.
- **New game** resets both boards, re-randomises the AI fleet, clears the log, and
  restarts placement.

## 9. UI Requirements

- Status bar always states the current phase: placing ship X, your turn, enemy firing, or
  the final result.
- A stats panel under the log appears with the first shot and tracks shots, hits, accuracy
  and ships sunk for both sides.
- Cell colors: water (dark blue), own ship (grey), hit (red), sunk (dark red), miss (white).
- The target grid shows a crosshair cursor and hover outline only on cells that can still
  be fired at.
- The log is an append-only, scrolling, chronological record of every placement and shot,
  using `A5`-style coordinates.

### Sound

- Effects are synthesised with the Web Audio API (`sound.js`); the page ships no audio
  files and makes no network requests for them.
- One effect per event: ship placed, rejected action, shot fired, miss, hit, ship sunk,
  victory, defeat. Both sides' shots use the same effects.
- A looping battle theme, "Tides of War", is synthesised the same way and plays for as
  long as the battle lasts: it starts when placement finishes and stops on game over or
  a new game.
- A "Sound: on/off" header button mutes everything, music included; the choice is remembered in
  `localStorage`. Where Web Audio is unavailable the button reads "Sound: unavailable"
  and is disabled; the game itself is unaffected.
- Audio is best-effort: a failure to play never interrupts a turn.

## 10. Non-Goals (prototype)

- No two-player / networked play, no accounts, no persistence across reloads.
- No gameplay animations (beyond the decorative radar-sweep backdrop on the
  target grid during the firing phase) or mobile-specific layout.

## 11. Open Items / Next Steps

- The opponent's board still lives in the page's JS, so it is readable from the console.
- No touch support for drag placement (mouse drag and click only).
- No match history or per-difficulty statistics across games.
