/**
 * Temporary auth-flow diagnostics. Off by default; enable with NEXT_PUBLIC_AYRA_AUTH_DEBUG=1 at build
 * time or `window.__AYRA_AUTH_DEBUG__ = true` in the browser. Never logs emails or tokens.
 */
export function isAuthDebugEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_AYRA_AUTH_DEBUG === "1") return true;
  return typeof window !== "undefined" && Boolean((window as any).__AYRA_AUTH_DEBUG__);
}

export function authDebug(event: string, data: Record<string, unknown> = {}): void {
  if (!isAuthDebugEnabled()) return;
  const path = typeof window !== "undefined" ? window.location.pathname : "server";
  console.info(`[AYRA:auth] ${event} ${JSON.stringify({ path, ...data })}`);
}

/** Short, non-identifying summary of a stored game state for diagnostics. */
export function describeGameState(raw: string | null): Record<string, unknown> {
  if (!raw) return { stored: false };
  try {
    const s = JSON.parse(raw);
    return { stored: true, name: s?.name ?? null, level: s?.level ?? null, onboarding: s?.onboarding?.status ?? "missing" };
  } catch {
    return { stored: true, parse: "error" };
  }
}
