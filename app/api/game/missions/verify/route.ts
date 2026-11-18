import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cleanApiKey, cleanSupabaseUrl } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DAY_API_RATE, serverEconomyEnabled } from "@/lib/game-server/day-api";
import { handleMissionVerify, missionPayoutsEnabled } from "@/lib/game-server/mission-verify";
import { createRateLimiter } from "@/lib/game-server/rate-limit";

/**
 * Q4.4 server mission check: POST { mission } (docs/q4-4-server-day-api.md, section 5). The user only from the verified
 * session; the Journal as Postgres has it; the app's mission rules on the server's day; the award only when payouts are
 * switched on (AYRA_SERVER_MISSION_PAYOUTS=1 — never set) and the mission award kind is enabled in the database (it is
 * not). Off unless NEXT_PUBLIC_AYRA_SERVER_ECONOMY=1 (404).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limiter = createRateLimiter(DAY_API_RATE);

function siteOrigin(req: Request): string | null {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!host) return null;
  const proto = req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

async function handle(req: Request) {
  const { url } = cleanSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const serviceKey = cleanApiKey(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  const session = serverEconomyEnabled() ? createSupabaseServerClient() : null;
  const enabled = serverEconomyEnabled() && !!session && !!url && !!serviceKey;
  const service = enabled ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const out = await handleMissionVerify(req, {
    enabled,
    payoutsEnabled: missionPayoutsEnabled(),
    async getUser() {
      const { data, error } = await session!.auth.getUser();
      return !error && data.user ? { id: data.user.id } : null;
    },
    async rpc(fn, args) {
      const { data, error } = await service!.rpc(fn, args);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
    limiter,
    now: () => new Date(),
    origin: siteOrigin(req),
  });
  return NextResponse.json(out.body, { status: out.status, headers: out.headers });
}

export const POST = handle;
