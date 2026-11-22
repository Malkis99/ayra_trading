/**
 * Q4.5-2 — the user of an economy request: the session's access token, verified by the auth server (getUser with THAT
 * token), and the claims of that same token for the database's freshness check (lib/game-server/session-token.ts).
 */
import type { SessionUser } from "./day-api";
import { sessionTokenOf } from "./session-token";

interface AuthLike {
  auth: {
    getSession(): Promise<{ data: { session: { access_token?: string | null } | null } }>;
    getUser(jwt?: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
}

export async function verifiedSessionUser(client: AuthLike): Promise<SessionUser | null> {
  const { data: s } = await client.auth.getSession();
  const jwt = s.session?.access_token;
  if (!jwt) return null;
  // the auth server checks this very token (signature, expiry, the user); its claims are read only after that
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) return null;
  return { id: data.user.id, token: sessionTokenOf(jwt) };
}
