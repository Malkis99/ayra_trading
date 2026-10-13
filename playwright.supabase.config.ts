import { defineConfig, devices } from "@playwright/test";

// Real magic-link (PKCE) flow against a local fake Supabase server and a production build.
export default defineConfig({
  testDir: "./e2e-supabase",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3001",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node e2e/fake-supabase/run-app.mjs",
    url: "http://localhost:3001/login",
    reuseExistingServer: !process.env.CI,
    timeout: 300 * 1000,
  },
});
