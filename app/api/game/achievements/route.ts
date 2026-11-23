import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cleanApiKey, cleanSupabaseUrl } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { serverEconomyEnabled } from "@/lib/game-server/day-api";
import { ACHIEVEMENTS_API_RATE, handleAchievementsApi } from "@/lib/game-server/achievements-api";
import { createRateLimiter } from "@/lib/game-server/rate-limit";
import { verifiedSessionUser } from "@/lib/game-server/session-user";

/**
 * Q4.6: GET /api/game/achievements — the signed-in person's own achievements on the server (lib/game-server/achievements-api.ts).
 * Read only; nothing is unlocked or paid by any request. Off unless NEXT_PUBLIC_AYRA_SERVER_ECONOMY=1 (404).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limiter = createRateLimiter(ACHIEVEMENTS_API_RATE);

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
  const out = await handleAchievementsApi(req, {
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
