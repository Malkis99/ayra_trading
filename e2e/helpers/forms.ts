import type { Page } from "@playwright/test";

/** Picks an option in a custom <Select> (components/ui/forms) by its trigger test id. */
export async function pickOption(page: Page, testId: string, label: string | RegExp) {
  await page.getByTestId(testId).click();
  await page.getByRole("listbox").getByRole("option", { name: label }).click();
}

/** Opens a collapsed section of the add-trade drawer. */
export async function openTradeSection(page: Page, title: string) {
  const btn = page.getByRole("button", { name: new RegExp(title) });
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
}
