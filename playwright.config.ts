import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: process.env.QA_TEST_DIR || "./tests/e2e",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  use: {
    baseURL: process.env.QA_BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: process.env.QA_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
