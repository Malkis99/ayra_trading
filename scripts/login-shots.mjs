// Sign-in screen in RU and EN at several widths (checks the background for spots/bands on wide screens).
// Usage: node scripts/login-shots.mjs <outDir> [baseUrl]   (mock build on :3000)
import { chromium } from "@playwright/test";
import fs from "node:fs";

const outDir = process.argv[2] || "docs/screens/login-header/after";
const base = process.argv[3] || "http://localhost:3000";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const lang of ["ru", "en"]) {
  for (const [w, h] of [[360, 780], [768, 1024], [1440, 900], [1920, 1080], [2560, 1440]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(() => {
      window.__AYRA_E2E_AUTH_MOCK__ = true;
    });
    const page = await ctx.newPage();
    await page.goto(`${base}/login`);
    if (lang === "en") await page.getByRole("button", { name: "EN", exact: true }).click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${outDir}/login-${lang}-${w}.jpg`, type: "jpeg", quality: 78 });
    await ctx.close();
  }
}
await browser.close();
console.log(`saved to ${outDir}`);
