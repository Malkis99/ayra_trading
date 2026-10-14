"use client";

import React, { useMemo, useState } from "react";
import { Loader2, MessageSquare, RotateCcw, Save, Trash2 } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useAuth } from "@/lib/auth/auth-context";
import { ChipMultiSelect, Input, Segmented, Select, Textarea } from "@/components/ui/forms";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  SOCIAL_NETWORKS,
  countryOptions,
  nicknameDaysLeft,
  nicknameProblem,
  normalizeSocial,
  type ProfileDetails,
  type ProfileVisibility,
  type SocialNetwork,
} from "@/lib/profile";
import { formatString } from "@/lib/i18n";

const BIO_MAX = 160;
const NONE = "none";
const EXPERIENCE = ["less_than_1", "1_2_years", "3_5_years", "more_than_5"];
const MARKETS = ["forex", "indices", "metals", "energy", "stocks", "crypto", "other"];
const STYLES = ["scalping", "daytrading", "swing", "positional", "undecided"];
const SOCIAL_LABEL: Record<SocialNetwork, string> = { telegram: "Telegram", x: "X", instagram: "Instagram", youtube: "YouTube" };

type Form = {
  nick: string;
  bio: string;
  country: string;
  experience: string;
  markets: string[];
  styles: string[];
  socials: Record<SocialNetwork, string>;
  visibility: ProfileVisibility;
};

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-s1/70 p-4 sm:p-5">
      <div>
        <h2 className="text-sm font-semibold text-tx">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-mu">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Edit profile: nickname (Latin, 3–24, once per 14 days), bio, optional details, my posts.
 * Accounts: the nickname goes to profiles (server checks: unique, format, 14 days after migration 0003);
 * everything else is stored locally in the game state (AppStorage) until cloud sync (T7b).
 */
export function EditProfileTab() {
  const { dict, lang, showToast } = useApp();
  const { gameState, saveProfileEdits, deletePost } = useGame();
  const { authState, profile, saveNickname } = useAuth();
  const e = dict.profile.edit;
  const signedIn = authState === "authenticated";
  const answers = gameState.onboarding.answers as Record<string, unknown>;
  const details: ProfileDetails = gameState.profileDetails ?? {};

  // Saved values (onboarding answers fill the trading fields until the profile is edited once)
  const initial: Form = useMemo(
    () => ({
      nick: gameState.name,
      bio: gameState.bio || "",
      country: details.country || NONE,
      experience: details.experience || (typeof answers.experience === "string" && answers.experience) || NONE,
      markets: details.markets ?? (Array.isArray(answers.markets) ? (answers.markets as string[]).filter((m) => MARKETS.includes(m)) : []),
      styles: details.styles ?? (typeof answers.tradingStyle === "string" && STYLES.includes(answers.tradingStyle) ? [answers.tradingStyle] : []),
      socials: { telegram: details.socials?.telegram || "", x: details.socials?.x || "", instagram: details.socials?.instagram || "", youtube: details.socials?.youtube || "" },
      visibility: details.visibility || "public",
    }),
    // recompute when the saved state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gameState.name, gameState.bio, gameState.profileDetails, gameState.onboarding.answers]
  );
  const [form, setForm] = useState<Form>(initial);
  const [baseline, setBaseline] = useState<Form>(initial);
  if (baseline !== initial) {
    // saved state changed (after save or sync): reset the form to it
    setBaseline(initial);
    setForm(initial);
  }
  const [nickError, setNickError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingPost, setDeletingPost] = useState<number | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const lastNickChange = (signedIn ? profile?.nickname_changed_at : null) ?? details.nicknameChangedAt ?? null;
  const daysLeft = nicknameDaysLeft(lastNickChange);
  const nickChanged = form.nick.trim() !== gameState.name;
  const problem = nickChanged ? nicknameProblem(form.nick) : null;
  const problemText = problem === "latin" ? e.nicknameErrors.errorLatin : problem === "length" ? e.nicknameErrors.errorLength : null;

  const socialErrors = Object.fromEntries(
    SOCIAL_NETWORKS.map((n) => [n, normalizeSocial(n, form.socials[n]) === null ? formatString(e.socialInvalid, { network: SOCIAL_LABEL[n] }) : null])
  ) as Record<SocialNetwork, string | null>;
  const hasSocialError = SOCIAL_NETWORKS.some((n) => socialErrors[n]);

  const dirty =
    nickChanged ||
    form.bio !== initial.bio ||
    form.country !== initial.country ||
    form.experience !== initial.experience ||
    !sameList(form.markets, initial.markets) ||
    !sameList(form.styles, initial.styles) ||
    SOCIAL_NETWORKS.some((n) => form.socials[n] !== initial.socials[n]) ||
    form.visibility !== initial.visibility;

  const countries = useMemo(() => [{ value: NONE, label: e.countryPlaceholder }, ...countryOptions(lang)], [lang, e.countryPlaceholder]);
  const expLabels = dict.awakening.exp as Record<string, string>;
  const marketLabels = dict.awakening.markets as Record<string, string>;
  const styleLabels = dict.awakening.style as Record<string, string>;

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!dirty || problem || hasSocialError || saving) return;
    setSaving(true);
    setNickError(null);
    let finalName = gameState.name;
    let changedAt = details.nicknameChangedAt ?? null;
    let nickFailed = false;
    try {
      if (nickChanged) {
        const nick = form.nick.trim();
        if (daysLeft > 0) {
          setNickError(e.nicknameErrors.nicknameCooldown);
          nickFailed = true;
        } else {
          const res = signedIn ? await saveNickname(nick) : { success: true as const };
          if (res.success) {
            finalName = nick;
            changedAt = new Date().toISOString();
          } else {
            const key = (res.errorKey || "genericError") as keyof typeof e.nicknameErrors;
            setNickError(e.nicknameErrors[key] || e.nicknameErrors.genericError);
            nickFailed = true;
          }
        }
      }
    } catch {
      setNickError(e.nicknameErrors.genericError);
      nickFailed = true;
    }
    // Everything else is saved even if the nickname was refused
    const socials = Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, normalizeSocial(n, form.socials[n]) || undefined]).filter(([, v]) => v));
    saveProfileEdits({
      name: finalName,
      bio: form.bio.slice(0, BIO_MAX),
      details: {
        ...details,
        country: form.country === NONE ? undefined : form.country,
        experience: form.experience === NONE ? undefined : form.experience,
        markets: form.markets,
        styles: form.styles,
        socials,
        visibility: form.visibility,
        nicknameChangedAt: changedAt,
      },
    });
    setSaving(false);
    if (!nickFailed) showToast(e.saved);
  };

  return (
    <form onSubmit={save} className="space-y-4" noValidate data-testid="edit-profile">
      <Card title={dict.profile.settingsV2.profileSection}>
        <Input
          label={e.nickname}
          value={form.nick}
          maxLength={24}
          autoComplete="off"
          spellCheck={false}
          disabled={daysLeft > 0}
          onChange={(ev) => {
            set("nick", ev.target.value);
            setNickError(null);
          }}
          hint={daysLeft > 0 ? formatString(e.nicknameLocked, { days: daysLeft }) : `${e.nicknameHint}. ${e.nicknameRule}`}
          error={nickError ?? problemText ?? undefined}
          data-testid="edit-nickname"
        />
        <Textarea label={e.bio} value={form.bio} maxLength={BIO_MAX} rows={3} placeholder={dict.profile.editModal.bioPlaceholder} onChange={(ev) => set("bio", ev.target.value)} />
      </Card>

      <Card title={e.detailsTitle} hint={e.detailsHint}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label={e.country} options={countries} value={form.country} onChange={(v) => set("country", v)} searchable optional />
          <Select
            label={e.experience}
            options={[{ value: NONE, label: e.experiencePlaceholder }, ...EXPERIENCE.map((v) => ({ value: v, label: expLabels[v] || v }))]}
            value={form.experience}
            onChange={(v) => set("experience", v)}
            optional
          />
        </div>
        <ChipMultiSelect label={e.markets} options={MARKETS.map((v) => ({ value: v, label: marketLabels[v] || v }))} value={form.markets} onChange={(v) => set("markets", v)} optional />
        <ChipMultiSelect label={e.styles} options={STYLES.map((v) => ({ value: v, label: styleLabels[v] || v }))} value={form.styles} onChange={(v) => set("styles", v)} optional />
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-tx">{e.socials}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {SOCIAL_NETWORKS.map((n) => (
              <Input
                key={n}
                label={SOCIAL_LABEL[n]}
                value={form.socials[n]}
                placeholder={e.socialPlaceholder}
                autoComplete="off"
                spellCheck={false}
                onChange={(ev) => set("socials", { ...form.socials, [n]: ev.target.value })}
                error={socialErrors[n] ?? undefined}
                optional
              />
            ))}
          </div>
        </fieldset>
        <Segmented
          label={e.visibility}
          hint={e.visibilityHint}
          options={[
            { value: "public", label: e.visibilityPublic },
            { value: "hidden", label: e.visibilityHidden },
          ]}
          value={form.visibility}
          onChange={(v) => set("visibility", v)}
        />
      </Card>

      {/* Temporary home of "My posts" until Community has its own section */}
      <Card title={dict.profile.settingsV2.postsSection} hint={dict.profile.settingsV2.postsNote}>
        {gameState.posts.length === 0 ? (
          <p className="text-sm text-mu">{dict.profile.settingsV2.postsEmpty}</p>
        ) : (
          <ul className="space-y-2" data-testid="my-posts">
            {gameState.posts.map((post, idx) => (
              <li key={idx} className="flex items-start gap-3 rounded-xl border border-line/70 bg-s2/30 p-3">
                <MessageSquare size={16} className="mt-0.5 shrink-0 text-vi" aria-hidden="true" />
                <p className="line-clamp-3 min-w-0 flex-1 whitespace-pre-line break-words text-sm text-tx">{post}</p>
                <button
                  type="button"
                  onClick={() => setDeletingPost(idx)}
                  aria-label={dict.profile.posts.deleteBtn}
                  title={dict.profile.posts.deleteBtn}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-mu transition hover:bg-short/10 hover:text-short focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <ConfirmDialog
          isOpen={deletingPost !== null}
          title={dict.profile.settingsV2.deletePostTitle}
          description={dict.profile.settingsV2.deletePostText}
          confirmLabel={dict.profile.posts.deleteBtn}
          cancelLabel={dict.profile.wardrobe.cancelAction}
          isDanger
          onConfirm={() => {
            if (deletingPost !== null) deletePost(deletingPost);
            setDeletingPost(null);
            showToast(dict.profile.posts.deletedToast);
          }}
          onCancel={() => setDeletingPost(null)}
        />
      </Card>

      {/* Sticky action bar */}
      <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-ink/90 p-3 backdrop-blur md:bottom-3">
        <p className="text-xs text-mu" aria-live="polite" data-testid="edit-status">
          {dirty ? e.changed : e.noChanges}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setForm(initial);
              setNickError(null);
            }}
            disabled={!dirty || saving}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-edge px-4 text-sm font-semibold text-tx transition hover:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={15} aria-hidden="true" />
            {e.reset}
          </button>
          <button
            type="submit"
            disabled={!dirty || saving || !!problem || hasSocialError}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-pri px-4 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
            {e.save}
          </button>
        </div>
      </div>
    </form>
  );
}
