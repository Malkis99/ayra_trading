import { readFileSync } from "node:fs";
import ts from "typescript";
import type { Page } from "@playwright/test";
import type { FocusStorage as LegacyStorage } from "../../test-fixtures/market-focus-v2/storage";

declare global { interface Window { watchLegacyFocus: LegacyStorage; releaseLegacyOpen?: () => void; legacyWriteResult?: Promise<string> } }
/** Real Chromium IDB, same origin, frozen deployed V2 storage/model. This is a protocol harness, not a second complete legacy SPA. */
export async function installLegacyFocus(page: Page) {
  const storage = readFileSync("lib/storage/index.ts", "utf8");
  const validation = storage.slice(storage.indexOf("const UUID_REGEX"), storage.indexOf("export function validateKeyName"));
  const sources = { model: readFileSync("test-fixtures/market-focus-v2/model.ts","utf8"), alerts: readFileSync("test-fixtures/market-focus-v2/alerts.ts","utf8"), storage: readFileSync("test-fixtures/market-focus-v2/storage.ts","utf8"), sessions: readFileSync("lib/market/sessions.ts","utf8"), validation };
  const modules = Object.entries(sources).map(([name,source]) => `${JSON.stringify(name)}:function(require,exports,module){${ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText}\n}`).join(",");
  await page.addScriptTag({content:`(()=>{const factories={${modules}},cache={};function load(name){if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;factories[name](key=>load(({'./model':'model','./alerts':'alerts','@/lib/market/sessions':'sessions','@/lib/storage':'validation'})[key]),module.exports,module);return module.exports;}window.watchLegacyFocus=new(load('storage').FocusStorage)();})()`});
}
