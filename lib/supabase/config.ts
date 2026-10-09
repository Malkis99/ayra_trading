export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isConfigured = Boolean(url && anonKey && url.trim().length > 0 && url.startsWith("http"));
  return { url: url || "", anonKey: anonKey || "", isConfigured };
}

export function isE2EMockEnabled(): boolean {
  if (typeof window !== "undefined") {
    return (
      process.env.NEXT_PUBLIC_AYRA_E2E_AUTH_MOCK === "1" ||
      process.env.AYRA_E2E_AUTH_MOCK === "1" ||
      Boolean((window as any).__AYRA_E2E_AUTH_MOCK__)
    );
  }
  return process.env.AYRA_E2E_AUTH_MOCK === "1" || process.env.NEXT_PUBLIC_AYRA_E2E_AUTH_MOCK === "1";
}
