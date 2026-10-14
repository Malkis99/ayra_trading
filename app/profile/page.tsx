"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/lib/context";
import { Modal, Tabs } from "@/components/ui";
import { ProfileHero } from "@/components/profile/ProfileHero";
import { OverviewTab } from "@/components/profile/OverviewTab";
import { CharacterTab } from "@/components/profile/CharacterTab";
import { WardrobeTab } from "@/components/profile/WardrobeTab";
import { AchievementsTab } from "@/components/profile/AchievementsTab";
import { SettingsTab } from "@/components/profile/SettingsTab";

const PROFILE_TABS = ["overview", "character", "wardrobe", "achievements", "settings"] as const;
type ProfileTab = (typeof PROFILE_TABS)[number];

function isProfileTab(v: string | null): v is ProfileTab {
  return !!v && (PROFILE_TABS as readonly string[]).includes(v);
}

type Pending = { kind: "tab"; tab: ProfileTab } | { kind: "href"; href: string };

/** Profile: the hero on a cosmic stage on top, then all sections as tabs (the active tab lives in ?tab=). */
export default function ProfilePage() {
  const { dict } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: ProfileTab = isProfileTab(raw) ? raw : "overview";
  const t = dict.profile.tabsV2;
  const c = dict.profile.characterV2;

  // Unsaved appearance draft: ask "Save / Discard / Stay" before leaving the Character tab or the page
  const [charDirty, setCharDirty] = useState(false);
  const saveCharRef = useRef<(() => void) | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const switchTab = useCallback(
    (next: ProfileTab) => {
      router.replace(next === "overview" ? pathname : `${pathname}?tab=${next}`, { scroll: false });
    },
    [router, pathname]
  );

  const go = useCallback(
    (next: ProfileTab) => {
      if (next === tab) return;
      if (tab === "character" && charDirty) {
        setPending({ kind: "tab", tab: next });
        return;
      }
      switchTab(next);
    },
    [tab, charDirty, switchTab]
  );

  // Links elsewhere in the app (sidebar, top bar) and closing / reloading the tab
  useEffect(() => {
    if (!charDirty) return;
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
  }, [charDirty, pathname]);

  const proceed = (p: Pending) => {
    setPending(null);
    setCharDirty(false);
    if (p.kind === "tab") switchTab(p.tab);
    else router.push(p.href);
  };

  const btn =
    "inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi";

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-4 md:space-y-5">
      <ProfileHero onEditCharacter={() => go("character")} onOpenWardrobe={() => go("wardrobe")} />

      <Tabs idPrefix="profile" label={t.label} value={tab} onChange={go} items={PROFILE_TABS.map((id) => ({ id, label: t[id] }))} />

      <div role="tabpanel" id={`profile-panel-${tab}`} aria-labelledby={`profile-tab-${tab}`} key={tab} className="motion-safe:animate-[ayraFade_200ms_ease-out]">
        {tab === "overview" && <OverviewTab onOpenAchievements={() => go("achievements")} />}
        {tab === "character" && <CharacterTab onDirtyChange={setCharDirty} saveRef={saveCharRef} />}
        {tab === "wardrobe" && <WardrobeTab />}
        {tab === "achievements" && <AchievementsTab />}
        {tab === "settings" && <SettingsTab />}
      </div>

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
            <button type="button" onClick={() => pending && proceed(pending)} className={`${btn} border border-edge text-tx hover:border-short/60 hover:text-short`}>
              {c.discard}
            </button>
            <button
              type="button"
              onClick={() => {
                saveCharRef.current?.();
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
