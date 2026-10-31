import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4440",
    viewport: { width: 1100, height: 800 },
  },
  webServer: {
    command: "rm -rf .tmp/e2e && node src/cli.ts serve --port 4440 --data .tmp/e2e --seed",
    url: "http://127.0.0.1:4440/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
