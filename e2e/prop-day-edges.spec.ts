import { test, expect } from "@playwright/test";
import { pickOption } from "./helpers/forms";

// The prop daily limit at day edges (TEST-FIX): the browser clock is fixed per case, the browser and the prop day reset
// use the same zone. A loss of 3000 was closed 10 minutes before «now»; a new loss of 4000 is saved «now».
// - the same prop day: 7000 of a 5000 limit → «limit reached»;
// - a new prop day: 4000 of 5000 → «80% used».
// The prop day starts at the reset hour (17:00 here), not at midnight: midnight, Sunday → Monday, a month end and
// a year end keep one prop day; 17:00 begins the next one.

const OFFSET_H: Record<string, number> = { UTC: 0, "Asia/Tbilisi": 4 }; // Tbilisi has no daylight saving time

const CASES: Array<{ name: string; local: string; sameDay: boolean }> = [
  { name: "evening before midnight", local: "2026-11-18T23:55", sameDay: true },
  { name: "first minutes of a new date", local: "2026-11-19T00:05", sameDay: true },
  { name: "Sunday → Monday", local: "2026-11-23T00:03", sameDay: true },
  { name: "month end", local: "2026-12-01T00:05", sameDay: true },
  { name: "year end", local: "2027-01-01T00:05", sameDay: true },
  { name: "just before the reset hour", local: "2026-11-18T16:58", sameDay: true },
  { name: "just after the reset hour", local: "2026-11-18T17:05", sameDay: false },
];

const CAUTION = "Дневной лимит использован на 80%";
const REACHED = "Лимит дня достигнут: проверь правила своей фирмы";

for (const tz of Object.keys(OFFSET_H)) {
  test.describe(`Prop daily limit at day edges (${tz})`, () => {
    test.use({ timezoneId: tz });

    for (const c of CASES) {
      test(`${c.name}: ${c.local} local`, async ({ context, page }) => {
        const now = new Date(Date.parse(`${c.local}:00Z`) - OFFSET_H[tz] * 3600_000);
        const before = new Date(now.getTime() - 10 * 60_000).toISOString();
        const account = {
          id: "acc_edge",
          name: "Edge Prop",
          type: "prop",
          currency: "USD",
          startBalance: 100000,
          platform: "manual",
          createdAt: "2026-11-01T00:00:00.000Z",
          propRules: {
            phaseLabel: "Phase 1",
            initialBalance: 100000,
            startedAt: "2026-11-01T00:00:00.000Z",
            dayReset: { timezone: tz, hour: 17 },
            maxDailyLoss: { type: "percent", value: 5, base: "initialBalance" },
          },
        };
        const earlier = {
          id: "t_earlier",
          accountId: "acc_edge",
          instrument: "EURUSD",
          direction: "long",
          status: "closed",
          openedAt: before,
          closedAt: before,
          pnlMoney: -3000,
          rMultiple: -1,
          result: "loss",
          emotions: [],
          mistakes: [],
          verification: "unverified",
          source: "manual",
          createdAt: before,
          updatedAt: before,
          schemaVersion: 4,
        };
        await page.clock.install({ time: now });
        await context.addInitScript(
          ({ journal, at }) => {
            if (sessionStorage.getItem("ayra_seeded")) return;
            sessionStorage.setItem("ayra_seeded", "1");
            localStorage.clear();
            localStorage.setItem(
              "ayra_demo_v1",
              JSON.stringify({
                name: "PropTrader",
                level: 1,
                xp: 0,
                coins: 0,
                createdAt: "2026-10-05",
                completedQuestsToday: {},
                lastQuestDate: "",
                firstActions: { trade: at },
                onboarding: { status: "done", step: 5, subStep: 0, answers: {} },
                profile: {
                  appearance: { skinTone: "skin_fair", hairstyle: "hair_buzz", hairColor: "hair_black", outfit: "outfit_obsidian" },
                  minorMode: false,
                  timezone: "UTC",
                },
              })
            );
            localStorage.setItem("ayra_journal_v1", journal);
            localStorage.setItem("ayra_lang", "ru");
          },
          { journal: JSON.stringify({ schemaVersion: 4, accounts: [account], trades: [earlier] }), at: "2026-10-05T10:00:00.000Z" }
        );
        await page.goto("/journal");
        await page.click("button:has-text('Добавить сделку')");
        await pickOption(page, "account-select", "Edge Prop (USD)");
        await page.fill("input[placeholder='XAUUSD, EURUSD...']", "GBPUSD");
        await page.fill("input[placeholder='150 / -50']", "-4000");
        await page.fill("input[placeholder='2.5 / -1']", "-1");
        await page.click("button:has-text('Сохранить сделку')");
        await expect(page.getByText(c.sameDay ? REACHED : CAUTION, { exact: true })).toBeVisible();
      });
    }
  });
}
