import { isE2EMockEnabled } from "@/lib/supabase/config";

/**
 * Can the app send auth letters (sign-up confirmation, «Forgot password»)?
 *
 * Without custom SMTP the built-in Supabase mail sends only a few letters an hour for the whole project, so
 * registration and «Forgot password» are closed and sign-in by password (no letter) works as usual.
 * **To reopen both after SMTP is set up (supabase/README.md): change `false` to `true` here — one edit.**
 */
export const EMAIL_SENDING_READY = false;

/** e2e builds (auth mock or the fake Supabase) always exercise registration and «Forgot password». */
export function authEmailFlowsOpen(): boolean {
  return EMAIL_SENDING_READY || isE2EMockEnabled() || process.env.NEXT_PUBLIC_AYRA_E2E_EMAIL_OPEN === "1";
}
