import { NextResponse } from "next/server";
import { fundamentalSnapshot } from "@/lib/market/economy/fundamentals-cache";
import { fundamentalDefinitions, fundamentalSeries, type FundamentalSeries } from "@/lib/market/economy/fundamentals-data";
import { sourceCheckRemainingSeconds, withFundamentalFreshness } from "@/lib/market/economy/fundamentals-freshness";

export const dynamic = "force-dynamic";
export const maxDuration = 35;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const series = query.get("series");
  const range = query.get("range");
  if (query.size !== 2 || !fundamentalSeries.includes(series as FundamentalSeries) || !["latest", "history"].includes(range ?? "")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const data = withFundamentalFreshness(series as FundamentalSeries,
    await fundamentalSnapshot(series as FundamentalSeries, range === "history"), Date.now());
  // Neither browser nor CDN may extend a ready response past its source-check deadline.
  const remaining = sourceCheckRemainingSeconds(series as FundamentalSeries, data.retrievedAt, Date.now());
  return NextResponse.json({ ...data, definition: fundamentalDefinitionsFor(series as FundamentalSeries) }, {
    status: data.status === "error" ? 503 : 200,
    headers: { "Cache-Control": data.status === "ready" && remaining > 0
      ? `public, max-age=${Math.min(60, remaining)}, s-maxage=${Math.min(300, remaining)}` : "no-store" },
  });
}

function fundamentalDefinitionsFor(series: FundamentalSeries) {
  const { seriesId, unit, adjustment, frequency } = fundamentalDefinitions[series];
  return { seriesId, unit, adjustment, frequency };
}
