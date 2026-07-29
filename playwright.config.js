// @ts-check
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./test",
  testMatch: /.*\.spec\.js/,
  fullyParallel: true,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"] },
});
