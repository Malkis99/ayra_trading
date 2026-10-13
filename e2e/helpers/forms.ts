import type { Page } from "@playwright/test";

/** Picks an option in a custom <Select> (components/ui/forms) by its trigger test id. */
export async function pickOption(page: Page, testId: string, label: string | RegExp) {
  await page.getByTestId(testId).click();
  await page.getByRole("listbox").getByRole("option", { name: label }).click();
}

/** Opens a collapsed section of the add-trade drawer. */
export async function openTradeSection(page: Page, title: string) {
  const btn = page.getByTestId("add-trade-drawer").getByRole("button", { name: new RegExp(`^${title}`) });
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
}

/** Opens a Journal tab; rare tabs are inside the "Ещё" menu. */
export async function openJournalTab(page: Page, name: string) {
  const tab = page.getByRole("tab", { name, exact: true });
  if (await tab.count()) {
    await tab.first().click();
    return;
  }
  await page.getByRole("tab", { name: /Ещё|Отчёты|Стратегии|Счета|Заметки/ }).last().click();
  await page.getByRole("menuitemradio", { name }).click();
}
