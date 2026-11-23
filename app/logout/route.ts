import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const supabase = createSupabaseServerClient();
  if (supabase) {
    await supabase.auth.signOut({ scope: "local" }); // only this device (owner decision 2026-11-23)
  }
  return NextResponse.redirect(new URL("/login", requestUrl.origin));
}

export async function POST(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const supabase = createSupabaseServerClient();
  if (supabase) {
    await supabase.auth.signOut({ scope: "local" }); // only this device (owner decision 2026-11-23)
  }
  return NextResponse.redirect(new URL("/login", requestUrl.origin));
}
