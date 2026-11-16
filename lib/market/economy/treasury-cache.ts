import { unstable_cache } from "next/cache";
import { fiscalSources, type FiscalData, type FiscalPoint, type FiscalSeries } from "./fiscal-data";
import { loadTreasury, TreasuryThrottle } from "./treasury";

const day = 86_400_000;
const refreshSeconds = 12 * 60 * 60;
type Snapshot = { checkedAt: string; points: FiscalPoint[] };
const retries: Partial<Record<FiscalSeries, number>> = {};
const running: Partial<Record<FiscalSeries, Promise<Snapshot>>> = {};
let sourcePauseUntil = 0;

function refresh(series: FiscalSeries) {
  return running[series] ??= (async () => {
    const now = Date.now();
    if (Math.max(sourcePauseUntil, retries[series] ?? 0) > now) throw new Error("Treasury cooldown");
    try {
      const points = await loadTreasury(series, new Date(now).toISOString().slice(0, 10));
      return { checkedAt: new Date().toISOString(), points };
    } catch (error) {
      if (error instanceof TreasuryThrottle) sourcePauseUntil = Math.max(sourcePauseUntil, error.until);
      retries[series] = Date.now() + 5 * 60_000;
      throw error;
    }
  })().finally(() => { delete running[series]; });
}

const snapshots = {
  debt: unstable_cache(() => refresh("debt"), ["treasury-debt-v1"], { revalidate: refreshSeconds }),
  budget: unstable_cache(() => refresh("budget"), ["treasury-budget-v1"], { revalidate: refreshSeconds }),
  interest: unstable_cache(() => refresh("interest"), ["treasury-interest-v1"], { revalidate: refreshSeconds }),
};

export function treasuryStatus(series: FiscalSeries, snapshot: Snapshot, now: number): FiscalData[FiscalSeries] {
  const latest = snapshot.points[snapshot.points.length - 1];
  const stale = now - Date.parse(snapshot.checkedAt) > day || (!!latest && now - Date.parse(latest.date) > (series === "debt" ? 7 : 55) * day);
  return { ...snapshot, status: stale ? "stale" : latest ? "ready" : "empty" };
}

export async function fiscalData(): Promise<FiscalData> {
  const read = async (series: FiscalSeries): Promise<FiscalData[FiscalSeries]> => {
    try {
      return treasuryStatus(series, await snapshots[series](), Date.now());
    } catch {
      return { status: "error", points: [] };
    }
  };
  const series = Object.keys(fiscalSources) as FiscalSeries[];
  const [debt, budget, interest] = await Promise.all(series.map(read));
  return { debt, budget, interest };
}
