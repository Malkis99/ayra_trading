import { NextResponse } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = getSupabaseEnv();
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";

  let urlValid = false;
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl.trim().replace(/^['"]+|['"]+$/g, ""));
      urlValid = parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      urlValid = false;
    }
  }

  const keyPresent = Boolean(rawKey.trim().length > 0);
  const siteUrlSet = Boolean(siteUrl.trim().length > 0);

  const responseBody = {
    supabaseConfigured: env.isConfigured,
    urlValid,
    keyPresent,
    siteUrlSet,
  };

  return NextResponse.json(responseBody, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
