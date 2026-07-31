// DOM layer: rendering, input handling, and turn sequencing. Rules live in game.js.

// Tests can shorten the AI's thinking time with ?delay=0. Anything that is not a
// finite number in [0, MAX_AI_DELAY_MS] is rejected loudly and falls back.
const DEFAULT_AI_DELAY_MS = 600;
const MAX_AI_DELAY_MS = 10000;

function parseDelay(raw) {
  if (raw === null) return DEFAULT_AI_DELAY_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_AI_DELAY_MS) {
    console.warn(`Ignoring invalid ?delay=${raw}; using ${DEFAULT_AI_DELAY_MS}ms.`);
    return DEFAULT_AI_DELAY_MS;
  }
  return n;
}

const AI_DELAY_MS = parseDelay(new URLSearchParams(location.search).get("delay"));

let state;

// <div class="cell ...">text</div>, the unit every grid is built from.
function cellEl(classes, text) {
  const d = document.createElement("div");
  d.className = classes;
  if (text !== undefined) d.textContent = text;
  return d;
}

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
  buildSkeleton();
  el("log").textContent = "";
  log("Place your fleet: click or drag a ship onto your ocean grid.");
  render();
}

// The grids and fleet lists are structural: they are created on the first game and
// then reused for the life of the page.
function buildSkeleton() {
  const player = el("player");
  if (gridCells.has(player)) return;
  buildGrid(player, {
    onClick: (r, c) => { if (!placementDone()) onPlaceClick(r, c); },
    onEnter: (r, c) => { if (!placementDone()) showPreview(r, c); },
    onDrop: (r, c) => { if (!placementDone()) onDrop(r, c); },
    onLeave: clearPreview,
  });
  buildGrid(el("enemy"), {
    onClick: (r, c) => {
      if (placementDone() && !state.over && state.turn === "player") onFireClick(r, c);
    },
  });
  buildFleetList(el("playerFleet"));
  buildFleetList(el("enemyFleet"));
}

function log(msg) {
  const box = el("log");
  const d = document.createElement("div");
  d.textContent = msg;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

// The audio layer is a nicety, so the game stays playable even if sound.js is
// missing entirely (a deploy that forgot to ship it, a blocked request).
const sfx = typeof sound !== "undefined" ? sound : missingSound();

function missingSound() {
  console.warn("sound.js did not load; the game will be silent.");
  return { play() {}, muted: true, available: false, setMuted: () => true };
}

// A refused action: same message as always, plus the buzz that goes with it.
function rejected(msg) {
  sfx.play("invalid");
  log(msg);
}

// Shot feedback shared by both sides: hit, sunk, and miss each have their own effect.
const shotSound = (result) => sfx.play(result === "miss" ? "miss" : result === "sunk" ? "sunk" : "hit");

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
  if (!onBoard(cells)) { rejected(`Invalid placement — the ${spec.name} would hang off the board.`); return false; }
  if (!canPlace(state.player, cells)) { rejected(`Invalid placement — the ${spec.name} would overlap another ship.`); return false; }
  try {
    place(state.player, spec, cells);
  } catch (err) {
    reportError(`placing the ${spec.name}`, err);
    return false;
  }
  sfx.play("place");
  log(`${spec.name} placed at ${coord(r, c)}.`);
  if (placementDone()) log("Fleet ready. Fire at will!");
  return true;
}

function randomPlacement() {
  if (placementDone()) return;
  try {
    placeRandomly(state.player, unplaced());
  } catch (err) {
    reportError("placing the fleet randomly", err);
    render();
    return;
  }
  sfx.play("place");
  log("Fleet placed randomly.");
  log("Fleet ready. Fire at will!");
  render();
}

function undoLastShip() {
  if (!state.player.ships.length) { rejected("Nothing to undo — no ships placed yet."); return; }
  if (hasShots(state.player)) {
    rejected("Ships cannot be moved once the shooting has started.");
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

// Cell nodes are created once per grid and reused; renders only touch classNames,
// so listeners survive and a hover is never interrupted by a rebuild.
const gridCells = new WeakMap();
const fleetItems = new WeakMap();

function buildGrid(container, hooks) {
  container.appendChild(cellEl("cell label"));
  LETTERS.forEach((L) => container.appendChild(cellEl("cell label", L)));
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    container.appendChild(cellEl("cell label", r + 1));
    const row = [];
    for (let c = 0; c < SIZE; c++) {
      const d = cellEl("cell");
      d.dataset.coord = coord(r, c);
      d.addEventListener("click", () => hooks.onClick(r, c));
      if (hooks.onEnter) {
        d.addEventListener("mouseenter", () => hooks.onEnter(r, c));
        d.addEventListener("dragover", (e) => { e.preventDefault(); hooks.onEnter(r, c); });
        d.addEventListener("drop", (e) => { e.preventDefault(); hooks.onDrop(r, c); });
      }
      container.appendChild(d);
      row.push(d);
    }
    cells.push(row);
  }
  if (hooks.onLeave) container.addEventListener("mouseleave", hooks.onLeave);
  gridCells.set(container, cells);
}

function buildBoard(container, board, { reveal, placing }) {
  container.classList.toggle("placing", !!placing);
  const cells = gridCells.get(container);
  if (!cells) throw new Error("buildBoard: the grid skeleton has not been built");
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const d = cells[r][c];
      const ship = board.grid[r][c];
      const shot = board.shots[r][c];
      let cls = "cell";
      if (reveal && ship) cls += " ship";
      if (shot === "miss") cls += " miss shot";
      if (shot === "hit") cls += isSunk(ship) ? " sunk shot" : " hit shot";
      // applyPreview() owns the preview classes; keep whatever it last set.
      if (d.classList.contains("preview-ok")) cls += " preview-ok";
      else if (d.classList.contains("preview-bad")) cls += " preview-bad";
      if (d.className !== cls) d.className = cls;
    }
  }
}

function buildFleetList(container) {
  const items = new Map();
  for (const spec of FLEET) {
    const li = document.createElement("li");
    li.dataset.ship = spec.name;
    li.addEventListener("dragstart", () => { if (li.draggable) state.dragging = spec.name; });
    li.addEventListener("dragend", () => { state.dragging = null; clearPreview(); });
    container.appendChild(li);
    items.set(spec.name, li);
  }
  fleetItems.set(container, items);
}

function fleetList(container, board, hideIntact, draggable) {
  const items = fleetItems.get(container);
  if (!items) throw new Error("fleetList: the fleet list skeleton has not been built");
  for (const spec of FLEET) {
    const ship = board.ships.find((s) => s.name === spec.name);
    const li = items.get(spec.name);
    const sunk = isSunk(ship);
    const cls = sunk ? "sunk" : "";
    if (li.className !== cls) li.className = cls;
    const detail = sunk ? "SUNK" : hideIntact ? "" : ship ? `${ship.hits}/${ship.size} hits` : "not placed";
    const text = `${spec.name} (${spec.size})${detail ? " — " + detail : ""}`;
    if (li.textContent !== text) li.textContent = text;
    const canDrag = !!draggable && !ship;
    if (li.draggable !== canDrag) li.draggable = canDrag;
  }
}

// Your shots land on the enemy board and vice versa.
const scoreboard = () => ({ you: accuracy(state.enemy), foe: accuracy(state.player) });

function statsTable(playerShotsFired, enemyShotsFired) {
  const box = el("stats");
  if (!playerShotsFired && !enemyShotsFired) {
    box.textContent = "";
    return;
  }
  const { you, foe } = scoreboard();
  box.textContent = "";
  const table = document.createElement("table");
  const row = (tag, cells) => {
    const tr = document.createElement("tr");
    for (const value of cells) {
      const td = document.createElement(tag);
      td.textContent = value;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  };
  row("th", ["", "Shots", "Hits", "Accuracy", "Sunk"]);
  row("td", ["You", you.shots, you.hits, `${you.pct}%`, `${sunkCount(state.enemy)}/5`]);
  row("td", ["Enemy", foe.shots, foe.hits, `${foe.pct}%`, `${sunkCount(state.player)}/5`]);
  box.appendChild(table);
  if (state.over) {
    const summary = document.createElement("div");
    summary.className = "summary";
    summary.textContent = state.summary;
    box.appendChild(summary);
  }
}

function render() {
  const placing = !placementDone();
  const playerShotsFired = hasShots(state.player);
  const enemyShotsFired = hasShots(state.enemy);
  buildBoard(el("player"), state.player, { reveal: true, placing });
  buildBoard(el("enemy"), state.enemy, { reveal: false });
  fleetList(el("playerFleet"), state.player, false, placing);
  fleetList(el("enemyFleet"), state.enemy, true, false);
  el("rotate").textContent =
    "Rotate: " + (state.horizontal ? "horizontal" : "vertical");
  el("rotate").disabled = !placing;
  el("random").disabled = !placing;
  el("undo").disabled =
    !state.player.ships.length || playerShotsFired;
  el("difficulty").disabled = !placing;
  el("status").textContent = state.over
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
  document.querySelectorAll("#player .cell").forEach((node) => {
    node.classList.remove("preview-ok", "preview-bad");
  });
  for (const [r, c, ok] of cells) {
    const node = document.querySelector(`#player .cell[data-coord="${coord(r, c)}"]`);
    if (node) node.classList.add(ok ? "preview-ok" : "preview-bad");
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
  if (!spec) rejected(name ? `Unknown ship "${name}" — drop ignored.` : "Nothing was being dragged.");
  else if (isPlaced(spec.name)) rejected(`The ${spec.name} is already on the board.`);
  else placeShip(spec, r, c, state.horizontal);
  render();
}

// "<lead> at C5 — HIT! You sank their Cruiser!", plus the matching sound.
function announceShot(lead, r, c, res, sunkSuffix) {
  sfx.play("fire");
  shotSound(res.result);
  const outcome = res.result === "miss" ? "miss" : "HIT";
  const suffix = res.result === "sunk" ? sunkSuffix(res.ship.name) : "";
  log(`${lead} at ${coord(r, c)} — ${outcome}${suffix}`);
}

function endGame(winner, summaryLead, effect) {
  sfx.play(effect);
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
  let res;
  try {
    res = fire(state.enemy, r, c);
  } catch (err) {
    reportError(`firing at ${coord(r, c)}`, err);
    return;
  }
  if (!res) { rejected(`You already fired at ${coord(r, c)} — pick another cell.`); return; }
  announceShot("You fire", r, c, res, (name) => `! You sank their ${name}!`);
  if (allSunk(state.enemy)) { endGame("You win!", "All enemy ships sunk.", "win"); return; }
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
    endGame("Draw — no cells left.", "The enemy has nowhere left to fire.", "lose");
    return;
  }
  const [r, c] = target;
  const res = fire(state.player, r, c);
  if (!res) throw new Error(`the AI picked ${coord(r, c)}, which it had already fired at`);
  announceShot("Enemy fires", r, c, res, (name) => `! Your ${name} is sunk!`);
  aiObserve(state.ai, r, c, res);
  if (allSunk(state.player)) { endGame("Enemy wins!", "Your fleet is destroyed.", "lose"); return; }
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
el("mute").addEventListener("click", () => {
  sfx.setMuted(!sfx.muted);
  renderMuteButton();
  log(sfx.muted ? "Sound off." : "Sound on.");
});
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key && e.key.toLowerCase() === "r") rotate();
});

function rotate() {
  if (placementDone()) return;
  state.horizontal = !state.horizontal;
  render();
}

function renderMuteButton() {
  const button = el("mute");
  button.textContent = sfx.available
    ? `Sound: ${sfx.muted ? "off" : "on"}`
    : "Sound: unavailable";
  button.setAttribute("aria-pressed", String(sfx.muted));
  button.disabled = !sfx.available;
}

renderMuteButton();
newGame();
