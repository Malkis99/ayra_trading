import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { DEVICE_KEYS } from "@/lib/storage/device-keys";

const EXCLUDED_FILES = ["components/Figure.tsx"];

function getAllSourceFiles(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const normalized = filePath.replace(/\\/g, "/");

    if (fs.statSync(filePath).isDirectory()) {
      if (
        !normalized.includes("node_modules") &&
        !normalized.includes(".next") &&
        !normalized.includes("lib/i18n/dictionaries")
      ) {
        getAllSourceFiles(filePath, fileList);
      }
    } else if (
      (file.endsWith(".ts") || file.endsWith(".tsx")) &&
      !file.endsWith(".test.ts") &&
      !file.endsWith(".test.tsx") &&
      !normalized.includes("allowed-latin") &&
      !EXCLUDED_FILES.some((ex) => normalized.endsWith(ex))
    ) {
      fileList.push(filePath);
    }
  });
  return fileList;
}

function stripComments(code: string): string {
  let stripped = code.replace(/\/\*[\s\S]*?\*\//g, "");
  stripped = stripped.replace(/\/\/.*/g, "");
  return stripped;
}

describe("Source Code i18n & Storage Scanner", () => {
  it("ensures no hardcoded Cyrillic strings or JSX text exist in UI components and page files", () => {
    const directoriesToScan = ["app", "components"];
    let allFiles: string[] = [];

    directoriesToScan.forEach((dir) => {
      const fullPath = path.resolve(process.cwd(), dir);
      if (fs.existsSync(fullPath)) {
        getAllSourceFiles(fullPath, allFiles);
      }
    });

    const cyrillicRegex = /[а-яА-ЯёЁ]/;
    const violations: { file: string; line: number; text: string }[] = [];

    allFiles.forEach((file) => {
      const content = fs.readFileSync(file, "utf-8");
      const stripped = stripComments(content);
      const lines = stripped.split("\n");

      lines.forEach((lineText, index) => {
        if (cyrillicRegex.test(lineText)) {
          violations.push({
            file: path.relative(process.cwd(), file),
            line: index + 1,
            text: lineText.trim(),
          });
        }
      });
    });

    if (violations.length > 0) {
      const message = violations
        .map((v) => `\n  - ${v.file}:${v.line} -> "${v.text}"`)
        .join("");
      throw new Error(`Hardcoded Cyrillic string found in source UI file(s):${message}`);
    }

    expect(violations).toHaveLength(0);
  });

  it("fails if direct references to localStorage, sessionStorage, or indexedDB exist outside lib/storage", () => {
    const directoriesToScan = ["app", "components", "lib"];
    let allFiles: string[] = [];

    directoriesToScan.forEach((dir) => {
      const fullPath = path.resolve(process.cwd(), dir);
      if (fs.existsSync(fullPath)) {
        getAllSourceFiles(fullPath, allFiles);
      }
    });

    // Exclude lib/storage directory
    const filesToScan = allFiles.filter(
      (file) => !file.replace(/\\/g, "/").includes("lib/storage/")
    );

    const storageRegex = /\b(localStorage|sessionStorage|indexedDB)\b/;
    const violations: { file: string; line: number; text: string }[] = [];

    filesToScan.forEach((file) => {
      const content = fs.readFileSync(file, "utf-8");
      const stripped = stripComments(content);
      const lines = stripped.split("\n");

      lines.forEach((lineText, index) => {
        if (storageRegex.test(lineText)) {
          violations.push({
            file: path.relative(process.cwd(), file),
            line: index + 1,
            text: lineText.trim(),
          });
        }
      });
    });

    if (violations.length > 0) {
      const message = violations
        .map((v) => `\n  - ${v.file}:${v.line} -> "${v.text}"`)
        .join("");
      throw new Error(
        `Direct browser storage reference (localStorage/sessionStorage/indexedDB) found outside lib/storage:${message}`
      );
    }

    expect(violations).toHaveLength(0);
  });

  it("ensures device-keys.ts contains NO keys for game, journal, onboarding, attachments, emails, or tokens", () => {
    const forbiddenKeys = [
      "ayra_demo_v1",
      "ayra_journal_v1",
      "ayra_last_selected_account",
      "ayra_last_selected_instrument",
      "ayra_prop_toasts",
      "ayra_prop_toasts_v1",
      "ayra_journal_unit",
      "ayra_journal_last_account",
      "ayra_journal_last_instrument",
      "ayra_attachments_v1",
    ];

    forbiddenKeys.forEach((key) => {
      expect(DEVICE_KEYS).not.toContain(key);
    });

    // Check key naming patterns: no email patterns, no token patterns
    DEVICE_KEYS.forEach((key) => {
      expect(key).not.toMatch(/@/);
      expect(key).not.toMatch(/token|secret|password|jwt|auth_token/i);
      expect(key).not.toMatch(/trade|journal|quest|game|xp|coins/i);
    });
  });
});
