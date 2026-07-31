// Pure Battleship rules + AI. No DOM access, so it can be unit-tested headlessly.
// Loaded as a classic script in the browser (attaches to window) and via
// require() in Node.

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SIZE = 10;
  const LETTERS = "ABCDEFGHIJ".split("");
  const FLEET = [
    { name: "Carrier", size: 5 },
    { name: "Battleship", size: 4 },
    { name: "Cruiser", size: 3 },
    { name: "Submarine", size: 3 },
    { name: "Destroyer", size: 2 },
  ];

  const coord = (r, c) => LETTERS[c] + (r + 1);

  const inBounds = (r, c) =>
    Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  const sameCell = ([ar, ac], [br, bc]) => ar === br && ac === bc;
  const includesCell = (cells, cell) => cells.some((other) => sameCell(other, cell));
  const pickRandom = (items, rng = Math.random) =>
    items.length ? items[Math.floor(rng() * items.length)] : null;
  const isSunk = (ship) => !!ship && ship.hits === ship.size;
  const sunkCount = (board) => board.ships.filter(isSunk).length;
  const hasShots = (board) => board.shots.flat().some(Boolean);

  function emptyBoard() {
    return {
      ships: [],
      grid: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)), // ship ref
      shots: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)), // 'hit' | 'miss'
    };
  }

  function cellsFor(r, c, size, horizontal) {
    const cells = [];
    for (let i = 0; i < size; i++) cells.push(horizontal ? [r, c + i] : [r + i, c]);
    return cells;
  }

  const onBoard = (cells) => cells.every(([r, c]) => inBounds(r, c));

  function canPlace(board, cells) {
    return onBoard(cells) && cells.every(([r, c]) => !board.grid[r][c]);
  }

  function place(board, spec, cells) {
    if (!spec || typeof spec.size !== "number") throw new TypeError("place: invalid ship spec");
    if (cells.length !== spec.size)
      throw new RangeError(`place: ${spec.name} needs ${spec.size} cells, got ${cells.length}`);
    if (!canPlace(board, cells))
      throw new RangeError(`place: ${spec.name} does not fit at ${coord(cells[0][0], cells[0][1])}`);
    const ship = { name: spec.name, size: spec.size, cells, hits: 0 };
    board.ships.push(ship);
    cells.forEach(([r, c]) => (board.grid[r][c] = ship));
    return ship;
  }

  // Bounded so a board that cannot fit the fleet fails loudly instead of hanging.
  const PLACEMENT_ATTEMPTS = 1000;

  function randomPlace(board, spec, rng = Math.random) {
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
      const horizontal = rng() < 0.5;
      const r = Math.floor(rng() * SIZE);
      const c = Math.floor(rng() * SIZE);
      const cells = cellsFor(r, c, spec.size, horizontal);
      if (canPlace(board, cells)) return place(board, spec, cells);
    }
    throw new Error(
      `randomFleet: no legal position for the ${spec.name} after ${PLACEMENT_ATTEMPTS} attempts`
    );
  }

  // Places each of the given specs at a uniformly random legal position.
  function placeRandomly(board, specs, rng = Math.random) {
    for (const spec of specs) randomPlace(board, spec, rng);
    return board;
  }

  const randomFleet = (board, rng = Math.random) => placeRandomly(board, FLEET, rng);

  function fire(board, r, c) {
    if (!inBounds(r, c)) throw new RangeError(`fire: (${r}, ${c}) is off the board`);
    if (board.shots[r][c]) return null; // repeat shot: not a turn
    const ship = board.grid[r][c];
    board.shots[r][c] = ship ? "hit" : "miss";
    if (!ship) return { result: "miss" };
    ship.hits++;
    return { result: isSunk(ship) ? "sunk" : "hit", ship };
  }

  const allSunk = (board) => board.ships.every(isSunk);

  // Shot statistics for a board that has been fired at.
  function accuracy(board) {
    const flat = board.shots.flat();
    const shots = flat.filter(Boolean).length;
    const hits = flat.filter((s) => s === "hit").length;
    return { shots, hits, misses: shots - hits, pct: shots ? Math.round((hits / shots) * 100) : 0 };
  }

  // ---- AI ----
  // difficulty: "easy"   = uniform random fire
  //             "normal" = parity hunt + adjacency targeting
  //             "hard"   = probability density over every legal remaining placement
  const DIFFICULTIES = ["easy", "normal", "hard"];

  function assertDifficulty(difficulty) {
    if (!DIFFICULTIES.includes(difficulty))
      throw new RangeError(
        `unknown difficulty "${difficulty}" (expected ${DIFFICULTIES.join(", ")})`
      );
    return difficulty;
  }

  const makeAI = (difficulty = "normal") => ({
    difficulty: assertDifficulty(difficulty),
    queue: [],
    hits: [],                       // hits on ships still afloat
    sunkCells: [],                  // cells known to belong to sunk ships
    remaining: FLEET.map((s) => s.size),
  });

  function contiguous(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
  }

  // Rebuilds the target queue from the hits belonging to ships still afloat.
  // Two or more collinear, contiguous hits lock targeting to that line's two ends.
  function rebuildQueue(ai) {
    const hits = ai.hits;
    ai.queue = [];
    if (!hits.length) return;
    const rows = hits.map(([r]) => r);
    const cols = hits.map(([, c]) => c);
    // For a line of hits, the only candidates are the two cells extending it.
    const lineEnds = (fixed, along, horizontal) => {
      const sorted = [...along].sort((a, b) => a - b);
      const before = sorted[0] - 1;
      const after = sorted[sorted.length - 1] + 1;
      return horizontal
        ? [[fixed, before], [fixed, after]]
        : [[before, fixed], [after, fixed]];
    };
    if (hits.length > 1 && rows.every((r) => r === rows[0]) && contiguous(cols)) {
      ai.queue.push(...lineEnds(rows[0], cols, true));
      return;
    }
    if (hits.length > 1 && cols.every((c) => c === cols[0]) && contiguous(rows)) {
      ai.queue.push(...lineEnds(cols[0], rows, false));
      return;
    }
    for (const [r, c] of hits) ai.queue.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]);
  }

  function allOpen(board) {
    const open = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) if (!board.shots[r][c]) open.push([r, c]);
    return open;
  }

  // Scores every cell by how many legal placements of the remaining fleet cover it,
  // weighting placements that would explain an unresolved hit. Uses only information
  // the AI legitimately has: its own shot results and the sinkings announced to it.
  function densityMap(ai, board) {
    const scores = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    for (const size of ai.remaining) {
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          for (const horizontal of [true, false]) {
            const cells = cellsFor(r, c, size, horizontal);
            if (!onBoard(cells)) continue;
            if (cells.some(([cr, cc]) =>
              board.shots[cr][cc] === "miss" || includesCell(ai.sunkCells, [cr, cc]))) continue;
            const covered = cells.filter(([cr, cc]) => board.shots[cr][cc] === "hit").length;
            const weight = 1 + covered * 25;
            for (const [cr, cc] of cells) if (!board.shots[cr][cc]) scores[cr][cc] += weight;
          }
        }
      }
    }
    return scores;
  }

  function chooseByDensity(ai, board, rng) {
    const scores = densityMap(ai, board);
    let best = [];
    let bestScore = 0;
    for (const [r, c] of allOpen(board)) {
      if (scores[r][c] > bestScore) { bestScore = scores[r][c]; best = [[r, c]]; }
      else if (scores[r][c] === bestScore && bestScore > 0) best.push([r, c]);
    }
    return pickRandom(best, rng);
  }

  function aiChoose(ai, board, options = {}) {
    const rng = options.rng || Math.random;
    const difficulty = assertDifficulty(options.difficulty || ai.difficulty || "normal");
    const open = allOpen(board);
    if (!open.length) return null;

    if (difficulty === "easy") return pickRandom(open, rng);

    if (difficulty === "hard") {
      return chooseByDensity(ai, board, rng) || pickRandom(open, rng);
    }

    while (ai.queue.length) {
      const [r, c] = ai.queue.shift();
      if (inBounds(r, c) && !board.shots[r][c]) return [r, c];
    }
    const parity = open.filter(([r, c]) => (r + c) % 2 === 0);
    return pickRandom(parity.length ? parity : open, rng);
  }

  // Folds a shot result into the AI's memory. Only the sunk ship's own hits are
  // discarded, so a second damaged ship keeps being pursued.
  function aiObserve(ai, r, c, res) {
    if (!res) return;
    if (!inBounds(r, c)) throw new RangeError(`aiObserve: (${r}, ${c}) is off the board`);
    if (res.result === "sunk" && (!res.ship || !Array.isArray(res.ship.cells)))
      throw new TypeError("aiObserve: a sunk result must carry the ship it sank");
    if (res.result === "hit") {
      ai.hits.push([r, c]);
      rebuildQueue(ai);
    } else if (res.result === "sunk") {
      const sunk = res.ship.cells;
      ai.hits = ai.hits.filter((hit) => !includesCell(sunk, hit));
      ai.sunkCells.push(...sunk);
      const i = ai.remaining.indexOf(res.ship.size);
      if (i !== -1) ai.remaining.splice(i, 1);
      rebuildQueue(ai);
    }
  }

  return {
    SIZE, LETTERS, FLEET, coord, inBounds, sameCell, includesCell, pickRandom,
    isSunk, sunkCount, hasShots, emptyBoard, cellsFor, onBoard, canPlace, place,
    placeRandomly, randomPlace, randomFleet, fire, allSunk, makeAI, contiguous,
    rebuildQueue, allOpen, aiChoose, aiObserve, densityMap, DIFFICULTIES,
    assertDifficulty, accuracy,
  };
});
