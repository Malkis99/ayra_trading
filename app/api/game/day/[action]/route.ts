import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cleanApiKey, cleanSupabaseUrl } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DAY_API_RATE, handleDayApi, serverEconomyEnabled } from "@/lib/game-server/day-api";
import { createRateLimiter } from "@/lib/game-server/rate-limit";
import { verifiedSessionUser } from "@/lib/game-server/session-user";

/**
 * Q4.4 server game day API (docs/q4-4-server-day-api.md):
 *   GET  /api/game/day/status            — the account state, the flag and the day (with each mission's standing)
 *   POST /api/game/day/open              { extras }            — opens today's day in the mode of the saved trading days
 *   POST /api/game/day/mode              { mode, extras? }
 *   POST /api/game/day/accept | pass     { mission }
 *   POST /api/game/day/replace           { from, to }
 *   POST /api/game/day/trading-days      { days }              — applies from the next game day
 * The user comes only from the verified session (cookies → auth.getUser on the server); every request first asks the
 * database whether that session is still fresh for the economy (Q4.5-2, 401 session_stale). The database functions run with
 * the service key and server time. Off unless NEXT_PUBLIC_AYRA_SERVER_ECONOMY=1 (404); they serve only accounts the
 * owner moved to the server economy (cloud_active) — none today.
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

async function handle(req: Request, { params }: { params: { action: string } }) {
  const { url } = cleanSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const serviceKey = cleanApiKey(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  const session = serverEconomyEnabled() ? createSupabaseServerClient() : null;
  const enabled = serverEconomyEnabled() && !!session && !!url && !!serviceKey;
  const service = enabled ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const out = await handleDayApi(req, params.action, {
    enabled,
    // the verified user and the claims of that very token (Q4.5-2: the database decides if the session is fresh)
    getUser: () => verifiedSessionUser(session!),
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

export const GET = handle;
export const POST = handle;
