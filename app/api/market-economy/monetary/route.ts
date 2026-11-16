import { NextResponse } from "next/server";
import { monetarySources, type MonetarySeries } from "@/lib/market/economy/monetary-data";
import { monetarySnapshot } from "@/lib/market/economy/monetary-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const series = params.get("series") ?? "";
  const range = params.get("range");
  if (params.size !== 2 || !Object.hasOwn(monetarySources, series) || (range !== "latest" && range !== "history")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const data = await monetarySnapshot(series as MonetarySeries, range === "history");
  return NextResponse.json(data, {
    status: data.status === "error" ? 503 : 200,
    headers: { "Cache-Control": data.status === "ready" ? "public, max-age=60, s-maxage=300" : "no-store" },
  });
}
