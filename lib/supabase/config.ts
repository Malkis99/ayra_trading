export function cleanSupabaseUrl(rawUrl: string): { url: string; truncatedReason: string | null } {
  if (!rawUrl) return { url: "", truncatedReason: null };
  let cleaned = rawUrl.trim().replace(/^['"]+|['"]+$/g, "");
  let truncatedReason: string | null = null;

  try {
    const parsed = new URL(cleaned);
    const origin = parsed.origin;
    if (parsed.pathname && parsed.pathname !== "/") {
      truncatedReason = `Truncated path '${parsed.pathname}' from Supabase URL`;
      cleaned = origin;
    } else if (cleaned.endsWith("/")) {
      truncatedReason = "Trimmed trailing slash from Supabase URL";
      cleaned = origin;
    } else {
      cleaned = origin;
    }
  } catch {
    // Keep as is if invalid URL format
  }

  return { url: cleaned, truncatedReason };
}

export function cleanApiKey(rawKey: string): string {
  if (!rawKey) return "";
  return rawKey.trim().replace(/^['"]+|['"]+$/g, "");
}

export function getSupabaseEnv() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const rawAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  const cleanKey = cleanApiKey(rawAnonKey);
  const { url, truncatedReason } = cleanSupabaseUrl(rawUrl);

  const isConfigured = Boolean(url && cleanKey && url.startsWith("http"));
  return {
    url,
    anonKey: cleanKey,
    isConfigured,
    truncatedReason,
  };
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
