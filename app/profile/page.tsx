"use client";

import React, { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/lib/context";
import { Tabs } from "@/components/ui";
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

/** Profile: the hero on a cosmic stage on top, then all sections as tabs (the active tab lives in ?tab=). */
export default function ProfilePage() {
  const { dict } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: ProfileTab = isProfileTab(raw) ? raw : "overview";
  const t = dict.profile.tabsV2;

  const go = useCallback(
    (next: ProfileTab) => {
      router.replace(next === "overview" ? pathname : `${pathname}?tab=${next}`, { scroll: false });
    },
    [router, pathname]
  );

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-4 md:space-y-5">
      <ProfileHero onEditCharacter={() => go("character")} onOpenWardrobe={() => go("wardrobe")} />

      <Tabs
        idPrefix="profile"
        label={t.label}
        value={tab}
        onChange={go}
        items={PROFILE_TABS.map((id) => ({ id, label: t[id] }))}
      />

      <div role="tabpanel" id={`profile-panel-${tab}`} aria-labelledby={`profile-tab-${tab}`} key={tab} className="motion-safe:animate-[ayraFade_200ms_ease-out]">
        {tab === "overview" && <OverviewTab onOpenAchievements={() => go("achievements")} />}
        {tab === "character" && <CharacterTab />}
        {tab === "wardrobe" && <WardrobeTab />}
        {tab === "achievements" && <AchievementsTab />}
        {tab === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}
