import { test, expect, webkit, chromium, type Page, type Browser } from "@playwright/test";
import { solidPng } from "./helpers/png";

// Screenshot viewer (owner's report 2026-10-27): a phone screenshot 739×1600 opened at «100%» on a 1440 laptop, its
// bottom was cut off and could not be scrolled. Now: whole picture by default (any format), «100%» = real size with
// scrolling and dragging, + / − / «Fit to window», double click toggles; the tools never cover the picture.
// Run in Chromium and WebKit (iPhone browsers are WebKit), on 1440×900 and 360×800.

const PICTURES = [
  { name: "tall", w: 739, h: 1600, rgb: [80, 52, 143] as [number, number, number] },
  { name: "wide", w: 1600, h: 900, rgb: [214, 169, 74] as [number, number, number] },
  { name: "square", w: 1000, h: 1000, rgb: [40, 120, 90] as [number, number, number] },
];

async function seed(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    indexedDB.deleteDatabase("ayra_attachments_v1");
    localStorage.setItem(
      "ayra_demo_v1",
      JSON.stringify({
        name: "ViewerTrader",
        level: 1,
        xp: 0,
        coins: 0,
        createdAt: "2026-10-08",
        completedQuestsToday: {},
        lastQuestDate: "2026-10-08",
        onboarding: { status: "done", step: 5, subStep: 0, answers: {} },
        profile: { appearance: { skinTone: "skin_fair", hairstyle: "hair_buzz", hairColor: "hair_black", outfit: "outfit_obsidian" }, minorMode: false, timezone: "UTC" },
      })
    );
    localStorage.setItem(
      "ayra_journal_v1",
      JSON.stringify({
        schemaVersion: 6,
        accounts: [{ id: "acc_1", name: "Main USD", type: "personal", currency: "USD", startBalance: 10000, platform: "manual", createdAt: "2026-10-08T00:00:00.000Z" }],
        trades: [
          {
            id: "tr_view",
            accountId: "acc_1",
            instrument: "EURUSD",
            direction: "long",
            status: "closed",
            openedAt: "2026-10-26T09:00:00.000Z",
            result: "win",
            pnlMoney: 40,
            emotions: [],
            mistakes: [],
            verification: "unverified",
            source: "manual",
            createdAt: "2026-10-26T09:00:00.000Z",
            attachmentIds: [],
          },
        ],
      })
    );
  });
}

/** Two screen frames: sizes are applied on the next frame (the 0.01 ms transition of «reduce motion»). */
const settle = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

type Box = { x: number; y: number; width: number; height: number };
const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox()) as Box;
const inside = (a: Box, b: Box) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1;
const overlap = (a: Box, b: Box) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
const percent = async (page: Page) => Number((await page.getByTestId("lightbox-zoom-level").innerText()).replace("%", ""));
const scrollPos = (page: Page) => page.getByTestId("lightbox-viewport").evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft, sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth }));

/** The whole picture is drawn inside the picture area and nothing covers it. */
async function expectFitted(page: Page) {
  await settle(page);
  await expect(page.getByTestId("lightbox-viewport")).toHaveAttribute("data-fit", "true");
  await expect.poll(async () => page.getByTestId("lightbox-image").evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0))).toBeGreaterThan(0);
  await settle(page);
  const img = await box(page, "lightbox-image");
  const area = await box(page, "lightbox-viewport");
  expect(inside(img, area)).toBe(true);
  const s = await scrollPos(page);
  expect(s.sh).toBeLessThanOrEqual(s.ch + 1); // nothing hidden below
  expect(s.sw).toBeLessThanOrEqual(s.cw + 1);
  // tools, caption and arrows stay outside the picture
  for (const name of ["lightbox-zoom-level", "lightbox-fit"]) expect(overlap(await box(page, name), img)).toBe(false);
  expect(overlap((await page.getByPlaceholder(/Подпись к скриншоту/).boundingBox()) as Box, img)).toBe(false);
  for (const label of ["Предыдущий", "Следующий"]) {
    const arrow = await page.getByRole("button", { name: label }).boundingBox();
    if (arrow) expect(overlap(arrow as Box, img)).toBe(false);
  }
}

async function run(page: Page, label: string) {
  await seed(page);
  await page.goto("/journal");
  await page.getByText("EURUSD").locator("visible=true").first().click();
  const card = page.getByTestId("trade-quick-view");
  await expect(card).toBeVisible();
  for (const p of PICTURES) {
    await card.locator("input[type='file'][accept='image/*']").setInputFiles({ name: `${p.name}.png`, mimeType: "image/png", buffer: solidPng(p.w, p.h, p.rgb) });
  }
  const thumbs = card.getByTestId("screenshot-thumb");
  await expect(thumbs).toHaveCount(3, { timeout: 15000 });
  // the previews show the whole picture (no arbitrary crop)
  for (let i = 0; i < 3; i++) expect(await thumbs.nth(i).evaluate((img) => getComputedStyle(img).objectFit)).toBe("contain");

  await card.locator(".aspect-video").first().click();
  await expect(page.getByTestId("lightbox-image")).toBeVisible();
  const seen = new Set<string>();
  for (let i = 0; i < PICTURES.length; i++) {
    await expectFitted(page);
    const shown = await page.getByTestId("lightbox-image").evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight }));
    // the order of the screenshots follows their processing: find which one this is
    const p = PICTURES.find((x) => x.w === shown.w && x.h === shown.h)!;
    expect(p, `${label}: unexpected picture ${shown.w}×${shown.h}`).toBeTruthy();
    seen.add(p.name);
    const fitPercent = await percent(page);

    // «100%»: the real size, scrolls when larger than the window
    await page.getByTestId("lightbox-zoom-level").click();
    await expect(page.getByTestId("lightbox-zoom-level")).toHaveText("100%");
    await settle(page);
    const real = await box(page, "lightbox-image");
    expect(Math.round(real.width)).toBe(shown.w);
    const s = await scrollPos(page);
    if (s.sh > s.ch + 1) {
      // wheel scrolls down; dragging with the mouse moves it back up
      const area = await box(page, "lightbox-viewport");
      await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
      await page.mouse.wheel(0, 400);
      await expect.poll(async () => (await scrollPos(page)).top, { message: `${label} ${p.name}: wheel scroll` }).toBeGreaterThan(0);
      const top = (await scrollPos(page)).top;
      await page.mouse.down();
      await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2 + 150, { steps: 5 });
      await page.mouse.up();
      expect((await scrollPos(page)).top).toBeLessThan(top);
    }

    // + and −, then «Fit to window» brings the whole picture back
    await page.getByTestId("lightbox-zoom-in").click();
    expect(await percent(page)).toBe(125);
    await page.getByTestId("lightbox-zoom-out").click();
    expect(await percent(page)).toBe(100);
    await page.getByTestId("lightbox-fit").click();
    expect(await percent(page)).toBe(fitPercent);
    await expectFitted(page);

    // double click: fit ↔ 100%
    await page.getByTestId("lightbox-viewport").dblclick();
    await expect(page.getByTestId("lightbox-viewport")).toHaveAttribute("data-fit", "false");
    await page.getByTestId("lightbox-viewport").dblclick();
    await expectFitted(page);

    if (i < PICTURES.length - 1) await page.getByRole("button", { name: "Следующий" }).click();
  }
  expect([...seen].sort()).toEqual(PICTURES.map((x) => x.name).sort());
  // Esc closes the viewer only (the trade card stays)
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lightbox-image")).toHaveCount(0);
  await expect(card).toBeVisible();
}

const SIZES = [
  { name: "1440", viewport: { width: 1440, height: 900 } },
  { name: "360", viewport: { width: 360, height: 800 } },
];

test.describe("Screenshot viewer: fit to window, 100%, zoom", () => {
  test.use({ reducedMotion: "reduce" });
  test.setTimeout(150_000);

  for (const engine of ["chromium", "webkit"] as const) {
    for (const size of SIZES) {
      test(`${engine} ${size.name}: tall, wide and square screenshots are whole by default; 100% scrolls; + / − / fit / double click`, async ({ baseURL }) => {
        const browser: Browser = await (engine === "webkit" ? webkit : chromium).launch();
        try {
          const page = await (await browser.newContext({ baseURL, viewport: size.viewport })).newPage();
          await run(page, `${engine} ${size.name}`);
        } finally {
          await browser.close();
        }
      });
    }
  }
});
