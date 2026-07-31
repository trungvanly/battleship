// DOM layer: rendering, input handling, and turn sequencing. Rules live in game.js.

// Tests can shorten the AI's thinking time with ?delay=0.
const AI_DELAY_MS = Number(new URLSearchParams(location.search).get("delay") ?? 600);

let state;

const byId = (id) => document.getElementById(id);

// <div class="cell ...">text</div>, the unit every grid is built from.
function cellEl(classes, text) {
  const d = document.createElement("div");
  d.className = classes;
  if (text !== undefined) d.textContent = text;
  return d;
}

function newGame() {
  if (state && state.timer !== null) clearTimeout(state.timer);
  const difficulty = byId("difficulty").value;
  state = {
    player: emptyBoard(),
    enemy: emptyBoard(),
    ai: makeAI(difficulty),
    difficulty,
    horizontal: true,
    over: false,
    turn: "player",
    timer: null,
    preview: null,
    dragging: null,
  };
  randomFleet(state.enemy);
  byId("log").innerHTML = "";
  log("Place your fleet: click or drag a ship onto your ocean grid.");
  render();
}

function log(msg) {
  const el = byId("log");
  const d = document.createElement("div");
  d.textContent = msg;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}

const isPlaced = (name) => state.player.ships.some((s) => s.name === name);
const unplaced = () => FLEET.filter((spec) => !isPlaced(spec.name));

// The ship a plain click places: the dragged one if any, else the next unplaced.
function placingSpec() {
  if (state.dragging) return FLEET.find((s) => s.name === state.dragging) || null;
  return unplaced()[0] || null;
}

const placementDone = () => unplaced().length === 0;

// ---- placement actions ----

function placeShip(spec, r, c, horizontal) {
  const cells = cellsFor(r, c, spec.size, horizontal);
  if (!onBoard(cells)) { log(`Invalid placement — the ${spec.name} would hang off the board.`); return false; }
  if (!canPlace(state.player, cells)) { log(`Invalid placement — the ${spec.name} would overlap another ship.`); return false; }
  place(state.player, spec, cells);
  log(`${spec.name} placed at ${coord(r, c)}.`);
  if (placementDone()) log("Fleet ready. Fire at will!");
  return true;
}

function randomPlacement() {
  if (placementDone()) return;
  placeRandomly(state.player, unplaced());
  log("Fleet placed randomly.");
  log("Fleet ready. Fire at will!");
  render();
}

function undoLastShip() {
  if (!state.player.ships.length || hasShots(state.player)) return;
  const ship = state.player.ships.pop();
  ship.cells.forEach(([r, c]) => (state.player.grid[r][c] = null));
  log(`${ship.name} removed.`);
  render();
}

// ---- rendering ----

function previewCells() {
  if (!state.preview || placementDone()) return [];
  const spec = state.preview.spec;
  const cells = cellsFor(state.preview.r, state.preview.c, spec.size, state.horizontal);
  const ok = canPlace(state.player, cells);
  return cells.filter(([r, c]) => r < SIZE && c < SIZE).map(([r, c]) => [r, c, ok]);
}

function buildBoard(el, board, { reveal, onClick, placing }) {
  el.innerHTML = "";
  el.classList.toggle("placing", !!placing);
  const preview = placing ? previewCells() : [];
  el.appendChild(cellEl("cell label"));
  LETTERS.forEach((L) => el.appendChild(cellEl("cell label", L)));
  for (let r = 0; r < SIZE; r++) {
    el.appendChild(cellEl("cell label", r + 1));
    for (let c = 0; c < SIZE; c++) {
      const d = cellEl("cell");
      d.dataset.coord = coord(r, c);
      const ship = board.grid[r][c];
      const shot = board.shots[r][c];
      if (reveal && ship) d.classList.add("ship");
      if (shot === "miss") d.classList.add("miss", "shot");
      if (shot === "hit") d.classList.add(isSunk(ship) ? "sunk" : "hit", "shot");
      const hint = preview.find(([pr, pc]) => sameCell([pr, pc], [r, c]));
      if (hint) d.classList.add(hint[2] ? "preview-ok" : "preview-bad");
      if (onClick) d.addEventListener("click", () => onClick(r, c));
      if (placing) {
        d.addEventListener("mouseenter", () => showPreview(r, c));
        d.addEventListener("dragover", (e) => { e.preventDefault(); showPreview(r, c); });
        d.addEventListener("drop", (e) => { e.preventDefault(); onDrop(r, c); });
      }
      el.appendChild(d);
    }
  }
  if (placing) el.addEventListener("mouseleave", clearPreview);
}

function fleetList(el, board, hideIntact, draggable) {
  el.innerHTML = "";
  for (const spec of FLEET) {
    const ship = board.ships.find((s) => s.name === spec.name);
    const li = document.createElement("li");
    const sunk = isSunk(ship);
    li.className = sunk ? "sunk" : "";
    li.dataset.ship = spec.name;
    const detail = sunk ? "SUNK" : hideIntact ? "" : ship ? `${ship.hits}/${ship.size} hits` : "not placed";
    li.textContent = `${spec.name} (${spec.size})${detail ? " — " + detail : ""}`;
    if (draggable && !ship) {
      li.draggable = true;
      li.addEventListener("dragstart", () => { state.dragging = spec.name; });
      li.addEventListener("dragend", () => { state.dragging = null; clearPreview(); });
    }
    el.appendChild(li);
  }
}

// Your shots land on the enemy board and vice versa.
const scoreboard = () => ({ you: accuracy(state.enemy), foe: accuracy(state.player) });

function statsTable() {
  const el = byId("stats");
  if (!hasShots(state.player) && !hasShots(state.enemy)) {
    el.innerHTML = "";
    return;
  }
  const { you, foe } = scoreboard();
  el.innerHTML = `
    <table>
      <tr><th></th><th>Shots</th><th>Hits</th><th>Accuracy</th><th>Sunk</th></tr>
      <tr><td>You</td><td>${you.shots}</td><td>${you.hits}</td><td>${you.pct}%</td><td>${sunkCount(state.enemy)}/5</td></tr>
      <tr><td>Enemy</td><td>${foe.shots}</td><td>${foe.hits}</td><td>${foe.pct}%</td><td>${sunkCount(state.player)}/5</td></tr>
    </table>
    ${state.over ? `<div class="summary">${state.summary}</div>` : ""}`;
}

function render() {
  const placing = !placementDone();
  buildBoard(byId("player"), state.player, {
    reveal: true,
    onClick: placing ? onPlaceClick : null,
    placing,
  });
  buildBoard(byId("enemy"), state.enemy, {
    reveal: false,
    onClick: !placing && !state.over && state.turn === "player" ? onFireClick : null,
  });
  fleetList(byId("playerFleet"), state.player, false, placing);
  fleetList(byId("enemyFleet"), state.enemy, true, false);
  byId("rotate").textContent = "Rotate: " + (state.horizontal ? "horizontal" : "vertical");
  byId("rotate").disabled = !placing;
  byId("random").disabled = !placing;
  byId("undo").disabled = !state.player.ships.length || hasShots(state.player);
  byId("difficulty").disabled = !placing;
  byId("status").textContent = state.over
    ? state.winner
    : placing
    ? `Placing ${placingSpec().name} (${placingSpec().size})`
    : state.turn === "player"
    ? "Your turn — fire at the target grid"
    : "Enemy is firing...";
  statsTable();
  applyPreview();
}

// ---- input handlers ----

// Preview is a class-only update: re-rendering the grid mid-hover would drop the
// mouse events the preview depends on.
function applyPreview() {
  const cells = previewCells();
  document.querySelectorAll("#player .cell").forEach((el) => {
    el.classList.remove("preview-ok", "preview-bad");
  });
  for (const [r, c, ok] of cells) {
    const el = document.querySelector(`#player .cell[data-coord="${coord(r, c)}"]`);
    if (el) el.classList.add(ok ? "preview-ok" : "preview-bad");
  }
}

function showPreview(r, c) {
  const spec = placingSpec();
  if (!spec) return;
  state.preview = { r, c, spec };
  applyPreview();
}

function clearPreview() {
  if (!state.preview) return;
  state.preview = null;
  applyPreview();
}

function onPlaceClick(r, c) {
  const spec = placingSpec();
  if (!spec) return;
  if (placeShip(spec, r, c, state.horizontal)) { state.preview = null; }
  render();
}

function onDrop(r, c) {
  const name = state.dragging;
  state.dragging = null;
  state.preview = null;
  const spec = FLEET.find((s) => s.name === name);
  if (spec && !isPlaced(spec.name)) placeShip(spec, r, c, state.horizontal);
  render();
}

// "<lead> at C5 — HIT! You sank their Cruiser!"
function logShot(lead, r, c, res, sunkSuffix) {
  const outcome = res.result === "miss" ? "miss" : "HIT";
  const suffix = res.result === "sunk" ? sunkSuffix(res.ship.name) : "";
  log(`${lead} at ${coord(r, c)} — ${outcome}${suffix}`);
}

function endGame(winner, summaryLead) {
  state.over = true;
  state.winner = winner;
  const { you, foe } = scoreboard();
  state.summary = `${summaryLead} You: ${you.hits}/${you.shots} hits (${you.pct}%). ` +
    `Enemy: ${foe.hits}/${foe.shots} hits (${foe.pct}%). Difficulty: ${state.difficulty}.`;
  log(state.summary);
  render();
}

function onFireClick(r, c) {
  if (state.over || state.turn !== "player") return;
  const res = fire(state.enemy, r, c);
  if (!res) return;
  logShot("You fire", r, c, res, (name) => `! You sank their ${name}!`);
  if (allSunk(state.enemy)) { endGame("You win!", "All enemy ships sunk."); return; }
  state.turn = "enemy";
  render();
  const game = state;
  state.timer = setTimeout(() => { if (state === game) enemyTurn(); }, AI_DELAY_MS);
}

function enemyTurn() {
  state.timer = null;
  const target = aiChoose(state.ai, state.player, { difficulty: state.difficulty });
  if (!target) return;
  const [r, c] = target;
  const res = fire(state.player, r, c);
  if (!res) return;
  logShot("Enemy fires", r, c, res, (name) => `! Your ${name} is sunk!`);
  aiObserve(state.ai, r, c, res);
  if (allSunk(state.player)) { endGame("Enemy wins!", "Your fleet is destroyed."); return; }
  state.turn = "player";
  render();
}

// Test hook: read-only access to the live game state.
window.__battleship = { get state() { return state; }, newGame, render, onPlaceClick, onFireClick };

byId("new").addEventListener("click", newGame);
byId("random").addEventListener("click", randomPlacement);
byId("undo").addEventListener("click", undoLastShip);
byId("difficulty").addEventListener("change", (e) => {
  state.difficulty = e.target.value;
  state.ai.difficulty = e.target.value;
  log(`Difficulty set to ${e.target.value}.`);
});
byId("rotate").addEventListener("click", rotate);
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key && e.key.toLowerCase() === "r") rotate();
});

function rotate() {
  if (placementDone()) return;
  state.horizontal = !state.horizontal;
  render();
}

newGame();
