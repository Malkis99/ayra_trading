/**
 * Password rule (owner decision, docs/auth-password-plan.md section 11): at least 8 characters, no required
 * character classes. Supabase stores at most 72 bytes of a password (bcrypt), so longer ones are refused here
 * instead of being silently cut by the server. The same minimum is set in the Supabase panel.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

export type PasswordProblem = "blank" | "tooShort" | "tooLong";

export function passwordProblem(password: string): PasswordProblem | null {
  if (!password || password.trim() === "") return "blank";
  if ([...password].length < PASSWORD_MIN_LENGTH) return "tooShort";
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return "tooLong";
  return null;
}

/** Supabase answers to a password update -> dictionary keys of `account.password.errors`. */
export function passwordUpdateErrorKey(error: { code?: string; message?: string; status?: number } | null | undefined): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  if (code === "same_password" || message.includes("different from the old")) return "samePassword";
  if (code === "weak_password" || message.includes("password should be")) return "tooShort";
  if (code === "reauthentication_needed" || message.includes("reauthentication")) return "reauthNeeded";
  if (error?.status === 429 || message.includes("rate limit")) return "tooManyAttempts";
  if (message.includes("fetch") || message.includes("network")) return "network";
  return "generic";
}

/** Sign-in screen lock after repeated wrong passwords (owner decision 6; placeholders). Server limits stay the real protection. */
export const SIGN_IN_MAX_FAILS = 5;
export const SIGN_IN_LOCK_SECONDS = 30;

type AuthErrorLike = { code?: string; message?: string; status?: number; name?: string } | null | undefined;

/**
 * Supabase answers to a password sign-in -> keys of `auth.errors`. A wrong password and an unknown e-mail give the
 * same key, so the screen never tells whether an e-mail is registered. «Not confirmed» comes only after a right password.
 */
export function signInErrorKey(error: AuthErrorLike): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  if (error?.status === 429 || message.includes("rate limit") || message.includes("too many")) return "tooManyAttempts";
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) return "emailNotConfirmed";
  if (message.includes("fetch") || message.includes("network") || error?.status === 0) return "networkError";
  if (typeof error?.status === "number" && error.status >= 500) return "authUnavailable";
  return "invalidCredentials";
}

/** «User already registered» must look like a normal sign-up (the code screen with a hint), never like an error. */
export function isAlreadyRegistered(error: AuthErrorLike): boolean {
  const code = error?.code ?? "";
  return code === "user_already_exists" || code === "email_exists" || (error?.message ?? "").toLowerCase().includes("already registered");
}
