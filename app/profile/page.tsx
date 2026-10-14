"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { Modal, Tabs } from "@/components/ui";
import { CharacterStage } from "@/components/CharacterStage";
import { OverviewTab } from "@/components/profile/OverviewTab";
import { StatsTab } from "@/components/profile/StatsTab";
import { WardrobeTab } from "@/components/profile/WardrobeTab";
import { AchievementsTab } from "@/components/profile/AchievementsTab";
import { EditProfileTab } from "@/components/profile/EditProfileTab";
import { AppearanceSection } from "@/components/profile/AppearanceSection";
import { SlotPicker } from "@/components/profile/SlotPicker";
import { sameAppearance } from "@/lib/profile";
import type { AvatarAppearance } from "@/lib/avatar";
import type { SlotName } from "@/lib/items";

const PROFILE_TABS = ["overview", "stats", "wardrobe", "achievements", "edit"] as const;
type ProfileTab = (typeof PROFILE_TABS)[number];

/** ?tab= value -> tab; links from before this layout still work (settings -> edit, character -> wardrobe). */
function tabFromParam(v: string | null): ProfileTab {
  if (v === "settings") return "edit";
  if (v === "character") return "wardrobe";
  return v && (PROFILE_TABS as readonly string[]).includes(v) ? (v as ProfileTab) : "overview";
}

type Pending = { kind: "tab"; tab: ProfileTab } | { kind: "href"; href: string };

/**
 * Profile: tabs on top; below, the character stage on the left (sticky, visible on every tab, so there is no second
 * character anywhere) and one wide panel with the active tab on the right. On phones: stage, tabs, panel.
 */
export default function ProfilePage() {
  const { dict, showToast } = useApp();
  const { gameState, updateAvatarAppearance } = useGame();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = tabFromParam(params.get("tab"));
  const t = dict.profile.tabsV3;
  const c = dict.profile.characterV2;

  // Appearance draft: shown on the stage at once, saved with "Save"
  const saved = gameState.profile.appearance;
  const [draft, setDraft] = useState<AvatarAppearance>(saved);
  const dirty = !sameAppearance(draft, saved);
  const savedKey = `${saved.skinTone}|${saved.hairstyle}|${saved.hairColor}|${saved.outfit}`;
  const lastSavedKey = useRef(savedKey);
  useEffect(() => {
    // the saved look changed elsewhere (other tab, first load): follow it
    if (lastSavedKey.current !== savedKey) {
      lastSavedKey.current = savedKey;
      setDraft({ ...saved });
    }
  }, [savedKey, saved]);

  const saveDraft = useCallback(() => {
    updateAvatarAppearance({ ...draft, stageBackground: saved.stageBackground });
    showToast(c.saved);
  }, [draft, saved.stageBackground, updateAvatarAppearance, showToast, c.saved]);

  const [slot, setSlot] = useState<SlotName | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const switchTab = useCallback(
    (next: ProfileTab) => router.replace(next === "overview" ? pathname : `${pathname}?tab=${next}`, { scroll: false }),
    [router, pathname]
  );
  const go = useCallback(
    (next: ProfileTab) => {
      if (next === tab) return;
      if (tab === "wardrobe" && dirty) {
        setPending({ kind: "tab", tab: next });
        return;
      }
      switchTab(next);
    },
    [tab, dirty, switchTab]
  );

  // Unsaved appearance: app links (sidebar, top bar) ask first; closing or reloading the page gets the browser prompt
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === pathname && url.search === window.location.search)) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ kind: "href", href: url.pathname + url.search + url.hash });
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty, pathname]);

  const proceed = (p: Pending) => {
    setPending(null);
    if (p.kind === "tab") switchTab(p.tab);
    else router.push(p.href);
  };

  const btn = "inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi";

  return (
    <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-5">
      <div className="order-2 min-w-0 lg:order-none lg:col-span-2">
        <Tabs idPrefix="profile" label={t.label} value={tab} onChange={go} items={PROFILE_TABS.map((id) => ({ id, label: t[id] }))} />
      </div>

      <aside className="order-1 min-w-0 lg:sticky lg:top-4 lg:order-none lg:self-start">
        <CharacterStage appearance={draft} onSlotClick={setSlot} selectedSlot={slot} />
      </aside>

      <section
        role="tabpanel"
        id={`profile-panel-${tab}`}
        aria-labelledby={`profile-tab-${tab}`}
        key={tab}
        className="order-3 min-w-0 rounded-2xl border border-line/70 bg-s1/30 p-3 motion-safe:animate-[ayraFade_200ms_ease-out] sm:p-4 lg:order-none lg:min-h-[560px]"
      >
        {tab === "overview" && <OverviewTab onOpenAchievements={() => go("achievements")} onEditProfile={() => go("edit")} />}
        {tab === "stats" && <StatsTab />}
        {tab === "wardrobe" && (
          <div className="space-y-4">
            <AppearanceSection draft={draft} onChange={setDraft} dirty={dirty} onSave={saveDraft} onReset={() => setDraft({ ...saved })} />
            <WardrobeTab />
          </div>
        )}
        {tab === "achievements" && <AchievementsTab />}
        {tab === "edit" && <EditProfileTab />}
      </section>

      <SlotPicker slot={slot} onClose={() => setSlot(null)} />

      <Modal
        isOpen={pending !== null}
        onClose={() => setPending(null)}
        title={c.unsavedTitle}
        closeLabel={c.stay}
        size="sm"
        data-testid="unsaved-dialog"
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setPending(null)} className={`${btn} text-mu hover:bg-s2 hover:text-tx`}>
              {c.stay}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft({ ...saved });
                if (pending) proceed(pending);
              }}
              className={`${btn} border border-edge text-tx hover:border-short/60 hover:text-short`}
            >
              {c.discard}
            </button>
            <button
              type="button"
              onClick={() => {
                saveDraft();
                if (pending) proceed(pending);
              }}
              className={`${btn} bg-pri text-white hover:brightness-110`}
            >
              {c.save}
            </button>
          </div>
        }
      >
        <p className="text-sm text-mu">{c.unsavedText}</p>
      </Modal>
    </div>
  );
}
