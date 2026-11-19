import { NextResponse } from "next/server";
import { fundamentalSnapshot } from "@/lib/market/economy/fundamentals-cache";
import { fundamentalDefinitions, fundamentalSeries, type FundamentalSeries } from "@/lib/market/economy/fundamentals-data";

export const dynamic = "force-dynamic";
export const maxDuration = 35;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const series = query.get("series");
  const range = query.get("range");
  if (query.size !== 2 || !fundamentalSeries.includes(series as FundamentalSeries) || !["latest", "history"].includes(range ?? "")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const data = await fundamentalSnapshot(series as FundamentalSeries, range === "history");
  return NextResponse.json({ ...data, definition: fundamentalDefinitionsFor(series as FundamentalSeries) }, {
    status: data.status === "error" ? 503 : 200,
    headers: { "Cache-Control": data.status === "ready" ? "public, max-age=60, s-maxage=300" : "no-store" },
  });
}

function fundamentalDefinitionsFor(series: FundamentalSeries) {
  const { seriesId, unit, adjustment, frequency } = fundamentalDefinitions[series];
  return { seriesId, unit, adjustment, frequency };
}
