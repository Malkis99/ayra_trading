// Onboarding steps 1–2 (nickname, language and time zone) at 360px and 1440px; on step 2 also with the zone list open.
// Usage: node scripts/awakening-grid-shots.mjs <outDir> [baseUrl]   (mock build on :3000)
import { chromium } from "@playwright/test";
import fs from "node:fs";

const outDir = process.argv[2] || "docs/screens/awakening-grid/after";
const base = process.argv[3] || "http://localhost:3000";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const [w, h] of [[360, 780], [1440, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem("shots")) return;
    sessionStorage.setItem("shots", "1");
    localStorage.clear();
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/awakening`);
  const nick = page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]');
  await nick.waitFor();
  await nick.fill("Nova_Trader");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/step1-${w}.jpg`, type: "jpeg", quality: 75 });
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/step2-${w}.jpg`, type: "jpeg", quality: 75 });
  const picker = page.getByTestId("timezone-select");
  if (await picker.count()) {
    await picker.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/step2-list-${w}.jpg`, type: "jpeg", quality: 75 });
  }
  await ctx.close();
}
await browser.close();
console.log(`saved to ${outDir}`);
