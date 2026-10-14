// Walks through the whole onboarding (/awakening) and saves a screenshot of every question and
// key frames of the finale, at 360px and 1440px. Needs a mock-auth build on :3000 (see docs/redesign-v1.md).
// Usage: node scripts/awakening-shots.mjs <outDir> [baseUrl]
import { chromium } from "@playwright/test";
import fs from "node:fs";

const outDir = process.argv[2] || "docs/screens/awakening/after";
const base = process.argv[3] || "http://localhost:3000";
fs.mkdirSync(outDir, { recursive: true });

const FINALE_FRAMES_MS = [300, 1500, 2800, 4200, 5600, 7200, 9000];
const CONTROL = /^(Назад|Продолжить|Пропустить.*|Back|Continue|Skip.*|RU|EN|Выйти|Начать|Транслит|Добавить)$/;

async function shot(page, file) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${outDir}/${file}`, type: "jpeg", quality: 72 });
}

const browser = await chromium.launch();
for (const [w, h] of [[360, 780], [1440, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() => {
    window.__AYRA_E2E_AUTH_MOCK__ = true;
    if (sessionStorage.getItem("shots")) return;
    sessionStorage.setItem("shots", "1");
    localStorage.clear();
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/awakening`);
  await page.waitForTimeout(1200);
  let n = 0;
  for (let guard = 0; guard < 40; guard++) {
    const start = page.getByRole("button", { name: /^(Начать|Start)/ });
    if (await start.first().isVisible().catch(() => false)) break;
    if (await page.getByTestId("awakening-finale").isVisible().catch(() => false)) break;
    n++;
    await shot(page, `q${String(n).padStart(2, "0")}-${w}.jpg`);
    const nick = page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]');
    if ((await nick.count()) && !(await nick.inputValue())) {
      await nick.fill("Nova_Trader");
      await shot(page, `q${String(n).padStart(2, "0")}b-${w}.jpg`);
    }
    const next = page.getByRole("button", { name: /^(Продолжить|Continue)/ }).last();
    if (!(await next.isEnabled().catch(() => false))) {
      const answers = page.locator("main button:not([disabled])");
      const count = await answers.count();
      for (let i = 0; i < count; i++) {
        const b = answers.nth(i);
        const text = ((await b.innerText().catch(() => "")) || "").trim();
        if (!text || CONTROL.test(text)) continue;
        await b.click();
        break;
      }
    }
    if (await next.isEnabled().catch(() => false)) await next.click();
    else await page.getByRole("button", { name: /^(Пропустить|Skip)/ }).first().click();
    await page.waitForTimeout(350);
  }
  // Finale frames (the animation starts when step 5 opens)
  const t0 = Date.now();
  for (const ms of FINALE_FRAMES_MS) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: `${outDir}/finale-${String(ms).padStart(4, "0")}ms-${w}.jpg`, type: "jpeg", quality: 72 });
  }
  await ctx.close();
}
await browser.close();
console.log(`saved to ${outDir}`);
