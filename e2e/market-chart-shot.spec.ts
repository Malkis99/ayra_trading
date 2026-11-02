import { test, expect, webkit, chromium, type Browser, type Page } from "@playwright/test";
import { marketGuest } from "./helpers/market";

// Market → Chart: «Chart screenshot». The browser's tab capture is replaced by a canvas of the window's size (the
// real permission prompt cannot be pressed in a test): «ok» gives a picture with stripes, «blank» one colour,
// «screen» another size (the whole screen was chosen), «deny» the browser's refusal. Phones get a disabled button.

const el = (page: Page, id: string) => page.getByTestId(id);

async function withFakeCapture(page: Page, mode: "ok" | "blank" | "screen" | "deny") {
  await page.addInitScript((mode) => {
    const fake = async () => {
      if (mode === "deny") throw new DOMException("denied", "NotAllowedError");
      const canvas = document.createElement("canvas");
      canvas.width = mode === "screen" ? 1920 : window.innerWidth;
      canvas.height = mode === "screen" ? 1080 : window.innerHeight;
      const ctx = canvas.getContext("2d")!;
      const paint = () => {
        ctx.fillStyle = "#18171f";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (mode === "blank") return;
        for (let x = 0; x < canvas.width; x += 24) {
          ctx.fillStyle = x % 48 ? "#34d399" : "#fb7185";
          ctx.fillRect(x, (x * 7) % canvas.height, 8, 120);
        }
      };
      paint();
      setInterval(paint, 100);
      return canvas.captureStream(10);
    };
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { value: fake, configurable: true });
  }, mode);
}

async function chart(browser: Browser, width: number, mode: "ok" | "blank" | "screen" | "deny" = "ok") {
  const { page } = await marketGuest(browser, width);
  await withFakeCapture(page, mode);
  await page.goto("/market?tab=chart");
  await expect(el(page, "market-chart-widget")).toHaveAttribute("data-status", "ready");
  return page;
}

test.describe("chromium: Market — chart screenshot", () => {
  let browser: Browser;
  test.beforeAll(async () => {
    browser = await chromium.launch();
  });
  test.afterAll(async () => {
    await browser.close();
  });

  test("1440: the picture is shown first, then downloads as PNG named by the instrument and timeframe", async () => {
    const page = await chart(browser, 1440);
    await expect(el(page, "market-chart-shot-phone")).toHaveCount(0);
    await expect(el(page, "market-chart-shot")).toBeEnabled();
    await el(page, "market-chart-shot").click();
    await expect(el(page, "market-chart-shot-preview")).toBeVisible();
    // the picture: our line + the chart + the time card, at the window's scale
    const size = await el(page, "market-chart-shot-preview").evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
    expect(size[0]).toBeGreaterThan(800);
    expect(size[1]).toBeGreaterThan(400);
    const [download] = await Promise.all([page.waitForEvent("download"), el(page, "market-chart-shot-download").click()]);
    expect(download.suggestedFilename()).toMatch(/^AYRA_DXY_1h_\d{4}-\d\d-\d\d_\d\d-\d\d\.png$/);
    await el(page, "market-chart-shot-close").click();
    await expect(el(page, "market-chart-shot-dialog")).toHaveCount(0);
  });

  test("1440: works in full screen, and Esc closes only the picture", async () => {
    const page = await chart(browser, 1440);
    await el(page, "market-chart-fullscreen").click();
    await expect(el(page, "market-chart")).toHaveAttribute("data-fullscreen", "true");
    await el(page, "market-chart-shot").click();
    await expect(el(page, "market-chart-shot-preview")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(el(page, "market-chart-shot-dialog")).toHaveCount(0);
    await expect(el(page, "market-chart")).toHaveAttribute("data-fullscreen", "true");
  });

  for (const [mode, code] of [
    ["blank", "blank"],
    ["screen", "notTab"],
    ["deny", "denied"],
  ] as const) {
    test(`1440: ${mode} — says so honestly, no picture`, async () => {
      const page = await chart(browser, 1440, mode);
      await el(page, "market-chart-shot").click();
      await expect(el(page, "market-chart-shot-error")).toHaveAttribute("data-code", code);
      await expect(el(page, "market-chart-shot-preview")).toHaveCount(0);
      await expect(el(page, "market-chart-shot-download")).toHaveCount(0);
    });
  }
});

for (const engine of ["chromium", "webkit"] as const) {
  test.describe(`${engine}: Market — chart screenshot on a phone`, () => {
    let browser: Browser;
    test.beforeAll(async () => {
      browser = await (engine === "webkit" ? webkit : chromium).launch();
    });
    test.afterAll(async () => {
      await browser.close();
    });

    test("360: the button is disabled and says to take an ordinary screenshot", async () => {
      const page = await chart(browser, 360);
      await expect(el(page, "market-chart-shot")).toBeDisabled();
      await expect(el(page, "market-chart-shot")).toHaveAttribute("aria-label", "Скриншот графика: На телефоне сделайте обычный скриншот");
      await expect(el(page, "market-chart-shot-phone")).toHaveText("На телефоне сделайте обычный скриншот");
    });
  });
}
