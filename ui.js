// DOM layer: rendering, input handling, and turn sequencing. Rules live in game.js.

// Tests can shorten the AI's thinking time with ?delay=0.
const AI_DELAY_MS = Number(new URLSearchParams(location.search).get("delay") ?? 600);

let state;

function newGame() {
  if (state && state.timer !== null) clearTimeout(state.timer);
  const difficulty = document.getElementById("difficulty").value;
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
  buildSkeleton();
  document.getElementById("log").innerHTML = "";
  log("Place your fleet: click or drag a ship onto your ocean grid.");
  render();
}

// The grids and fleet lists are structural: they are created on the first game and
// then reused for the life of the page.
function buildSkeleton() {
  const player = document.getElementById("player");
  if (gridCells.has(player)) return;
  buildGrid(player, {
    onClick: (r, c) => { if (!placementDone()) onPlaceClick(r, c); },
    onEnter: (r, c) => { if (!placementDone()) showPreview(r, c); },
    onDrop: (r, c) => { if (!placementDone()) onDrop(r, c); },
    onLeave: clearPreview,
  });
  buildGrid(document.getElementById("enemy"), {
    onClick: (r, c) => {
      if (placementDone() && !state.over && state.turn === "player") onFireClick(r, c);
    },
  });
  buildFleetList(document.getElementById("playerFleet"));
  buildFleetList(document.getElementById("enemyFleet"));
}

function log(msg) {
  const el = document.getElementById("log");
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
  for (const spec of unplaced()) {
    let placed = false;
    while (!placed) {
      const horizontal = Math.random() < 0.5;
      const r = Math.floor(Math.random() * SIZE);
      const c = Math.floor(Math.random() * SIZE);
      const cells = cellsFor(r, c, spec.size, horizontal);
      if (canPlace(state.player, cells)) { place(state.player, spec, cells); placed = true; }
    }
  }
  log("Fleet placed randomly.");
  log("Fleet ready. Fire at will!");
  render();
}

function undoLastShip() {
  if (!state.player.ships.length || state.player.shots.flat().some(Boolean)) return;
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

// Cell nodes are created once per grid and reused; renders only touch classNames,
// so listeners survive and a hover is never interrupted by a rebuild.
const gridCells = new WeakMap();
const fleetItems = new WeakMap();

function buildGrid(el, hooks) {
  const head = document.createElement("div");
  head.className = "cell label";
  el.appendChild(head);
  LETTERS.forEach((L) => {
    const d = document.createElement("div");
    d.className = "cell label";
    d.textContent = L;
    el.appendChild(d);
  });
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    const rowLabel = document.createElement("div");
    rowLabel.className = "cell label";
    rowLabel.textContent = r + 1;
    el.appendChild(rowLabel);
    const row = [];
    for (let c = 0; c < SIZE; c++) {
      const d = document.createElement("div");
      d.className = "cell";
      d.dataset.coord = coord(r, c);
      d.addEventListener("click", () => hooks.onClick(r, c));
      if (hooks.onEnter) {
        d.addEventListener("mouseenter", () => hooks.onEnter(r, c));
        d.addEventListener("dragover", (e) => { e.preventDefault(); hooks.onEnter(r, c); });
        d.addEventListener("drop", (e) => { e.preventDefault(); hooks.onDrop(r, c); });
      }
      el.appendChild(d);
      row.push(d);
    }
    cells.push(row);
  }
  if (hooks.onLeave) el.addEventListener("mouseleave", hooks.onLeave);
  gridCells.set(el, cells);
}

function buildBoard(el, board, { reveal, placing }) {
  el.classList.toggle("placing", !!placing);
  const cells = gridCells.get(el);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const d = cells[r][c];
      const ship = board.grid[r][c];
      const shot = board.shots[r][c];
      let cls = "cell";
      if (reveal && ship) cls += " ship";
      if (shot === "miss") cls += " miss shot";
      if (shot === "hit") cls += ship && ship.hits === ship.size ? " sunk shot" : " hit shot";
      // applyPreview() owns the preview classes; keep whatever it last set.
      if (d.classList.contains("preview-ok")) cls += " preview-ok";
      else if (d.classList.contains("preview-bad")) cls += " preview-bad";
      if (d.className !== cls) d.className = cls;
    }
  }
}

function buildFleetList(el) {
  const items = new Map();
  for (const spec of FLEET) {
    const li = document.createElement("li");
    li.dataset.ship = spec.name;
    li.addEventListener("dragstart", () => { if (li.draggable) state.dragging = spec.name; });
    li.addEventListener("dragend", () => { state.dragging = null; clearPreview(); });
    el.appendChild(li);
    items.set(spec.name, li);
  }
  fleetItems.set(el, items);
}

function fleetList(el, board, hideIntact, draggable) {
  const items = fleetItems.get(el);
  for (const spec of FLEET) {
    const ship = board.ships.find((s) => s.name === spec.name);
    const li = items.get(spec.name);
    const sunk = ship && ship.hits === ship.size;
    const cls = sunk ? "sunk" : "";
    if (li.className !== cls) li.className = cls;
    const detail = sunk ? "SUNK" : hideIntact ? "" : ship ? `${ship.hits}/${ship.size} hits` : "not placed";
    const text = `${spec.name} (${spec.size})${detail ? " — " + detail : ""}`;
    if (li.textContent !== text) li.textContent = text;
    const canDrag = !!draggable && !ship;
    if (li.draggable !== canDrag) li.draggable = canDrag;
  }
}

function statsTable(playerShotsFired, enemyShotsFired) {
  const el = document.getElementById("stats");
  if (!playerShotsFired && !enemyShotsFired) {
    el.innerHTML = "";
    return;
  }
  const you = accuracy(state.enemy);   // your shots land on the enemy board
  const foe = accuracy(state.player);
  const sunkBy = (board) => board.ships.filter((s) => s.hits === s.size).length;
  el.innerHTML = `
    <table>
      <tr><th></th><th>Shots</th><th>Hits</th><th>Accuracy</th><th>Sunk</th></tr>
      <tr><td>You</td><td>${you.shots}</td><td>${you.hits}</td><td>${you.pct}%</td><td>${sunkBy(state.enemy)}/5</td></tr>
      <tr><td>Enemy</td><td>${foe.shots}</td><td>${foe.hits}</td><td>${foe.pct}%</td><td>${sunkBy(state.player)}/5</td></tr>
    </table>
    ${state.over ? `<div class="summary">${state.summary}</div>` : ""}`;
}

function render() {
  const placing = !placementDone();
  const playerShotsFired = state.player.shots.flat().some(Boolean);
  const enemyShotsFired = state.enemy.shots.flat().some(Boolean);
  buildBoard(document.getElementById("player"), state.player, { reveal: true, placing });
  buildBoard(document.getElementById("enemy"), state.enemy, { reveal: false });
  fleetList(document.getElementById("playerFleet"), state.player, false, placing);
  fleetList(document.getElementById("enemyFleet"), state.enemy, true, false);
  document.getElementById("rotate").textContent =
    "Rotate: " + (state.horizontal ? "horizontal" : "vertical");
  document.getElementById("rotate").disabled = !placing;
  document.getElementById("random").disabled = !placing;
  document.getElementById("undo").disabled =
    !state.player.ships.length || playerShotsFired;
  document.getElementById("difficulty").disabled = !placing;
  document.getElementById("status").textContent = state.over
    ? state.winner
    : placing
    ? `Placing ${placingSpec().name} (${placingSpec().size})`
    : state.turn === "player"
    ? "Your turn — fire at the target grid"
    : "Enemy is firing...";
  statsTable(playerShotsFired, enemyShotsFired);
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

function endGame(winner, summaryLead) {
  state.over = true;
  state.winner = winner;
  const you = accuracy(state.enemy);
  const foe = accuracy(state.player);
  state.summary = `${summaryLead} You: ${you.hits}/${you.shots} hits (${you.pct}%). ` +
    `Enemy: ${foe.hits}/${foe.shots} hits (${foe.pct}%). Difficulty: ${state.difficulty}.`;
  log(state.summary);
  render();
}

function onFireClick(r, c) {
  if (state.over || state.turn !== "player") return;
  const res = fire(state.enemy, r, c);
  if (!res) return;
  log(`You fire at ${coord(r, c)} — ${res.result === "miss" ? "miss" : "HIT"}${res.result === "sunk" ? `! You sank their ${res.ship.name}!` : ""}`);
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
  log(`Enemy fires at ${coord(r, c)} — ${res.result === "miss" ? "miss" : "HIT"}${res.result === "sunk" ? `! Your ${res.ship.name} is sunk!` : ""}`);
  aiObserve(state.ai, r, c, res);
  if (allSunk(state.player)) { endGame("Enemy wins!", "Your fleet is destroyed."); return; }
  state.turn = "player";
  render();
}

// Test hook: read-only access to the live game state.
window.__battleship = { get state() { return state; }, newGame, render, onPlaceClick, onFireClick };

document.getElementById("new").addEventListener("click", newGame);
document.getElementById("random").addEventListener("click", randomPlacement);
document.getElementById("undo").addEventListener("click", undoLastShip);
document.getElementById("difficulty").addEventListener("change", (e) => {
  state.difficulty = e.target.value;
  state.ai.difficulty = e.target.value;
  log(`Difficulty set to ${e.target.value}.`);
});
document.getElementById("rotate").addEventListener("click", rotate);
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
