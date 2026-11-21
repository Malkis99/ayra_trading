import { test, expect, type Page } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";
import { signIn } from "../e2e/helpers/auth";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { stubTradingView } from "../e2e/helpers/tradingview";
import { mkdirSync } from "node:fs";

async function seed(page: Page, lang: "ru" | "en" = "ru", ids = ["eurusd", "gold"]) {
  await page.addInitScript(({lang,ids})=>{
    localStorage.setItem("ayra_guest_dismissed","1");localStorage.setItem("ayra_lang",lang);
    if(sessionStorage.getItem("focus-seeded"))return;sessionStorage.setItem("focus-seeded","1");
    localStorage.setItem("ayra_market_watchlist",JSON.stringify({version:1,ids,updatedAt:"2026-11-22T00:00:00Z"}));
  },{lang,ids});
  await page.goto("/market?tab=watchlist");
  if(ids.length) await expect(page.getByTestId("market-focus-direction")).toBeEnabled();
}
async function pick(page: Page, key: string, name: string) {
  await page.getByTestId(`market-focus-${key}`).click();await page.getByRole("option",{name,exact:true}).click();
}
const focus = (p: Page) => p.getByTestId("market-focus");
const saved = (p: Page) => expect(p.getByTestId("market-focus-status")).toHaveAttribute("data-kind","saved");

test("manual fields, six checks, reload/offline, removal/re-add and filters preserve local focus",async({browser})=>{
  const {page}=await marketGuest(browser,390);try{
    await seed(page);await pick(page,"direction","Бычье");await saved(page);await pick(page,"poi","FVG");await pick(page,"mss","Ожидание");await pick(page,"session","Лондон");
    const checks=focus(page).getByRole("checkbox");await expect(checks).toHaveCount(6);for(const check of await checks.all())await check.check();await saved(page);
    await pick(page,"session","Нью-Йорк");for(const check of await checks.all())await expect(check).toBeChecked();
    await page.reload();await expect(page.getByTestId("market-focus-direction")).toContainText("Бычье");for(const check of await checks.all())await expect(check).toBeChecked();
    await pick(page,"instrument","Золото");await expect(page.getByTestId("market-focus-direction")).toContainText("Не выбрано");await pick(page,"instrument","EUR/USD");await expect(checks.first()).toBeChecked();
    await page.context().setOffline(true);await pick(page,"direction","Медвежье");await saved(page);await page.context().setOffline(false);
    await page.getByTestId("market-watchlist-query").fill("gold");await pick(page,"instrument","EUR/USD");await expect(page.getByTestId("market-focus-direction")).toContainText("Медвежье");await page.getByTestId("market-watchlist-clear-filters").click();
    await page.getByTestId("market-watchlist-remove-eurusd").click();await expect(page.getByTestId("market-focus-instrument")).toContainText("Золото");
    await page.getByTestId("market-watchlist-add").click();await page.getByTestId("market-watchlist-pick-eurusd").click();await page.getByTestId("market-watchlist-add").click();
    await expect(page.getByTestId("market-focus-instrument")).toContainText("Золото");await pick(page,"instrument","EUR/USD");await expect(page.getByTestId("market-focus-direction")).toContainText("Медвежье");
    await page.getByTestId("market-watchlist-remove-eurusd").click();await page.getByTestId("market-watchlist-remove-gold").click();await expect(page.getByTestId("market-focus-empty")).toBeVisible();await expect(focus(page).getByRole("checkbox")).toHaveCount(0);
  }finally{await page.context().close();}
});

test("two tabs preserve patches and a reset never wipes a later unreviewed change",async({browser})=>{
  const {page:a}=await marketGuest(browser,1440);const context=a.context();try{
    await seed(a);const b=await context.newPage();await b.goto("/market?tab=watchlist");await expect(b.getByTestId("market-focus-direction")).toBeEnabled();
    await Promise.all([pick(a,"direction","Бычье"),pick(b,"poi","FVG")]);await expect(a.getByTestId("market-focus-poi")).toContainText("FVG");await expect(b.getByTestId("market-focus-direction")).toContainText("Бычье");
    const reset=a.getByTestId("market-focus-reset");await reset.focus();await reset.press("Enter");const dialog=a.getByRole("dialog");await expect(dialog.getByText("Отмена",{exact:true})).toBeFocused();
    await focus(b).getByRole("checkbox",{name:"Реакция",exact:true}).check();await saved(b);
    await dialog.getByRole("button",{name:"Сбросить фокус",exact:true}).click();await expect(dialog).toContainText("Фокус изменён в другой вкладке");await expect(focus(b).getByRole("checkbox",{name:"Реакция",exact:true})).toBeChecked();
    await dialog.getByRole("button",{name:"Проверить сброс",exact:true}).click();await dialog.getByRole("button",{name:"Сбросить фокус",exact:true}).click();await expect(dialog).toHaveCount(0);await expect(b.getByTestId("market-focus-direction")).toContainText("Не выбрано");await expect(focus(b).getByRole("checkbox",{name:"Реакция",exact:true})).not.toBeChecked();
    await pick(a,"direction","Нейтральное");await saved(a);await reset.click();await a.keyboard.press("Escape");await expect(reset).toBeFocused();await expect(a.getByTestId("market-focus-direction")).toContainText("Нейтральное");
  }finally{await context.close();}
});

test("IndexedDB unavailable does not block Watchlist or pretend to save",async({browser})=>{
  const {page}=await marketGuest(browser,390);try{
    await page.addInitScript(()=>Object.defineProperty(window,"indexedDB",{get(){throw new DOMException("Denied","SecurityError");}}));
    await page.addInitScript(()=>{localStorage.setItem("ayra_guest_dismissed","1");localStorage.setItem("ayra_market_watchlist",JSON.stringify({version:1,ids:["eurusd","gold"]}));});
    await page.goto("/market?tab=watchlist");await expect(page.getByTestId("market-focus-status")).toHaveAttribute("data-kind","storage");await expect(page.getByTestId("market-focus-direction")).toBeDisabled();
    await page.getByTestId("market-watchlist-query").fill("XAUUSD");await expect(page.getByTestId("market-watchlist-row-gold")).toBeVisible();await expect(page.getByTestId("market-watchlist-row-eurusd")).toHaveCount(0);
  }finally{await page.context().close();}
});

test("aborted entry transaction leaves confirmed value and exposes storage error",async({browser})=>{
  const {page}=await marketGuest(browser,390);try{
    await seed(page);await pick(page,"direction","Бычье");await saved(page);
    await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore["put"]>){if(this.name==="entries"){IDBObjectStore.prototype.put=original;throw new DOMException("Quota","QuotaExceededError");}return original.apply(this,args);};});
    await pick(page,"direction","Медвежье");await expect(page.getByTestId("market-focus-status")).toHaveAttribute("data-kind","storage");await expect(page.getByTestId("market-focus-direction")).toContainText("Бычье");await focus(page).getByRole("button",{name:"Повторить чтение"}).click();await saved(page);
  }finally{await page.context().close();}
});

test("real fake-auth A → B → Guest → A keeps focus local and sends no focus/metadata writes",async({browser,request})=>{
  const context=await browser.newContext({reducedMotion:"reduce"});await stubTradingView(context,"ok");const page=await context.newPage();const stamp=Date.now();let aId="";try{
    const openAccount=async(email:string,first:boolean)=>{await signIn(page,email);if(first)await completeOnboarding(page,`Focus${Date.now()%10000000}`);const profile=await(await request.get(`http://127.0.0.1:54329/__test/profile?email=${encodeURIComponent(email)}`)).json();await page.evaluate(id=>{localStorage.setItem(`ayra:${id}:ayra_market_watchlist`,JSON.stringify({version:1,ids:["eurusd","gold"],updatedAt:"2026-11-22T00:00:00Z"}));},profile.id);await page.goto("/market?tab=watchlist");await expect(page.getByTestId("market-focus-direction")).toBeEnabled();return profile.id as string;};
    const signOut=async()=>{await page.goto("/settings/account");await page.getByRole("button",{name:"Выйти",exact:true}).click();await expect(page).toHaveURL(/\/login/);};
    aId=await openAccount(`FocusA_${stamp}@example.com`,true);await pick(page,"direction","Бычье");await saved(page);await signOut();
    await openAccount(`FocusB_${stamp}@example.com`,true);await expect(page.getByTestId("market-focus-direction")).toContainText("Не выбрано");await pick(page,"direction","Медвежье");await saved(page);await signOut();
    await page.evaluate(()=>{localStorage.setItem("ayra_guest_dismissed","1");localStorage.setItem("ayra_market_watchlist",JSON.stringify({version:1,ids:["eurusd","gold"]}));});
    await page.goto("/market?tab=watchlist");await expect(page.getByTestId("market-focus-direction")).toBeEnabled();await expect(page.getByTestId("market-focus-direction")).toContainText("Не выбрано");
    await openAccount(`FocusA_${stamp}@example.com`,false);await expect(page.getByTestId("market-focus-direction")).toContainText("Бычье");
    const cloud=await(await request.get(`http://127.0.0.1:54329/__test/cloud-rows?email=${encodeURIComponent(`FocusA_${stamp}@example.com`)}`)).json();expect(cloud.some((r:{id:string})=>r.id==="watchlist_meta"||r.id.includes("focus"))).toBe(false);expect(aId).toBeTruthy();
  }finally{await page.context().close();}
});

for(const width of [360,390,768,1024,1440])for(const lang of ["ru","en"] as const)test(`Market Focus layout ${width} ${lang}`,async({browser})=>{
  const {page}=await marketGuest(browser,width);const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));try{
    await seed(page,lang);await pick(page,"direction",lang==="ru"?"Бычье":"Bullish");await pick(page,"poi","FVG");await pick(page,"mss",lang==="ru"?"Ожидание":"Waiting");await pick(page,"session",lang==="ru"?"Лондон":"London");
    await focus(page).getByRole("checkbox").first().check();await saved(page);
    expect(await focus(page).evaluate(node=>{const quotes=document.querySelector('[data-testid="market-watchlist-quotes"]');return !!quotes&&!!(quotes.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING);})).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);await expect(focus(page).getByRole("combobox")).toHaveCount(5);
    await focus(page).getByRole("checkbox").last().scrollIntoViewIfNeeded();await focus(page).getByRole("checkbox").last().click({trial:true});
    await page.getByTestId("market-focus-status").scrollIntoViewIfNeeded();await expect(page.getByTestId("market-focus-status")).toBeVisible();
    if(process.env.AYRA_FOCUS_SCREENSHOTS&&[390,1440].includes(width)){
      mkdirSync(process.env.AYRA_FOCUS_SCREENSHOTS,{recursive:true});
      // A tall viewport lets the real scroll pane fit the whole mobile panel without altering app styles.
      await page.setViewportSize({width,height:width<768?1600:1000});await focus(page).scrollIntoViewIfNeeded();
      await focus(page).screenshot({path:`${process.env.AYRA_FOCUS_SCREENSHOTS}/focus-${width}-${lang}.png`});
    }
    expect(errors).toEqual([]);
  }finally{await page.context().close();}
});
