// Starts the fake Supabase server, then builds and serves a production build of the app wired to it.
// Used as the webServer of playwright.supabase.config.ts; works on Windows and Unix (no shell env syntax).
import { spawn } from "node:child_process";
import { createFakeSupabase } from "./server.mjs";

const SUPABASE_PORT = Number(process.env.FAKE_SUPABASE_PORT || 54329);
const APP_PORT = Number(process.env.APP_PORT || 3001);

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${SUPABASE_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fake-anon-key",
  NEXT_PUBLIC_SITE_URL: `http://localhost:${APP_PORT}`,
  AYRA_NEXT_DIST_DIR: ".next-e2e-supabase",
  // registration and «Forgot password» are tested here even while production waits for SMTP (lib/auth/email-sending.ts)
  NEXT_PUBLIC_AYRA_E2E_EMAIL_OPEN: "1",
  NEXT_PUBLIC_MARKET_RELEASE_CHECKS: "1",
  // Q4.2: the shadow mission check is tested here (production keeps it off until the owner turns it on)
  NEXT_PUBLIC_AYRA_MISSION_SHADOW: "1",
  // Q4.4: the server day API and the switch of the economy owner are tested here (production keeps them off); the
  // fake server answers like the real Supabase without 0014–0016 unless a test installs its stand-in
  NEXT_PUBLIC_AYRA_SERVER_ECONOMY: "1",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
};
delete env.AYRA_E2E_AUTH_MOCK;
delete env.NEXT_PUBLIC_AYRA_E2E_AUTH_MOCK;

createFakeSupabase().listen(SUPABASE_PORT, () => console.log(`[fake-supabase] listening on ${SUPABASE_PORT}`));

const run = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn("npx", ["next", ...args], { env, stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`next ${args[0]} exited with ${code}`))));
  });

if (!process.env.SKIP_BUILD) await run(["build"]);
await run(["start", "-p", String(APP_PORT)]);
