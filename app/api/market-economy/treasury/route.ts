import { NextResponse } from "next/server";
import { fiscalData } from "@/lib/market/economy/treasury-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET() {
  const data = await fiscalData();
  const unavailable = Object.values(data).every(series => series.status === "error");
  return NextResponse.json(data, { status: unavailable ? 503 : 200, headers: {
    "Cache-Control": unavailable ? "no-store" : "public, max-age=120, s-maxage=300, stale-while-revalidate=60",
  } });
}
