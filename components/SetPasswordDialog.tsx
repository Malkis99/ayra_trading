"use client";

import React, { useEffect, useState } from "react";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { passwordProblem } from "@/lib/auth/password";
import type { SanitizedErrorInfo } from "@/lib/auth/error-sanitizer";
import { Button, Modal } from "@/components/ui";
import { PasswordInput } from "@/components/ui/forms";

type Props = { isOpen: boolean; onClose: () => void; onSaved: () => void };

/**
 * «Create password» (account made by the e-mail code, no password yet) or «Change password» (asks the current one).
 * Works for the signed-in account only and sends no e-mail.
 */
export function SetPasswordDialog({ isOpen, onClose, onSaved }: Props) {
  const { dict } = useApp();
  const t = dict.account.password;
  const tech = dict.auth.techDetails;
  const { user, setPassword } = useAuth();
  const changing = Boolean(user?.hasPassword);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<keyof typeof t.errors | null>(null);
  const [details, setDetails] = useState<SanitizedErrorInfo | null>(null);
  const [currentBlank, setCurrentBlank] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCurrent("");
    setNext("");
    setErrorKey(null);
    setDetails(null);
    setCurrentBlank(false);
  }, [isOpen]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setCurrentBlank(changing && !current);
    const problem = passwordProblem(next);
    if (problem) {
      setErrorKey(problem);
      setDetails(null);
      return;
    }
    if (changing && !current) {
      setErrorKey(null);
      return;
    }
    setBusy(true);
    setErrorKey(null);
    setDetails(null);
    const res = await setPassword(next, changing ? current : undefined);
    setBusy(false);
    if (res.success) {
      onSaved();
      return;
    }
    setErrorKey((res.errorKey as keyof typeof t.errors) in t.errors ? (res.errorKey as keyof typeof t.errors) : "generic");
    setDetails(res.errorDetails ?? null);
  };

  const wrongCurrent = errorKey === "wrongCurrent";
  const formError = errorKey && !wrongCurrent && !["blank", "tooShort", "tooLong"].includes(errorKey) ? t.errors[errorKey] : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={changing ? t.change : t.create}
      subtitle={changing ? t.changeLead : t.createLead}
      closeLabel={t.close}
      size="sm"
      sheetOnMobile
      data-testid="set-password-dialog"
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {/* Hidden username for password managers: they store the password under this e-mail */}
        <input type="email" name="email" autoComplete="username" value={user?.email ?? ""} readOnly hidden />
        {changing && (
          <PasswordInput
            label={t.current}
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
              setCurrentBlank(false);
              if (errorKey === "wrongCurrent") setErrorKey(null);
            }}
            autoComplete="current-password"
            showLabel={t.show}
            hideLabel={t.hide}
            error={currentBlank ? t.errors.blank : wrongCurrent ? t.errors.wrongCurrent : undefined}
            data-testid="password-current"
          />
        )}
        <PasswordInput
          label={t.new}
          value={next}
          onChange={(e) => {
            setNext(e.target.value);
            if (errorKey === "blank" || errorKey === "tooShort" || errorKey === "tooLong") setErrorKey(null);
          }}
          autoComplete="new-password"
          showLabel={t.show}
          hideLabel={t.hide}
          hint={t.hint}
          error={errorKey === "blank" || errorKey === "tooShort" || errorKey === "tooLong" ? t.errors[errorKey] : undefined}
          data-testid="password-new"
          autoFocus={!changing}
        />

        <div aria-live="polite">
          {formError && (
            <div role="alert" className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300" data-testid="password-error">
              <p>{formError}</p>
              {details && (
                <details className="text-[11px] text-mu">
                  <summary className="cursor-pointer">{tech.toggle}</summary>
                  <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-2 break-all">
                    <dt>{tech.time}</dt>
                    <dd>{details.timestamp}</dd>
                    <dt>{tech.code}</dt>
                    <dd>{String(details.status)}</dd>
                    <dt>{tech.errorName}</dt>
                    <dd>{details.errorName}</dd>
                    <dt>{tech.message}</dt>
                    <dd>{details.sanitizedMessage}</dd>
                  </dl>
                </details>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t.cancel}
          </Button>
          <Button type="submit" disabled={busy} data-testid="password-save">
            {busy ? t.saving : t.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
