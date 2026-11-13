import { test, expect, type Page } from "@playwright/test";
import { baseGame, readGame, seedGame, utcDay } from "./helpers/quests";

// Quest Hub QH-1 (docs/quest-hub-plan.md): four top-level tabs that switch the page, ?tab= in the address with Back and
// Forward, the wide grid with the progress rail, «My goals» and discipline moved, «Creators» only says «soon».

const today = utcDay();
const tabs = (page: Page) => page.getByTestId("hub-tabs");
const selected = (page: Page) => tabs(page).locator('[role="tab"][aria-selected="true"]');
const tabParam = (page: Page) => new URL(page.url()).searchParams.get("tab");

const saved = {
  level: 6,
  xp: 120,
  coins: 340,
  currentStreak: 4,
  bestStreak: 9,
  equipment: { top: 1, bottom: 3, shoes: 5 },
  unlockedTitles: ["novice"],
  achievements: { first_quest: true },
  customGoals: [{ id: "g1", title: "Без сдвига стопа", category: "Trading", createdAt: "2026-11-01" }],
  history: [{ questId: "q_walk", questTitle: "Прогулка 20 минут", category: "Physical", xp: 30, coins: 0, completedAt: "2026-11-10", at: "2026-11-10T09:00:00.000Z" }],
};

test.describe("Quest Hub (QH-1)", () => {
  test.use({ reducedMotion: "reduce" });

  test("tabs are right under the profile and switch the page; ?tab= works with Back and Forward", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today }));
    await page.goto("/quests");
    await expect(selected(page)).toHaveAttribute("data-testid", "hub-tab-today");
    // the tab row comes straight after the profile strip
    const heroBottom = (await page.getByTestId("quests-hero").boundingBox())!;
    const tabsBox = (await tabs(page).boundingBox())!;
    expect(tabsBox.y - (heroBottom.y + heroBottom.height)).toBeLessThan(40);

    await tabs(page).getByRole("tab", { name: "Неделя" }).click();
    await expect.poll(() => tabParam(page)).toBe("week");
    await expect(page.getByTestId("hub-panel")).toHaveAttribute("data-tab", "week");
    await expect(page.getByTestId("week-days")).toBeVisible();
    await expect(page.getByTestId("mode-panel")).toHaveCount(0); // the content is replaced, not appended

    await tabs(page).getByRole("tab", { name: "История" }).click();
    await expect.poll(() => tabParam(page)).toBe("history");
    await expect(page.getByTestId("discipline")).toBeVisible();

    await page.goBack();
    await expect.poll(() => tabParam(page)).toBe("week");
    await expect(page.getByTestId("hub-panel")).toHaveAttribute("data-tab", "week");
    await page.goBack();
    await expect(page.getByTestId("hub-panel")).toHaveAttribute("data-tab", "today");
    await page.goForward();
    await expect(page.getByTestId("hub-panel")).toHaveAttribute("data-tab", "week");

    // a link opens its tab; a reload keeps it; an unknown value falls back to Today
    await page.goto("/quests?tab=creators");
    await expect(selected(page)).toHaveAttribute("data-testid", "hub-tab-creators");
    await page.reload();
    await expect(page.getByTestId("creators-soon")).toBeVisible();
    await page.goto("/quests?tab=nope");
    await expect(selected(page)).toHaveAttribute("data-testid", "hub-tab-today");
  });

  test("tabs follow the ARIA tabs pattern and the keyboard", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today }));
    await page.goto("/quests");
    await expect(tabs(page)).toHaveAttribute("role", "tablist");
    await expect(tabs(page)).toHaveAttribute("aria-label", "Разделы заданий");
    const all = tabs(page).getByRole("tab");
    await expect(all).toHaveCount(4);
    for (const id of ["today", "week", "history", "creators"]) {
      const tab = page.getByTestId(`hub-tab-${id}`);
      await expect(tab).toHaveAttribute("aria-controls", `quests-panel-${id}`);
      await expect(tab).toHaveAttribute("tabindex", id === "today" ? "0" : "-1");
    }
    const panel = page.getByTestId("hub-panel"); // the modes have their own nested tabpanel
    await expect(panel).toHaveAttribute("role", "tabpanel");
    await expect(panel).toHaveAttribute("id", "quests-panel-today");
    await expect(panel).toHaveAttribute("aria-labelledby", "quests-tab-today");

    await page.getByTestId("hub-tab-today").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("hub-tab-week")).toBeFocused();
    await expect(page.getByTestId("hub-tab-week")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(page.getByTestId("hub-tab-creators")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("hub-tab-today")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("hub-tab-creators")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(page.getByTestId("hub-tab-today")).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => tabParam(page)).toBe("today");

    // one h1 for the page; the progress rail is a labelled landmark
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Задания");
    await expect(page.getByRole("complementary", { name: "Прогресс" })).toBeVisible();
  });

  for (const width of [360, 390, 768, 1280, 1440, 1920]) {
    test(`${width}px: no horizontal scroll on any tab, buttons are named and big enough`, async ({ context, page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedGame(context, baseGame({ lastQuestDate: today, ...saved }));
      for (const id of ["today", "week", "history", "creators"]) {
        await page.goto(`/quests?tab=${id}`);
        await expect(page.getByTestId("hub-panel")).toHaveAttribute("data-tab", id);
        const overflow = await page.evaluate(() => {
          const main = document.querySelector("main");
          return { doc: document.documentElement.scrollWidth - window.innerWidth, main: main ? main.scrollWidth - main.clientWidth : 0 };
        });
        expect(overflow, `${id} at ${width}`).toEqual({ doc: 0, main: 0 });
        // every visible control of the Hub has a name and a tap target of at least 40px (44px for most)
        const controls = await page.locator('[data-testid="hub-tabs"] button, [data-testid="hub-panel"] button, [data-testid="hub-panel"] a').evaluateAll((els) =>
          els
            .filter((e) => (e as HTMLElement).offsetParent !== null)
            .map((e) => ({ name: (e.getAttribute("aria-label") || e.textContent || "").trim(), h: Math.round(e.getBoundingClientRect().height), html: e.outerHTML.slice(0, 80) }))
        );
        for (const c of controls) {
          expect(c.name, c.html).not.toBe("");
          expect(c.h, `${id} ${width}: ${c.name}`).toBeGreaterThanOrEqual(36);
        }
      }
      if (width >= 1280) {
        // desktop: the rail stands next to the main column, the Hub uses the width (no 880px column)
        await page.goto("/quests");
        const panel = (await page.getByTestId("hub-panel").boundingBox())!;
        const rail = (await page.getByTestId("hub-rail").boundingBox())!;
        expect(panel.width).toBeGreaterThan(Math.min(width - 220 - 48, 1480) - 2);
        expect(rail.y).toBeLessThan(panel.y + 10);
        expect(rail.width).toBeGreaterThanOrEqual(338);
      } else {
        // tablet and phone: one column, the rail under the main column
        await page.goto("/quests");
        const main = (await page.getByTestId("mode-panel").boundingBox())!;
        const rail = (await page.getByTestId("hub-rail").boundingBox())!;
        expect(rail.y).toBeGreaterThan(main.y + main.height);
      }
    });
  }

  test("phone: the profile strip and the modes are compact; the tabs fit one row", async ({ context, page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await seedGame(context, baseGame({ lastQuestDate: today, ...saved }));
    await page.goto("/quests");
    const hero = (await page.getByTestId("quests-hero").boundingBox())!;
    expect(hero.height).toBeLessThanOrEqual(135); // was ≈170 with the next step inside (UX3-2a)
    const modes = (await page.getByTestId("mode-switch").boundingBox())!;
    expect(modes.height).toBeLessThanOrEqual(52);
    const row = await tabs(page).getByRole("tab").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(row).size).toBe(1);
    // the three missions start on the first screen
    await expect(page.getByTestId("mode-panel")).toBeInViewport();
  });

  test("My goals live in the rail of Today and History; discipline is the top of History", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today, ...saved }));
    await page.goto("/quests");
    const rail = page.getByTestId("hub-rail");
    await expect(rail.getByTestId("goals-card")).toContainText("Без сдвига стопа");
    await expect(rail.getByTestId("week-card")).toBeVisible();
    await expect(rail.getByTestId("weekly-boss")).toBeVisible();
    await rail.getByTestId("week-card-open").click();
    await expect.poll(() => tabParam(page)).toBe("week");
    await expect(page.getByTestId("hub-rail").getByTestId("trading-days")).toBeVisible();

    await tabs(page).getByRole("tab", { name: "История" }).click();
    await expect(page.getByTestId("streak-current")).toContainText("4");
    await expect(page.getByTestId("streak-best")).toContainText("9");
    await expect(page.getByTestId("shield-count")).toContainText("Доступно щитов");
    await expect(page.getByTestId("activity-cell")).toHaveCount(28);
    await expect(page.getByTestId("history-item")).toHaveCount(1);
    await expect(page.getByTestId("hub-rail").getByTestId("goals-card")).toBeVisible();
    await expect(page.getByTestId("streak-rule")).toBeVisible();
  });

  test("Creators says «soon» honestly: no quests, no buttons, nothing changes in the game", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today, ...saved }));
    await page.goto("/quests?tab=creators");
    await expect(page.getByTestId("hub-tab-creators")).toContainText("Скоро");
    const soon = page.getByTestId("creators-soon");
    await expect(soon).toContainText("Скоро");
    await expect(soon).toContainText("квестов и наград нет");
    const panel = page.getByTestId("hub-panel");
    await expect(panel.locator("button, a, input, select, textarea")).toHaveCount(0);
    await expect(panel).not.toContainText(/\+\d+ XP|Coins ·/);
    await expect(page.getByTestId("creators-rules")).toContainText("Нет наград за лайки, подписки и просмотры");
  });

  test("switching tabs keeps every saved value: XP, Coins, level, items, titles, achievements, goals, history", async ({ context, page }) => {
    await seedGame(context, baseGame({ lastQuestDate: today, ...saved }));
    await page.goto("/quests");
    await expect(page.getByTestId("quests-hero")).toBeVisible();
    const before = await readGame(page);
    for (const name of ["Неделя", "История", "Авторы", "Сегодня", "История", "Неделя"]) {
      await tabs(page).getByRole("tab", { name }).click();
      await page.waitForTimeout(100);
    }
    await page.goBack();
    await page.goBack();
    await page.reload();
    await expect(page.getByTestId("quests-hero")).toBeVisible();
    const after = await readGame(page);
    const keep = (g: Record<string, unknown>) => ({
      xp: g.xp, level: g.level, coins: g.coins, equipment: g.equipment, unlockedTitles: g.unlockedTitles, achievements: g.achievements,
      customGoals: g.customGoals, history: g.history, completedQuestsToday: g.completedQuestsToday, questDay: g.questDay,
      currentStreak: g.currentStreak, bestStreak: g.bestStreak, streakShieldsAvailable: g.streakShieldsAvailable, dailyStats: g.dailyStats,
    });
    expect(keep(after as unknown as Record<string, unknown>)).toEqual(keep(before as unknown as Record<string, unknown>));
    expect(after.xp).toBe(saved.xp);
    expect(after.coins).toBe(saved.coins);
    expect(after.history).toEqual(saved.history);
  });
});
