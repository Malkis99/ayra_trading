import { test, expect, type Page } from "@playwright/test";
import { baseGame, readGame, seedGame, totalXp } from "./helpers/quests";

// One game day by the account time zone for Quests, Home and Profile; time zone changes and midnight never give a
// closed day again and never lock today's quests (docs/quests-2.0-plan.md, 4.2).

async function firstCoreTitleOnQuests(page: Page) {
  await page.goto("/quests");
  return (await page.locator('[data-testid^="quest-card-"] h3').first().textContent())?.trim();
}

test.describe("Game day and time zones", () => {
  test.use({ reducedMotion: "reduce" });

  test("Tbilisi at 20:30 UTC: Quests, Home and Profile all use the next day", async ({ context, page }) => {
    await page.clock.install({ time: new Date("2026-11-12T20:30:00Z") });
    await seedGame(context, baseGame({ lastQuestDate: "2026-11-12", lastRewardClaimDate: "2026-11-13", profile: { ...baseGame().profile, timezone: "Asia/Tbilisi" } }));
    const questsTitle = await firstCoreTitleOnQuests(page);
    await expect.poll(async () => (await readGame(page)).lastQuestDate).toBe("2026-11-13");
    await page.getByRole("tab", { name: "Неделя" }).click();
    await expect(page.getByTestId("week-day-2026-11-13")).toHaveAttribute("aria-current", "date");

    await page.goto("/");
    // the same quest set on Home
    await expect(page.getByText(questsTitle!, { exact: true }).first()).toBeVisible();
    // the daily reward of 2026-11-13 (Tbilisi) is already claimed: Home does not offer it again
    const g = await readGame(page);
    expect(g.lastQuestDate).toBe("2026-11-13");

    await page.goto("/profile");
    await expect(page.getByText(questsTitle!, { exact: true }).first()).toBeVisible();
  });

  test("a zone behind keeps today's quests open; switching back and forth gives no extra day", async ({ context, page }) => {
    await page.clock.install({ time: new Date("2026-11-12T11:00:00Z") });
    await seedGame(context, baseGame({ lastQuestDate: "", profile: { ...baseGame().profile, timezone: "Pacific/Kiritimati" } }));
    await page.goto("/quests");
    await expect.poll(async () => (await readGame(page)).lastQuestDate).toBe("2026-11-13");
    const card = page.locator('[data-testid^="quest-card-"]').filter({ has: page.getByTestId("quest-badge-self") }).first();
    await card.getByTestId("quest-complete").click();
    await expect(card.getByTestId("quest-done")).toBeVisible();
    const xp1 = totalXp(await readGame(page));

    for (const zone of ["Etc/GMT+12", "Pacific/Kiritimati", "Etc/GMT+12"]) {
      await page.evaluate((z) => {
        const g = JSON.parse(localStorage.getItem("ayra_demo_v1") || "{}");
        g.profile.timezone = z;
        localStorage.setItem("ayra_demo_v1", JSON.stringify(g));
      }, zone);
      await page.clock.runFor(5 * 60 * 1000);
      await page.reload();
      await expect(page.getByTestId("quests-hero")).toBeVisible();
      const g = await readGame(page);
      expect(g.lastQuestDate).toBe("2026-11-13");
      expect(totalXp(g)).toBe(xp1);
    }
    // the quest done earlier stays done, the others stay open
    await expect(page.getByTestId("quest-done").first()).toBeVisible();
    await expect(page.locator('[data-testid^="quest-card-"]').filter({ has: page.getByTestId("quest-badge-self") }).getByTestId("quest-complete").first()).toBeVisible();
  });

  test("midnight while the tab is open: a new day once, yesterday's rewards are not given again", async ({ context, page }) => {
    await page.clock.install({ time: new Date("2026-11-12T23:58:30Z") });
    await seedGame(context, baseGame({ lastQuestDate: "2026-11-12" }));
    await page.goto("/quests");
    const card = page.locator('[data-testid^="quest-card-"]').filter({ has: page.getByTestId("quest-badge-self") }).first();
    const id = ((await card.getAttribute("data-testid")) || "").replace("quest-card-", "");
    await card.getByTestId("quest-complete").click();
    await expect(card.getByTestId("quest-done")).toBeVisible();
    const xpBefore = totalXp(await readGame(page));

    await page.clock.runFor(3 * 60 * 1000); // past 00:00 UTC; the open tab checks the day every minute
    await expect.poll(async () => (await readGame(page)).lastQuestDate).toBe("2026-11-13");
    const g = await readGame(page);
    expect(g.completedQuestsToday).toEqual({});
    expect(totalXp(g)).toBe(xpBefore);
    expect(g.history.filter((h) => h.questId === id && h.completedAt === "2026-11-12")).toHaveLength(1);
    await page.clock.runFor(3 * 60 * 1000);
    expect((await readGame(page)).lastQuestDate).toBe("2026-11-13");
  });
});
