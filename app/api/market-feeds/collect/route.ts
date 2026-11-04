import { NextResponse } from "next/server";
import { cleanApiKey, cleanSupabaseUrl } from "@/lib/supabase/config";
import { collectFeeds, type Scope } from "@/lib/market/feeds/collect";
import { serviceClient, supabaseFeedsDb } from "@/lib/market/feeds/supabase-db";
import { sameSecret } from "@/lib/market/feeds/secret";

/**
 * The Market feeds collector (docs/market-feeds-plan.md, section 4). Called on a schedule by Supabase (pg_cron +
 * pg_net) with `Authorization: Bearer <MARKET_FEEDS_SECRET>`; anyone else gets 401. Server-only variables:
 * SUPABASE_SERVICE_ROLE_KEY (writes the 0009 tables), MARKET_FEEDS_SECRET, optional BLS_API_KEY, EIA_API_KEY
 * (EIA's weekly figures; without it EIA events show without figures).
 *   POST /api/market-feeds/collect?scope=news|releases|schedules|all&prune=1
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const isScope = (v: string | null): v is Scope => v === "news" || v === "releases" || v === "schedules" || v === "all";

async function handle(req: Request) {
  const secret = (process.env.MARKET_FEEDS_SECRET || "").trim();
  const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!secret) return NextResponse.json({ error: "collector_not_configured", missing: ["MARKET_FEEDS_SECRET"] }, { status: 503 });
  if (!sameSecret(given, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { url } = cleanSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const serviceKey = cleanApiKey(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !serviceKey && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean);
  if (missing.length) return NextResponse.json({ error: "collector_not_configured", missing }, { status: 503 });

  const params = new URL(req.url).searchParams;
  const scopeParam = params.get("scope");
  const scope: Scope = isScope(scopeParam) ? scopeParam : "news";
  const prune = params.get("prune") === "1";

  const { results, pruned } = await collectFeeds({
    scope,
    prune,
    now: Date.now(),
    fetch: (u, init) => fetch(u, { ...init, cache: "no-store" }),
    db: supabaseFeedsDb(serviceClient(url, serviceKey)),
    blsKey: cleanApiKey(process.env.BLS_API_KEY || "") || undefined,
    eiaKey: cleanApiKey(process.env.EIA_API_KEY || "") || undefined,
  });
  const failed = results.filter((r) => !r.ok).length;
  return NextResponse.json({ scope, ok: failed === 0, failed, results, pruned }, { status: 200 });
}

export const POST = handle;
export const GET = handle;
