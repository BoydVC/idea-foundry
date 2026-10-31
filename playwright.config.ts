import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:4440",
    viewport: { width: 1280, height: 800 },
    video: "on",
  },
  webServer: {
    command: "rm -rf .data-e2e && FOUNDRY_DATA=.data-e2e PORT=4440 node --experimental-strip-types src/server.ts",
    url: "http://127.0.0.1:4440/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
