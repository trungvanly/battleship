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

  const onBoard = (cells) =>
    cells.every(([r, c]) => r >= 0 && r < SIZE && c >= 0 && c < SIZE);

  function canPlace(board, cells) {
    return onBoard(cells) && cells.every(([r, c]) => !board.grid[r][c]);
  }

  function place(board, spec, cells) {
    const ship = { name: spec.name, size: spec.size, cells, hits: 0 };
    board.ships.push(ship);
    cells.forEach(([r, c]) => (board.grid[r][c] = ship));
    return ship;
  }

  function randomFleet(board, rng = Math.random) {
    for (const spec of FLEET) {
      let placed = false;
      while (!placed) {
        const horizontal = rng() < 0.5;
        const r = Math.floor(rng() * SIZE);
        const c = Math.floor(rng() * SIZE);
        const cells = cellsFor(r, c, spec.size, horizontal);
        if (canPlace(board, cells)) { place(board, spec, cells); placed = true; }
      }
    }
    return board;
  }

  function fire(board, r, c) {
    if (board.shots[r][c]) return null;
    const ship = board.grid[r][c];
    board.shots[r][c] = ship ? "hit" : "miss";
    if (!ship) return { result: "miss" };
    ship.hits++;
    return { result: ship.hits === ship.size ? "sunk" : "hit", ship };
  }

  const allSunk = (board) => board.ships.every((s) => s.hits === s.size);

  // ---- AI targeting: hunt/target with parity ----
  const makeAI = () => ({ queue: [], hits: [] });

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
    if (hits.length > 1 && rows.every((r) => r === rows[0]) && contiguous(cols)) {
      const sorted = [...cols].sort((a, b) => a - b);
      ai.queue.push([rows[0], sorted[0] - 1], [rows[0], sorted[sorted.length - 1] + 1]);
      return;
    }
    if (hits.length > 1 && cols.every((c) => c === cols[0]) && contiguous(rows)) {
      const sorted = [...rows].sort((a, b) => a - b);
      ai.queue.push([sorted[0] - 1, cols[0]], [sorted[sorted.length - 1] + 1, cols[0]]);
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

  function aiChoose(ai, board, rng = Math.random) {
    while (ai.queue.length) {
      const [r, c] = ai.queue.shift();
      if (r >= 0 && r < SIZE && c >= 0 && c < SIZE && !board.shots[r][c]) return [r, c];
    }
    const parity = allOpen(board).filter(([r, c]) => (r + c) % 2 === 0);
    const pool = parity.length ? parity : allOpen(board);
    return pool.length ? pool[Math.floor(rng() * pool.length)] : null;
  }

  // Folds a shot result into the AI's memory. Only the sunk ship's own hits are
  // discarded, so a second damaged ship keeps being pursued.
  function aiObserve(ai, r, c, res) {
    if (!res) return;
    if (res.result === "hit") {
      ai.hits.push([r, c]);
      rebuildQueue(ai);
    } else if (res.result === "sunk") {
      const sunk = res.ship.cells;
      ai.hits = ai.hits.filter(([hr, hc]) => !sunk.some(([sr, sc]) => sr === hr && sc === hc));
      rebuildQueue(ai);
    }
  }

  return {
    SIZE, LETTERS, FLEET, coord, emptyBoard, cellsFor, onBoard, canPlace, place,
    randomFleet, fire, allSunk, makeAI, contiguous, rebuildQueue, allOpen,
    aiChoose, aiObserve,
  };
});
