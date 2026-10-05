"use client";

import React, { useState } from "react";
import { TabHeader } from "@/components/TabHeader";
import { CharacterScene } from "@/components/CharacterScene";
import { ProfileOverview } from "@/components/ProfileOverview";
import { WardrobeTab } from "@/components/WardrobeTab";
import { StatsTab } from "@/components/StatsTab";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState(0);
  const [wardrobePreview, setWardrobePreview] = useState<Record<string, number> | null>(null);

  const { dict } = useApp();
  const { gameState } = useGame();

  const tabs = [
    dict.profile.tabs.overview,
    dict.profile.tabs.wardrobe,
    dict.profile.tabs.achievements,
    dict.profile.tabs.chronicle,
    dict.profile.tabs.posts,
    dict.profile.tabs.stats,
  ];

  return (
    <div className="space-y-4">
      {/* Single Line Title */}
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">
          {dict.profile.title}
        </h1>
      </div>

      {/* Tabs Row */}
      <TabHeader tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Main Grid: Character Scene (left) + Tab Content (right) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-start">
        {/* Character Stage Left Column */}
        <div className="lg:col-span-5">
          <CharacterScene previewEquipment={wardrobePreview} />
        </div>

        {/* Tab Content Panel Right Column */}
        <div className="lg:col-span-7">
          {activeTab === 0 && (
            <ProfileOverview onGoToStatsTab={() => setActiveTab(5)} />
          )}

          {activeTab === 1 && (
            <WardrobeTab onPreviewChange={setWardrobePreview} />
          )}

          {activeTab === 2 && (
            <div className="card p-6 border border-line space-y-3">
              <h3 className="font-serif text-lg font-bold text-tx">
                {dict.profile.tabs.achievements}
              </h3>
              <p className="text-xs text-mu">{dict.profile.inDev}</p>
              <div className="rounded-xl border border-line/40 bg-s2/40 p-4 text-xs text-mu">
                {Object.keys(gameState.achievements || {}).length === 0 ? (
                  <p>{dict.profile.noAchievements}</p>
                ) : (
                  <ul className="space-y-2">
                    {Object.keys(gameState.achievements).map((key) => (
                      <li key={key} className="flex items-center gap-2 text-tx font-semibold">
                        <span className="text-go">★</span>
                        <span>{key}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {activeTab === 3 && (
            <div className="card p-6 border border-line space-y-3">
              <h3 className="font-serif text-lg font-bold text-tx">
                {dict.profile.tabs.chronicle}
              </h3>
              <p className="text-xs text-mu">{dict.profile.inDev}</p>
              <div className="rounded-xl border border-line/40 bg-s2/40 p-4 text-xs text-mu max-h-96 overflow-y-auto space-y-2">
                {gameState.chronicle.map((item, idx) => {
                  let text = "";
                  if (typeof item === "string") {
                    text = item;
                  } else if (item.type === "questDone") {
                    text = formatString(dict.chronicleEvents.questDone, {
                      title: item.title,
                      xp: item.xp,
                    });
                  } else if (item.type === "levelUp") {
                    text = formatString(dict.chronicleEvents.levelUp, {
                      level: item.level,
                    });
                  } else if (item.type === "dailyReward") {
                    text = formatString(dict.chronicleEvents.dailyReward, {
                      coins: item.coins,
                    });
                  } else if (item.type === "itemEquipped") {
                    text = formatString(dict.chronicleEvents.itemEquipped, {
                      name: item.name,
                    });
                  } else if (item.type === "titleUnlocked") {
                    text = formatString(dict.chronicleEvents.titleUnlocked, {
                      title: item.titleId,
                    });
                  } else if (item.type === "titleSelected") {
                    text = formatString(dict.chronicleEvents.titleSelected, {
                      title: item.titleId,
                    });
                  } else if (item.type === "nicknameChanged") {
                    text = formatString(dict.chronicleEvents.nicknameChanged, {
                      name: item.name,
                    });
                  } else if (item.type === "characterCreated") {
                    text = dict.chronicleEvents.characterCreated;
                  } else {
                    text = JSON.stringify(item);
                  }

                  return (
                    <div key={idx} className="p-2 rounded bg-s1 border border-line/30 text-tx">
                      • {text}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 4 && (
            <div className="card p-6 border border-line space-y-3">
              <h3 className="font-serif text-lg font-bold text-tx">
                {dict.profile.tabs.posts}
              </h3>
              <p className="text-xs text-mu">{dict.profile.inDev}</p>
              <div className="rounded-xl border border-dashed border-line p-8 text-center text-xs text-mu">
                {formatString(dict.profile.emptyDetails, {
                  tab: dict.profile.tabs.posts,
                })}
              </div>
            </div>
          )}

          {activeTab === 5 && <StatsTab />}
        </div>
      </div>
    </div>
  );
}
