import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { postLoginRouterUrl } from "@/lib/auth/post-login";
import { authDebug } from "@/lib/auth/debug";

/**
 * Email link target: only exchanges the code for a session, then always hands over to the
 * post-login router (/auth/continue), which alone decides where the user goes.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");

  if (code) {
    const supabase = createSupabaseServerClient();
    if (supabase) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      authDebug("callback.exchange", { ok: !error && !!data?.session, error: error?.message ?? null });
    }
  }

  return NextResponse.redirect(new URL(postLoginRouterUrl(next), requestUrl.origin));
}
