import { expect, type BrowserContext, type Page } from "@playwright/test";

/** Game state as saved on the device (guest space). */
export type SavedGame = {
  xp: number;
  level: number;
  coins: number;
  rev?: number;
  completedQuestsToday: Record<string, boolean>;
  replacementsUsedToday: number;
  questReplacements?: Record<string, string>;
  lastQuestDate: string;
  isRestDay: boolean;
  history: Array<{ questId: string; xp: number; coins: number; completedAt: string; at?: string }>;
  customGoals: Array<{ id: string; title: string }>;
  rewardedScreenshotHashes?: string[];
  dailyStats: Record<string, { isRestDay: boolean; xpGained: number; coinsGained: number }>;
};

export const readGame = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ayra_demo_v1") || "{}")) as Promise<SavedGame>;

/** XP counted across level-ups (need(lv) = 80 + 40·lv). */
export const totalXp = (g: Pick<SavedGame, "xp" | "level">) => {
  let sum = g.xp;
  for (let lv = 1; lv < g.level; lv++) sum += 80 + lv * 40;
  return sum;
};

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

/** A seeded game for the whole context (each new tab reads the same saved state; written once per tab session). */
export async function seedGame(ctx: BrowserContext, game: Record<string, unknown>, extra: Record<string, string> = {}) {
  await ctx.addInitScript(
    ({ game, extra }) => {
      if (sessionStorage.getItem("ayra_seeded")) return;
      sessionStorage.setItem("ayra_seeded", "1");
      if (localStorage.getItem("ayra_e2e_seed_done")) return; // a second tab keeps what the first one saved
      localStorage.clear();
      localStorage.setItem("ayra_e2e_seed_done", "1");
      localStorage.setItem("ayra_demo_v1", JSON.stringify(game));
      localStorage.setItem("ayra_lang", "ru");
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
    },
    { game, extra }
  );
}

export function baseGame(over: Record<string, unknown> = {}) {
  return {
    name: "QuestTrader",
    level: 1,
    xp: 0,
    coins: 0,
    createdAt: "2026-10-01",
    completedQuestsToday: {},
    lastQuestDate: "",
    onboarding: { status: "done", step: 5, subStep: 0, answers: {} },
    profile: { appearance: { skinTone: "skin_fair", hairstyle: "hair_buzz", hairColor: "hair_black", outfit: "outfit_obsidian" }, minorMode: false, timezone: "UTC" },
    ...over,
  };
}

/** Opens the bonus quests on «Today» (closed by default), so every quest of the day is on screen. */
export async function expandBonus(page: Page) {
  const toggle = page.getByRole("button", { name: /^Бонусные задания/ });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

/** The first self-reported (ticked by hand) quest card on «Today» that is not done yet (bonus quests opened). */
export async function firstSelfQuest(page: Page) {
  await expandBonus(page);
  const card = page.locator('[data-testid^="quest-card-"]').filter({ has: page.getByTestId("quest-badge-self") }).filter({ hasNot: page.getByTestId("quest-done") }).first();
  await expect(card).toBeVisible();
  const testId = (await card.getAttribute("data-testid")) || "";
  return { card, id: testId.replace("quest-card-", "") };
}

/** Makes a day mode active (UX3-1: a mode tab only shows that mode; «Make active» changes the active one). */
export async function activateMode(page: Page, mode: "trading" | "study" | "rest" | "recovery") {
  await page.getByTestId(`mode-${mode}`).click();
  const activate = page.getByTestId("mode-activate");
  if (await activate.isVisible()) await activate.click();
  await expect(page.getByTestId(`mode-${mode}`)).toHaveAttribute("data-active", "true");
}
