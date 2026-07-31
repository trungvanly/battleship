// DOM tests for the cases in TEST-SPEC.md section 3.
// Run: npx playwright test
const { test, expect } = require("@playwright/test");
const path = require("path");

const PAGE = "file://" + path.join(__dirname, "..", "index.html");
// ?delay=0 removes the AI's 600ms thinking pause so tests don't race it.
const fast = PAGE + "?delay=0";

const cell = (page, board, coord) => page.locator(`#${board} .cell[data-coord="${coord}"]`);
const logText = (page) => page.locator("#log").innerText();
const status = (page) => page.locator("#status").innerText();
const state = (page, fn) => page.evaluate(fn);

async function placeFleet(page) {
  for (const c of ["A1", "A2", "A3", "A4", "A5"]) await cell(page, "player", c).click();
}

test.describe("placement", () => {
  test.beforeEach(async ({ page }) => page.goto(fast));

  test("P1: a legal horizontal placement occupies the expected cells", async ({ page }) => {
    await cell(page, "player", "A1").click();
    for (const c of ["A1", "B1", "C1", "D1", "E1"]) {
      await expect(cell(page, "player", c)).toHaveClass(/ship/);
    }
    expect(await status(page)).toContain("Placing Battleship");
  });

  test("P2: an overhanging placement is rejected", async ({ page }) => {
    await cell(page, "player", "H1").click();
    expect(await logText(page)).toContain("hang off the board");
    expect(await status(page)).toContain("Placing Carrier");
  });

  test("P3/P5: rotate places the ship vertically", async ({ page }) => {
    await page.click("#rotate");
    await expect(page.locator("#rotate")).toHaveText("Rotate: vertical");
    await cell(page, "player", "A1").click();
    for (const c of ["A1", "A2", "A3", "A4", "A5"]) {
      await expect(cell(page, "player", c)).toHaveClass(/ship/);
    }
  });

  test("P4: an overlapping placement is rejected", async ({ page }) => {
    await cell(page, "player", "A1").click();
    await cell(page, "player", "B1").click();
    expect(await logText(page)).toContain("would overlap another ship");
    expect(await status(page)).toContain("Placing Battleship");
  });

  test("P5: the R hotkey toggles orientation", async ({ page }) => {
    await page.keyboard.press("r");
    await expect(page.locator("#rotate")).toHaveText("Rotate: vertical");
    await page.keyboard.press("r");
    await expect(page.locator("#rotate")).toHaveText("Rotate: horizontal");
  });

  test("P6: finishing placement unlocks firing", async ({ page }) => {
    await placeFleet(page);
    expect(await logText(page)).toContain("Fleet ready");
    expect(await status(page)).toContain("Your turn");
  });

  test("P7: the enemy grid is inert during placement", async ({ page }) => {
    await cell(page, "enemy", "E5").click();
    expect(await state(page, () => __battleship.state.enemy.shots.flat().filter(Boolean).length)).toBe(0);
  });

  test("P8: ships cannot be moved once the fleet is set", async ({ page }) => {
    await placeFleet(page);
    const before = await state(page, () => JSON.stringify(__battleship.state.player.ships.map((s) => s.cells)));
    await cell(page, "player", "F6").click();
    const after = await state(page, () => JSON.stringify(__battleship.state.player.ships.map((s) => s.cells)));
    expect(after).toBe(before);
  });
});

test.describe("firing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(fast);
    await placeFleet(page);
    // Deterministic enemy fleet: one Destroyer-length target we control.
    await state(page, () => {
      const s = __battleship.state;
      s.enemy = emptyBoard();
      place(s.enemy, { name: "Carrier", size: 5 }, cellsFor(0, 0, 5, true));
      place(s.enemy, { name: "Battleship", size: 4 }, cellsFor(2, 0, 4, true));
      place(s.enemy, { name: "Cruiser", size: 3 }, cellsFor(4, 0, 3, true));
      place(s.enemy, { name: "Submarine", size: 3 }, cellsFor(6, 0, 3, true));
      place(s.enemy, { name: "Destroyer", size: 2 }, cellsFor(8, 0, 2, true));
    });
    await state(page, () => __battleship.render());
  });

  test("F1: firing an empty cell is a miss and the AI replies once", async ({ page }) => {
    await cell(page, "enemy", "J10").click();
    await expect(cell(page, "enemy", "J10")).toHaveClass(/miss/);
    expect(await logText(page)).toContain("You fire at J10 — miss");
    await expect
      .poll(async () => ((await logText(page)).match(/Enemy fires/g) || []).length)
      .toBe(1);
  });

  test("F2: firing a ship cell is a hit", async ({ page }) => {
    await cell(page, "enemy", "A1").click();
    await expect(cell(page, "enemy", "A1")).toHaveClass(/hit/);
    expect(await logText(page)).toContain("You fire at A1 — HIT");
  });

  test("F3/F9: sinking a ship is announced and only then revealed in the fleet list", async ({ page }) => {
    await expect(page.locator("#enemyFleet")).toContainText("Destroyer (2)");
    await cell(page, "enemy", "A9").click();
    expect(await page.locator("#enemyFleet").innerText()).not.toContain("SUNK");
    await cell(page, "enemy", "B9").click();
    expect(await logText(page)).toContain("You sank their Destroyer!");
    await expect(cell(page, "enemy", "A9")).toHaveClass(/sunk/);
    await expect(page.locator("#enemyFleet")).toContainText("Destroyer (2) — SUNK");
  });

  test("F4: clicking an already-fired cell does nothing", async ({ page }) => {
    await cell(page, "enemy", "J10").click();
    const shotsBefore = await state(page, () => __battleship.state.enemy.shots.flat().filter(Boolean).length);
    await cell(page, "enemy", "J10").click();
    const shotsAfter = await state(page, () => __battleship.state.enemy.shots.flat().filter(Boolean).length);
    expect(shotsAfter).toBe(shotsBefore);
    expect(await logText(page)).toContain("You already fired at J10");
  });

  test("a failure during the enemy turn is reported and hands the turn back", async ({ page }) => {
    await state(page, () => {
      __battleship.state.difficulty = "nightmare";
      __battleship.state.turn = "player";
    });
    await cell(page, "enemy", "J10").click();
    await expect(page.locator("#log")).toContainText("Something went wrong (the enemy's turn)");
    expect(await state(page, () => __battleship.state.turn)).toBe("player");
  });

  test("F5/F6: turns stay alternating under rapid clicking", async ({ page }) => {
    await Promise.all([
      cell(page, "enemy", "J10").click(),
      cell(page, "enemy", "J9").click(),
      cell(page, "enemy", "J8").click(),
    ]);
    const { mine, theirs } = await state(page, () => ({
      mine: __battleship.state.enemy.shots.flat().filter(Boolean).length,
      theirs: __battleship.state.player.shots.flat().filter(Boolean).length,
    }));
    expect(mine - theirs).toBeGreaterThanOrEqual(0);
    expect(mine - theirs).toBeLessThanOrEqual(1);
  });

  test("F7: sinking the whole enemy fleet wins and locks the board", async ({ page }) => {
    // Sink everything except the Destroyer's last cell, which the UI click takes.
    await state(page, () => {
      const s = __battleship.state;
      s.enemy.ships.forEach((ship, i) => {
        const cells = i === s.enemy.ships.length - 1 ? ship.cells.slice(0, -1) : ship.cells;
        cells.forEach(([r, c]) => fire(s.enemy, r, c));
      });
      __battleship.render();
    });
    await cell(page, "enemy", "B9").click();
    expect(await status(page)).toBe("You win!");
    expect(await logText(page)).toContain("All enemy ships sunk.");
    const shots = await state(page, () => __battleship.state.player.shots.flat().filter(Boolean).length);
    await page.waitForTimeout(100);
    expect(await state(page, () => __battleship.state.player.shots.flat().filter(Boolean).length)).toBe(shots);
  });

  test("F8: the AI winning ends the game", async ({ page }) => {
    // Sink all but one player cell and point the AI straight at it.
    await state(page, () => {
      const s = __battleship.state;
      const last = s.player.ships[s.player.ships.length - 1];
      const survivor = last.cells[last.cells.length - 1];
      s.player.ships.forEach((ship) => {
        ship.cells.forEach(([r, c]) => {
          if (r !== survivor[0] || c !== survivor[1]) fire(s.player, r, c);
        });
      });
      s.ai.queue = [survivor];
      __battleship.render();
    });
    await cell(page, "enemy", "J10").click();
    await expect.poll(() => status(page)).toBe("Enemy wins!");
  });
});

test.describe("setup aids", () => {
  test.beforeEach(async ({ page }) => page.goto(fast));

  test("S1: Random placement fills the whole fleet legally", async ({ page }) => {
    await page.click("#random");
    const cells = await state(page, () => __battleship.state.player.grid.flat().filter(Boolean).length);
    expect(cells).toBe(17);
    expect(await status(page)).toContain("Your turn");
    expect(await logText(page)).toContain("Fleet placed randomly.");
    await expect(page.locator("#random")).toBeDisabled();
  });

  test("S2: Random placement only fills the ships still unplaced", async ({ page }) => {
    await cell(page, "player", "A1").click();
    await page.click("#random");
    for (const c of ["A1", "B1", "C1", "D1", "E1"]) {
      await expect(cell(page, "player", c)).toHaveClass(/ship/);
    }
    expect(await state(page, () => __battleship.state.player.ships.length)).toBe(5);
  });

  test("S3: Undo removes the last ship and is disabled at the extremes", async ({ page }) => {
    await expect(page.locator("#undo")).toBeDisabled();
    await cell(page, "player", "A1").click();
    await page.click("#undo");
    await expect(cell(page, "player", "A1")).not.toHaveClass(/ship/);
    expect(await logText(page)).toContain("Carrier removed.");
    expect(await status(page)).toContain("Placing Carrier");
    await expect(page.locator("#undo")).toBeDisabled();
  });

  test("S4: Undo is unavailable once shots have been fired", async ({ page }) => {
    await page.click("#random");
    await cell(page, "enemy", "J10").click();
    await expect(page.locator("#undo")).toBeDisabled();
  });

  test("S5: hovering previews the placement, green when legal and red when not", async ({ page }) => {
    await cell(page, "player", "A1").hover();
    for (const c of ["A1", "B1", "C1", "D1", "E1"]) {
      await expect(cell(page, "player", c)).toHaveClass(/preview-ok/);
    }
    await cell(page, "player", "H1").hover();
    await expect(cell(page, "player", "H1")).toHaveClass(/preview-bad/);
    await expect(cell(page, "player", "A1")).not.toHaveClass(/preview-ok/);
  });

  test("S6: dragging a ship from the fleet list places it", async ({ page }) => {
    await page.locator('#playerFleet li[data-ship="Destroyer"]').dragTo(cell(page, "player", "C3"));
    for (const c of ["C3", "D3"]) {
      await expect(cell(page, "player", c)).toHaveClass(/ship/);
    }
    expect(await logText(page)).toContain("Destroyer placed at C3.");
    expect(await status(page)).toContain("Placing Carrier");
  });

  test("S7: a placed ship is no longer draggable", async ({ page }) => {
    await page.click("#random");
    await expect(page.locator('#playerFleet li[data-ship="Destroyer"]')).not.toHaveAttribute("draggable", "true");
  });
});

test.describe("difficulty and stats", () => {
  test("D1: the chosen difficulty drives the AI and locks once firing starts", async ({ page }) => {
    await page.goto(fast);
    await page.selectOption("#difficulty", "hard");
    await page.click("#random");
    expect(await state(page, () => __battleship.state.ai.difficulty)).toBe("hard");
    await expect(page.locator("#difficulty")).toBeDisabled();
  });

  test("D2: New game keeps the selected difficulty", async ({ page }) => {
    await page.goto(fast);
    await page.selectOption("#difficulty", "easy");
    await page.click("#new");
    expect(await state(page, () => __battleship.state.difficulty)).toBe("easy");
  });

  test("D3: stats appear after the first shot and track accuracy", async ({ page }) => {
    await page.goto(fast);
    await page.click("#random");
    expect(await page.locator("#stats").innerText()).toBe("");
    await state(page, () => {
      const s = __battleship.state;
      s.enemy = emptyBoard();
      place(s.enemy, { name: "Destroyer", size: 2 }, cellsFor(0, 0, 2, true));
      __battleship.render();
    });
    await cell(page, "enemy", "A1").click();   // hit
    await cell(page, "enemy", "J10").click();  // miss
    const stats = await page.locator("#stats").innerText();
    expect(stats).toContain("You");
    expect(stats).toContain("50%");
  });

  test("D4: winning prints an end-of-game summary", async ({ page }) => {
    await page.goto(fast);
    await page.click("#random");
    await state(page, () => {
      const s = __battleship.state;
      s.enemy = emptyBoard();
      place(s.enemy, { name: "Destroyer", size: 2 }, cellsFor(0, 0, 2, true));
      __battleship.render();
    });
    await cell(page, "enemy", "A1").click();
    await cell(page, "enemy", "B1").click();
    expect(await status(page)).toBe("You win!");
    const summary = await page.locator("#stats .summary").innerText();
    expect(summary).toContain("All enemy ships sunk.");
    expect(summary).toContain("Difficulty: normal");
  });
});

test.describe("lifecycle", () => {
  test("L1/L2: New game clears both boards", async ({ page }) => {
    await page.goto(fast);
    await placeFleet(page);
    await cell(page, "enemy", "J10").click();
    await page.click("#new");
    expect(await status(page)).toContain("Placing Carrier");
    const counts = await state(page, () => ({
      ships: __battleship.state.player.ships.length,
      mine: __battleship.state.enemy.shots.flat().filter(Boolean).length,
      theirs: __battleship.state.player.shots.flat().filter(Boolean).length,
    }));
    expect(counts).toEqual({ ships: 0, mine: 0, theirs: 0 });
  });

  test("L3: New game cancels the pending AI shot (regression)", async ({ page }) => {
    await page.goto(PAGE); // full 600ms delay, so the timer is genuinely in flight
    await placeFleet(page);
    await cell(page, "enemy", "J10").click();
    await page.click("#new");
    await page.waitForTimeout(1200);
    expect(await state(page, () => __battleship.state.player.shots.flat().filter(Boolean).length)).toBe(0);
    expect(await logText(page)).not.toContain("Enemy fires");
  });

  test("L4: reloading starts a fresh game", async ({ page }) => {
    await page.goto(fast);
    await placeFleet(page);
    await page.reload();
    expect(await status(page)).toContain("Placing Carrier");
  });
});
