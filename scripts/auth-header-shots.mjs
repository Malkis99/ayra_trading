// Screenshots of the sign-in screen and the top bar (guest / signed in) at 360px and 1440px.
// Usage: node scripts/auth-header-shots.mjs <outDir> [baseUrl] [--no-mock]
// With mock auth (default, needs a mock build on :3000) it also signs in and shots the signed-in top bar.
import { chromium } from "@playwright/test";
import fs from "node:fs";

const outDir = process.argv[2] || "docs/screens/login-header/after";
const base = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "http://localhost:3000";
const mock = !process.argv.includes("--no-mock");
fs.mkdirSync(outDir, { recursive: true });

const shot = async (page, name, w, clip) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/${name}-${w}.jpg`, type: "jpeg", quality: 75, ...(clip ? { clip } : {}) });
};

const browser = await chromium.launch();
for (const [w, h] of [[360, 780], [1440, 900]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript((m) => {
    if (m) window.__AYRA_E2E_AUTH_MOCK__ = true;
    if (sessionStorage.getItem("shots")) return;
    sessionStorage.setItem("shots", "1");
    localStorage.clear();
  }, mock);
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await shot(page, "login", w);
  await page.click("button[type='submit']").catch(() => {});
  if (mock) {
    await page.fill("#email-input", "not-an-email");
    await page.click("input[type='checkbox']");
    await page.click("button[type='submit']");
    await shot(page, "login-error", w);
    await page.fill("#email-input", "shots_user@example.com");
    await page.click("button[type='submit']");
    await shot(page, "login-sent", w);
    await page.click("text=Изменить почту");
  }
  await page.click("button:has-text('Продолжить без входа')");
  await page.waitForTimeout(800);
  await page.goto(`${base}/journal`);
  await shot(page, "header-guest", w, { x: 0, y: 0, width: w, height: 120 });
  await shot(page, "page-guest", w);
  if (mock) {
    await page.goto(`${base}/login`);
    await page.fill("#email-input", "shots_user@example.com");
    await page.click("input[type='checkbox']");
    await page.click("button[type='submit']");
    await page.fill("#otp-input", "123456");
    await page.click("button[type='submit']");
    await page.waitForURL((u) => u.pathname === "/awakening", { timeout: 15000 });
    await page.locator('input[placeholder="A-Z a-z 0-9 _ . -"]').fill("Shots_User");
    for (const sel of ["Продолжить", "Продолжить", "Продолжить", "18–24 года", "Продолжить", "Пропустить шаг целиком", "1–2 года", "Продолжить", "Крипто", "Продолжить", "Дисциплина", "Продолжить", "Пропустить необязательные вопросы", "Пропустить шаг целиком"])
      await page.click(`button:has-text("${sel}")`);
    await page.getByRole("button", { name: "Пропустить анимацию" }).click();
    await page.getByRole("button", { name: "Начать" }).click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
    await shot(page, "header-signed", w, { x: 0, y: 0, width: w, height: 120 });
    await shot(page, "page-signed", w);
  }
  await ctx.close();
}
await browser.close();
console.log(`saved to ${outDir}`);
