/**
 * Q4.5-2 — which account a server answer belongs to. Every economy request is sent with the scope it was made for: the
 * loaded account space, how many times the game has switched spaces (a space generation), the auth session generation
 * (lib/auth/auth-generation.ts: a sign-out, another account or a new sign-in of the same account ends it) and the
 * account id. An answer is applied ONLY when the server names that same account (it reads the user from the verified
 * token) and nothing of the scope has changed since: the active space, the loaded space and both generations. The space
 * that happens to be active when an answer arrives proves nothing on its own.
 */
export interface RequestScope {
  /** «account:<id>» — the space the request was made for */
  space: string;
  /** the account id of that space */
  account: string;
  /** how many times the game had loaded a space when the request was sent */
  spaceGeneration: number;
  /** the auth session generation when the request was sent */
  authGeneration: number;
}

export interface ScopeNow {
  activeSpace: string;
  loadedSpace: string | null;
  spaceGeneration: number;
  authGeneration: number;
}

/** The scope of a request made now — none outside an account space (a guest has no server economy). */
export function requestScopeOf(now: ScopeNow): RequestScope | null {
  const space = now.loadedSpace;
  if (!space || !space.startsWith("account:") || now.activeSpace !== space) return null;
  const account = space.slice("account:".length);
  if (!account) return null;
  return { space, account, spaceGeneration: now.spaceGeneration, authGeneration: now.authGeneration };
}

/**
 * Does an answer still belong where it would be applied? The server must name the request's account, and the device
 * must still be in exactly that scope: same active and loaded space, same space generation, same auth generation.
 */
export function answerBelongs(scope: RequestScope | null | undefined, answeredAccount: string | null | undefined, now: ScopeNow): boolean {
  if (!scope || typeof answeredAccount !== "string" || answeredAccount !== scope.account) return false;
  return (
    now.activeSpace === scope.space &&
    now.loadedSpace === scope.space &&
    now.spaceGeneration === scope.spaceGeneration &&
    now.authGeneration === scope.authGeneration
  );
}
