import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SHADOW_RATE, handleMissionShadow, missionShadowEnabled } from "@/lib/game-server/mission-shadow-handler";
import { createRateLimiter } from "@/lib/game-server/rate-limit";
import { supabaseJournalReader } from "@/lib/game-server/supabase-journal-reader";

/**
 * Q4.2 shadow mission check (docs/q4-2-mission-shadow.md). POST { missions: [{ id, day, done, source?, reason? }] }.
 * The user comes only from the verified Supabase session (cookies → auth.getUser on the server); the journal is read with
 * that session (RLS). Read-only: no service key, no writes, no payment — the answer says `authorizedForPayout: false`.
 * Off unless NEXT_PUBLIC_AYRA_MISSION_SHADOW=1 (404).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limiter = createRateLimiter(SHADOW_RATE);

function siteOrigin(req: Request): string | null {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!host) return null;
  const proto = req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

async function handle(req: Request) {
  const client = missionShadowEnabled() ? createSupabaseServerClient() : null;
  let userId: string | null = null;
  const out = await handleMissionShadow(req, {
    enabled: missionShadowEnabled() && client !== null,
    async getUser() {
      const { data, error } = await client!.auth.getUser();
      userId = !error && data.user ? data.user.id : null;
      return userId ? { id: userId } : null;
    },
    reader: {
      timezone: () => supabaseJournalReader(client!, userId!).timezone(),
      cloudSync: () => supabaseJournalReader(client!, userId!).cloudSync(),
      allRows: (t, max) => supabaseJournalReader(client!, userId!).allRows(t, max),
      rowsById: (t, ids) => supabaseJournalReader(client!, userId!).rowsById(t, ids),
    },
    limiter,
    now: () => new Date(),
    origin: siteOrigin(req),
  });
  return NextResponse.json(out.body, { status: out.status, headers: out.headers });
}

export const POST = handle;
export const GET = handle;
