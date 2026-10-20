import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

/**
 * A one-off client that keeps nothing: used only to check the current password before a change.
 * It never touches the signed-in session of the app (no storage, no refresh, no URL parsing).
 */
export function createSupabaseCheckClient(): SupabaseClient | null {
  const { url, anonKey, isConfigured } = getSupabaseEnv();
  if (!isConfigured) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "ayra-password-check" },
  });
}
