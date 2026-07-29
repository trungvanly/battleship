// Unit, property, and simulation tests for the pure game logic.
// Run: node --test test/   (or npm test)
const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../game.js");

const shipSpec = (name) => g.FLEET.find((s) => s.name === name);

test("coordinate mapping", () => {
  assert.equal(g.coord(0, 0), "A1");
  assert.equal(g.coord(9, 9), "J10");
  assert.equal(g.coord(4, 2), "C5");
});

test("canPlace rejects overhang", () => {
  const b = g.emptyBoard();
  assert.ok(!g.canPlace(b, g.cellsFor(0, 7, 5, true)), "horizontal overhang");
  assert.ok(!g.canPlace(b, g.cellsFor(7, 0, 5, false)), "vertical overhang");
  assert.ok(g.canPlace(b, g.cellsFor(0, 5, 5, true)), "exact fit at the edge");
});

test("canPlace rejects overlap but allows adjacency", () => {
  const b = g.emptyBoard();
  g.place(b, shipSpec("Carrier"), g.cellsFor(0, 0, 5, true));
  assert.ok(!g.canPlace(b, g.cellsFor(0, 2, 3, false)), "crossing an existing ship");
  assert.ok(g.canPlace(b, g.cellsFor(1, 0, 4, true)), "touching is legal");
});

test("fire returns miss, hit, sunk, and null for repeats", () => {
  const b = g.emptyBoard();
  g.place(b, shipSpec("Destroyer"), g.cellsFor(3, 3, 2, true));
  assert.equal(g.fire(b, 0, 0).result, "miss");
  assert.equal(g.fire(b, 3, 3).result, "hit");
  assert.equal(g.fire(b, 3, 3), null, "a repeat shot is not a turn");
  const last = g.fire(b, 3, 4);
  assert.equal(last.result, "sunk");
  assert.equal(last.ship.name, "Destroyer");
  assert.ok(g.allSunk(b));
});

test("allSunk is false while any ship is afloat", () => {
  const b = g.emptyBoard();
  g.place(b, shipSpec("Destroyer"), g.cellsFor(0, 0, 2, true));
  g.place(b, shipSpec("Cruiser"), g.cellsFor(2, 0, 3, true));
  g.fire(b, 0, 0); g.fire(b, 0, 1);
  assert.ok(!g.allSunk(b));
});

test("property: 5000 random fleets are always legal", () => {
  for (let i = 0; i < 5000; i++) {
    const b = g.randomFleet(g.emptyBoard());
    assert.equal(b.ships.length, 5);
    assert.equal(b.grid.flat().filter(Boolean).length, 17, "17 occupied cells, so no overlap");
    for (const s of b.ships) {
      assert.equal(s.cells.length, s.size);
      const rows = new Set(s.cells.map(([r]) => r));
      const cols = new Set(s.cells.map(([, c]) => c));
      assert.ok(rows.size === 1 || cols.size === 1, "axis-aligned");
      assert.ok(g.onBoard(s.cells), "on the board");
    }
  }
});

test("A2: the AI follows up adjacent to a hit", () => {
  const b = g.emptyBoard();
  g.place(b, shipSpec("Cruiser"), g.cellsFor(4, 4, 3, true));
  const ai = g.makeAI();
  g.aiObserve(ai, 4, 4, g.fire(b, 4, 4));
  const [r, c] = g.aiChoose(ai, b);
  assert.equal(Math.abs(r - 4) + Math.abs(c - 4), 1);
});

test("two collinear hits lock targeting to the line ends", () => {
  const ai = g.makeAI();
  ai.hits = [[4, 4], [4, 5]];
  g.rebuildQueue(ai);
  assert.deepEqual(ai.queue, [[4, 3], [4, 6]]);

  const vertical = g.makeAI();
  vertical.hits = [[4, 4], [5, 4]];
  g.rebuildQueue(vertical);
  assert.deepEqual(vertical.queue, [[3, 4], [6, 4]]);
});

test("A4: a sink does not discard hits on another damaged ship", () => {
  const b = g.emptyBoard();
  g.place(b, shipSpec("Destroyer"), g.cellsFor(0, 0, 2, true)); // A1-B1
  g.place(b, shipSpec("Cruiser"), g.cellsFor(1, 0, 3, true));   // A2-C2
  const ai = g.makeAI();
  for (const [r, c] of [[1, 0], [0, 0], [0, 1]]) g.aiObserve(ai, r, c, g.fire(b, r, c));
  assert.deepEqual(ai.hits, [[1, 0]], "only the sunk Destroyer's hits are dropped");
  const [r, c] = g.aiChoose(ai, b);
  assert.equal(Math.abs(r - 1) + Math.abs(c - 0), 1, "next shot pursues the damaged Cruiser");
});

test("A3: after a lone sink the AI returns to parity hunting", () => {
  const b = g.emptyBoard();
  g.place(b, shipSpec("Destroyer"), g.cellsFor(0, 0, 2, true));
  const ai = g.makeAI();
  g.aiObserve(ai, 0, 0, g.fire(b, 0, 0));
  g.aiObserve(ai, 0, 1, g.fire(b, 0, 1));
  assert.deepEqual(ai.hits, []);
  assert.deepEqual(ai.queue, []);
  const [r, c] = g.aiChoose(ai, b);
  assert.equal((r + c) % 2, 0);
});

function playAIGame() {
  const board = g.randomFleet(g.emptyBoard());
  const ai = g.makeAI();
  const seen = new Set();
  let shots = 0;
  while (!g.allSunk(board)) {
    const target = g.aiChoose(ai, board);
    assert.ok(target, "the AI always has a target while ships remain");
    const [r, c] = target;
    assert.ok(!seen.has(r + "," + c), "the AI never repeats a shot");
    seen.add(r + "," + c);
    const res = g.fire(board, r, c);
    assert.ok(res, "fire() never rejects an AI shot");
    g.aiObserve(ai, r, c, res);
    shots++;
    assert.ok(shots <= 100, "a game cannot exceed the 100 cells of the board");
  }
  return shots;
}

test("A5: 2000 simulated games terminate, and the AI beats random play", () => {
  const games = 2000;
  let total = 0;
  let worst = 0;
  for (let i = 0; i < games; i++) {
    const shots = playAIGame();
    total += shots;
    worst = Math.max(worst, shots);
  }
  const avg = total / games;
  console.log(`    AI shots to clear a board: avg ${avg.toFixed(1)}, worst ${worst}`);
  assert.ok(avg < 70, `hunt/target should average well under random play, got ${avg.toFixed(1)}`);
  assert.ok(avg > 30, `suspiciously low average (${avg.toFixed(1)}) — is the AI cheating?`);
});
