// Screenshots of Profile → «Coins» at 1440 and 360 with a few credits (mock build on :3000).
// Usage: node scripts/coins-shots.mjs [outDir] [baseUrl]
import { chromium } from "@playwright/test";
import fs from "node:fs";

const outDir = process.argv[2] || "docs/screens/coins-tab";
const base = process.argv[3] || "http://localhost:3000";
fs.mkdirSync(outDir, { recursive: true });

const now = Date.now();
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
const state = {
  name: "CoinsTrader",
  level: 3,
  xp: 120,
  coins: 175,
  createdAt: "2026-10-08",
  completedQuestsToday: {},
  lastQuestDate: new Date().toISOString().slice(0, 10),
  onboarding: { status: "done", step: 5, subStep: 0, answers: {} },
  profile: { appearance: { skinTone: "skin_fair", hairstyle: "hair_buzz", hairColor: "hair_black", outfit: "outfit_obsidian" }, minorMode: false, timezone: "UTC" },
  coinLogSince: at(3 * 24 * 60),
  coinLog: [
    { at: at(5), source: "firstAction", amount: 20, kind: "trade" },
    { at: at(6), source: "quest", amount: 10, questId: "q_tradelog", title: "Запись сделки в журнал" },
    { at: at(60), source: "dailyReward", amount: 15 },
    { at: at(24 * 60), source: "quest", amount: 10, questId: "q_bias", title: "Daily Bias перед сессией" },
    { at: at(25 * 60), source: "firstAction", amount: 10, kind: "account" },
  ],
};

const browser = await chromium.launch();
for (const [w, h] of [[1440, 900], [360, 780]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem("shots")) return;
    sessionStorage.setItem("shots", "1");
    localStorage.clear();
    localStorage.setItem("ayra_demo_v1", JSON.stringify(s));
  }, state);
  const page = await ctx.newPage();
  await page.goto(`${base}/profile?tab=coins`);
  await page.waitForTimeout(1200);
  if (w === 360) {
    await page.evaluate(() => { document.querySelector('[role="tabpanel"]')?.scrollIntoView({ block: "start" }); document.querySelector("main")?.scrollBy(0, -64); });
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: `${outDir}/coins-${w}.jpg`, type: "jpeg", quality: 72 });
  // the «?» opened
  await page.getByTestId("coins-balance-hint").click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${outDir}/coins-hint-${w}.jpg`, type: "jpeg", quality: 72 });
  await ctx.close();
}
await browser.close();
console.log("saved to", outDir);
