import { NextResponse } from "next/server";
import { fiscalData, fiscalSeries } from "@/lib/market/economy/treasury-cache";
import { fiscalRanges, fiscalSources, type FiscalRange, type FiscalSeries, type FiscalSnapshot } from "@/lib/market/economy/fiscal-data";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

function respond(data: unknown, snapshots: FiscalSnapshot[]) {
  const unavailable = snapshots.every(snapshot => snapshot.status === "error");
  const cache = snapshots.some(snapshot => snapshot.status === "error") ? "no-store"
    : snapshots.some(snapshot => snapshot.status !== "ready" || snapshot.partial)
      ? "public, max-age=0, s-maxage=30"
      : "public, max-age=60, s-maxage=300, stale-while-revalidate=60";
  return NextResponse.json(data, { status: unavailable ? 503 : 200, headers: { "Cache-Control": cache } });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.size === 0) {
    const data = await fiscalData();
    return respond(data, Object.values(data));
  }
  const series = params.get("series");
  const range = params.get("range");
  if (params.size !== 2 || !Object.hasOwn(fiscalSources, series ?? "") || !fiscalRanges.includes(range as FiscalRange)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const data = await fiscalSeries(series as FiscalSeries, range as FiscalRange);
  return respond(data, [data]);
}
