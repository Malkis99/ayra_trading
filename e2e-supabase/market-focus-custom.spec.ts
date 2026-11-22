import { test, expect, type Page } from "@playwright/test";
import { marketGuest } from "../e2e/helpers/market";
import { mkdirSync, readFileSync } from "node:fs";

async function open(page:Page,lang:"ru"|"en"="ru"){
  await page.addInitScript(language=>{localStorage.setItem("ayra_guest_dismissed","1");localStorage.setItem("ayra_lang",language);if(sessionStorage.getItem("custom-seeded"))return;sessionStorage.setItem("custom-seeded","1");localStorage.setItem("ayra_market_watchlist",JSON.stringify({version:1,ids:["eurusd","gold"]}));},lang);
  await page.goto("/market?tab=watchlist");await expect(page.getByTestId("market-focus-direction")).toBeEnabled();
}
const focus=(p:Page)=>p.getByTestId("market-focus");
const saved=(p:Page)=>expect(p.getByTestId("market-focus-status")).toHaveAttribute("data-kind","saved");
async function add(page:Page,text:string){if(await page.getByTestId("focus-checklist-customize").getAttribute("aria-pressed")!=="true")await page.getByTestId("focus-checklist-customize").click();await page.getByTestId("focus-item-add").click();await page.getByTestId("focus-item-text").fill(text);await page.getByTestId("focus-item-save").click();await saved(page);await expect(focus(page).getByRole("checkbox",{name:text,exact:true})).toBeVisible();}

test("custom create/edit/reorder/check/reload/reset/delete is keyboard accessible and local",async({browser})=>{
  const {page}=await marketGuest(browser,390);try{
    await open(page);await add(page,"My manual condition");let checkbox=focus(page).getByRole("checkbox",{name:"My manual condition",exact:true});await checkbox.check();await saved(page);
    await page.getByRole("button",{name:"Выше: My manual condition",exact:true}).focus();await page.keyboard.press("Enter");await saved(page);await expect(page.getByRole("button",{name:"Изменить: My manual condition",exact:true})).toBeFocused();
    await page.getByRole("button",{name:"Изменить: My manual condition",exact:true}).click();await page.getByTestId("focus-item-text").fill("Renamed condition");await page.getByTestId("focus-item-save").click();checkbox=focus(page).getByRole("checkbox",{name:"Renamed condition",exact:true});await expect(checkbox).toBeChecked();
    await page.reload();await expect(checkbox).toBeChecked();await page.getByTestId("market-focus-reset").click();await page.getByRole("dialog").getByRole("button",{name:"Сбросить фокус",exact:true}).click();await expect(checkbox).not.toBeChecked();await expect(checkbox).toHaveCount(1);
    await page.getByTestId("focus-checklist-customize").click();await checkbox.check();await saved(page);await page.getByRole("button",{name:"Удалить: Renamed condition",exact:true}).click();await page.keyboard.press("Escape");await expect(checkbox).toBeChecked();
    await page.getByRole("button",{name:"Удалить: Renamed condition",exact:true}).click();await expect(page.getByRole("dialog")).toContainText("Пункт и его отметка");await page.getByRole("dialog").getByRole("button",{name:"Удалить пункт",exact:true}).click();await expect(checkbox).toHaveCount(0);await page.reload();await expect(checkbox).toHaveCount(0);await expect(focus(page).getByRole("checkbox")).toHaveCount(6);
  }finally{await page.context().close();}
});

test("two tabs cannot silently delete or rename a changed custom item",async({browser})=>{
  const {page:a}=await marketGuest(browser,1440);try{
    await open(a);await add(a,"Shared condition");const b=await a.context().newPage();await b.goto("/market?tab=watchlist");await expect(focus(b).getByRole("checkbox",{name:"Shared condition",exact:true})).toBeVisible();
    await a.getByRole("button",{name:"Изменить: Shared condition",exact:true}).click();await a.getByTestId("focus-item-text").fill("Old draft");await focus(b).getByRole("checkbox",{name:"Shared condition",exact:true}).check();await saved(b);
    await expect(a.getByTestId("focus-item-save")).toBeDisabled();await expect(focus(a)).toContainText("Черновик не применён");await focus(a).getByRole("button",{name:"Взять актуальный текст",exact:true}).click();await a.getByTestId("focus-item-text").fill("Reviewed title");await a.getByTestId("focus-item-save").click();await expect(focus(b).getByRole("checkbox",{name:"Reviewed title",exact:true})).toBeChecked();
    await a.getByRole("button",{name:"Удалить: Reviewed title",exact:true}).click();await focus(b).getByRole("checkbox",{name:"Reviewed title",exact:true}).uncheck();await saved(b);await a.getByRole("dialog").getByRole("button",{name:"Удалить пункт",exact:true}).click();await expect(a.getByTestId("market-focus-status")).toHaveAttribute("data-kind","conflict");await expect(focus(b).getByRole("checkbox",{name:"Reviewed title",exact:true})).toHaveCount(1);await expect(focus(b).getByRole("checkbox",{name:"Reviewed title",exact:true})).not.toBeChecked();
  }finally{await a.context().close();}
});

test("browser upgrades V1 without losing six marks and exports the migrated checklist",async({browser})=>{
  const {page}=await marketGuest(browser,390);try{
    await page.addInitScript(()=>{
      if(sessionStorage.getItem("v1-seeded"))return;sessionStorage.setItem("v1-seeded","1");
      const request=indexedDB.open("ayra_market_focus_v1",1);
      request.onupgradeneeded=()=>{request.result.createObjectStore("entries",{keyPath:["spaceId","instrumentId"]});request.result.createObjectStore("preferences",{keyPath:"spaceId"});};
      request.onsuccess=()=>{const db=request.result,tx=db.transaction("entries","readwrite");tx.objectStore("entries").put({version:1,spaceId:"guest",instrumentId:"eurusd",revision:3,direction:"bullish",poi:"fvg",mss:null,session:null,checklist:{poiReached:true,liquiditySweep:false,displacement:true,mssCisd:false,retracementTest:true,reaction:false}});tx.oncomplete=()=>db.close();};
    });
    await open(page);const checked=focus(page).getByRole("checkbox");await expect(checked).toHaveCount(6);for(const index of [0,2,4])await expect(checked.nth(index)).toBeChecked();for(const index of [1,3,5])await expect(checked.nth(index)).not.toBeChecked();
    await page.goto("/settings/cloud");const downloadEvent=page.waitForEvent("download");await page.getByRole("button",{name:"Экспортировать",exact:true}).click();const download=await downloadEvent,payload=JSON.parse(readFileSync((await download.path())!,"utf8"));expect(payload.marketFocus.databaseVersion).toBe(2);expect(payload.marketFocus.entries[0].checklist.items.map((i:{checked:boolean})=>i.checked)).toEqual([true,false,true,false,true,false]);
  }finally{await page.context().close();}
});

test("maximum checklist stays readable and custom titles are rendered as text, never HTML",async({browser})=>{
  const {page}=await marketGuest(browser,390);try{
    await open(page);const literal='<img src=x onerror="window.focusXss=1">';
    await page.evaluate(async title=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("ayra_market_focus_v1",2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise<void>((resolve,reject)=>{const tx=db.transaction("entries","readwrite");tx.objectStore("entries").put({version:2,spaceId:"guest",instrumentId:"eurusd",revision:1,direction:null,poi:null,mss:null,session:null,checklist:{orderRevision:0,items:Array.from({length:30},(_,i)=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,"0")}`,template:null,text:i===0?title:i===29?"L".repeat(160):`Condition ${i}`,checked:i===1,revision:1}))}});tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();window.dispatchEvent(new Event("focus"));},literal);
    await expect(focus(page).getByRole("checkbox")).toHaveCount(30);await expect(focus(page).getByRole("checkbox",{name:literal,exact:true})).toHaveCount(1);await expect(focus(page).locator("img")).toHaveCount(0);expect(await page.evaluate(()=>Reflect.has(window,"focusXss"))).toBe(false);
    await page.getByTestId("focus-checklist-customize").click();await expect(page.getByTestId("focus-item-add")).toBeDisabled();await focus(page).getByRole("checkbox").last().scrollIntoViewIfNeeded();await focus(page).getByRole("checkbox").last().click({trial:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  }finally{await page.context().close();}
});

for(const width of [360,390,768,1024,1440])for(const lang of ["ru","en"] as const)test(`custom checklist layout ${width} ${lang}`,async({browser})=>{
  const {page}=await marketGuest(browser,width);const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));try{
    await open(page,lang);await add(page,lang==="ru"?"Проверить реакцию у выбранной области":"Review the reaction around my area");await focus(page).getByRole("checkbox").last().check();await saved(page);await page.getByTestId("focus-item-add").click();await page.getByTestId("focus-item-text").fill("😀".repeat(161));await expect(page.getByTestId("focus-item-save")).toBeDisabled();await focus(page).getByRole("button",{name:lang==="ru"?"Отмена":"Cancel",exact:true}).click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);expect(errors).toEqual([]);
    if(process.env.AYRA_FOCUS_SCREENSHOTS&&[390,1440].includes(width)){mkdirSync(process.env.AYRA_FOCUS_SCREENSHOTS,{recursive:true});await page.setViewportSize({width,height:width<768?2200:1300});await focus(page).scrollIntoViewIfNeeded();await focus(page).screenshot({path:`${process.env.AYRA_FOCUS_SCREENSHOTS}/custom-${width}-${lang}.png`});}
  }finally{await page.context().close();}
});
