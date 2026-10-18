import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * All persistent data goes through AppStorage / the repositories in lib/storage (spaces, write guards, flush).
 * Direct browser storage anywhere else would bypass them, so the app code is scanned for it.
 */
describe("storage access goes through lib/storage only", () => {
  it("no localStorage / sessionStorage / indexedDB outside lib/storage (tests excluded)", () => {
    const roots = ["app", "components", "lib"];
    const allowedDir = path.join("lib", "storage");
    const pattern = /\b(localStorage|sessionStorage|indexedDB)\b/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (full.startsWith(allowedDir) || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
          const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
          lines.forEach((line, i) => {
            const code = line.replace(/\/\/.*$/, ""); // ignore line comments
            if (pattern.test(code)) offenders.push(`${full}:${i + 1}`);
          });
        }
      }
    };
    roots.forEach((r) => fs.existsSync(r) && walk(r));
    expect(offenders).toEqual([]);
  });
});
