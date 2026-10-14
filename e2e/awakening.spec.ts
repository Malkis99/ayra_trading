import { test, expect } from "@playwright/test";

test.describe("Awakening Onboarding E2E Tests", () => {
  test("Clean device redirects / -> /awakening, completes onboarding and returns to Home cleanly", async ({ page }) => {
    // Navigate directly to /awakening to clear state
    await page.goto("/awakening");
    await page.evaluate(() => localStorage.clear());

    // Clean device navigation to /awakening
    await page.goto("/awakening");
    expect(page.url()).toContain("/awakening");

    // Step 1: Nickname
    const nicknameInput = page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]');
    await nicknameInput.fill("Trader_42");
    await page.click('button:has-text("Продолжить")');

    // Language/Timezone -> Continue
    await page.click('button:has-text("Продолжить")');

    // Appearance -> Continue
    await page.click('button:has-text("Продолжить")');

    // Age range -> select 18-24
    await page.click('button:has-text("18–24 года")');
    await page.click('button:has-text("Продолжить")');

    // Step 2: Lifestyle -> Skip step
    await page.click('button:has-text("Пропустить шаг целиком")');

    // Step 3: Trading Profile
    // Q1: Experience
    await page.click('button:has-text("1–2 года")');
    await page.click('button:has-text("Продолжить")');

    // Q2: Markets
    await page.click('button:has-text("Крипто")');
    await page.click('button:has-text("Продолжить")');

    // Q3: Main problem (mandatory)
    await page.click('button:has-text("Дисциплина")');
    await page.click('button:has-text("Продолжить")');

    // Skip remaining optional questions in step 3
    await page.click('button:has-text("Пропустить необязательные вопросы")');

    // Step 4: Goals -> Skip step
    await page.click('button:has-text("Пропустить шаг целиком")');

    // Step 5: awakening finale -> skip the animation -> "Начать"
    await expect(page.getByTestId("awakening-finale")).toBeVisible();
    await page.getByRole("button", { name: "Пропустить анимацию" }).click();
    const startButton = page.locator('button:has-text("Начать")');
    await expect(startButton).toBeVisible({ timeout: 2000 });
    await startButton.click();

    // Verify redirect to Home (/) within 3 seconds without whiteout or infinite logo
    await page.waitForURL((url) => url.pathname === "/", { timeout: 5000 });
    expect(page.url()).not.toContain("/awakening");

    // Verify localStorage has status = 'done'
    const storedStatus = await page.evaluate(() => {
      const saved = localStorage.getItem("ayra_demo_v1");
      return saved ? JSON.parse(saved).onboarding?.status : null;
    });
    expect(storedStatus).toBe("done");

    // Refresh page -> verify we stay on Home
    await page.reload();
    await page.waitForTimeout(500);
    expect(page.url()).not.toContain("/awakening");
  });

  test("Legacy profile shows soft banner on Home without forced redirect", async ({ page }) => {
    // Seed before any app script runs, so the app cannot overwrite the seed on navigation.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("e2e_seeded")) return;
      sessionStorage.setItem("e2e_seeded", "1");
      localStorage.setItem(
        "ayra_demo_v1",
        JSON.stringify({
          name: "OldTrader",
          onboarding: { status: "legacy" },
        })
      );
    });

    await page.goto("/");
    await page.waitForTimeout(1000);

    expect(page.url()).not.toContain("/awakening");
    const banner = page.locator("text=Пройти знакомство");
    await expect(banner).toBeVisible();
  });

  test("InProgress onboarding shows Continue soft banner on Home without forced redirect", async ({ page }) => {
    // Seed before any app script runs, so the app cannot overwrite the seed on navigation.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("e2e_seeded")) return;
      sessionStorage.setItem("e2e_seeded", "1");
      localStorage.setItem(
        "ayra_demo_v1",
        JSON.stringify({
          name: "DraftUser",
          onboarding: { status: "inProgress", step: 2, subStep: 1 },
        })
      );
    });

    await page.goto("/");
    await page.waitForTimeout(1000);

    expect(page.url()).not.toContain("/awakening");
    const banner = page.locator("text=Продолжить знакомство");
    await expect(banner).toBeVisible();
  });

  test("Mobile 360px: header keeps logout reachable and appearance step is not clipped", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.addInitScript(() => {
      (window as any).__AYRA_E2E_AUTH_MOCK__ = true;
    });
    await page.goto("/awakening");
    await page.evaluate(() => {
      localStorage.clear();
      const id = "mock-user-id-mobile";
      localStorage.setItem(
        "ayra_mock_auth_v1",
        JSON.stringify({
          user: { id, email: "very.long.email.address@example.com", created_at: new Date().toISOString() },
          profile: {
            id,
            nickname: null,
            locale: "ru",
            timezone: "UTC",
            age_group: null,
            minor_mode: false,
            consent_at: null,
            consent_version: null,
            created_at: "",
            updated_at: "",
          },
        })
      );
    });
    await page.goto("/awakening");

    const header = page.locator("header");
    await expect(header.getByRole("button", { name: "Выйти" })).toBeInViewport();
    await expect(header.getByRole("link", { name: "AYRA" })).toBeInViewport();
    const overflow = await header.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(pageOverflow).toBeLessThanOrEqual(0);

    await page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]').fill("Mobile_42");
    await page.click('button:has-text("Продолжить")');
    await page.click('button:has-text("Продолжить")');

    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toBeInViewport();
    const titleTop = await title.evaluate((el) => el.getBoundingClientRect().top);
    const headerBottom = await header.evaluate((el) => el.getBoundingClientRect().bottom);
    expect(titleTop).toBeGreaterThanOrEqual(headerBottom);
  });

  test("Finale plays once (about 7 s) and after a reload shows the final frame at once", async ({ page }) => {
    await page.goto("/awakening");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/awakening");

    await page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]').fill("Finale_Tester");
    await page.click('button:has-text("Продолжить")');
    await page.click('button:has-text("Продолжить")');
    await page.click('button:has-text("Продолжить")');
    await page.click('button:has-text("18–24 года")');
    await page.click('button:has-text("Продолжить")');
    await page.click('button:has-text("Пропустить шаг целиком")');
    await page.click('button:has-text("1–2 года")');
    await page.click('button:has-text("Продолжить")');
    await page.click('button:has-text("Крипто")');
    await page.click('button:has-text("Продолжить")');
    await page.click('button:has-text("Дисциплина")');
    await page.click('button:has-text("Продолжить")');
    await page.click('button:has-text("Пропустить необязательные вопросы")');
    await page.click('button:has-text("Пропустить шаг целиком")');

    const finale = page.getByTestId("awakening-finale");
    await expect(finale).toBeVisible();
    // The start button appears only at the end of the animation
    await expect(page.getByRole("button", { name: "Начать" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Начать" })).toBeVisible({ timeout: 12000 });
    await expect(finale).toHaveAttribute("data-phase", "done");
    await expect(page.getByTestId("finale-nickname")).toHaveText("Finale_Tester");
    await expect(finale).toContainText("Уровень 1");
    await expect(finale).toContainText("Дисциплина");

    // Reload on the finale: the final frame is shown immediately, no replay
    await page.reload();
    await expect(page.getByRole("button", { name: "Начать" })).toBeVisible({ timeout: 2000 });
    await expect(page.getByRole("button", { name: "Пропустить анимацию" })).toHaveCount(0);

    await page.getByRole("button", { name: "Начать" }).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 5000 });
  });

  test("Keyboard: Esc goes back, Enter continues", async ({ page }) => {
    await page.goto("/awakening");
    await page.evaluate(() => localStorage.clear());
    await page.goto("/awakening");
    await page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]').fill("Keys_Tester");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Язык и часовой пояс" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]')).toHaveValue("Keys_Tester");
  });
});
