import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./config";

let browserClient: SupabaseClient | null = null;
let warnedGuestMode = false;

export function createSupabaseBrowserClient(): SupabaseClient | null {
  const { url, anonKey, isConfigured } = getSupabaseEnv();

  if (!isConfigured) {
    if (typeof window !== "undefined" && !warnedGuestMode) {
      console.warn("[AYRA] Supabase credentials not found. Running in local guest mode.");
      warnedGuestMode = true;
    }
    return null;
  }

  if (!browserClient) {
    browserClient = createBrowserClient(url, anonKey);
  }

  return browserClient;
}
