export const fiscalSources = {
  debt: "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/",
  budget: "https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/",
  interest: "https://fiscaldata.treasury.gov/datasets/interest-expense-debt-outstanding/",
};
export type FiscalSeries = keyof typeof fiscalSources;
export type FiscalPoint = { date: string; values: (string | null)[]; fiscalYear?: number; ytd?: string[] };
export type FiscalSnapshot = { status: "ready" | "stale" | "empty" | "error"; checkedAt?: string; partial?: boolean; points: FiscalPoint[] };
export type FiscalData = Record<FiscalSeries, FiscalSnapshot>;
export const fiscalRanges = ["latest", "1", "3", "5", "10", "max"] as const;
export type FiscalRange = typeof fiscalRanges[number];

// All amounts crossing the HTTP boundary are integer cents encoded as strings.
export function cents(value: unknown): bigint {
  if (typeof value !== "string" || !/^-?\d{1,18}(?:\.\d{1,2})?$/.test(value)) throw new Error("Invalid Treasury amount");
  const [dollars, fraction = ""] = value.replace("-", "").split(".");
  return (BigInt(dollars) * BigInt(100) + BigInt(fraction.padEnd(2, "0"))) * (value.startsWith("-") ? BigInt(-1) : BigInt(1));
}

export function formatUsd(value: string, lang: string) {
  const amount = BigInt(value);
  const abs = amount < BigInt(0) ? -amount : amount;
  const scale = abs >= BigInt("100000000000000") ? "trillion" : abs >= BigInt("100000000000") ? "billion" : "million";
  const divisor = BigInt(scale === "trillion" ? "1000000000000" : scale === "billion" ? "1000000000" : "1000000");
  const rounded = (abs + divisor / BigInt(2)) / divisor;
  const text = new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(Number(rounded) / 100);
  const unit = lang === "ru" ? { trillion: "трлн", billion: "млрд", million: "млн" }[scale]
    : { trillion: "T", billion: "B", million: "M" }[scale];
  return `${amount < BigInt(0) ? "−" : ""}${text} ${unit} USD`;
}

export function fiscalRange(points: FiscalPoint[], range: string) {
  if (range === "max" || !points.length) return points;
  const latest = new Date(points[points.length - 1].date);
  const year = latest.getUTCFullYear() - Number(range);
  latest.setUTCFullYear(year);
  if (latest.getUTCDate() !== Number(points[points.length - 1].date.slice(-2))) latest.setUTCDate(0);
  const lower = latest.toISOString().slice(0, 10);
  // Flow series are monthly and month ends can differ across non-leap years.
  return points.filter(point => points[0].fiscalYear ? point.date.slice(0, 7) >= lower.slice(0, 7) : point.date >= lower);
}
