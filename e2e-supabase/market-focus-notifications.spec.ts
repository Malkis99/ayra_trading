import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";
import { mkdirSync } from "node:fs";
import { signIn } from "../e2e/helpers/auth";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { stubTradingView } from "../e2e/helpers/tradingview";

async function openAccount(page: Page, request: APIRequestContext, email: string, first: boolean) {
  await signIn(page,email);if(first)await completeOnboarding(page,`Alert${Date.now()%10000000}`);
  const profile=await(await request.get(`http://127.0.0.1:54329/__test/profile?email=${encodeURIComponent(email)}`)).json();
  await page.evaluate(id=>localStorage.setItem(`ayra:${id}:ayra_market_watchlist`,JSON.stringify({version:1,ids:["eurusd"]})),profile.id);
  await page.goto("/market?tab=watchlist");await page.getByTestId("focus-alerts").locator("summary").click();await expect(page.getByTestId("focus-alerts").getByRole("checkbox").first()).toBeEnabled();
}
test("account policy failure pauses delivery without claiming a saved completion",async({browser,request})=>{
  const context=await browser.newContext({viewport:{width:390,height:1000}});await stubTradingView(context,"ok");const page=await context.newPage();try{
    await page.route("**/rest/v1/notification_settings?*",r=>r.fulfill({status:500,json:{message:"test unavailable"}}));
    await openAccount(page,request,`FocusPolicy_${Date.now()}@example.com`,true);
    await page.getByTestId("focus-alerts").getByRole("checkbox").first().check();await expect(page.getByTestId("focus-alerts")).toContainText("Настройки сохранены на этом устройстве");
    const checks=page.getByTestId("market-focus-checklist").getByRole("checkbox");await expect(checks).toHaveCount(6);for(const check of await checks.all())await check.check();
    await expect(page.getByTestId("focus-alerts")).toContainText("Напоминания приостановлены");await expect(page.getByTestId("focus-alert-message")).toHaveCount(0);
  }finally{await context.close();}
});
test("A → B → Guest → A preserves isolated opt-ins",async({browser,request})=>{
  const context=await browser.newContext({viewport:{width:390,height:1000},timezoneId:"Asia/Tbilisi"});await stubTradingView(context,"ok");const page=await context.newPage();const stamp=Date.now();try{
    const open=(email:string,first:boolean)=>openAccount(page,request,email,first);
    const out=async()=>{await page.goto("/settings/account");await page.getByRole("button",{name:"Выйти",exact:true}).click();await expect(page).toHaveURL(/\/login/);};
    const a=`FocusAlertA_${stamp}@example.com`,b=`FocusAlertB_${stamp}@example.com`;
    await open(a,true);await page.getByTestId("focus-alerts").getByRole("checkbox").first().check();await expect(page.getByTestId("focus-alerts")).toContainText("Настройки сохранены на этом устройстве");
    await out();
    await open(b,true);await expect(page.getByTestId("focus-alerts").getByRole("checkbox").first()).not.toBeChecked();await expect(page.getByTestId("focus-alert-message")).toHaveCount(0);await out();
    await page.evaluate(()=>{localStorage.setItem("ayra_guest_dismissed","1");localStorage.setItem("ayra_market_watchlist",JSON.stringify({version:1,ids:["eurusd"]}));});await page.goto("/market?tab=watchlist");await page.getByTestId("focus-alerts").locator("summary").click();await expect(page.getByTestId("focus-alerts").getByRole("checkbox").first()).not.toBeChecked();
    await open(a,false);await expect(page.getByTestId("focus-alerts").getByRole("checkbox").first()).toBeChecked();
  }finally{await page.context().close();}
});

test("local completion is opt-in, committed, deduplicated across tabs and isolated after reload",async({browser})=>{
  const {page:a}=await marketGuest(browser,390);const ctx=a.context();try{
    await a.addInitScript(()=>{localStorage.setItem("ayra_guest_dismissed","1");localStorage.setItem("ayra_lang","en");localStorage.setItem("ayra_market_watchlist",JSON.stringify({version:1,ids:["eurusd","gold"]}));});
    await a.goto("/market?tab=watchlist");const settings=a.getByTestId("focus-alerts");await settings.locator("summary").click();
    const opt=settings.getByRole("checkbox",{name:"Checklist completion",exact:true});await expect(opt).toBeEnabled();await expect(opt).not.toBeChecked();
    await opt.check();await expect(settings.getByText("Settings saved on this device",{exact:true})).toBeVisible();
    const b=await ctx.newPage();await b.goto("/market?tab=watchlist");await expect(b.getByTestId("market-focus-direction")).toBeEnabled();
    const checks=a.getByTestId("market-focus-checklist").getByRole("checkbox");for(const c of await checks.all())await c.check();
    await expect(a.getByTestId("market-focus-status")).toHaveAttribute("data-kind","saved");
    await expect.poll(async()=>await a.getByTestId("focus-alert-message").count()+await b.getByTestId("focus-alert-message").count()).toBe(1);
    await a.reload();await b.reload();await expect(a.getByTestId("market-focus-direction")).toBeEnabled();await expect(b.getByTestId("market-focus-direction")).toBeEnabled();await expect(a.getByTestId("focus-alert-message")).toHaveCount(0);await expect(b.getByTestId("focus-alert-message")).toHaveCount(0);
  }finally{await ctx.close();}
});

test("manual reminder uses UTC, can be cancelled, works offline, and does not replay after expiry",async({browser})=>{
  const {page}=await marketGuest(browser,390);try{
    await page.addInitScript(()=>{localStorage.setItem("ayra_guest_dismissed","1");localStorage.setItem("ayra_lang","en");localStorage.setItem("ayra_market_watchlist",JSON.stringify({version:1,ids:["eurusd"]}));});
    await page.clock.install({time:new Date("2026-11-23T08:00:00Z")});await page.goto("/market?tab=watchlist");const panel=page.getByTestId("focus-alerts");await panel.locator("summary").click();
    const input=panel.getByLabel("Reminder date and time (UTC)");await expect(input).toBeEnabled();await input.fill("2026-11-23T08:01");await panel.getByRole("button",{name:"Set reminder",exact:true}).click();await expect(panel.getByText("Scheduled (UTC): 2026-11-23T08:01:00.000Z",{exact:true})).toBeVisible();
    await panel.getByRole("button",{name:"Delete reminder",exact:true}).click();await expect(panel.getByRole("button",{name:"Delete reminder",exact:true})).toHaveCount(0);await page.clock.fastForward(80_000);await expect(page.getByTestId("focus-alert-message")).toHaveCount(0);
    await input.fill("2026-11-23T08:03");await panel.getByRole("button",{name:"Set reminder",exact:true}).click();await expect(panel.getByRole("button",{name:"Delete reminder",exact:true})).toBeEnabled();await page.context().setOffline(true);await page.clock.fastForward(110_000);await expect(page.getByTestId("focus-alert-message")).toContainText("Time to review this instrument");await page.context().setOffline(false);
    await page.getByTestId("focus-alert-message").getByRole("button",{name:"Dismiss"}).click();await page.reload();await expect(page.getByTestId("market-focus-direction")).toBeEnabled();await page.clock.fastForward(120_000);await expect(page.getByTestId("focus-alert-message")).toHaveCount(0);
  }finally{await page.context().close();}
});

test("London reminder uses the existing DST session occurrence, not a fixed UTC hour",async({browser})=>{
  const {page}=await marketGuest(browser,390);try{
    await page.addInitScript(()=>{localStorage.setItem("ayra_guest_dismissed","1");localStorage.setItem("ayra_lang","en");localStorage.setItem("ayra_market_watchlist",JSON.stringify({version:1,ids:["eurusd"]}));});
    await page.clock.install({time:new Date("2026-03-30T06:54:00Z")});await page.goto("/market?tab=watchlist");await page.getByTestId("market-focus-session").click();await page.getByRole("option",{name:"London",exact:true}).click();
    const panel=page.getByTestId("focus-alerts");await panel.locator("summary").click();await panel.getByRole("checkbox",{name:"Selected session reminder",exact:true}).check();await expect(panel.getByText("Settings saved on this device",{exact:true})).toBeVisible();
    await page.clock.fastForward(70_000);await expect(page.getByTestId("focus-alert-message")).toContainText("Your selected session is approaching or starting");
  }finally{await page.context().close();}
});

for(const lang of ["ru","en"] as const)for(const width of [360,390,768,1024,1440])test(`local notification settings ${lang} ${width}`,async({browser})=>{
  const {page}=await marketGuest(browser,width,{height:1200});try{
    await page.addInitScript(lang=>{localStorage.setItem("ayra_guest_dismissed","1");localStorage.setItem("ayra_lang",lang);localStorage.setItem("ayra_market_watchlist",JSON.stringify({version:1,ids:["eurusd"]}));},lang);
    const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.goto("/market?tab=watchlist");const panel=page.getByTestId("focus-alerts");await panel.locator("summary").focus();await page.keyboard.press("Enter");await expect(panel.locator('input[type="datetime-local"]')).toBeEnabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
    if(process.env.AYRA_FOCUS_ALERT_SCREENS&&(width===390||width===1440)){mkdirSync(process.env.AYRA_FOCUS_ALERT_SCREENS,{recursive:true});await page.setViewportSize({width,height:width<768?2200:1500});await page.getByTestId("market-focus").scrollIntoViewIfNeeded();await page.getByTestId("market-focus").screenshot({path:`${process.env.AYRA_FOCUS_ALERT_SCREENS}/${width}-${lang}.png`});}
  }finally{await page.context().close();}
});
