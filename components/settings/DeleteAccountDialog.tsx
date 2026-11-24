"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { AppStorage } from "@/lib/storage";
import { Button, Modal } from "@/components/ui";
import { PasswordInput } from "@/components/ui/forms";

type Props = { isOpen: boolean; onClose: () => void; resuming?: boolean };
type ErrorKey = keyof ReturnType<typeof useApp>["dict"]["account"]["deletion"]["errors"];

/**
 * Q4.7-Б1 — «Delete account» (docs/q4-7-b1-account-deletion-storage.md): what is deleted, that it cannot be undone, the
 * typed confirmation and a proof that it is the person (the password, or a sign-in within 10 minutes — the server decides).
 * The server deletes the files first and the account last; until it answers «deleted» nothing is called done, and a
 * failed step can be repeated safely. After it: this device's copy of the account is erased and the person is signed out.
 */
export function DeleteAccountDialog({ isOpen, onClose, resuming = false }: Props) {
  const { dict, showToast } = useApp();
  const t = dict.account.deletion;
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPhrase("");
    setPassword("");
    setError(null);
    setLeft(null);
  }, [isOpen]);

  const confirmed = phrase.trim() === t.phrase;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !confirmed || !user) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ confirm: phrase.trim(), ...(password ? { password } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { state?: string; error?: string; listed?: number; gone?: number };
      if (res.ok && body.state === "deleted") {
        const userId = user.id;
        // signed out first (it writes this tab's copy back), then this device's copy of the account erased
        await signOut().catch(() => undefined);
        AppStorage.clear(userId);
        showToast(t.done);
        router.replace("/login");
        return;
      }
      const code = (body.error && body.error in t.errors ? body.error : res.status === 429 ? "rate_limited" : "generic") as ErrorKey;
      setError(code);
      setLeft(typeof body.listed === "number" && typeof body.gone === "number" ? Math.max(0, body.listed - body.gone) : null);
    } catch {
      setError("unavailable");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={busy ? () => undefined : onClose} title={t.title} subtitle={t.lead} closeLabel={t.cancel} size="sm" sheetOnMobile
      data-testid="delete-account-dialog">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <input type="email" name="email" autoComplete="username" value={user?.email ?? ""} readOnly hidden />
        {resuming && (
          <p className="rounded-xl border border-vi/40 bg-pri/20 p-3 text-xs text-tx" data-testid="delete-account-resuming">{t.unfinished}</p>
        )}
        <div className="space-y-1.5 text-xs text-tx">
          <p className="font-semibold">{t.willDelete}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-mu">
            {[t.item1, t.item2, t.item3, t.item4, t.item5].map((x) => <li key={x}>{x}</li>)}
          </ul>
        </div>
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{t.irreversible}</p>
        <p className="text-[11px] text-mu">{t.devices}</p>

        <label className="block space-y-1 text-xs">
          <span className="text-mu">{t.typeLabel}</span>
          <input value={phrase} onChange={(e) => setPhrase(e.target.value)} className="input w-full text-sm" autoComplete="off" spellCheck={false}
            data-testid="delete-account-phrase" disabled={busy} />
        </label>
        {user?.hasPassword ? (
          <PasswordInput label={t.password} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
            showLabel={dict.account.password.show} hideLabel={dict.account.password.hide} data-testid="delete-account-password" />
        ) : (
          <p className="text-[11px] text-mu" data-testid="delete-account-fresh-hint">{t.freshHint}</p>
        )}

        <div aria-live="polite">
          {busy && <p className="text-xs text-mu" data-testid="delete-account-working">{t.working}</p>}
          {error && (
            <div role="alert" className="space-y-1 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300" data-testid="delete-account-error"
              data-code={error}>
              <p>{t.errors[error]}</p>
              {left !== null && left > 0 && <p data-testid="delete-account-left">{t.left.replace("{n}", String(left))}</p>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t.cancel}</Button>
          <button type="submit" disabled={!confirmed || busy} className="btn-danger px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="delete-account-submit">
            {error ? t.retry : t.submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}
