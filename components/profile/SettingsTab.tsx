"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Download, LogIn, LogOut, Settings2, Shield, Trash2, Loader2 } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useAuth } from "@/lib/auth/auth-context";
import { Input, Segmented, Select, Textarea, Toggle } from "@/components/ui/forms";
import { exportProfileDataJSON } from "@/lib/stats";
import { nicknameProblem, timeZoneOptions } from "@/lib/profile";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-s1/70 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-tx">{title}</h2>
      {children}
    </section>
  );
}

const BIO_MAX = 160;

/** Profile settings: nickname and bio, language, time zone, 16–17 mode (info), notifications, export, account. */
export function SettingsTab() {
  const { dict, lang, setLanguage, showToast } = useApp();
  const { gameState, updateProfile, updateTimezone } = useGame();
  const { user, authState, signOut, checkNicknameAvailable, saveNickname } = useAuth();
  const s = dict.profile.settingsV2;
  const isSignedIn = authState === "authenticated";

  const [nick, setNick] = useState(gameState.name);
  const [bio, setBio] = useState(gameState.bio || "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const tz = gameState.profile.timezone || "UTC";
  const zones = useMemo(() => timeZoneOptions(tz).map((z) => ({ value: z, label: z.replace(/_/g, " ") })), [tz]);
  const changed = nick.trim() !== gameState.name || bio !== (gameState.bio || "");

  const problem = nicknameProblem(nick);
  const problemText =
    problem === "latin" ? dict.profile.editModal.nicknameErrorLatin : problem === "length" ? dict.awakening.q.nickname.errorLength : null;

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nick.trim();
    if (problem) {
      setError(problemText);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isSignedIn && trimmed !== gameState.name) {
        const free = await checkNicknameAvailable(trimmed);
        if (!free) {
          setError(dict.awakening.q.nickname.errorNicknameTaken);
          return;
        }
        await saveNickname(trimmed);
      }
      updateProfile(trimmed, bio.slice(0, BIO_MAX));
      showToast(dict.chronicleEvents.profileUpdated);
    } finally {
      setSaving(false);
    }
  };

  const exportData = () => {
    const blob = new Blob([exportProfileDataJSON(gameState)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ayra-profile-${gameState.name || "profile"}-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(dict.profile.statsTab.downloadedToast);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={s.profileSection}>
        <form onSubmit={saveProfile} className="space-y-4" noValidate>
          <Input
            label={s.nickname}
            hint={s.nicknameHint}
            value={nick}
            maxLength={24}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setNick(e.target.value);
              setError(null);
            }}
            error={error ?? (nick.trim() && problemText ? problemText : undefined)}
          />
          <Textarea label={s.bio} value={bio} maxLength={BIO_MAX} rows={3} placeholder={dict.profile.editModal.bioPlaceholder} onChange={(e) => setBio(e.target.value)} />
          <button
            type="submit"
            disabled={!changed || saving || !!problem}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-pri px-4 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {saving ? s.checking : s.save}
          </button>
        </form>
      </Card>

      <Card title={s.preferencesSection}>
        <Segmented
          label={s.language}
          options={[
            { value: "ru", label: dict.settings.languageRu },
            { value: "en", label: dict.settings.languageEn },
          ]}
          value={lang}
          onChange={(v) => setLanguage(v)}
        />
        {/* IANA time zone ids (Asia/Tbilisi) are technical names: excluded from the i18n leakage test */}
        <div data-i18n-ignore>
          <Select label={s.timezone} options={zones} value={tz} onChange={(v) => updateTimezone(v)} searchable />
        </div>
        <div className="rounded-xl border border-line/70 bg-s2/30 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-tx">
            <Shield size={15} className="text-vi" aria-hidden="true" />
            {s.minorTitle}
          </p>
          <p className="mt-1 text-xs text-mu">{gameState.profile.minorMode ? `${dict.settings.minorModeBadge}. ${dict.settings.minorModeInfo}` : s.minorOff}</p>
        </div>
        <Toggle
          label={
            <span className="flex items-center gap-2">
              {s.notifications}
              <span className="rounded bg-s2 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-mu">{s.soon}</span>
            </span>
          }
          description={s.notificationsSoon}
          checked={false}
          disabled
          onChange={() => {}}
        />
      </Card>

      <Card title={s.dataSection}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-tx">{s.exportTitle}</p>
            <p className="text-xs text-mu">{s.exportDesc}</p>
          </div>
          <button
            type="button"
            onClick={exportData}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border border-edge px-4 text-sm font-semibold text-tx transition hover:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
          >
            <Download size={16} aria-hidden="true" />
            {dict.profile.statsTab.exportJsonBtn}
          </button>
        </div>
        <Link href="/settings" className="inline-flex items-center gap-1.5 text-xs font-semibold text-vi hover:text-tx">
          <Settings2 size={14} aria-hidden="true" />
          {s.allSettings}
        </Link>
      </Card>

      <Card title={s.accountSection}>
        {user ? (
          <>
            <p className="text-sm text-mu">
              {dict.account.emailLabel}: <span className="font-semibold text-tx">{user.email}</span>
            </p>
            <button
              type="button"
              onClick={() => signOut()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-edge px-4 text-sm font-semibold text-tx transition hover:border-short/60 hover:text-short focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
            >
              <LogOut size={16} aria-hidden="true" />
              {dict.account.signOutBtn}
            </button>
            <div className="flex flex-col gap-2 rounded-xl border border-short/25 bg-short/5 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-tx">
                  {s.deleteTitle}
                  <span className="rounded bg-s2 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-mu">{s.soon}</span>
                </p>
                <p className="text-xs text-mu">{s.deleteDesc}</p>
              </div>
              <button
                type="button"
                disabled
                className="inline-flex min-h-[40px] shrink-0 cursor-not-allowed items-center gap-2 rounded-xl border border-short/30 px-3 text-sm font-semibold text-short/60"
              >
                <Trash2 size={15} aria-hidden="true" />
                {s.deleteTitle}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-mu">{s.guestNote}</p>
            <Link
              href="/login"
              className="inline-flex min-h-[44px] items-center gap-2 self-start rounded-xl bg-pri px-4 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
            >
              <LogIn size={16} aria-hidden="true" />
              {dict.account.signInToCloudBtn}
            </Link>
          </>
        )}
      </Card>
    </div>
  );
}
