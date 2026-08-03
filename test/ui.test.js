// Unit tests for the DOM layer (ui.js), run headlessly against a jsdom document.
// The Playwright suite covers whole-page journeys; these exercise ui.js's rendering
// and input functions directly, including branches a real session rarely reaches.
// Run: node --test test/ui.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { JSDOM } = require("jsdom");
const g = require("../game.js");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// Boots index.html (which loads game.js and ui.js) in jsdom. ?delay=0 removes the
// AI's thinking pause, so the enemy turn is a single macrotask away.
function loadGame({ delay = 0 } = {}) {
  const dom = new JSDOM(HTML, {
    url: "file://" + path.join(ROOT, "index.html") + "?delay=" + delay,
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
  });
  return new Promise((resolve, reject) => {
    dom.window.addEventListener("error", (e) => reject(e.error || new Error(e.message)));
    dom.window.addEventListener("load", () => resolve(dom.window));
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const $ = (win, sel) => win.document.querySelector(sel);
const cell = (win, board, coord) => $(win, `#${board} .cell[data-coord="${coord}"]`);
const logText = (win) => $(win, "#log").textContent;
const statusText = (win) => $(win, "#status").textContent;

// The five ships, placed vertically down columns A-E so every fleet member is on row 1.
const FLEET_COORDS = ["A1", "B1", "C1", "D1", "E1"];

function placeFleet(win) {
  win.document.getElementById("rotate").click(); // vertical, so the ships do not collide
  for (const c of FLEET_COORDS) cell(win, "player", c).click();
}

function click(win, board, coord) {
  cell(win, board, coord).click();
}

test("a new game renders both grids, the fleet lists, and the placement prompt", async () => {
  const win = await loadGame();
  assert.equal(win.document.querySelectorAll("#player .cell:not(.label)").length, 100);
  assert.equal(win.document.querySelectorAll("#enemy .cell:not(.label)").length, 100);
  assert.equal(win.document.querySelectorAll("#playerFleet li").length, 5);
  assert.match(statusText(win), /Placing Carrier \(5\)/);
  assert.match(logText(win), /Place your fleet/);
  assert.equal($(win, "#stats").innerHTML, "", "no stats before a shot is fired");
  assert.equal(cell(win, "player", "A1").dataset.coord, "A1");
  win.close();
});

test("row and column labels are rendered once per board", async () => {
  const win = await loadGame();
  const labels = [...win.document.querySelectorAll("#player .cell.label")].map((d) => d.textContent);
  assert.equal(labels.length, 21, "a corner, 10 letters, and 10 numbers");
  assert.deepEqual(labels.slice(1, 11), "ABCDEFGHIJ".split(""));
  assert.deepEqual(labels.slice(11), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  win.close();
});

test("clicking places the pending ship and advances the prompt", async () => {
  const win = await loadGame();
  click(win, "player", "A1");
  for (const c of ["A1", "B1", "C1", "D1", "E1"]) {
    assert.ok(cell(win, "player", c).classList.contains("ship"), `${c} shows the Carrier`);
  }
  assert.match(logText(win), /Carrier placed at A1\./);
  assert.match(statusText(win), /Placing Battleship \(4\)/);
  assert.equal($(win, "#playerFleet li[data-ship='Carrier']").textContent, "Carrier (5) — 0/5 hits");
  assert.equal($(win, "#playerFleet li[data-ship='Cruiser']").textContent, "Cruiser (3) — not placed");
  win.close();
});

test("an overhanging placement is logged and leaves the ship pending", async () => {
  const win = await loadGame();
  click(win, "player", "H1");
  assert.match(logText(win), /would hang off the board/);
  assert.match(statusText(win), /Placing Carrier/);
  assert.equal(win.__battleship.state.player.ships.length, 0);
  win.close();
});

test("an overlapping placement is logged and leaves the ship pending", async () => {
  const win = await loadGame();
  click(win, "player", "A1");
  click(win, "player", "B1"); // Battleship across the Carrier's row 1
  assert.match(logText(win), /would overlap another ship/);
  assert.match(statusText(win), /Placing Battleship/);
  assert.equal(win.__battleship.state.player.ships.length, 1);
  win.close();
});

test("rotate toggles orientation, updates its label, and locks after placement", async () => {
  const win = await loadGame();
  const rotate = win.document.getElementById("rotate");
  assert.equal(rotate.textContent, "Rotate: horizontal");
  rotate.click();
  assert.equal(rotate.textContent, "Rotate: vertical");
  assert.equal(win.__battleship.state.horizontal, false);
  click(win, "player", "A1");
  for (const c of ["A1", "A2", "A3", "A4", "A5"]) {
    assert.ok(cell(win, "player", c).classList.contains("ship"), `${c} shows the Carrier`);
  }
  win.close();
});

test("the R hotkey rotates, but modified keypresses and other keys do not", async () => {
  const win = await loadGame();
  const press = (key, init = {}) =>
    win.dispatchEvent(new win.KeyboardEvent("keydown", { key, ...init }));
  press("R");
  assert.equal(win.__battleship.state.horizontal, false);
  press("r");
  assert.equal(win.__battleship.state.horizontal, true);
  press("r", { ctrlKey: true });
  press("r", { altKey: true });
  press("r", { metaKey: true });
  press("x");
  assert.equal(win.__battleship.state.horizontal, true, "modifiers and other keys are ignored");
  win.close();
});

test("rotation is a no-op once the fleet is placed", async () => {
  const win = await loadGame();
  placeFleet(win);
  const rotate = win.document.getElementById("rotate");
  assert.ok(rotate.disabled);
  win.dispatchEvent(new win.KeyboardEvent("keydown", { key: "r" }));
  assert.equal(win.__battleship.state.horizontal, false, "the hotkey is inert too");
  win.close();
});

test("random placement fills only the unplaced ships and readies the fleet", async () => {
  const win = await loadGame();
  click(win, "player", "A1");
  const carrier = win.__battleship.state.player.ships[0];
  win.document.getElementById("random").click();
  const { player } = win.__battleship.state;
  assert.equal(player.ships.length, 5);
  assert.equal(player.ships[0], carrier, "the already-placed Carrier is untouched");
  assert.equal(player.grid.flat().filter(Boolean).length, 17);
  assert.match(logText(win), /Fleet placed randomly\./);
  assert.match(statusText(win), /Your turn/);
  assert.ok(win.document.getElementById("random").disabled);
  win.close();
});

test("undo removes the last ship and is disabled at both extremes", async () => {
  const win = await loadGame();
  const undo = win.document.getElementById("undo");
  assert.ok(undo.disabled, "nothing to undo on a fresh board");
  click(win, "player", "A1");
  assert.ok(!undo.disabled);
  undo.click();
  assert.equal(win.__battleship.state.player.ships.length, 0);
  assert.ok(!cell(win, "player", "A1").classList.contains("ship"));
  assert.match(logText(win), /Carrier removed\./);
  assert.ok(undo.disabled);
  win.close();
});

test("undo is refused once shots have been fired", async () => {
  const win = await loadGame();
  placeFleet(win);
  click(win, "enemy", "A1");
  await flush();
  const undo = win.document.getElementById("undo");
  assert.ok(undo.disabled);
  undo.click();
  assert.equal(win.__battleship.state.player.ships.length, 5, "the fleet survives a stray undo");
  win.close();
});

test("hovering previews the placement, green when legal and red when not", async () => {
  const win = await loadGame();
  const hover = (coord) =>
    cell(win, "player", coord).dispatchEvent(new win.MouseEvent("mouseenter"));
  hover("A1");
  for (const c of ["A1", "B1", "C1", "D1", "E1"]) {
    assert.ok(cell(win, "player", c).classList.contains("preview-ok"), `${c} previews green`);
  }
  hover("H1");
  assert.ok(cell(win, "player", "H1").classList.contains("preview-bad"), "an overhang previews red");
  assert.ok(!cell(win, "player", "A1").classList.contains("preview-ok"), "the old preview is cleared");
  $(win, "#player").dispatchEvent(new win.MouseEvent("mouseleave"));
  assert.equal(win.document.querySelectorAll("#player .preview-ok, #player .preview-bad").length, 0);
  win.close();
});

test("a preview that runs off the board only marks its on-board cells", async () => {
  const win = await loadGame();
  cell(win, "player", "H1").dispatchEvent(new win.MouseEvent("mouseenter"));
  const marked = win.document.querySelectorAll("#player .preview-bad");
  assert.equal(marked.length, 3, "H1, I1, and J1; the two off-board cells have no element");
  win.close();
});

test("dragging a ship from the fleet list places it where it is dropped", async () => {
  const win = await loadGame();
  const submarine = $(win, "#playerFleet li[data-ship='Submarine']");
  assert.ok(submarine.draggable, "unplaced ships are draggable");
  submarine.dispatchEvent(new win.Event("dragstart"));
  assert.equal(win.__battleship.state.dragging, "Submarine");
  const target = cell(win, "player", "C5");
  target.dispatchEvent(new win.Event("dragover", { cancelable: true }));
  assert.ok(target.classList.contains("preview-ok"), "dragging over previews the drop");
  target.dispatchEvent(new win.Event("drop", { cancelable: true }));
  for (const c of ["C5", "D5", "E5"]) {
    assert.ok(cell(win, "player", c).classList.contains("ship"), `${c} holds the Submarine`);
  }
  assert.equal(win.__battleship.state.dragging, null);
  assert.ok(!$(win, "#playerFleet li[data-ship='Submarine']").draggable, "a placed ship is inert");
  win.close();
});

test("dropping a ship that is already placed changes nothing", async () => {
  const win = await loadGame();
  click(win, "player", "A1"); // Carrier
  win.__battleship.state.dragging = "Carrier";
  cell(win, "player", "A8").dispatchEvent(new win.Event("drop", { cancelable: true }));
  assert.equal(win.__battleship.state.player.ships.length, 1);
  assert.ok(!cell(win, "player", "A8").classList.contains("ship"));
  win.close();
});

test("abandoning a drag clears both the dragging ship and its preview", async () => {
  const win = await loadGame();
  const carrier = $(win, "#playerFleet li[data-ship='Carrier']");
  carrier.dispatchEvent(new win.Event("dragstart"));
  cell(win, "player", "A1").dispatchEvent(new win.Event("dragover", { cancelable: true }));
  carrier.dispatchEvent(new win.Event("dragend"));
  assert.equal(win.__battleship.state.dragging, null);
  assert.equal(win.document.querySelectorAll("#player .preview-ok").length, 0);
  win.close();
});

test("the enemy grid is inert until the fleet is ready", async () => {
  const win = await loadGame();
  click(win, "enemy", "A1");
  assert.equal(win.__battleship.state.enemy.shots.flat().filter(Boolean).length, 0);
  assert.match(statusText(win), /Placing Carrier/);
  win.close();
});

test("firing marks the cell, logs the shot, and hands the turn to the AI", async () => {
  const win = await loadGame();
  placeFleet(win);
  const { state } = win.__battleship;
  const empty = findCell(state.enemy, false);
  click(win, "enemy", win.coord(...empty));
  assert.match(logText(win), /You fire at .* — miss/);
  assert.ok(cell(win, "enemy", win.coord(...empty)).classList.contains("miss"));
  await flush();
  assert.match(logText(win), /Enemy fires at/);
  assert.equal(state.turn, "player");
  assert.match(statusText(win), /Your turn/);
  win.close();
});

test("a hit is announced, and a sink is announced and revealed in the fleet list", async () => {
  const win = await loadGame();
  placeFleet(win);
  const { state } = win.__battleship;
  const destroyer = state.enemy.ships.find((s) => s.name === "Destroyer");
  for (const [r, c] of destroyer.cells) {
    win.__battleship.onFireClick(r, c);
    await flush();
  }
  assert.match(logText(win), /HIT/);
  assert.match(logText(win), /You sank their Destroyer!/);
  const li = $(win, "#enemyFleet li[data-ship='Destroyer']");
  assert.ok(li.classList.contains("sunk"));
  assert.equal(li.textContent, "Destroyer (2) — SUNK");
  assert.ok(cell(win, "enemy", win.coord(...destroyer.cells[0])).classList.contains("sunk"));
  assert.equal($(win, "#enemyFleet li[data-ship='Carrier']").textContent, "Carrier (5)",
    "intact enemy ships leak no damage detail");
  win.close();
});

test("re-firing an already-shot cell is not a turn", async () => {
  const win = await loadGame();
  placeFleet(win);
  win.__battleship.onFireClick(5, 5);
  await flush();
  const shots = win.__battleship.state.enemy.shots.flat().filter(Boolean).length;
  const before = logText(win);
  win.__battleship.onFireClick(5, 5);
  await flush();
  assert.equal(win.__battleship.state.enemy.shots.flat().filter(Boolean).length, shots);
  assert.equal(
    logText(win),
    before + "You already fired at F6 — pick another cell.",
    "the repeat is explained and the AI does not reply"
  );
  win.close();
});

test("clicking during the enemy's turn is ignored", async () => {
  const win = await loadGame({ delay: 50 });
  placeFleet(win);
  win.__battleship.onFireClick(5, 5);
  assert.equal(win.__battleship.state.turn, "enemy");
  win.__battleship.onFireClick(6, 6);
  assert.equal(win.__battleship.state.enemy.shots[6][6], null, "the second shot is dropped");
  win.close();
});

test("the stats table appears with the first shot and tracks accuracy", async () => {
  const win = await loadGame();
  placeFleet(win);
  const { state } = win.__battleship;
  assert.equal($(win, "#stats").innerHTML, "");
  const [hr, hc] = state.enemy.ships[0].cells[0];
  win.__battleship.onFireClick(hr, hc);
  await flush();
  const table = $(win, "#stats").textContent.replace(/\s+/g, " ");
  assert.match(table, /You11100%0\/5/);
  assert.match(table, /Enemy1/, "the AI's reply is counted too");
  win.close();
});

test("sinking the enemy fleet wins, locks the board, and prints a summary", async () => {
  const win = await loadGame();
  placeFleet(win);
  const { state } = win.__battleship;
  for (const ship of state.enemy.ships) {
    for (const [r, c] of ship.cells) {
      if (state.over) break;
      win.__battleship.onFireClick(r, c);
      await flush();
    }
  }
  assert.ok(state.over);
  assert.equal(statusText(win), "You win!");
  assert.match(logText(win), /All enemy ships sunk\./);
  assert.match($(win, "#stats").textContent, /All enemy ships sunk\..*Difficulty: normal\./s);
  const remaining = findCell(state.enemy, false);
  win.__battleship.onFireClick(...remaining);
  assert.equal(state.enemy.shots[remaining[0]][remaining[1]], null, "the board is locked");
  win.close();
});

test("the AI sinking the player's fleet ends the game", async () => {
  const win = await loadGame();
  placeFleet(win);
  const { state } = win.__battleship;
  // Leave the player one intact cell, then let the AI take it.
  for (const ship of state.player.ships) {
    for (const [r, c] of ship.cells.slice(0, ship.cells.length - 1)) win.fire(state.player, r, c);
  }
  const last = state.player.ships[state.player.ships.length - 1];
  const [lr, lc] = last.cells[last.cells.length - 1];
  state.player.ships.forEach((s) => { if (s !== last) win.fire(state.player, ...s.cells[s.size - 1]); });
  state.ai.queue = [[lr, lc]];
  win.__battleship.onFireClick(...findCell(state.enemy, false));
  await flush();
  assert.ok(state.over);
  assert.equal(statusText(win), "Enemy wins!");
  assert.match(logText(win), /Your fleet is destroyed\./);
  win.close();
});

test("the difficulty select drives the AI and locks once firing starts", async () => {
  const win = await loadGame();
  const select = win.document.getElementById("difficulty");
  assert.deepEqual(
    [...select.options].map((o) => o.value),
    g.DIFFICULTIES,
    "the select offers exactly the supported difficulties"
  );
  select.value = "devin";
  select.dispatchEvent(new win.Event("change"));
  assert.equal(win.__battleship.state.difficulty, "devin");
  assert.equal(win.__battleship.state.ai.difficulty, "devin");
  assert.match(logText(win), /Difficulty set to devin\./);
  select.value = "hard";
  select.dispatchEvent(new win.Event("change"));
  assert.equal(win.__battleship.state.difficulty, "hard");
  assert.equal(win.__battleship.state.ai.difficulty, "hard");
  assert.match(logText(win), /Difficulty set to hard\./);
  placeFleet(win);
  assert.ok(select.disabled, "difficulty is locked once the fleet is ready");
  win.close();
});

test("New game clears both boards and keeps the selected difficulty", async () => {
  const win = await loadGame();
  const select = win.document.getElementById("difficulty");
  select.value = "easy";
  select.dispatchEvent(new win.Event("change"));
  placeFleet(win);
  const firstEnemy = win.__battleship.state.enemy;
  win.__battleship.onFireClick(...findCell(firstEnemy, false));
  await flush();
  win.document.getElementById("new").click();
  const { state } = win.__battleship;
  assert.equal(state.player.ships.length, 0);
  assert.equal(state.enemy.shots.flat().filter(Boolean).length, 0);
  assert.equal(state.player.shots.flat().filter(Boolean).length, 0);
  assert.equal(state.difficulty, "easy");
  assert.equal(state.ai.difficulty, "easy");
  assert.match(logText(win), /^Place your fleet/, "the log is reset");
  assert.equal(win.document.querySelectorAll("#player .ship").length, 0);
  win.close();
});

test("New game cancels the pending AI shot (regression)", async () => {
  const win = await loadGame({ delay: 30 });
  placeFleet(win);
  win.__battleship.onFireClick(...findCell(win.__battleship.state.enemy, false));
  win.document.getElementById("new").click();
  const fresh = win.__battleship.state;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(fresh.player.shots.flat().filter(Boolean).length, 0,
    "the stale timer must not fire at the new board");
  assert.equal(fresh.turn, "player");
  win.close();
});

// First cell of the board that either holds a ship (ship=true) or does not.
function findCell(board, ship) {
  for (let r = 0; r < 10; r++)
    for (let c = 0; c < 10; c++)
      if (!board.shots[r][c] && !!board.grid[r][c] === ship) return [r, c];
  throw new Error("no such cell");
}
