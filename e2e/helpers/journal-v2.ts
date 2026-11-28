import type { Page } from "@playwright/test";

/** Synthetic local fixtures only; no cloud requests or production user records. */
export async function seedJournalV2(page: Page, lang = "ru") {
  await page.addInitScript(({ lang }) => {
    if (sessionStorage.getItem("j21-seeded")) return;
    sessionStorage.setItem("j21-seeded", "1");
    localStorage.clear(); localStorage.setItem("ayra_guest_dismissed", "1"); localStorage.setItem("ayra_lang", lang);
    localStorage.setItem("ayra_demo_v1", JSON.stringify({ name: "JournalTester", onboarding: { status: "done", step: 5, answers: {} }, profile: { timezone: "Asia/Tbilisi" } }));
    const base = { accountId: "usd", direction: "long", status: "closed", emotions: [], mistakes: [], source: "manual", verification: "unverified", schemaVersion: 5 };
    const trade = (id: string, instrument: string, date: string, pnl: number, extra = {}) => ({ ...base, id, instrument, openedAt: date, closedAt: date, createdAt: date, updatedAt: date, pnlMoney: pnl, rMultiple: pnl / 100, result: pnl > 0 ? "win" : pnl < 0 ? "loss" : "breakeven", ...extra });
    localStorage.setItem("ayra_journal_v1", JSON.stringify({ schemaVersion: 5, accounts: [
      { id: "usd", name: "Main USD", type: "personal", currency: "USD", startBalance: 10000, platform: "manual", createdAt: "2026-01-01T00:00:00Z" },
      { id: "eur", name: "Second EUR", type: "personal", currency: "EUR", startBalance: 10000, platform: "manual", createdAt: "2026-01-01T00:00:00Z" },
    ], trades: [
      trade("eur-win", "EURUSD", "2026-11-27T23:30:00Z", 200, { strategyId: "strategy", processScore: 90 }),
      trade("gold-loss", "XAUUSD", "2026-11-27T23:15:00Z", -50, { direction: "short", processScore: 40, mistakes: ["fomo"] }),
      trade("euro-account", "GBPUSD", "2026-11-27T22:00:00Z", 75, { accountId: "eur" }),
      trade("previous", "NAS100", "2026-11-26T10:00:00Z", 100),
    ], strategies: [{ id: "strategy", name: "Test Strategy", rules: [], tags: [], color: "#a38ad1", version: 1, createdAt: "2026-01-01T00:00:00Z" }], plans: [], noTrades: [], notes: [] }));
  }, { lang });
}
