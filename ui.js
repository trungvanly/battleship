// DOM layer: rendering, input handling, and turn sequencing. Rules live in game.js.

let state;

function newGame() {
  if (state && state.timer !== null) clearTimeout(state.timer);
  state = {
    player: emptyBoard(),
    enemy: emptyBoard(),
    ai: makeAI(),
    toPlace: 0,
    horizontal: true,
    over: false,
    turn: "player",
    timer: null,
  };
  randomFleet(state.enemy);
  document.getElementById("log").innerHTML = "";
  log("Place your fleet: click your ocean grid to position each ship.");
  render();
}

function log(msg) {
  const el = document.getElementById("log");
  const d = document.createElement("div");
  d.textContent = msg;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}

function placingSpec() {
  return state.toPlace < FLEET.length ? FLEET[state.toPlace] : null;
}

function buildBoard(el, board, { reveal, onClick }) {
  el.innerHTML = "";
  const head = document.createElement("div");
  head.className = "cell label";
  el.appendChild(head);
  LETTERS.forEach((L) => {
    const d = document.createElement("div");
    d.className = "cell label";
    d.textContent = L;
    el.appendChild(d);
  });
  for (let r = 0; r < SIZE; r++) {
    const rowLabel = document.createElement("div");
    rowLabel.className = "cell label";
    rowLabel.textContent = r + 1;
    el.appendChild(rowLabel);
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
      if (onClick) d.addEventListener("click", () => onClick(r, c));
      el.appendChild(d);
    }
  }
}

function fleetList(el, board, hideIntact) {
  el.innerHTML = "";
  for (const spec of FLEET) {
    const ship = board.ships.find((s) => s.name === spec.name);
    const li = document.createElement("li");
    const sunk = ship && ship.hits === ship.size;
    li.className = sunk ? "sunk" : "";
    const detail = sunk ? "SUNK" : hideIntact ? "" : ship ? `${ship.hits}/${ship.size} hits` : "not placed";
    li.textContent = `${spec.name} (${spec.size})${detail ? " — " + detail : ""}`;
    el.appendChild(li);
  }
}

function render() {
  const spec = placingSpec();
  buildBoard(document.getElementById("player"), state.player, {
    reveal: true,
    onClick: spec ? onPlaceClick : null,
  });
  buildBoard(document.getElementById("enemy"), state.enemy, {
    reveal: false,
    onClick: !spec && !state.over && state.turn === "player" ? onFireClick : null,
  });
  fleetList(document.getElementById("playerFleet"), state.player, false);
  fleetList(document.getElementById("enemyFleet"), state.enemy, true);
  document.getElementById("rotate").textContent =
    "Rotate: " + (state.horizontal ? "horizontal" : "vertical");
  document.getElementById("status").textContent = state.over
    ? state.winner
    : spec
    ? `Placing ${spec.name} (${spec.size})`
    : state.turn === "player"
    ? "Your turn — fire at the target grid"
    : "Enemy is firing...";
}

function onPlaceClick(r, c) {
  const spec = placingSpec();
  const cells = cellsFor(r, c, spec.size, state.horizontal);
  if (!onBoard(cells)) { log(`Invalid placement — the ${spec.name} would hang off the board.`); return; }
  if (!canPlace(state.player, cells)) { log(`Invalid placement — the ${spec.name} would overlap another ship.`); return; }
  place(state.player, spec, cells);
  log(`${spec.name} placed at ${coord(cells[0][0], cells[0][1])}.`);
  state.toPlace++;
  if (!placingSpec()) log("Fleet ready. Fire at will!");
  render();
}

function onFireClick(r, c) {
  if (state.over || state.turn !== "player") return;
  const res = fire(state.enemy, r, c);
  if (!res) return;
  log(`You fire at ${coord(r, c)} — ${res.result === "miss" ? "miss" : "HIT"}${res.result === "sunk" ? `! You sank their ${res.ship.name}!` : ""}`);
  if (allSunk(state.enemy)) { state.over = true; state.winner = "You win!"; log("All enemy ships sunk. You win!"); render(); return; }
  state.turn = "enemy";
  render();
  const game = state;
  state.timer = setTimeout(() => { if (state === game) enemyTurn(); }, AI_DELAY_MS);
}

function enemyTurn() {
  state.timer = null;
  const target = aiChoose(state.ai, state.player);
  if (!target) return;
  const [r, c] = target;
  const res = fire(state.player, r, c);
  if (!res) return;
  log(`Enemy fires at ${coord(r, c)} — ${res.result === "miss" ? "miss" : "HIT"}${res.result === "sunk" ? `! Your ${res.ship.name} is sunk!` : ""}`);
  aiObserve(state.ai, r, c, res);
  if (allSunk(state.player)) { state.over = true; state.winner = "Enemy wins!"; log("Your fleet is destroyed. Enemy wins."); render(); return; }
  state.turn = "player";
  render();
}

// Tests can shorten the AI's thinking time with ?delay=0.
const AI_DELAY_MS = Number(new URLSearchParams(location.search).get("delay") ?? 600);

// Test hook: read-only access to the live game state.
window.__battleship = { get state() { return state; }, newGame, render, onPlaceClick, onFireClick };

document.getElementById("new").addEventListener("click", newGame);
document.getElementById("rotate").addEventListener("click", () => {
  state.horizontal = !state.horizontal;
  render();
});
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key && e.key.toLowerCase() === "r") { state.horizontal = !state.horizontal; render(); }
});
newGame();
