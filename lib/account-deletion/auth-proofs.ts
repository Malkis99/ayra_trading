import { createClient } from "@supabase/supabase-js";
import type { DeletionDeps } from "./handler";

/**
 * The auth server's checks behind a deletion's proof (P5 remediation), shared by the route and the hosted pilot so the
 * pilot runs exactly this code. Each check uses a separate client and keeps no session: the one a successful check opens
 * is ended right away.
 */
export function authProofs(url: string, anonKey: string): Pick<DeletionDeps, "verifyPassword" | "sendCode" | "verifyCode"> {
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    async verifyPassword(email, password) {
      const check = createClient(url, anonKey, opts);
      const { data, error } = await check.auth.signInWithPassword({ email, password });
      if (error || !data.session) return false;
      await check.auth.signOut({ scope: "local" }).catch(() => undefined);
      return true;
    },
    async sendCode(email) {
      // the auth server's own one-time code to the account's e-mail; never creates an account
      const { error } = await createClient(url, anonKey, opts).auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (!error) return { error: null };
      return { error: (error as { status?: number }).status === 429 ? "rate_limited" : "failed" };
    },
    async verifyCode(email, code) {
      // the auth server checks the code (single-use there) and names the account it belongs to
      const check = createClient(url, anonKey, opts);
      const { data, error } = await check.auth.verifyOtp({ email, token: code, type: "email" });
      if (error || !data.session || !data.user) return null;
      await check.auth.signOut({ scope: "local" }).catch(() => undefined);
      return { userId: data.user.id };
    },
  };
}
