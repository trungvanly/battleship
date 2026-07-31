// DOM layer: rendering, input handling, and turn sequencing. Rules live in game.js.

// Tests can shorten the AI's thinking time with ?delay=0.
const DEFAULT_AI_DELAY_MS = 600;
const AI_DELAY_MS = parseDelay(new URLSearchParams(location.search).get("delay"));

function parseDelay(raw) {
  if (raw === null) return DEFAULT_AI_DELAY_MS;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms < 0) {
    console.warn(`Ignoring invalid ?delay=${raw}; using ${DEFAULT_AI_DELAY_MS}ms.`);
    return DEFAULT_AI_DELAY_MS;
  }
  return ms;
}

let state;

// Every DOM lookup goes through here so a missing element is an immediate,
// named failure instead of a downstream "cannot read property of null".
function el(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element #${id}`);
  return node;
}

// Surfaces an unexpected failure to the player instead of letting it die in a
// callback, and leaves the game in a state they can act on.
function reportError(context, err) {
  console.error(`${context}:`, err);
  try {
    log(`Something went wrong (${context}): ${err && err.message ? err.message : err}. Start a new game.`);
  } catch (logErr) {
    console.error("Could not write to the log:", logErr);
  }
}

function newGame() {
  if (state && state.timer !== null) clearTimeout(state.timer);
  const difficulty = el("difficulty").value;
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
  el("log").innerHTML = "";
  log("Place your fleet: click or drag a ship onto your ocean grid.");
  render();
}

function log(msg) {
  const box = el("log");
  const d = document.createElement("div");
  d.textContent = msg;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
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
  try {
    place(state.player, spec, cells);
  } catch (err) {
    reportError(`placing the ${spec.name}`, err);
    return false;
  }
  log(`${spec.name} placed at ${coord(r, c)}.`);
  if (placementDone()) log("Fleet ready. Fire at will!");
  return true;
}

function randomPlacement() {
  if (placementDone()) return;
  try {
    for (const spec of unplaced()) randomPlace(state.player, spec);
  } catch (err) {
    reportError("placing the fleet randomly", err);
    render();
    return;
  }
  log("Fleet placed randomly.");
  log("Fleet ready. Fire at will!");
  render();
}

function undoLastShip() {
  if (!state.player.ships.length) { log("Nothing to undo — no ships placed yet."); return; }
  if (state.player.shots.flat().some(Boolean)) {
    log("Ships cannot be moved once the shooting has started.");
    return;
  }
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

function buildBoard(container, board, { reveal, onClick, placing }) {
  container.innerHTML = "";
  container.classList.toggle("placing", !!placing);
  const preview = placing ? previewCells() : [];
  const head = document.createElement("div");
  head.className = "cell label";
  container.appendChild(head);
  LETTERS.forEach((L) => {
    const d = document.createElement("div");
    d.className = "cell label";
    d.textContent = L;
    container.appendChild(d);
  });
  for (let r = 0; r < SIZE; r++) {
    const rowLabel = document.createElement("div");
    rowLabel.className = "cell label";
    rowLabel.textContent = r + 1;
    container.appendChild(rowLabel);
    for (let c = 0; c < SIZE; c++) {
      const d = document.createElement("div");
      d.className = "cell";
      d.dataset.coord = coord(r, c);
      const ship = board.grid[r][c];
      const shot = board.shots[r][c];
      if (reveal && ship) d.classList.add("ship");
      if (shot === "miss") d.classList.add("miss", "shot");
      if (shot === "hit") {
        d.classList.add(ship && ship.hits === ship.size ? "sunk" : "hit", "shot");
      }
      const hint = preview.find(([pr, pc]) => pr === r && pc === c);
      if (hint) d.classList.add(hint[2] ? "preview-ok" : "preview-bad");
      if (onClick) d.addEventListener("click", () => onClick(r, c));
      if (placing) {
        d.addEventListener("mouseenter", () => showPreview(r, c));
        d.addEventListener("dragover", (e) => { e.preventDefault(); showPreview(r, c); });
        d.addEventListener("drop", (e) => { e.preventDefault(); onDrop(r, c); });
      }
      container.appendChild(d);
    }
  }
  if (placing) container.addEventListener("mouseleave", clearPreview);
}

function fleetList(container, board, hideIntact, draggable) {
  container.innerHTML = "";
  for (const spec of FLEET) {
    const ship = board.ships.find((s) => s.name === spec.name);
    const li = document.createElement("li");
    const sunk = ship && ship.hits === ship.size;
    li.className = sunk ? "sunk" : "";
    li.dataset.ship = spec.name;
    const detail = sunk ? "SUNK" : hideIntact ? "" : ship ? `${ship.hits}/${ship.size} hits` : "not placed";
    li.textContent = `${spec.name} (${spec.size})${detail ? " — " + detail : ""}`;
    if (draggable && !ship) {
      li.draggable = true;
      li.addEventListener("dragstart", () => { state.dragging = spec.name; });
      li.addEventListener("dragend", () => { state.dragging = null; clearPreview(); });
    }
    container.appendChild(li);
  }
}

function statsTable() {
  const box = el("stats");
  if (!state.player.shots.flat().some(Boolean) && !state.enemy.shots.flat().some(Boolean)) {
    box.innerHTML = "";
    return;
  }
  const you = accuracy(state.enemy);   // your shots land on the enemy board
  const foe = accuracy(state.player);
  const sunkBy = (board) => board.ships.filter((s) => s.hits === s.size).length;
  box.innerHTML = `
    <table>
      <tr><th></th><th>Shots</th><th>Hits</th><th>Accuracy</th><th>Sunk</th></tr>
      <tr><td>You</td><td>${you.shots}</td><td>${you.hits}</td><td>${you.pct}%</td><td>${sunkBy(state.enemy)}/5</td></tr>
      <tr><td>Enemy</td><td>${foe.shots}</td><td>${foe.hits}</td><td>${foe.pct}%</td><td>${sunkBy(state.player)}/5</td></tr>
    </table>
    ${state.over ? `<div class="summary">${state.summary}</div>` : ""}`;
}

function render() {
  const placing = !placementDone();
  buildBoard(el("player"), state.player, {
    reveal: true,
    onClick: placing ? onPlaceClick : null,
    placing,
  });
  buildBoard(el("enemy"), state.enemy, {
    reveal: false,
    onClick: !placing && !state.over && state.turn === "player" ? onFireClick : null,
  });
  fleetList(el("playerFleet"), state.player, false, placing);
  fleetList(el("enemyFleet"), state.enemy, true, false);
  el("rotate").textContent =
    "Rotate: " + (state.horizontal ? "horizontal" : "vertical");
  el("rotate").disabled = !placing;
  el("random").disabled = !placing;
  el("undo").disabled =
    !state.player.ships.length || state.player.shots.flat().some(Boolean);
  el("difficulty").disabled = !placing;
  el("status").textContent = state.over
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
  if (!spec) log(name ? `Unknown ship "${name}" — drop ignored.` : "Nothing was being dragged.");
  else if (isPlaced(spec.name)) log(`The ${spec.name} is already on the board.`);
  else placeShip(spec, r, c, state.horizontal);
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
  let res;
  try {
    res = fire(state.enemy, r, c);
  } catch (err) {
    reportError(`firing at ${coord(r, c)}`, err);
    return;
  }
  if (!res) { log(`You already fired at ${coord(r, c)} — pick another cell.`); return; }
  log(`You fire at ${coord(r, c)} — ${res.result === "miss" ? "miss" : "HIT"}${res.result === "sunk" ? `! You sank their ${res.ship.name}!` : ""}`);
  if (allSunk(state.enemy)) { endGame("You win!", "All enemy ships sunk."); return; }
  state.turn = "enemy";
  render();
  const game = state;
  state.timer = setTimeout(() => { if (state === game) enemyTurn(); }, AI_DELAY_MS);
}

function enemyTurn() {
  try {
    takeEnemyTurn();
  } catch (err) {
    // A crash inside the timer would otherwise leave the turn stuck on the enemy.
    reportError("the enemy's turn", err);
    state.turn = "player";
    render();
  }
}

function takeEnemyTurn() {
  state.timer = null;
  const target = aiChoose(state.ai, state.player, { difficulty: state.difficulty });
  if (!target) {
    endGame("Draw — no cells left.", "The enemy has nowhere left to fire.");
    return;
  }
  const [r, c] = target;
  const res = fire(state.player, r, c);
  if (!res) throw new Error(`the AI picked ${coord(r, c)}, which it had already fired at`);
  log(`Enemy fires at ${coord(r, c)} — ${res.result === "miss" ? "miss" : "HIT"}${res.result === "sunk" ? `! Your ${res.ship.name} is sunk!` : ""}`);
  aiObserve(state.ai, r, c, res);
  if (allSunk(state.player)) { endGame("Enemy wins!", "Your fleet is destroyed."); return; }
  state.turn = "player";
  render();
}

// Test hook: read-only access to the live game state.
window.__battleship = { get state() { return state; }, newGame, render, onPlaceClick, onFireClick };

el("new").addEventListener("click", newGame);
el("random").addEventListener("click", randomPlacement);
el("undo").addEventListener("click", undoLastShip);
el("difficulty").addEventListener("change", (e) => {
  const value = e.target.value;
  if (!DIFFICULTIES.includes(value)) {
    reportError("changing difficulty", new RangeError(`unknown difficulty "${value}"`));
    e.target.value = state.difficulty;
    return;
  }
  state.difficulty = value;
  state.ai.difficulty = value;
  log(`Difficulty set to ${value}.`);
});
el("rotate").addEventListener("click", rotate);
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
