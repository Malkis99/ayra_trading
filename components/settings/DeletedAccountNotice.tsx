"use client";

import React, { useEffect, useState } from "react";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { DELETED_ACCOUNTS_EVENT, AppStorage } from "@/lib/storage";
import { deleteAccountDeviceData } from "@/lib/storage/profile-transfer";

/**
 * Q4.7-Б1 — on a device of an account that was deleted elsewhere: its copy is still kept here (the journal, the game,
 * screenshots). The person decides to erase it; nothing is written into it again meanwhile (lib/storage).
 */
export function DeletedAccountNotice() {
  const { dict } = useApp();
  const t = dict.account.deletion;
  const { authState } = useAuth();
  const [ids, setIds] = useState<string[]>([]);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // on every change of who is signed in, and whenever an account is marked deleted — here or in another tab; the mark
    // can come after the sign-out it causes has already been shown (supabase-js may sign out first on a failed refresh)
    const read = () => setIds(AppStorage.deletedAccountsWithLocalData().filter((id) => AppStorage.getActiveSpaceId() !== `account:${id}`));
    read();
    const onStorage = (e: StorageEvent) => { if (e.key === "ayra_deleted_accounts") read(); };
    window.addEventListener(DELETED_ACCOUNTS_EVENT, read);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DELETED_ACCOUNTS_EVENT, read);
      window.removeEventListener("storage", onStorage);
    };
  }, [authState]);

  if (hidden || ids.length === 0) return null;
  const erase = async () => {
    setBusy(true);
    for (const id of ids) await deleteAccountDeviceData(id).catch(() => AppStorage.clear(id));
    setBusy(false);
    setIds([]);
    // another notice of this tab (the page may have changed meanwhile) reads again what is left
    window.dispatchEvent(new CustomEvent(DELETED_ACCOUNTS_EVENT));
  };
  return (
    <div role="status" className="mx-4 mt-3 flex flex-col gap-2 rounded-xl border border-vi/40 bg-pri/20 p-3 text-xs text-tx sm:flex-row sm:items-center sm:justify-between"
      data-testid="deleted-account-notice">
      <p>{t.otherDevice}</p>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={erase} disabled={busy} className="btn-danger px-3 py-1.5 text-xs" data-testid="deleted-account-erase">{t.eraseCopy}</button>
        <button type="button" onClick={() => setHidden(true)} disabled={busy} className="btn-ghost border border-line px-3 py-1.5 text-xs">{t.keepCopy}</button>
      </div>
    </div>
  );
}
