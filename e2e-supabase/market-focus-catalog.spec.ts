import { test, expect, type Page } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";
import { installLegacyFocus } from "../e2e/helpers/focus-legacy";
import { mkdirSync, readFileSync } from "node:fs";
import { signIn } from "../e2e/helpers/auth";
import { completeOnboarding } from "../e2e/helpers/onboarding";
import { stubTradingView } from "../e2e/helpers/tradingview";

async function open(page:Page,lang:"ru"|"en"="ru"){
  await page.addInitScript(lang=>{localStorage.setItem("ayra_guest_dismissed","1");localStorage.setItem("ayra_lang",lang);if(!sessionStorage.getItem("focus-d-seeded")){sessionStorage.setItem("focus-d-seeded","1");localStorage.setItem("ayra_market_watchlist",JSON.stringify({version:1,ids:["eurusd","gold"]}));}},lang);
  await page.goto("/market?tab=watchlist");await expect(page.getByTestId("focus-manage-poi")).toBeEnabled();
}
async function manage(page:Page,kind:string){await page.getByTestId(`focus-manage-${kind}`).click();await expect(page.getByTestId("focus-catalog-name")).toBeVisible();}
async function create(page:Page,kind:string,label:string,lang:"ru"|"en"="ru",session?:{start:string;end:string;zone:string}){
  await manage(page,kind);await page.getByTestId("focus-catalog-editor").getByRole("button",{name:lang==="ru"?"Новое значение":"New value",exact:true}).click();await page.getByTestId("focus-catalog-name").fill(label);
  if(session){await page.getByTestId("focus-session-start").fill(session.start);await page.getByTestId("focus-session-end").fill(session.end);await page.getByTestId("timezone-select").click();await page.getByRole("option").filter({hasText:session.zone.split("/").at(-1)!.replaceAll("_"," ")}).first().click();if(session.end<session.start)await expect(page.getByTestId("focus-catalog-editor")).toContainText(lang==="ru"?"Окончание в следующий локальный день":"Ends on the next local day");}
  await page.getByTestId("focus-catalog-save").click();await expect(page.getByTestId("focus-catalog-editor")).toContainText(lang==="ru"?"Тип сохранён на этом устройстве":"Type saved on this device");
}
async function pick(page:Page,kind:string,label:string){await page.getByTestId(`market-focus-${kind}`).click();await page.getByRole("option").filter({hasText:label}).first().click();if(kind==="instrument")await expect(page.getByTestId("focus-manage-poi")).toBeEnabled();else await expect(page.getByTestId("market-focus-status")).toHaveAttribute("data-kind","saved");}
async function rows(page:Page,space="guest"){return page.evaluate(async space=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("ayra_market_focus_v1",2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return new Promise<{version:number;entries:Record<string,unknown>[];preference:Record<string,unknown>|undefined}>((resolve,reject)=>{const tx=db.transaction(["entries","preferences"],"readonly"),r=tx.objectStore("entries").getAll(),p=tx.objectStore("preferences").get(space);tx.oncomplete=()=>{db.close();resolve({version:db.version,entries:r.result.filter(row=>row.spaceId===space),preference:p.result});};tx.onabort=()=>{db.close();reject(tx.error);};});},space);}

test("custom library supports all fields, sharing, rename, tombstone and offline persistence without losing checklist",async({browser})=>{
  const {page}=await marketGuest(browser,390);try{
    await open(page);await page.getByTestId("market-focus-checklist").getByRole("checkbox").first().check();
    for(const [kind,label]of [["poi","Breaker"],["mss","CHoCH"],["direction","Range"]]){await create(page,kind,label);await pick(page,kind,label);}
    expect((await rows(page)).entries[0].version).toBe(3);await expect(page.getByTestId("market-focus-checklist").getByRole("checkbox").first()).toBeChecked();
    await pick(page,"instrument","Золото");await expect(page.getByTestId("market-focus-poi")).toContainText("Не выбрано");await pick(page,"poi","Breaker");await manage(page,"poi");
    await page.getByRole("button",{name:"Изменить: Breaker",exact:true}).click();await page.getByTestId("focus-catalog-name").fill("Reviewed breaker");await page.getByTestId("focus-catalog-save").click();await expect(page.getByTestId("market-focus-poi")).toContainText("Reviewed breaker");
    await page.getByRole("button",{name:"Удалить: Reviewed breaker",exact:true}).click();await expect(page.getByRole("dialog")).toContainText("Используется в 2 инструментах");await page.getByRole("dialog").getByRole("button",{name:"Удалить тип",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);await expect(page.getByTestId("market-focus-poi")).toContainText("Удалённый тип");
    await page.context().setOffline(true);await pick(page,"poi","FVG");await page.context().setOffline(false);await page.reload();await expect(page.getByTestId("market-focus-poi")).toContainText("FVG");
    await pick(page,"instrument","EUR/USD");await expect(page.getByTestId("market-focus-poi")).toContainText("Удалённый тип");await expect(page.getByTestId("market-focus-direction")).toContainText("Range");await expect(page.getByTestId("market-focus-checklist").getByRole("checkbox").first()).toBeChecked();
    await page.getByTestId("market-focus-reset").click();await page.getByRole("dialog").getByRole("button",{name:"Сбросить фокус",exact:true}).click();await expect(page.getByTestId("market-focus-direction")).toContainText("Не выбрано");await manage(page,"mss");await expect(page.getByTestId("focus-catalog-editor")).toContainText("CHoCH");
  }finally{await page.context().close();}
});

test("real Chromium lazy V2 migration preserves receipts and fences an accepted old-tab write; legacy export works",async({browser})=>{
  const {page:a}=await marketGuest(browser,1440);const ctx=a.context();try{
    await open(a);await a.evaluate(async()=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("ayra_market_focus_v1",2);r.onsuccess=()=>resolve(r.result);});await new Promise<void>(resolve=>{const tx=db.transaction("entries","readwrite");tx.objectStore("entries").put({version:2,spaceId:"guest",instrumentId:"eurusd",revision:7,direction:"bullish",poi:null,mss:null,session:"london",opaque:{keep:true},checklist:{orderRevision:0,items:["poiReached","liquiditySweep","displacement","mssCisd","retracementTest","reaction"].map((key,i)=>({id:`template:${key}`,template:key,text:null,checked:i<2,revision:1}))},localAlerts:{version:1,revision:1,completion:true,session:false,lead:5,enabledAt:1,reminder:null,completionEvent:null,seenCompletion:6,seenSession:123,seenReminder:456}});tx.oncomplete=()=>resolve();});db.close();window.dispatchEvent(new Event("focus"));});
    await expect(a.getByTestId("market-focus-direction")).toContainText("Бычье");const before=(await rows(a)).entries[0];const b=await ctx.newPage();await b.goto("/market?tab=watchlist");await installLegacyFocus(b);
    await b.evaluate(()=>{const original=indexedDB.open.bind(indexedDB);let first=true;indexedDB.open=((...args:Parameters<IDBFactory["open"]>)=>{const request=original(...args);if(first){first=false;Object.defineProperty(request,"onsuccess",{set(handler:(event:Event)=>void){request.addEventListener("success",event=>{window.releaseLegacyOpen=()=>handler.call(request,event);});}});}return request;}) as IDBFactory["open"];window.legacyWriteResult=window.watchLegacyFocus.patch("guest","eurusd",{field:"poi",value:"fvg"}).then(()=>"unexpected-write",error=>error.kind);});
    await expect.poll(()=>b.evaluate(()=>typeof window.releaseLegacyOpen)).toBe("function");await create(a,"poi","Custom zone");await pick(a,"poi","Custom zone");
    await b.evaluate(()=>window.releaseLegacyOpen!());expect(await b.evaluate(()=>window.legacyWriteResult)).toBe("unsupported");
    const after=(await rows(a)).entries[0];expect(after.version).toBe(3);expect(after.checklist).toEqual(before.checklist);expect(after.localAlerts).toEqual(before.localAlerts);expect(after.opaque).toEqual(before.opaque);expect((await rows(a)).version).toBe(2);await expect(a.getByTestId("focus-alert-message")).toHaveCount(0);
    const exported=await b.evaluate(()=>window.watchLegacyFocus.exportSpace("guest"));expect(exported.databaseVersion).toBe(2);expect(exported.entries).toEqual([after]);await b.evaluate(()=>window.watchLegacyFocus.select("guest","gold"));expect(JSON.stringify((await rows(a)).preference)).toContain("Custom zone");
  }finally{await ctx.close();}
});

test("real V1 upgrade then custom selection keeps all six legacy marks and creates no completion",async({browser})=>{
  const {page}=await marketGuest(browser,390);try{
    await page.addInitScript(()=>{if(sessionStorage.getItem("focus-d-v1"))return;sessionStorage.setItem("focus-d-v1","1");const r=indexedDB.open("ayra_market_focus_v1",1);r.onupgradeneeded=()=>{r.result.createObjectStore("entries",{keyPath:["spaceId","instrumentId"]});r.result.createObjectStore("preferences",{keyPath:"spaceId"});};r.onsuccess=()=>{const db=r.result,tx=db.transaction("entries","readwrite");tx.objectStore("entries").put({version:1,spaceId:"guest",instrumentId:"eurusd",revision:4,direction:"bullish",poi:null,mss:null,session:null,checklist:{poiReached:true,liquiditySweep:false,displacement:true,mssCisd:false,retracementTest:true,reaction:false}});tx.oncomplete=()=>db.close();};});
    await open(page);expect((await rows(page)).entries[0].version).toBe(2);await create(page,"mss","My structure");await pick(page,"mss","My structure");const row=(await rows(page)).entries[0];expect(row.version).toBe(3);expect((row.checklist as {items:{checked:boolean}[]}).items.map(i=>i.checked)).toEqual([true,false,true,false,true,false]);await expect(page.getByTestId("focus-alert-message")).toHaveCount(0);
  }finally{await page.context().close();}
});

test("two tabs preserve drafts and reject delete when a new reference appeared",async({browser})=>{
  const {page:a}=await marketGuest(browser,1440);const ctx=a.context();try{
    await open(a);await create(a,"poi","Shared type");const b=await ctx.newPage();await b.goto("/market?tab=watchlist");await expect(b.getByTestId("focus-manage-poi")).toBeEnabled();await manage(b,"poi");
    await a.getByRole("button",{name:"Изменить: Shared type",exact:true}).click();await a.getByTestId("focus-catalog-name").fill("Old draft");await b.getByRole("button",{name:"Изменить: Shared type",exact:true}).click();await b.getByTestId("focus-catalog-name").fill("Reviewed type");await b.getByTestId("focus-catalog-save").click();
    await expect(a.getByTestId("focus-catalog-save")).toBeDisabled();await expect(a.getByTestId("focus-catalog-name")).toHaveValue("Old draft");await a.getByTestId("focus-catalog-editor").getByRole("button",{name:"Взять актуальное значение",exact:true}).click();await expect(a.getByTestId("focus-catalog-name")).toHaveValue("Reviewed type");
    await a.getByRole("button",{name:"Удалить: Reviewed type",exact:true}).click();await pick(b,"instrument","Золото");await pick(b,"poi","Reviewed type");await a.getByRole("dialog").getByRole("button",{name:"Удалить тип",exact:true}).click();await expect(a.getByRole("dialog")).toContainText("Тип или его связи изменены");await expect(b.getByTestId("market-focus-poi")).not.toContainText("Удалённый тип");
    await a.getByRole("dialog").getByRole("button",{name:"Проверить изменения",exact:true}).click();await a.getByRole("button",{name:"Удалить: Reviewed type",exact:true}).click();await expect(a.getByRole("dialog")).toContainText("Используется в 1 инструментах");await a.getByRole("dialog").getByRole("button",{name:"Удалить тип",exact:true}).click();await expect(b.getByTestId("market-focus-poi")).toContainText("Удалённый тип");
  }finally{await ctx.close();}
});

test("custom overnight session stays local with reminders disabled; standard London still fires after V3 conversion",async({browser})=>{
  const {page}=await marketGuest(browser,390);try{
    await page.clock.install({time:new Date("2026-03-30T06:54:00Z")});await open(page);await pick(page,"session","Лондон");const alerts=page.getByTestId("focus-alerts");await alerts.locator("summary").click();await alerts.getByRole("checkbox").nth(1).check();await expect(alerts).toContainText("Настройки сохранены на этом устройстве");
    await create(page,"session","Night focus","ru",{start:"23:00",end:"02:00",zone:"Europe/London"});expect(JSON.stringify((await rows(page)).preference)).toContain("Europe/London");await pick(page,"session","Night focus");await expect(alerts.getByRole("checkbox").nth(1)).toBeDisabled();await expect(alerts.getByRole("checkbox").nth(1)).not.toBeChecked();await page.clock.fastForward(70_000);await expect(page.getByTestId("focus-alert-message")).toHaveCount(0);
    await pick(page,"session","Лондон");await expect(alerts.getByRole("checkbox").nth(1)).toBeEnabled();await page.clock.fastForward(20_000);await expect(page.getByTestId("focus-alert-message")).toContainText("Выбранная сессия");
  }finally{await page.context().close();}
});

test("account library and V3 export stay isolated through A → B → Guest → A",async({browser,request})=>{
  const ctx=await browser.newContext({viewport:{width:390,height:1000}});await stubTradingView(ctx,"ok");const page=await ctx.newPage(),stamp=Date.now();try{
    const account=async(email:string,first:boolean)=>{await signIn(page,email);if(first)await completeOnboarding(page,`Catalog${Date.now()%10000000}`);const profile=await(await request.get(`http://127.0.0.1:54329/__test/profile?email=${encodeURIComponent(email)}`)).json();await page.evaluate(id=>localStorage.setItem(`ayra:${id}:ayra_market_watchlist`,JSON.stringify({version:1,ids:["eurusd","gold"]})),profile.id);await page.goto("/market?tab=watchlist");await expect(page.getByTestId("focus-manage-poi")).toBeEnabled();return profile.id as string;};
    const out=async()=>{await page.goto("/settings/account");await page.getByRole("button",{name:"Выйти",exact:true}).click();await expect(page).toHaveURL(/\/login/);};
    const a=`CatalogA_${stamp}@example.com`,b=`CatalogB_${stamp}@example.com`;const id=await account(a,true);await create(page,"poi","Account A concept");await pick(page,"poi","Account A concept");await out();await account(b,true);await manage(page,"poi");await expect(page.getByTestId("focus-catalog-editor")).toContainText("Пользовательских значений пока нет");await out();
    await open(page);await create(page,"poi","Guest concept");await pick(page,"poi","Guest concept");await account(a,false);await expect(page.getByTestId("market-focus-poi")).toContainText("Account A concept");await manage(page,"poi");await expect(page.getByTestId("focus-catalog-editor")).not.toContainText("Guest concept");
    expect((await rows(page,`account:${id}`)).entries[0].version).toBe(3);
  }finally{await ctx.close();}
});

test("profile export and Guest cleanup include custom catalogs and retain the active account",async({browser,request})=>{
  const ctx=await browser.newContext({viewport:{width:390,height:1000}});await stubTradingView(ctx,"ok");const page=await ctx.newPage(),email=`CatalogExport_${Date.now()}@example.com`;try{
    await signIn(page,email);await completeOnboarding(page,`Export${Date.now()%10000000}`);const profile=await(await request.get(`http://127.0.0.1:54329/__test/profile?email=${encodeURIComponent(email)}`)).json();await page.evaluate(id=>localStorage.setItem(`ayra:${id}:ayra_market_watchlist`,JSON.stringify({version:1,ids:["eurusd"]})),profile.id);await page.goto("/market?tab=watchlist");await expect(page.getByTestId("focus-manage-poi")).toBeEnabled();await create(page,"poi","Exported own type");await pick(page,"poi","Exported own type");
    await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("ayra_market_focus_v1",2);r.onsuccess=()=>resolve(r.result);});await new Promise<void>(resolve=>{const tx=db.transaction("preferences","readwrite");tx.objectStore("preferences").put({version:1,spaceId:"guest",selectedInstrumentId:"eurusd",customCatalog:{version:1,revision:1,items:[{version:1,spaceId:"guest",kind:"poi",id:"00000000-0000-4000-8000-000000002995",label:"Guest-only catalog",revision:1,deleted:false}]}});tx.oncomplete=()=>resolve();});db.close();});
    await page.goto("/profile?tab=stats");const event=page.waitForEvent("download");await page.getByRole("button",{name:"Экспортировать мои данные (JSON)",exact:true}).click();const download=await event,payload=JSON.parse(readFileSync((await download.path())!,"utf8"));expect(JSON.stringify(payload.marketFocus)).toContain("Exported own type");expect(JSON.stringify(payload.marketFocus)).not.toContain("Guest-only catalog");
    await page.goto("/settings/cloud");await page.getByRole("button",{name:"Удалить данные гостя",exact:true}).click();const dialog=page.getByRole("dialog");await dialog.getByRole("textbox").fill("УДАЛИТЬ");await dialog.getByRole("button",{name:"Удалить данные гостя",exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByText("Данные гостя удалены с устройства.",{exact:true})).toBeVisible();expect((await rows(page)).preference).toBeUndefined();expect((await rows(page,`account:${profile.id}`)).entries[0].version).toBe(3);
  }finally{await ctx.close();}
});

for(const lang of ["ru","en"] as const)for(const width of [360,390,768,1024,1440])test(`working custom focus ${lang} ${width}`,async({browser})=>{
  const {page}=await marketGuest(browser,width,{height:1200});const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));try{
    await open(page,lang);await create(page,"poi",lang==="ru"?"Моя область интереса":"My area of interest",lang);await pick(page,"poi",lang==="ru"?"Моя область интереса":"My area of interest");await page.getByTestId("focus-catalog-name").fill("😀".repeat(161));await expect(page.getByTestId("focus-catalog-save")).toBeDisabled();await page.keyboard.press("Escape");await expect(page.getByTestId("focus-manage-poi")).toBeFocused();await page.keyboard.press("Enter");await expect(page.getByTestId("focus-catalog-name")).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
    if(process.env.AYRA_FOCUS_CATALOG_SCREENS&&[390,1440].includes(width)){mkdirSync(process.env.AYRA_FOCUS_CATALOG_SCREENS,{recursive:true});await page.setViewportSize({width,height:width<768?2400:1600});await page.getByTestId("focus-catalog-name").blur();await page.getByTestId("market-focus").scrollIntoViewIfNeeded();await page.getByTestId("market-focus").screenshot({path:`${process.env.AYRA_FOCUS_CATALOG_SCREENS}/${width}-${lang}.png`});}
  }finally{await page.context().close();}
});
