import { test, expect, type Page } from "@playwright/test";
import { baseGame, expandBonus, readGame, seedGame, totalXp, utcDay } from "./helpers/quests";

// One reward per quest across tabs (docs/quests-2.0-plan.md, 4.1): one mutation point, Web Locks, check inside the lock.

const today = utcDay();

async function openQuests(page: Page) {
  await page.goto("/quests");
  await expect(page.getByTestId("quests-hero")).toBeVisible();
  await expandBonus(page);
}

/** The id of a self-reported quest of today, the same in every tab. */
async function selfQuestId(page: Page) {
  const card = page.locator('[data-testid^="quest-card-"]').filter({ has: page.getByTestId("quest-badge-self") }).first();
  return ((await card.getAttribute("data-testid")) || "").replace("quest-card-", "");
}

const completeIn = (page: Page, id: string, tolerant = false) => {
  const click = page.getByTestId(`quest-card-${id}`).getByRole("button", { name: "Выполнить" }).click({ timeout: tolerant ? 3000 : undefined });
  // at the same moment the other tab may already show it done (its button is gone): that is fine
  return tolerant ? click.catch(() => undefined) : click;
};

test.describe("Quests in several tabs", () => {
  test.use({ reducedMotion: "reduce" });

  for (const tabs of [2, 3]) {
    test(`${tabs} tabs completing the same quest at the same moment give its XP once`, async ({ context }) => {
      await seedGame(context, baseGame({ lastQuestDate: today }));
      const pages = await Promise.all(Array.from({ length: tabs }, () => context.newPage()));
      for (const p of pages) await openQuests(p);
      const id = await selfQuestId(pages[0]);
      const before = totalXp(await readGame(pages[0]));
      await Promise.all(pages.map((p) => completeIn(p, id, true)));
      await expect.poll(async () => (await readGame(pages[0])).completedQuestsToday[id]).toBe(true);
      await pages[0].waitForTimeout(500);
      const after = await readGame(pages[0]);
      const gained = totalXp(after) - before;
      expect(after.history.filter((h) => h.questId === id && h.completedAt === today)).toHaveLength(1);
      expect(gained).toBe(after.history.find((h) => h.questId === id)!.xp);
      // every tab shows it done
      for (const p of pages) await expect(p.getByTestId(`quest-card-${id}`).getByTestId("quest-done")).toBeVisible();
    });
  }

  test("a tab opened before a reward does not overwrite it with its old copy", async ({ context }) => {
    await seedGame(context, baseGame({ lastQuestDate: today }));
    const early = await context.newPage();
    await openQuests(early);
    const other = await context.newPage();
    await openQuests(other);
    const ids = await other.locator('[data-testid^="quest-card-"]').filter({ has: other.getByTestId("quest-badge-self") }).evaluateAll((els) =>
      els.map((e) => (e.getAttribute("data-testid") || "").replace("quest-card-", ""))
    );
    expect(ids.length).toBeGreaterThanOrEqual(2);
    await completeIn(other, ids[0]);
    await expect.poll(async () => (await readGame(other)).completedQuestsToday[ids[0]]).toBe(true);
    // the early tab changes something else: the first reward stays
    await early.getByTestId("mode-rest").click();
    await expect(early.getByTestId("rest-panel")).toBeVisible();
    await early.getByTestId("mode-trading").click();
    await expandBonus(early);
    await completeIn(early, ids[1]);
    await expect.poll(async () => Object.keys((await readGame(early)).completedQuestsToday).sort()).toEqual([ids[0], ids[1]].sort());
  });

  test("without Web Locks (fallback): one tab after another still gives the reward once; a same-moment click is recorded as it is", async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
      } catch {
        // ignore
      }
    });
    await seedGame(context, baseGame({ lastQuestDate: today }));
    const a = await context.newPage();
    const b = await context.newPage();
    await openQuests(a);
    await openQuests(b);
    const id = await selfQuestId(a);
    await completeIn(a, id);
    await expect.poll(async () => (await readGame(a)).completedQuestsToday[id]).toBe(true);
    await expect(b.getByTestId(`quest-card-${id}`).getByTestId("quest-done")).toBeVisible();
    expect((await readGame(a)).history.filter((h) => h.questId === id)).toHaveLength(1);

    // same moment, no lock: one synchronous check-and-write per tab; the residual risk is documented (plan 4.1)
    const ids = await a.locator('[data-testid^="quest-card-"]').filter({ has: a.getByTestId("quest-badge-self") }).filter({ hasNot: a.getByTestId("quest-done") }).evaluateAll((els) =>
      els.map((e) => (e.getAttribute("data-testid") || "").replace("quest-card-", ""))
    );
    if (ids.length) {
      await Promise.all([completeIn(a, ids[0], true), completeIn(b, ids[0], true)]);
      await a.waitForTimeout(500);
      const n = (await readGame(a)).history.filter((h) => h.questId === ids[0]).length;
      testInfo.annotations.push({ type: "no-web-locks-same-moment", description: `entries for one quest: ${n}` });
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(2);
    }
    await context.close();
  });
});
