import { NextResponse } from "next/server";
import { pceSnapshot } from "@/lib/market/economy/bea-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 35;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const range = params.get("range");
  if (params.size !== 1 || (range !== "latest" && range !== "history")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const result = await pceSnapshot(range === "history");
  return NextResponse.json(result, {
    status: result.status === "error" ? 503 : 200,
    headers: { "Cache-Control": result.status === "ready" ? "public, max-age=60, s-maxage=300" : "no-store" },
  });
}
