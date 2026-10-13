// Captures every main page at 360px and 1440px for design reviews (before/after).
// Usage: node scripts/screenshots.mjs <outDir> [baseUrl]   (needs a mock-auth build running, see docs/redesign-v1.md)
// Options (env): SHOTS_PAGES=home,profile  — only these pages; SHOTS_CUSTOM_CHARACTER=1 — non-default appearance + gear.
//   SHOTS_JOURNAL=1 — seed one trading account and add journal dialog shots (journal-add, journal-add-detailed).
import { chromium } from "@playwright/test";
import fs from "node:fs";

const outDir = process.argv[2] || "docs/redesign/screens/before";
const base = process.argv[3] || "http://localhost:3000";
fs.mkdirSync(outDir, { recursive: true });

const GUEST = {
  name: "TraderDemo",
  level: 4,
  xp: 60,
  coins: 120,
  onboarding: { status: "done", step: 5, answers: { nickname: "TraderDemo" } },
};
if (process.env.SHOTS_CUSTOM_CHARACTER) {
  GUEST.profile = {
    appearance: { skinTone: "skin_deep", hairstyle: "hair_dreads", hairColor: "hair_cyan", outfit: "outfit_crimson" },
  };
}

const ALL_PAGES = [
  ["home", "/"],
  ["journal", "/journal"],
  ["market", "/market"],
  ["quests", "/quests"],
  ["community", "/community"],
  ["academy", "/academy"],
  ["profile", "/profile"],
  ["settings", "/settings"],
  ["plans", "/plans"],
  ["journal-analytics", "/journal?tab=analytics"],
  ["journal-plan", "/journal?tab=plan"],
];
// Dialog shots (viewport only): [name, path, action]
const DIALOGS = process.env.SHOTS_JOURNAL
  ? [
      ["journal-add", "/journal", async (page) => {
        await page.getByRole("button", { name: "Добавить сделку" }).first().click();
      }],
      ["journal-trade-view", "/journal", async (page) => {
        await page.getByRole("button", { name: "Сделки" }).first().click().catch(() => {});
        const row = page.locator("tr", { hasText: "EURUSD" }).first();
        if (await row.isVisible().catch(() => false)) await row.click();
        else await page.locator("text=EURUSD >> visible=true").first().click();
      }],
      ["journal-strategy-modal", "/journal?tab=strategies", async (page) => {
        await page.getByRole("button", { name: /Создать стратегию|Новая стратегия/ }).first().click();
      }],
      ["journal-account-modal", "/journal?tab=accounts", async (page) => {
        await page.getByRole("button", { name: "Добавить счёт" }).first().click();
      }],
      ["journal-no-trade-modal", "/journal", async (page) => {
        const today = page.getByTestId("today-panel");
        const toggle = today.getByRole("button", { name: /Сегодня/ });
        if (await toggle.isVisible().catch(() => false)) await toggle.click();
        await today.getByRole("button", { name: /Не вошёл/ }).click();
      }],
      ["journal-add-detailed", "/journal", async (page) => {
        await page.getByRole("button", { name: "Добавить сделку" }).first().click();
        await page.getByRole("button", { name: /Развернуть всё|Подробно/ }).first().click();
      }],
    ]
  : [];
// Example trades relative to "now" (local machine time = browser time), plus today's plan.
function exampleJournal() {
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const at = (daysAgo, h, m = 10) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m).toISOString();
  const rows = [
    [0, 9, "XAUUSD", "long", 2.1, ["calm"], [], 88, "london"],
    [0, 11, "EURUSD", "short", -1, ["anxious"], ["fomo"], 42, "newyork"],
    [1, 10, "NAS100", "long", 1.6, ["focused"], [], 81, "newyork"],
    [1, 14, "GBPUSD", "short", 0.4, ["calm"], [], 74, "london"],
    [2, 9, "XAUUSD", "short", -1, ["impatient"], ["early_entry"], 51, "london"],
    [3, 15, "BTCUSD", "long", 3.2, ["confident"], [], 92, "overlap"],
    [4, 10, "US30", "long", -0.5, ["calm"], [], 70, "newyork"],
  ];
  const trades = rows.map(([d, h, instrument, direction, r, emotions, mistakes, ps, session], i) => ({
    id: `shot_${i}`, accountId: "acc_shots", instrument, direction, status: "closed",
    openedAt: at(d, h), closedAt: at(d, h, 40), rMultiple: r, pnlMoney: Math.round(r * 250), riskAmount: 250,
    result: r > 0.05 ? "win" : r < -0.05 ? "loss" : "breakeven", emotions, mistakes, processScore: ps, session,
    executionRating: ps > 80 ? 5 : ps > 60 ? 4 : 2, verification: "unverified", source: "manual",
    createdAt: at(d, h), updatedAt: at(d, h), schemaVersion: 3,
  }));
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return {
    schemaVersion: 5,
    accounts: [{ id: "acc_shots", name: "Main", type: "personal", currency: "USD", startBalance: 25000, platform: "manual", createdAt: "2026-01-01T00:00:00.000Z" }],
    trades,
    strategies: [],
    plans: [{
      date: todayKey,
      bias: [{ instrument: "XAUUSD", direction: "bullish" }, { instrument: "EURUSD", direction: "neutral" }],
      levels: [], events: [],
      limits: { maxDailyLoss: { type: "r", value: 3 }, maxTrades: 4 },
      checklist: [{ key: "bias_defined", done: true }, { key: "key_levels_marked", done: true }, { key: "events_checked", done: false }],
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    }],
  };
}
const JOURNAL_SEED = process.env.SHOTS_JOURNAL ? exampleJournal() : null;

const only = process.env.SHOTS_PAGES?.split(",");
const pages = only ? ALL_PAGES.filter(([name]) => only.includes(name)) : ALL_PAGES;

// The app scrolls inside <main>; unlock heights so a full-page shot shows the whole page.
const UNLOCK_CSS = "html,body,.h-screen{height:auto!important;overflow:visible!important} main{overflow:visible!important;flex:none!important}";

async function shoot(page, file) {
  await page.addStyleTag({ content: UNLOCK_CSS });
  await page.waitForTimeout(200);
  await page.screenshot({ path: file, type: "jpeg", quality: 70, fullPage: true });
}

const browser = await chromium.launch();
for (const [w, h] of [[360, 800], [1440, 900]]) {
  // Local guest mode with a finished onboarding: the regular signed-in-like dashboard
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
  await ctx.addInitScript(([seed, journal]) => {
    (window).__AYRA_E2E_AUTH_MOCK__ = true;
    if (localStorage.getItem("shots_seeded")) return;
    localStorage.setItem("shots_seeded", "1");
    localStorage.setItem("ayra_guest_dismissed", "1");
    localStorage.setItem("ayra_demo_v1", JSON.stringify(seed));
    if (journal) localStorage.setItem("ayra_journal_v1", JSON.stringify(journal));
  }, [GUEST, JOURNAL_SEED]);
  const page = await ctx.newPage();
  for (const [name, path] of pages) {
    await page.goto(base + path);
    await page.waitForTimeout(1200);
    await shoot(page, `${outDir}/${name}-${w}.jpg`);
  }
  for (const [name, path, action] of DIALOGS) {
    if (only && !only.includes(name)) continue;
    await page.goto(base + path);
    await page.waitForTimeout(1000);
    await action(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/${name}-${w}.jpg`, type: "jpeg", quality: 70 });
  }
  await ctx.close();

  if (only) continue;
  // Public visitor: login and public home; fresh device: awakening
  const pub = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
  await pub.addInitScript(() => { (window).__AYRA_E2E_AUTH_MOCK__ = true; });
  const p2 = await pub.newPage();
  for (const [name, path] of [["home-public", "/"], ["login", "/login"], ["awakening", "/awakening"]]) {
    await p2.goto(base + path);
    await p2.waitForTimeout(1200);
    await shoot(p2, `${outDir}/${name}-${w}.jpg`);
  }
  await pub.close();
}
await browser.close();
console.log(`saved to ${outDir}`);
