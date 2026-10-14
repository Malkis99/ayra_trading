// Screenshots of /profile at 360px and 1440px: every tab, the background picker and an open equipment slot.
// Usage: node scripts/profile-shots.mjs <outDir> [baseUrl] [--old]   (mock build on :3000)
// --old: the layout before this PR (hero + tabs Обзор, Персонаж, Гардероб, Достижения, Настройки).
import { chromium } from "@playwright/test";
import fs from "node:fs";

const outDir = process.argv[2] || "docs/screens/profile-stage/after";
const base = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "http://localhost:3000";
const old = process.argv.includes("--old");
fs.mkdirSync(outDir, { recursive: true });

const TABS = old
  ? [["overview", "Обзор"], ["character", "Персонаж"], ["wardrobe", "Гардероб"], ["achievements", "Достижения"], ["settings", "Настройки"]]
  : [["overview", "Обзор"], ["stats", "Статистика"], ["wardrobe", "Гардероб"], ["achievements", "Достижения"], ["edit", "Редактировать профиль"]];

const browser = await chromium.launch();
for (const [w, h] of [[360, 780], [1440, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem("shots")) return;
    sessionStorage.setItem("shots", "1");
    localStorage.clear();
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/profile`);
  await page.waitForTimeout(1200);
  for (const [id, name] of TABS) {
    await page.getByRole("tab", { name, exact: true }).click();
    await page.waitForTimeout(600);
    if (w === 360) {
      // phones: show the tab content (scroll the app's main area to the tab panel)
      await page.evaluate(() => document.querySelector('[role="tabpanel"]')?.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: `${outDir}/${id}-${w}.jpg`, type: "jpeg", quality: 72 });
    if (w === 360) await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 0));
  }
  if (!old) {
    await page.getByRole("tab", { name: "Обзор", exact: true }).click();
    await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 0));
    // background picker: choose another open background
    await page.locator('[data-testid="stage-bg-option"][data-bg="deep_space"]').click();
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('[data-testid="stage-bg-option"]')?.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${outDir}/background-${w}.jpg`, type: "jpeg", quality: 72 });
    // equipment slot with the chooser open
    await page.locator('[data-testid="stage-slot"][data-slot="Верх"]').filter({ visible: true }).first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/slot-${w}.jpg`, type: "jpeg", quality: 72 });
  }
  await ctx.close();
}
await browser.close();
console.log(`saved to ${outDir}`);
