import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeRedirectUrl } from "@/lib/auth/redirect-whitelist";
import { authDebug } from "@/lib/auth/debug";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");

  const safeNext = sanitizeRedirectUrl(next, "/");

  if (code) {
    const supabase = createSupabaseServerClient();
    if (supabase) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      authDebug("callback.exchange", { ok: !error && !!data?.session, error: error?.message ?? null });
    }
  }

  return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
}
