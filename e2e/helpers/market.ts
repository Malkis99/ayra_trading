import type { Browser, Page } from "@playwright/test";
import { stubTradingView } from "./tradingview";

/**
 * A guest on the Market (Tbilisi, onboarding done), TradingView stubbed (no real network). `scripts` collects every
 * TradingView request; `minor` turns on the 16–17 mode.
 */
export async function marketGuest(
  browser: Browser,
  width: number,
  opts: { minor?: boolean; tradingView?: "ok" | "unavailable"; height?: number } = {}
): Promise<{ page: Page; scripts: string[] }> {
  const context = await browser.newContext({ viewport: { width, height: opts.height ?? 900 }, timezoneId: "Asia/Tbilisi", reducedMotion: "reduce" });
  await stubTradingView(context, opts.tradingView ?? "ok");
  const page = await context.newPage();
  const scripts: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("tradingview")) scripts.push(r.url());
  });
  await page.addInitScript(
    ({ minor }) => {
      if (sessionStorage.getItem("e2e_seeded")) return;
      sessionStorage.setItem("e2e_seeded", "1");
      localStorage.clear();
      localStorage.setItem(
        "ayra_demo_v1",
        JSON.stringify({
          name: "MarketTrader",
          level: 1,
          xp: 0,
          coins: 0,
          createdAt: "2026-10-08",
          completedQuestsToday: {},
          lastQuestDate: "2026-10-08",
          onboarding: { status: "done", step: 5, subStep: 0, answers: {} },
          profile: { appearance: { skinTone: "skin_fair", hairstyle: "hair_buzz", hairColor: "hair_black", outfit: "outfit_obsidian" }, minorMode: minor, timezone: "Asia/Tbilisi" },
        })
      );
    },
    { minor: !!opts.minor }
  );
  return { page, scripts };
}
