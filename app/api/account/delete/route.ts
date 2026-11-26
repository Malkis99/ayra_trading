import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cleanApiKey, cleanSupabaseUrl } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createRateLimiter } from "@/lib/game-server/rate-limit";
import { DELETION_RATE, accountDeletionEnabled, handleAccountDeletion, type DeletionUser } from "@/lib/account-deletion/handler";
import { authProofs } from "@/lib/account-deletion/auth-proofs";

/**
 * Q4.7-Б1 — deleting one's own account, files included (docs/q4-7-b1-account-deletion-storage.md).
 *   GET  /api/account/delete              — the state of the person's own deletion
 *   POST /api/account/delete { confirm, action: "send_code" } — a one-time code to the account's e-mail
 *   POST /api/account/delete { confirm, password? | code? } — starts or continues it
 * The user comes only from the verified session. The service key is used here, on the server, for the database's steps
 * (0023), the Storage API and the auth server's admin calls — never sent to the browser. Off unless
 * NEXT_PUBLIC_AYRA_ACCOUNT_DELETION=1 (404) — the owner turns it on after migration 0023 is applied.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limiter = createRateLimiter(DELETION_RATE);

async function handle(req: Request) {
  const { url } = cleanSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const serviceKey = cleanApiKey(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  const anonKey = cleanApiKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
  const session = accountDeletionEnabled() ? createSupabaseServerClient() : null;
  const enabled = accountDeletionEnabled() && !!session && !!url && !!serviceKey && !!anonKey;
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = enabled ? createClient(url, serviceKey, opts) : null;
  let jwt: string | null = null;

  const out = await handleAccountDeletion(req, {
    enabled,
    async getUser(): Promise<DeletionUser | null> {
      const { data: s } = await session!.auth.getSession();
      jwt = s.session?.access_token ?? null;
      if (!jwt) return null;
      // the auth server checks this very token (how the person signed in is not read: it is no proof — the handler asks
      // for one made now)
      const { data, error } = await session!.auth.getUser(jwt);
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email ?? null };
    },
    // the password or a one-time e-mail code, checked by the auth server (shared with the hosted pilot)
    ...authProofs(url, anonKey),
    async rpc(fn, args) {
      const { data, error } = await service!.rpc(fn, args);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
    async removeFiles(bucket, names) {
      const { data, error } = await service!.storage.from(bucket).remove(names);
      return { removed: (data || []).map((o: { name: string }) => o.name), error: error ? "storage_error" : null };
    },
    async signOutOthers() {
      const { error } = await service!.auth.admin.signOut(jwt!, "others");
      return { error: error ? "sign_out_failed" : null };
    },
    async deleteAuthUser(id) {
      const { error } = await service!.auth.admin.deleteUser(id);
      return { error: error ? "auth_delete_failed" : null, notFound: (error as { status?: number } | null)?.status === 404 };
    },
    limiter,
    now: () => Date.now(),
  });
  return NextResponse.json(out.body, { status: out.status, headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
