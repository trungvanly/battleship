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

test("invalid input fails loudly instead of corrupting the board", () => {
  const b = g.emptyBoard();
  assert.throws(() => g.fire(b, -1, 0), RangeError);
  assert.throws(() => g.fire(b, 0, 10), RangeError);
  assert.throws(() => g.fire(b, 1.5, 0), RangeError);
  assert.throws(() => g.place(b, shipSpec("Carrier"), g.cellsFor(0, 7, 5, true)), RangeError);
  assert.throws(() => g.place(b, shipSpec("Carrier"), g.cellsFor(0, 0, 3, true)), RangeError);
  assert.throws(() => g.makeAI("impossible"), RangeError);
  assert.throws(() => g.aiChoose(g.makeAI(), b, { difficulty: "nightmare" }), RangeError);
  assert.throws(() => g.aiObserve(g.makeAI(), 0, 0, { result: "sunk" }), TypeError);
  assert.equal(b.ships.length, 0, "no partial state left behind");
});

test("randomPlace gives up loudly on a board with no room", () => {
  const b = g.emptyBoard();
  for (let r = 0; r < 10; r++) g.place(b, { name: "Filler", size: 10 }, g.cellsFor(r, 0, 10, true));
  assert.throws(() => g.randomPlace(b, shipSpec("Destroyer")), /no legal position/);
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

function playAIGame(difficulty = "normal") {
  const board = g.randomFleet(g.emptyBoard());
  const ai = g.makeAI(difficulty);
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

test("accuracy summarises a board's shot history", () => {
  const b = g.emptyBoard();
  g.place(b, shipSpec("Destroyer"), g.cellsFor(0, 0, 2, true));
  assert.deepEqual(g.accuracy(b), { shots: 0, hits: 0, misses: 0, pct: 0 });
  g.fire(b, 0, 0);
  g.fire(b, 5, 5);
  g.fire(b, 6, 6);
  g.fire(b, 7, 7);
  assert.deepEqual(g.accuracy(b), { shots: 4, hits: 1, misses: 3, pct: 25 });
});

test("aiObserve tracks sunk cells and the remaining fleet", () => {
  const b = g.emptyBoard();
  g.place(b, shipSpec("Destroyer"), g.cellsFor(0, 0, 2, true));
  const ai = g.makeAI();
  assert.deepEqual(ai.remaining, [5, 4, 3, 3, 2]);
  g.aiObserve(ai, 0, 0, g.fire(b, 0, 0));
  g.aiObserve(ai, 0, 1, g.fire(b, 0, 1));
  assert.deepEqual(ai.remaining, [5, 4, 3, 3]);
  assert.deepEqual(ai.sunkCells, [[0, 0], [0, 1]]);
});

test("easy fires uniformly at random, ignoring parity and hits", () => {
  const b = g.randomFleet(g.emptyBoard());
  const ai = g.makeAI("easy");
  ai.hits = [[4, 4]];
  g.rebuildQueue(ai);
  const picks = Array.from({ length: 200 }, () => g.aiChoose(ai, b));
  assert.ok(picks.some(([r, c]) => (r + c) % 2 === 1), "not restricted to the parity grid");
  const adjacent = picks.filter(([r, c]) => Math.abs(r - 4) + Math.abs(c - 4) === 1).length;
  assert.ok(adjacent < picks.length, "does not chase hits");
});

test("hard: density chases unresolved hits and prefers the centre", () => {
  const b = g.emptyBoard();
  g.place(b, shipSpec("Cruiser"), g.cellsFor(4, 4, 3, true));
  const ai = g.makeAI("hard");
  g.aiObserve(ai, 4, 4, g.fire(b, 4, 4));
  const [r, c] = g.aiChoose(ai, b);
  assert.equal(Math.abs(r - 4) + Math.abs(c - 4), 1, "an unresolved hit dominates the map");
  assert.equal(g.densityMap(ai, b)[4][4], 0, "already-fired cells score zero");

  const fresh = g.densityMap(g.makeAI("hard"), g.emptyBoard());
  assert.ok(fresh[4][4] > fresh[0][0], "the centre is denser than the corner");
});

test("hard mode cannot see ships it has not shot at", () => {
  // Identical shot history over different hidden fleets must give identical maps.
  const a = g.emptyBoard();
  const b = g.emptyBoard();
  g.place(a, shipSpec("Cruiser"), g.cellsFor(0, 0, 3, true));
  g.place(b, shipSpec("Cruiser"), g.cellsFor(9, 7, 3, true));
  const ai = g.makeAI("hard");
  assert.deepEqual(g.densityMap(ai, a), g.densityMap(ai, b));
});

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

test("difficulty ordering: devin and hard beat normal beats easy", () => {
  assert.deepEqual(g.DIFFICULTIES, ["easy", "normal", "hard", "devin"]);
  const runs = 120;
  const average = (difficulty) => {
    let total = 0;
    for (let i = 0; i < runs; i++) total += playAIGame(difficulty);
    return total / runs;
  };
  const easy = average("easy");
  const normal = average("normal");
  const hard = average("hard");
  const devin = average("devin");
  console.log(`    avg shots — easy ${easy.toFixed(1)}, normal ${normal.toFixed(1)}, hard ${hard.toFixed(1)}, devin ${devin.toFixed(1)}`);
  assert.ok(hard < normal, `hard (${hard.toFixed(1)}) should need fewer shots than normal (${normal.toFixed(1)})`);
  assert.ok(normal < easy, `normal (${normal.toFixed(1)}) should need fewer shots than easy (${easy.toFixed(1)})`);
  assert.ok(devin < normal, `devin (${devin.toFixed(1)}) should need fewer shots than normal (${normal.toFixed(1)})`);
  assert.ok(
    devin < hard * 1.15,
    `devin (${devin.toFixed(1)}) should be at least comparable to hard (${hard.toFixed(1)})`
  );
});

test("devin mode hunts on the parity grid using the density map", () => {
  const board = g.emptyBoard();
  const ai = g.makeAI("devin");
  for (let i = 0; i < 40; i++) {
    const scores = g.densityMap(ai, board);
    const [r, c] = g.aiChoose(ai, board);
    assert.equal((r + c) % 2, 0, `hunt shot ${g.coord(r, c)} is off the parity grid`);
    const parityBest = Math.max(
      ...g.allOpen(board).filter(([pr, pc]) => (pr + pc) % 2 === 0).map(([pr, pc]) => scores[pr][pc])
    );
    assert.equal(scores[r][c], parityBest, "devin fires at the densest parity cell");
    board.shots[r][c] = "miss"; // an empty board, so every hunt shot misses
  }
});

test("devin mode drains the target queue before hunting again", () => {
  const board = g.emptyBoard();
  g.place(board, shipSpec("Cruiser"), g.cellsFor(4, 4, 3, true));
  const ai = g.makeAI("devin");
  g.aiObserve(ai, 4, 4, g.fire(board, 4, 4));
  g.aiObserve(ai, 4, 5, g.fire(board, 4, 5));
  // Two collinear hits: the queue holds only the line's two ends, one of which is odd parity.
  const first = g.aiChoose(ai, board);
  const second = g.aiChoose(ai, board);
  assert.deepEqual(
    [first, second].map(([r, c]) => g.coord(r, c)).sort(),
    ["D5", "G5"].sort()
  );
  assert.ok([first, second].some(([r, c]) => (r + c) % 2 !== 0), "the queue overrides parity");
});

test("devin mode falls back when the parity grid is exhausted", () => {
  const board = g.emptyBoard();
  for (let r = 0; r < g.SIZE; r++)
    for (let c = 0; c < g.SIZE; c++) if ((r + c) % 2 === 0) board.shots[r][c] = "miss";
  const ai = g.makeAI("devin");
  const [r, c] = g.aiChoose(ai, board);
  assert.equal((r + c) % 2, 1, "with no parity cells left it fires at an open odd cell");
});
