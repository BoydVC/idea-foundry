import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    viewport: { width: 1280, height: 800 },
    baseURL: "http://127.0.0.1:4440",
  },
  webServer: {
    command: "npx tsx src/server.ts",
    url: "http://127.0.0.1:4440/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      FOUNDRY_DATA: "data/e2e",
      FOUNDRY_FRESH: "1",
      FOUNDRY_SEED: "1",
      PORT: "4440",
    },
  },
});
