"use client";

import React from "react";
import { X, Check, Lock, Sparkles } from "lucide-react";
import { useGame } from "@/lib/game-context";
import { useApp } from "@/lib/context";
import { TITLES_CATALOG, TitleItem, TitleRarity } from "@/lib/titles";
import { formatString } from "@/lib/i18n";

interface TitlesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TitlesModal({ isOpen, onClose }: TitlesModalProps) {
  const { gameState, selectTitle } = useGame();
  const { dict, showToast } = useApp();

  if (!isOpen) return null;

  const getRarityBadge = (rarity: TitleRarity) => {
    switch (rarity) {
      case "common":
        return "border-line text-mu bg-s2";
      case "rare":
        return "border-blue-500/30 text-blue-400 bg-blue-500/10";
      case "epic":
        return "border-vi/40 text-vi-lt bg-vi/10";
      case "legendary":
        return "border-go/40 text-go bg-go/10 font-bold";
      default:
        return "border-line text-mu bg-s2";
    }
  };

  const getTitleName = (item: TitleItem): string => {
    const key = item.nameKey.split(".")[1];
    return (dict.titles as any)[key] || item.id;
  };

  const getUnlockRequirement = (item: TitleItem): string => {
    if (item.isComingSoon) {
      return dict.titles.comingSoon;
    }
    if (item.source === "level" && item.reqLevel) {
      return formatString(dict.titles.reqLevel, { level: item.reqLevel });
    }
    if (item.source === "achievement" && item.reqAchievement) {
      return formatString(dict.titles.reqAchievement, { name: item.reqAchievement });
    }
    return dict.titles.comingSoon;
  };

  const handleSelect = (item: TitleItem) => {
    const isUnlocked = gameState.unlockedTitles.includes(item.id);
    if (!isUnlocked) return;

    const titleName = getTitleName(item);
    const ok = selectTitle(item.id);
    if (ok) {
      showToast(formatString(dict.titles.selectedToast, { name: titleName }));
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
      <div className="card w-full max-w-lg bg-s1 p-6 border border-line shadow-2xl relative max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between pb-4 border-b border-line">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-go" />
            <h3 className="font-serif text-xl font-bold text-tx">
              {dict.titles.modalTitle}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-mu hover:bg-s2 hover:text-tx"
            aria-label={dict.addModal.close}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-2.5 pr-1">
          {TITLES_CATALOG.map((item) => {
            const isUnlocked = gameState.unlockedTitles.includes(item.id);
            const isSelected = gameState.selectedTitle === item.id;
            const titleName = getTitleName(item);
            const unlockReq = getUnlockRequirement(item);
            const rarityStyle = getRarityBadge(item.rarity);

            return (
              <div
                key={item.id}
                onClick={() => isUnlocked && handleSelect(item)}
                className={`flex items-center justify-between rounded-xl border p-3.5 transition-all duration-200 ${
                  isUnlocked
                    ? isSelected
                      ? "border-vi bg-vi/15 shadow-[0_0_12px_rgba(163,138,209,0.2)] cursor-pointer"
                      : "border-line bg-s2/60 hover:border-vi/50 hover:bg-s2 cursor-pointer"
                    : "border-line/40 bg-s1/40 opacity-70 cursor-not-allowed"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-tx">
                        {titleName}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${rarityStyle}`}
                      >
                        {item.rarity}
                      </span>
                    </div>

                    <span className="text-xs text-mu">
                      {isUnlocked
                        ? dict.titles.unlockedBadge
                        : `${dict.titles.howToUnlock} ${unlockReq}`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isSelected ? (
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-vi text-white">
                      <Check size={14} />
                    </span>
                  ) : isUnlocked ? (
                    <button
                      onClick={() => handleSelect(item)}
                      className="btn-ghost text-xs py-1 px-3 border border-line hover:border-vi"
                    >
                      {dict.profile.wardrobe.equipBtn}
                    </button>
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-s2 text-mu">
                      <Lock size={14} />
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
