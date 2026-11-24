// Q4.7 hosted pilot: lets plain `node` import the app's own TypeScript modules (lib/account-deletion/handler.ts), so the
// pilot checks the real code and not a copy of it. Node strips the types itself; this only resolves «@/…» and
// extensionless relative imports to the .ts files next to them. No new dependency.
//   node --import ./scripts/hosted-pilot/ts-resolve.mjs …
import { register } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function resolve(specifier, context, next) {
  let target = null;
  if (specifier.startsWith("@/")) target = path.join(root, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (target && !path.extname(target)) {
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      if (existsSync(target + ext)) return next(pathToFileURL(target + ext).href, context);
    }
  }
  if (target && specifier.startsWith("@/")) return next(pathToFileURL(target).href, context);
  return next(specifier, context);
}

if (!globalThis.__ayraPilotResolve) {
  globalThis.__ayraPilotResolve = true;
  register(import.meta.url);
}
