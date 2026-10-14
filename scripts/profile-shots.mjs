// Screenshots of /profile: the hero and every tab at 360px and 1440px (guest on this device).
// Usage: node scripts/profile-shots.mjs <outDir> [baseUrl] [--old]
// --old: the previous profile (tabs Обзор, Гардероб, Достижения, Хроника, Посты, Статистика).
import { chromium } from "@playwright/test";
import fs from "node:fs";

const outDir = process.argv[2] || "docs/screens/profile/after";
const base = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "http://localhost:3000";
const old = process.argv.includes("--old");
fs.mkdirSync(outDir, { recursive: true });

const TABS = old
  ? [["overview", "Обзор"], ["wardrobe", "Гардероб"], ["achievements", "Достижения"], ["stats", "Статистика"]]
  : [["overview", "Обзор"], ["character", "Персонаж"], ["wardrobe", "Гардероб"], ["achievements", "Достижения"], ["settings", "Настройки"]];

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
    const tab = page.getByRole("tab", { name }).or(page.getByRole("button", { name, exact: true })).last();
    await tab.click();
    await page.waitForTimeout(600);
    if (!old && id === "wardrobe" && w === 1440) {
      // show one equipped item
      const first = page.locator('[data-testid="wardrobe-item"][data-state="available"]').first();
      if (await first.count()) await first.getByRole("button").click();
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: `${outDir}/${id}-${w}.jpg`, type: "jpeg", quality: 72, fullPage: w === 360 });
  }
  await ctx.close();
}
await browser.close();
console.log(`saved to ${outDir}`);
