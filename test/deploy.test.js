// The GitHub Pages artifact is assembled by scripts/build-site.sh. A script that
// index.html loads but the artifact omits produces a page that dies on load, so
// the packaging is checked here rather than after a deploy.
// Run: node --test test/deploy.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const scriptSrcs = [...HTML.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);

test("index.html loads the scripts the game needs", () => {
  assert.ok(scriptSrcs.length >= 3, "expected game.js, sound.js and ui.js");
  for (const src of scriptSrcs) {
    assert.ok(fs.existsSync(path.join(ROOT, src)), `${src} is referenced but missing`);
  }
});

test("the packaged site contains every script index.html references", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "battleship-site-"));
  try {
    execFileSync(path.join(ROOT, "scripts", "build-site.sh"), [out], { stdio: "pipe" });
    for (const src of ["index.html", ...scriptSrcs]) {
      assert.ok(fs.existsSync(path.join(out, src)), `${src} is missing from the packaged site`);
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("the Pages workflow packages the site with the build script", () => {
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "pages.yml"), "utf8");
  assert.match(workflow, /scripts\/build-site\.sh/, "pages.yml must not hand-maintain a copy list");
});
