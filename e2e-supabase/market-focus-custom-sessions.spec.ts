import { test, expect, type Page } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";
import { mkdirSync } from "node:fs";
import { signIn } from "../e2e/helpers/auth";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { stubTradingView } from "../e2e/helpers/tradingview";

async function open(page:Page,lang:"ru"|"en"="en",clock="2026-03-30T06:50:00Z"){
  await page.addInitScript(lang=>{localStorage.setItem("ayra_guest_dismissed","1");localStorage.setItem("ayra_lang",lang);if(!sessionStorage.getItem("focus-e-seeded")){sessionStorage.setItem("focus-e-seeded","1");localStorage.setItem("ayra_market_watchlist",JSON.stringify({version:1,ids:["eurusd","gold"]}));}},lang);
  await page.clock.install({time:new Date(clock)});await page.goto("/market?tab=watchlist");await expect(page.getByTestId("focus-manage-session")).toBeEnabled();
}
async function create(page:Page,{lang="en",label="Custom session",zone="London",start="08:00",end="17:00",enabled=true,sunday=false}:{lang?:"ru"|"en";label?:string;zone?:string;start?:string;end?:string;enabled?:boolean;sunday?:boolean}={}){
  await page.getByTestId("focus-manage-session").click();await page.getByTestId("focus-catalog-name").fill(label);await page.getByTestId("focus-session-start").fill(start);await page.getByTestId("focus-session-end").fill(end);await page.getByTestId("timezone-select").click();await page.getByRole("option").filter({hasText:zone}).first().click();
  const schedule=page.getByTestId("focus-session-schedule");const days=schedule.getByRole("checkbox");for(let i=0;i<7;i++){if(i<5)await expect(days.nth(i)).toBeChecked();else await expect(days.nth(i)).not.toBeChecked();}
  await expect(page.getByTestId("focus-custom-session-enabled")).not.toBeChecked();if(sunday)await days.nth(6).check();if(enabled)await page.getByTestId("focus-custom-session-enabled").check();
  await page.getByTestId("focus-catalog-save").click();await expect(page.getByTestId("focus-catalog-editor")).toContainText(lang==="en"?"Type saved on this device":"Тип сохранён на этом устройстве");
  if(enabled)await expect(page.getByTestId("focus-custom-session-enabled")).toBeChecked();else await expect(page.getByTestId("focus-custom-session-enabled")).not.toBeChecked();
  await page.getByTestId("market-focus-session").click();await page.getByRole("option").filter({hasText:label}).click();await expect(page.getByTestId("market-focus-status")).toHaveAttribute("data-kind","saved");
}
async function snapshot(page:Page,space="guest"){
  return page.evaluate(async space=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("ayra_market_focus_v1",2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return new Promise<{version:number;entries:Record<string,unknown>[];preference:Record<string,unknown>}>((resolve,reject)=>{const tx=db.transaction(["entries","preferences"],"readonly"),rows=tx.objectStore("entries").getAll(),pref=tx.objectStore("preferences").get(space);tx.oncomplete=()=>{db.close();resolve({version:db.version,entries:rows.result.filter(row=>row.spaceId===space),preference:pref.result});};tx.onabort=()=>{db.close();reject(tx.error);};});},space);
}
test("custom reminder commits once, works offline, and survives reload without replay",async({browser})=>{
  const {page}=await marketGuest(browser,390);try{await open(page);await create(page);await page.context().setOffline(true);await page.clock.fastForward(301000);await expect(page.getByTestId("focus-alert-message")).toContainText("Your selected session");
    const saved=await snapshot(page);expect(saved.version).toBe(2);expect(saved.preference.customCatalog).toMatchObject({version:2});expect(JSON.stringify(saved.entries)).toContain('"2026-03-30"');
    await page.context().setOffline(false);await page.reload();await expect(page.getByTestId("market-focus-session")).toContainText("Custom session");await page.clock.fastForward(20000);await expect(page.getByTestId("focus-alert-message")).toHaveCount(0);expect((await snapshot(page)).entries).toEqual(saved.entries);
  }finally{await page.context().close();}
});
test("two real tabs claim the same custom cycle once and rename cannot produce a duplicate",async({browser})=>{
  const {page:a}=await marketGuest(browser,1440);const ctx=a.context();try{await open(a);await create(a);const b=await ctx.newPage();await b.goto("/market?tab=watchlist");await expect(b.getByTestId("market-focus-session")).toContainText("Custom session");
    await a.clock.fastForward(301000); // Playwright clock is context-wide: this advances both tabs once.
    await expect.poll(async()=>await a.getByTestId("focus-alert-message").count()+await b.getByTestId("focus-alert-message").count()).toBe(1);
    await a.getByRole("button",{name:"Edit: Custom session",exact:true}).click();await a.getByTestId("focus-catalog-name").fill("Renamed session");await a.getByTestId("focus-catalog-save").click();await expect(b.getByTestId("market-focus-session")).toContainText("Renamed session");
    for(const page of [a,b])if(await page.getByTestId("focus-alert-message").count())await page.getByTestId("focus-alert-message").getByRole("button",{name:"Dismiss"}).click();
    await a.clock.fastForward(20000);await expect(a.getByTestId("focus-alert-message")).toHaveCount(0);await expect(b.getByTestId("focus-alert-message")).toHaveCount(0);
  }finally{await ctx.close();}
});
test("opening Watchlist after a deadline does not catch up an undelivered custom cycle",async({browser})=>{
  const {page}=await marketGuest(browser,390);try{await open(page);await create(page);await page.goto("/academy");await page.clock.fastForward(301000);await page.goto("/market?tab=watchlist");await expect(page.getByTestId("market-focus-session")).toContainText("Custom session");await page.clock.fastForward(20000);await expect(page.getByTestId("focus-alert-message")).toHaveCount(0);expect(JSON.stringify((await snapshot(page)).entries)).not.toContain("customSessionReceipts");
  }finally{await page.context().close();}
});
test("New York fold delivers the first instant once; the repeated hour never produces another event",async({browser})=>{
  const {page}=await marketGuest(browser,390);try{await open(page,"en","2026-11-01T05:20:00Z");await create(page,{zone:"New York",start:"01:30",end:"03:00",sunday:true});await page.clock.fastForward(301000);await expect(page.getByTestId("focus-alert-message")).toContainText("Your selected session");await page.getByTestId("focus-alert-message").getByRole("button",{name:"Dismiss"}).click();await page.clock.fastForward(3600000);await expect(page.getByTestId("focus-alert-message")).toHaveCount(0);
  }finally{await page.context().close();}
});
test("London gap is skipped without shifting to a different local hour",async({browser})=>{
  const {page}=await marketGuest(browser,390);try{await open(page,"en","2026-03-29T00:20:00Z");await create(page,{start:"01:30",end:"03:00",sunday:true});await page.clock.fastForward(70*60000);await expect(page.getByTestId("focus-alert-message")).toHaveCount(0);expect(JSON.stringify((await snapshot(page)).entries)).not.toContain("customSessionReceipts");
  }finally{await page.context().close();}
});
for(const lang of ["ru","en"] as const)for(const width of [360,390,768,1024,1440])test(`custom session schedule ${lang} ${width}`,async({browser})=>{
  const {page}=await marketGuest(browser,width,{height:1400}),errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));try{await open(page,lang);await create(page,{lang,label:lang==="ru"?"Моя ночная сессия":"My overnight session",start:"23:00",end:"02:00",enabled:false});await page.getByRole("button",{name:lang==="ru"?"Изменить: Моя ночная сессия":"Edit: My overnight session",exact:true}).click();await expect(page.getByTestId("focus-custom-session-enabled")).not.toBeChecked();await page.getByTestId("focus-custom-session-enabled").focus();await page.keyboard.press("Space");await expect(page.getByTestId("focus-custom-session-enabled")).toBeChecked();await page.getByTestId("focus-catalog-save").click();await expect(page.getByTestId("focus-catalog-editor")).toContainText(lang==="ru"?"Тип сохранён":"Type saved");await page.getByRole("button",{name:lang==="ru"?"Изменить: Моя ночная сессия":"Edit: My overnight session",exact:true}).click();await expect(page.getByTestId("focus-custom-session-enabled")).toBeChecked();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
    if(process.env.AYRA_CUSTOM_SESSION_SCREENS&&[390,1440].includes(width)){mkdirSync(process.env.AYRA_CUSTOM_SESSION_SCREENS,{recursive:true});await page.setViewportSize({width,height:width<768?2800:1700});await page.getByTestId("market-focus").scrollIntoViewIfNeeded();await page.getByTestId("market-focus").screenshot({path:`${process.env.AYRA_CUSTOM_SESSION_SCREENS}/${width}-${lang}.png`});}
  }finally{await page.context().close();}
});

test.describe("custom session account isolation",()=>{
  const emailA=`SessionA_${Date.now()}@example.com`;
  test.beforeAll(async({browser})=>{const context=await browser.newContext();const page=await context.newPage();try{await signIn(page,emailA);await completeOnboarding(page,`SessionA${Date.now()%10000000}`);}finally{await context.close();}});
  test("A → B → Guest → A retains only its own opt-in and never copies the guest catalog",async({browser,request})=>{
    const context=await browser.newContext({viewport:{width:390,height:1400}});await stubTradingView(context,"ok");const page=await context.newPage();try{
      const account=async(email:string,first=false)=>{await signIn(page,email);if(first)await completeOnboarding(page,`SessionB${Date.now()%10000000}`);const profile=await(await request.get(`http://127.0.0.1:54329/__test/profile?email=${encodeURIComponent(email)}`)).json();await page.evaluate(id=>localStorage.setItem(`ayra:${id}:ayra_market_watchlist`,JSON.stringify({version:1,ids:["eurusd"]})),profile.id);await page.goto("/market?tab=watchlist");await expect(page.getByTestId("focus-manage-session")).toBeEnabled();return profile.id as string;};
      const logout=async()=>{await page.goto("/settings/account");await page.getByRole("button",{name:"Выйти",exact:true}).click();await expect(page).toHaveURL(/\/login/);};
      const a=await account(emailA);await create(page,{lang:"ru",label:"Account A session"});await logout();await account(`SessionB_${Date.now()}@example.com`,true);await page.getByTestId("focus-manage-session").click();await expect(page.getByTestId("focus-catalog-editor")).not.toContainText("Account A session");await logout();
      await page.addInitScript(()=>{localStorage.setItem("ayra_guest_dismissed","1");localStorage.setItem("ayra_market_watchlist",JSON.stringify({version:1,ids:["eurusd"]}));});await page.goto("/market?tab=watchlist");await expect(page.getByTestId("focus-manage-session")).toBeEnabled();await create(page,{lang:"ru",label:"Guest session",enabled:false});await account(emailA);await expect(page.getByTestId("market-focus-session")).toContainText("Account A session");const own=await snapshot(page,`account:${a}`);expect(JSON.stringify(own.preference)).toContain('"enabled":true');expect(JSON.stringify(own.preference)).not.toContain("Guest session");
    }finally{await context.close();}
  });
});
