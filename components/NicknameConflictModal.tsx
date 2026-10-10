"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useApp } from "@/lib/context";
import { isValidLatinNickname } from "@/lib/stats";
import { Loader2, AlertCircle, Check } from "lucide-react";

export function NicknameConflictModal({
  initialNickname,
  onResolved,
}: {
  initialNickname: string;
  onResolved: () => void;
}) {
  const { dict } = useApp();
  const { auth } = dict;
  const { checkNicknameAvailable, saveNickname, suggestAvailableNickname } = useAuth();

  const [nickname, setNickname] = useState(initialNickname);
  const [checking, setChecking] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const runSuggestion = async () => {
      setChecking(true);
      const suggested = await suggestAvailableNickname(initialNickname);
      if (active) {
        setNickname(suggested);
        setIsAvailable(true);
        setChecking(false);
      }
    };
    runSuggestion();
    return () => {
      active = false;
    };
  }, [initialNickname, suggestAvailableNickname]);

  useEffect(() => {
    if (!nickname) {
      setIsAvailable(null);
      setErrorMsg(null);
      return;
    }

    const clean = nickname.trim();
    if (clean.length < 3 || clean.length > 24 || !isValidLatinNickname(clean)) {
      setIsAvailable(false);
      setErrorMsg(dict.awakening.q.nickname.errorLatin);
      return;
    }

    const timer = setTimeout(async () => {
      setChecking(true);
      const avail = await checkNicknameAvailable(clean);
      setChecking(false);
      setIsAvailable(avail);
      if (!avail) {
        setErrorMsg(dict.awakening.q.nickname.errorNicknameTaken);
      } else {
        setErrorMsg(null);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [nickname, checkNicknameAvailable, dict]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAvailable || checking || saving) return;

    setSaving(true);
    const res = await saveNickname(nickname.trim());
    setSaving(false);

    if (res.success) {
      onResolved();
    } else {
      setErrorMsg(dict.awakening.q.nickname.errorNicknameTaken);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-6 shadow-2xl space-y-4">
        <h2 className="font-serif text-xl font-bold text-tx">{auth.nicknameConflictTitle}</h2>
        <p className="text-xs text-tx-muted">{auth.nicknameConflictSubtitle}</p>

        <form onSubmit={handleSave} className="space-y-4 pt-2">
          <div>
            <label className="block text-xs font-semibold text-tx-muted uppercase mb-1">
              {dict.awakening.q.nickname.title}
            </label>
            <div className="relative">
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={24}
                className="w-full rounded-xl border border-line bg-ink py-2.5 px-3.5 text-sm text-tx focus:border-violet-glow focus:outline-none"
              />
              {checking && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-violet-glow" />
              )}
            </div>
          </div>

          {errorMsg && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!isAvailable || checking || saving}
            className="w-full rounded-xl bg-violet py-3 text-sm font-semibold text-white shadow-lg shadow-violet/30 transition hover:bg-violet-glow disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Check className="h-4 w-4" />
                <span>{auth.saveNicknameBtn}</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
