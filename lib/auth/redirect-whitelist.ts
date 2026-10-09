/**
 * Safe redirect validator to prevent open redirect vulnerabilities.
 */
export function sanitizeRedirectUrl(url: string | null | undefined, fallback = "/"): string {
  if (!url || typeof url !== "string") {
    return fallback;
  }

  const trimmed = url.trim();

  // Must start with '/' and not '//' or '/\' or containing backslashes
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\") || trimmed.includes("\\")) {
    return fallback;
  }

  // Prevent absolute URLs or dangerous protocols like javascript:, data:, http:
  try {
    const dummyBase = "http://localhost:3000";
    const parsed = new URL(trimmed, dummyBase);

    if (parsed.origin !== dummyBase) {
      return fallback;
    }

    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return fallback;
  }
}
