// Headless harness: loads the game script from index.html against a stub DOM
// and runs simulations / regression checks. Run: node test/sim.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function makeEl() {
  const el = {
    children: [], innerHTML: "", textContent: "", className: "", scrollTop: 0, scrollHeight: 0,
    classList: { add() {} },
    appendChild(c) { el.children.push(c); },
    addEventListener() {},
  };
  return el;
}
const els = {};
const document = {
  getElementById: (id) => (els[id] = els[id] || makeEl()),
  createElement: () => makeEl(),
};
const timers = [];
const ctx = {
  document,
  window: { addEventListener() {} },
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout: (id) => { if (id) timers[id - 1] = null; },
  console,
};
// `const`/`let` bindings are not context globals, so re-export what the tests need.
const exportTail = `
globalThis.FLEET = FLEET;
globalThis.SIZE = SIZE;
globalThis.coord = coord;
globalThis.allSunk = allSunk;
Object.defineProperty(globalThis, "state", { get: () => state });
`;
vm.createContext(ctx);
vm.runInContext(src + exportTail, ctx);

const g = ctx;
let failures = 0;
const check = (name, ok, extra = "") => {
  if (!ok) { failures++; console.log(`FAIL ${name} ${extra}`); }
  else console.log(`pass ${name}`);
};

// --- unit: placement legality ---
{
  const b = g.emptyBoard();
  check("canPlace off-board rejected", !g.canPlace(b, g.cellsFor(0, 7, 5, true)));
  g.place(b, { name: "Carrier", size: 5 }, g.cellsFor(0, 0, 5, true));
  check("canPlace overlap rejected", !g.canPlace(b, g.cellsFor(0, 2, 3, false)));
  check("canPlace adjacent allowed", g.canPlace(b, g.cellsFor(1, 0, 4, true)));
}

// --- unit: fire results ---
{
  const b = g.emptyBoard();
  g.place(b, { name: "Destroyer", size: 2 }, g.cellsFor(3, 3, 2, true));
  check("miss", g.fire(b, 0, 0).result === "miss");
  check("hit", g.fire(b, 3, 3).result === "hit");
  check("repeat shot returns null", g.fire(b, 3, 3) === null);
  check("sunk", g.fire(b, 3, 4).result === "sunk");
  check("allSunk", g.allSunk(b));
}

// --- unit: coordinate mapping ---
check("coord A1", g.coord(0, 0) === "A1");
check("coord J10", g.coord(9, 9) === "J10");

// --- property: random fleets are always legal ---
{
  let bad = 0;
  for (let i = 0; i < 5000; i++) {
    const b = g.emptyBoard();
    g.randomFleet(b);
    const occupied = b.grid.flat().filter(Boolean).length;
    if (occupied !== 17 || b.ships.length !== 5) bad++;
    for (const s of b.ships) {
      const rows = new Set(s.cells.map(([r]) => r));
      const cols = new Set(s.cells.map(([, c]) => c));
      if (rows.size !== 1 && cols.size !== 1) bad++;
      if (s.cells.some(([r, c]) => r < 0 || r > 9 || c < 0 || c > 9)) bad++;
    }
  }
  check("5000 random fleets legal", bad === 0, `bad=${bad}`);
}

// --- simulation: AI plays out full games ---
function playGame() {
  const board = g.emptyBoard();
  g.randomFleet(board);
  const ai = g.makeAI();
  let shots = 0;
  while (!g.allSunk(board)) {
    const target = ai_pick(ai, board);
    if (!target) throw new Error("AI ran out of targets");
    const [r, c] = target;
    const res = g.fire(board, r, c);
    if (!res) throw new Error("AI repeated a shot at " + g.coord(r, c));
    shots++;
    if (res.result === "hit") { ai.hits.push([r, c]); g.rebuildQueue(ai); }
    else if (res.result === "sunk") {
      ai.hits = ai.hits.filter(([hr, hc]) => !res.ship.cells.some(([sr, sc]) => sr === hr && sc === hc));
      g.rebuildQueue(ai);
    }
    if (shots > 100) throw new Error("game exceeded 100 shots");
  }
  return shots;
}
const ai_pick = (ai, board) => g.aiChoose(ai, board);

{
  let total = 0, worst = 0;
  for (let i = 0; i < 2000; i++) { const s = playGame(); total += s; worst = Math.max(worst, s); }
  const avg = total / 2000;
  console.log(`AI average shots to clear the board: ${avg.toFixed(1)} (worst ${worst})`);
  check("AI average within hunt/target band (<80)", avg < 80, `avg=${avg.toFixed(1)}`);
}

// --- regression A4: sinking one ship keeps targeting the other damaged ship ---
{
  const b = g.emptyBoard();
  g.place(b, { name: "Destroyer", size: 2 }, g.cellsFor(0, 0, 2, true)); // A1-B1
  g.place(b, { name: "Cruiser", size: 3 }, g.cellsFor(1, 0, 3, true));   // A2-C2
  const ai = g.makeAI();
  // AI damages the Cruiser, then sinks the Destroyer
  for (const [r, c] of [[1, 0], [0, 0], [0, 1]]) {
    const res = g.fire(b, r, c);
    if (res.result === "hit") { ai.hits.push([r, c]); g.rebuildQueue(ai); }
    else if (res.result === "sunk") {
      ai.hits = ai.hits.filter(([hr, hc]) => !res.ship.cells.some(([sr, sc]) => sr === hr && sc === hc));
      g.rebuildQueue(ai);
    }
  }
  const next = g.aiChoose(ai, b);
  const adjacentToCruiserHit = next && Math.abs(next[0] - 1) + Math.abs(next[1] - 0) === 1;
  check("A4: resumes on the still-damaged Cruiser after a sink", adjacentToCruiserHit, JSON.stringify(next));
}

// --- regression: two collinear hits lock targeting to the line ends ---
{
  const ai = g.makeAI();
  ai.hits = [[4, 4], [4, 5]];
  g.rebuildQueue(ai);
  const ok = ai.queue.length === 2 && ai.queue.every(([r]) => r === 4);
  check("collinear hits target only the line ends", ok, JSON.stringify(ai.queue));
}

// --- regression L3: New game cancels the pending AI shot ---
{
  g.newGame();
  for (const spec of g.FLEET) {
    // place the player's fleet in rows via the real handler
    const row = g.FLEET.indexOf(spec);
    g.onPlaceClick(row, 0);
  }
  g.onFireClick(0, 0);            // schedules the AI reply
  g.newGame();                    // should cancel it
  timers.filter(Boolean).forEach((fn) => fn());
  const shotsOnFreshBoard = g.state.player.shots.flat().filter(Boolean).length;
  check("L3: no stale AI shot after New game", shotsOnFreshBoard === 0, `shots=${shotsOnFreshBoard}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
