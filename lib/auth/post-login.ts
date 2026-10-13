import { sanitizeRedirectUrl } from "./redirect-whitelist";

/**
 * The only place that decides where a user goes after signing in. /auth/callback (email link),
 * "Continue here" and code entry on /login all lead here; the page waits for the account space and
 * the cloud profile, then calls resolvePostLoginRoute once.
 */
export const POST_LOGIN_ROUTER = "/auth/continue";

/** Destinations that must never be used as "next" after sign-in (they would loop). */
function isAuthFlowPath(path: string): boolean {
  const pathname = path.split(/[?#]/)[0];
  return pathname === "/login" || pathname === "/logout" || pathname.startsWith("/auth/");
}

/** Safe "next" for after sign-in: a same-site path, never an auth-flow page. */
export function safeNextAfterLogin(rawNext: string | null | undefined): string {
  const next = sanitizeRedirectUrl(rawNext, "/");
  return isAuthFlowPath(next) ? "/" : next;
}

/** URL of the post-login router, carrying the requested destination. */
export function postLoginRouterUrl(rawNext?: string | null): string {
  const next = safeNextAfterLogin(rawNext);
  return next === "/" ? POST_LOGIN_ROUTER : `${POST_LOGIN_ROUTER}?next=${encodeURIComponent(next)}`;
}
