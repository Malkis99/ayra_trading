import { ru } from "./dictionaries/ru";
import { en } from "./dictionaries/en";
import { Dictionary, Language } from "./types";

export const dictionaries: Record<Language, Dictionary> = {
  ru,
  en,
};

export function getDictionary(lang: Language): Dictionary {
  return dictionaries[lang] || ru;
}

/**
 * Format string with placeholders like {count}, {name}, etc.
 */
export function formatString(template: string, params: Record<string, string | number>): string {
  let result = template;
  for (const key of Object.keys(params)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(params[key]));
  }
  return result;
}

/**
 * Get plural form for a given count using Intl.PluralRules
 */
export function getPlural(
  lang: Language,
  count: number,
  pluralMap: { one: string; few?: string; many?: string; other: string }
): string {
  const pr = new Intl.PluralRules(lang === "ru" ? "ru-RU" : "en-US");
  const rule = pr.select(count);
  return pluralMap[rule as keyof typeof pluralMap] || pluralMap.other || pluralMap.one;
}

/**
 * Format numbers according to locale
 */
export function formatNumber(lang: Language, num: number, options?: Intl.NumberFormatOptions): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  return new Intl.NumberFormat(locale, options).format(num);
}

/**
 * Format date according to locale
 */
export function formatDate(lang: Language, date: Date | number, options?: Intl.DateTimeFormatOptions): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  return new Intl.DateTimeFormat(locale, options).format(date);
}
