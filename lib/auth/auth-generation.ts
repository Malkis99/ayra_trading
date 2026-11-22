/**
 * Which sign-in a late answer belongs to. An answer started for one session (the load-time getUser) may come back after
 * a sign-out, another account's sign-in, or a new sign-in of the same account; it must then change nothing.
 *
 * A session's identity is its account plus its Supabase session id (the `session_id` claim of the access token): a token
 * refresh keeps it, a new sign-in of the same account gets a new one. Seeing no session, or another identity, starts a
 * new generation; an answer applies only while the generation it was started in is still current.
 */

type SessionLike = { access_token?: string | null; user?: { id: string } | null } | null | undefined;

/** The `session_id` claim of an access token, or null when the token has none or cannot be read. */
export function tokenSessionId(accessToken: string | null | undefined): string | null {
  if (!accessToken) return null;
  const part = accessToken.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const sid = (JSON.parse(json) as { session_id?: unknown }).session_id;
    return typeof sid === "string" && sid ? sid : null;
  } catch {
    return null;
  }
}

/** The identity of a session: account and session id; null for no session. */
export function sessionIdentity(session: SessionLike): string | null {
  if (!session?.user?.id) return null;
  return `${session.user.id}:${tokenSessionId(session.access_token) ?? ""}`;
}

export class AuthGeneration {
  private identity: string | null | undefined = undefined;
  private generation = 0;

  /** Notes the session seen now (null: no session); returns the generation it belongs to. */
  observe(session: SessionLike): number {
    const next = sessionIdentity(session);
    if (next === null || next !== this.identity) {
      // no session always ends the generation: a sign-out followed by a sign-in of the same session id is still new
      if (!(next === null && this.identity === null)) this.generation += 1;
      this.identity = next;
    }
    return this.generation;
  }

  /** Whether an answer started in `generation` may still be applied. */
  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}
