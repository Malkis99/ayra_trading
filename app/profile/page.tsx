"use client";

import React, { useState, useEffect, useRef } from "react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { CharacterStage } from "@/components/CharacterStage";
import { TabHeader } from "@/components/TabHeader";
import { Figure } from "@/components/Figure";
import {
  ITEMS,
  SLOTS,
  FRAMES,
  TITLES,
  BACKGROUNDS,
  SlotName,
  EquipmentItem,
} from "@/lib/items";
import { xpForNextLevel, ChronicleEntry } from "@/lib/game";
import { formatString, formatNumber } from "@/lib/i18n";
import { Check, Lock, X } from "lucide-react";

export default function ProfilePage() {
  const { dict, lang, showToast } = useApp();
  const {
    gameState,
    effectiveEquipment,
    previewItem,
    setPreviewItem,
    wardrobeFilter,
    setWardrobeFilter,
    equipItem,
    unequipSlot,
    applyLoadout,
    saveLoadout,
    addPost,
    updateProfile,
    completeQuest,
    cycleFrame,
    cycleBackground,
    cycleTitle,
  } = useGame();

  const [activeTab, setActiveTab] = useState<number>(0);
  const [isEditModalOpen, setEditModalOpen] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>("");
  const [editBio, setEditBio] = useState<string>("");
  const [editError, setEditError] = useState<string>("");

  const [postText, setPostText] = useState<string>("");
  const [confirmEmptyLoadout, setConfirmEmptyLoadout] = useState<string | null>(null);

  const editInputRef = useRef<HTMLInputElement>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);

  // Tabs list
  const tabs = [
    dict.profile.tabs.overview,
    dict.profile.tabs.wardrobe,
    dict.profile.tabs.achievements,
    dict.profile.tabs.chronicle,
    dict.profile.tabs.posts,
    dict.profile.tabs.stats,
  ];

  // Handle URL tab parameter if present (e.g., /profile?tab=wardrobe)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab");
      if (tabParam === "wardrobe") setActiveTab(1);
      else if (tabParam === "achievements") setActiveTab(2);
      else if (tabParam === "chronicle") setActiveTab(3);
      else if (tabParam === "posts") setActiveTab(4);
      else if (tabParam === "stats") setActiveTab(5);
    }
  }, []);

  // Clear preview when changing tabs
  const handleTabChange = (idx: number) => {
    setActiveTab(idx);
    setPreviewItem(null);
    setConfirmEmptyLoadout(null);
  };

  // Handle slot click from CharacterStage
  const handleSlotClick = (slot: SlotName) => {
    setWardrobeFilter(slot);
    setActiveTab(1); // switch to Wardrobe
    setPreviewItem(null);
  };

  // Handle Newly Unlocked Achievements Toast Queue
  const notifyNewlyUnlocked = (unlockedIds: string[]) => {
    unlockedIds.forEach((id) => {
      const achTitle =
        (dict.profile.achievements as any)[id] || id;
      showToast(
        formatString(dict.chronicleEvents.achievementUnlocked, { title: achTitle })
      );
    });
  };

  // Open Edit Modal
  const openEditModal = () => {
    setEditName(gameState.name);
    setEditBio(gameState.bio || "");
    setEditError("");
    setEditModalOpen(true);
  };

  // Focus trap for Edit Modal
  useEffect(() => {
    if (isEditModalOpen) {
      setTimeout(() => editInputRef.current?.focus(), 50);

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setEditModalOpen(false);
        } else if (e.key === "Tab" && modalContainerRef.current) {
          const focusables = modalContainerRef.current.querySelectorAll<HTMLElement>(
            'button, input, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isEditModalOpen]);

  // Handle Edit Profile Form Submit
  const handleSaveProfile = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditError(dict.profile.editModal.errorEmptyNickname);
      return;
    }
    if (trimmed.length > 24) {
      setEditError(dict.profile.editModal.errorTooLongNickname);
      return;
    }
    if (editBio.length > 160) {
      setEditError(dict.profile.editModal.errorTooLongBio);
      return;
    }

    updateProfile(trimmed, editBio);
    setEditModalOpen(false);
    showToast(dict.chronicleEvents.profileUpdated);
  };

  // Calculations for Overview tab
  const nextLevelXp = xpForNextLevel(gameState.level);
  const xpPercent = Math.min(100, Math.round((gameState.xp / nextLevelXp) * 100));

  // Reputation title
  const repPercent = Math.min(100, 40 + gameState.level * 3);
  const repStatusText =
    repPercent < 50
      ? dict.profile.reputationStatusGrowing
      : repPercent < 70
      ? dict.profile.reputationStatusGood
      : dict.profile.reputationStatusExcellent;

  const currentFrameObj = FRAMES[gameState.frame] || FRAMES[0];
  const currentTitleObj = TITLES[gameState.title] || TITLES[0];
  const currentBgObj = BACKGROUNDS[gameState.background % 3] || BACKGROUNDS[0];

  const translatedFrameName =
    (dict.frames as any)[currentFrameObj.nameKey.replace("frames.", "")] || currentFrameObj.nameKey;
  const translatedTitleName =
    currentTitleObj.id === 1
      ? dict.titles.titleNovice
      : currentTitleObj.id === 2
      ? dict.titles.titleDisciplined
      : currentTitleObj.id === 3
      ? dict.titles.titleStrategist
      : dict.titles.none;
  const translatedBgName =
    (dict.backgrounds as any)[currentBgObj.nameKey.replace("backgrounds.", "")] || currentBgObj.nameKey;

  // Stats values
  const dummyStats: Record<string, number> = {
    Discipline: 10 + gameState.weeklyQuestCount * 2,
    Trading: 10 + Object.keys(gameState.completedQuestsToday).length * 2,
    Intelligence: 10 + gameState.level * 3,
    Focus: 10 + (gameState.currentStreak > 0 ? gameState.currentStreak * 2 : 0),
    Psychology: 12 + gameState.posts.length * 2,
    Knowledge: 10 + gameState.level * 2,
    Endurance: 10 + (gameState.isRestDay ? 5 : 2),
    Strength: 10 + Object.keys(gameState.equipment).length * 2,
  };

  // Filtered wardrobe items
  const filteredItems = ITEMS.filter((it) => {
    if (wardrobeFilter === "Все") return true;
    return it.slot === wardrobeFilter;
  });

  // Handle Equip item action
  const handleEquipPreview = () => {
    if (previewItem == null) return;
    const item = ITEMS[previewItem];
    if (!item) return;
    if (gameState.level < item.reqLevel) {
      showToast(
        formatString(dict.profile.wardrobe.opensAtLevel, {
          level: formatNumber(lang, item.reqLevel),
        })
      );
      return;
    }

    const newly = equipItem(previewItem);
    notifyNewlyUnlocked(newly);
    showToast(
      formatString(dict.chronicleEvents.itemEquipped, {
        name: (dict.items as any)[item.nameKey.replace("items.", "")] || item.nameKey,
      })
    );
  };

  // Handle Unequip slot action
  const handleUnequipSlot = (slot: string) => {
    const newly = unequipSlot(slot);
    notifyNewlyUnlocked(newly);

    const slotKeyMap: Record<string, string> = {
      Голова: "head",
      Верх: "top",
      Верхняя: "outer",
      Низ: "bottom",
      Обувь: "shoes",
      Плащ: "cloak",
      Перчатки: "gloves",
      Аксессуар: "accessory",
      Аура: "aura",
      Компаньон: "companion",
    };
    const translatedSlotName = (dict.slots as any)[slotKeyMap[slot] || "top"] || slot;

    showToast(
      formatString(dict.chronicleEvents.itemUnequipped, {
        name: translatedSlotName,
      })
    );
  };

  // Handle Save to Loadout action
  const handleSaveToLoadout = () => {
    const activeLd = gameState.activeLoadout || "Сессия";
    saveLoadout(activeLd);
    showToast(
      formatString(dict.profile.wardrobe.loadoutSavedToast, {
        name: activeLd,
      })
    );
  };

  // Handle Select Loadout Tab
  const handleSelectLoadout = (ldName: string) => {
    const targetEq = gameState.loadouts[ldName] || {};
    if (Object.keys(targetEq).length === 0) {
      // Show inline confirmation row
      setConfirmEmptyLoadout(ldName);
    } else {
      setConfirmEmptyLoadout(null);
      const newly = applyLoadout(ldName);
      notifyNewlyUnlocked(newly);
    }
  };

  const handleConfirmEmptyLoadout = () => {
    if (!confirmEmptyLoadout) return;
    const ldName = confirmEmptyLoadout;
    setConfirmEmptyLoadout(null);
    const newly = applyLoadout(ldName);
    notifyNewlyUnlocked(newly);
  };

  // Handle Publish Post
  const handlePublishPost = () => {
    const trimmed = postText.trim();
    if (!trimmed) return;
    const newly = addPost(trimmed);
    notifyNewlyUnlocked(newly);
    setPostText("");
    showToast(dict.chronicleEvents.postPublished);
  };

  // Render Chronicle Entry
  const renderChronicleItem = (entry: ChronicleEntry, idx: number) => {
    let text = "";
    if (typeof entry === "string") {
      text = entry;
    } else {
      switch (entry.type) {
        case "characterCreated":
          text = dict.chronicleEvents.characterCreated;
          break;
        case "questDone":
          text = formatString(dict.chronicleEvents.questDone, {
            title: entry.title,
            xp: entry.xp,
          });
          break;
        case "levelUp":
          text = formatString(dict.chronicleEvents.levelUp, { level: entry.level });
          break;
        case "dailyReward":
          text = formatString(dict.chronicleEvents.dailyReward, { coins: entry.coins });
          break;
        case "planChanged":
          text = formatString(dict.chronicleEvents.planChanged, { plan: entry.plan });
          break;
        case "itemEquipped": {
          const itemObj = entry.itemId != null ? ITEMS[entry.itemId] : null;
          const nameKeyShort = itemObj ? itemObj.nameKey.replace("items.", "") : "";
          const name =
            itemObj && (dict.items as any)[nameKeyShort]
              ? (dict.items as any)[nameKeyShort]
              : entry.name || "";
          text = formatString(dict.chronicleEvents.itemEquipped, { name });
          break;
        }
        case "itemUnequipped": {
          const slotKeyMap: Record<string, string> = {
            Голова: "head",
            Верх: "top",
            Верхняя: "outer",
            Низ: "bottom",
            Обувь: "shoes",
            Плащ: "cloak",
            Перчатки: "gloves",
            Аксессуар: "accessory",
            Аура: "aura",
            Компаньон: "companion",
          };
          const slotName = (dict.slots as any)[slotKeyMap[entry.slot] || "top"] || entry.slot;
          text = formatString(dict.chronicleEvents.itemUnequipped, { name: slotName });
          break;
        }
        case "achievementUnlocked": {
          const achKey = entry.achievementId || "";
          const achTitle =
            achKey && (dict.profile.achievements as any)[achKey]
              ? (dict.profile.achievements as any)[achKey]
              : entry.title || "";
          text = formatString(dict.chronicleEvents.achievementUnlocked, {
            title: achTitle,
          });
          break;
        }
        case "postPublished":
          text = dict.chronicleEvents.postPublished;
          break;
        case "profileUpdated":
          text = dict.chronicleEvents.profileUpdated;
          break;
        case "legacy":
          text = formatString(dict.chronicleEvents.legacy, { text: entry.text });
          break;
        default:
          text = JSON.stringify(entry);
      }
    }

    return (
      <div key={idx} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-line bg-s2/40 text-xs text-tx">
        <span className="w-2 h-2 rounded-full bg-vi flex-none" />
        <span className="truncate">{text}</span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">{dict.profile.title}</h1>
        <p className="text-xs text-mu mt-1">{dict.profile.subtitle}</p>
      </div>

      {/* Tabs Header */}
      <TabHeader tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left Column: Interactive 360° Character Stage */}
        <div className="lg:col-span-5">
          <CharacterStage onSlotClick={handleSlotClick} />
        </div>

        {/* Right Column: Active Tab Content Panel */}
        <div className="lg:col-span-7 card space-y-4">
          {/* TAB 0: OVERVIEW (Обзор) */}
          {activeTab === 0 && (
            <div className="space-y-5">
              {/* Header Info */}
              <div className="flex items-center gap-3">
                <div className="lvbadge">{gameState.level}</div>
                <div className="flex-1 min-w-0">
                  <b className="font-serif text-2xl font-semibold text-tx block truncate">
                    {gameState.name}
                  </b>
                  <div className="text-xs text-mu truncate">
                    {formatString(dict.profile.levelStatus, {
                      level: formatNumber(lang, gameState.level),
                      title: translatedTitleName,
                    })}
                  </div>
                </div>
                <div className="border border-go text-go rounded-md px-3 py-1 text-xs font-bold uppercase tracking-wider flex-none">
                  {gameState.plan}
                </div>
              </div>

              {/* Bio */}
              <p className="text-xs text-mu italic bg-s2/40 p-2.5 rounded-xl border border-line">
                {gameState.bio || dict.profile.editModal.bioPlaceholder || "Мой путь — дисциплина и процесс."}
              </p>

              {/* Reputation & Stats Summary */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-line">
                <div className="space-y-1">
                  <b className="text-xs font-semibold text-tx">
                    {formatString(dict.profile.reputationTitle, { status: repStatusText })}
                  </b>
                  <div className="xp w-40">
                    <i className="block h-full bg-vi" style={{ width: `${repPercent}%` }} />
                  </div>
                  <div className="text-[10px] text-mu">{dict.profile.reputationNote}</div>
                </div>

                <div className="flex gap-6 text-sm font-bold text-tx">
                  <div>
                    {gameState.xp} / {nextLevelXp}
                    <small className="block text-[10px] font-normal text-mu">XP</small>
                  </div>
                  <div>
                    {gameState.coins}
                    <small className="block text-[10px] font-normal text-mu">Coins</small>
                  </div>
                </div>
              </div>

              {/* Social Placeholders */}
              <div className="grid grid-cols-3 gap-2 text-center py-2 border-y border-line">
                <div>
                  <b className="text-sm font-bold text-tx">0</b>
                  <small className="block text-[10px] text-mu">{dict.profile.followers}</small>
                </div>
                <div>
                  <b className="text-sm font-bold text-tx">0</b>
                  <small className="block text-[10px] text-mu">{dict.profile.following}</small>
                </div>
                <div>
                  <b className="text-sm font-bold text-tx">0</b>
                  <small className="block text-[10px] text-mu">{dict.profile.markedUseful}</small>
                </div>
              </div>

              {/* Level Progress */}
              <div className="flex items-center gap-3 text-xs">
                <span className="text-vi font-bold">Lv {gameState.level}</span>
                <div className="xp flex-1 h-2">
                  <i className="block h-full bg-gradient-to-r from-pri to-vi" style={{ width: `${xpPercent}%` }} />
                </div>
                <span className="text-mu text-[11px]">
                  {formatString(dict.profile.toLevel, {
                    level: formatNumber(lang, gameState.level + 1),
                  })}
                </span>
              </div>

              {/* Customization Options (Cycle Frame, Bg, Title) */}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={cycleFrame}
                  className="chip hover:border-vi transition-colors cursor-pointer"
                >
                  {formatString(dict.profile.frameLabel, { name: translatedFrameName })}
                </button>
                <button
                  type="button"
                  onClick={cycleBackground}
                  className="chip hover:border-vi transition-colors cursor-pointer"
                >
                  {formatString(dict.profile.bgLabel, { name: translatedBgName })}
                </button>
                <button
                  type="button"
                  onClick={cycleTitle}
                  className="chip hover:border-vi transition-colors cursor-pointer"
                >
                  {formatString(dict.profile.titleLabel, { name: translatedTitleName })}
                </button>
              </div>

              {/* 8 Character Stats */}
              <div className="space-y-2 pt-2">
                <h4 className="h4">{dict.profile.statsHeader}</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {Object.entries(dummyStats).map(([key, val]) => (
                    <div key={key} className="space-y-1">
                      <div className="flex justify-between text-mu text-[11px]">
                        <span>{(dict.categories as any)[key] || key}</span>
                        <span className="font-semibold text-tx">{val}</span>
                      </div>
                      <div className="xp">
                        <i className="block h-full bg-vi" style={{ width: `${Math.min(100, val * 5)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Edit & Demo Action Buttons */}
              <div className="flex gap-2 pt-3">
                <button type="button" onClick={openEditModal} className="btn text-xs">
                  {dict.profile.editBtn}
                </button>
              </div>
            </div>
          )}

          {/* TAB 1: WARDROBE (Гардероб) */}
          {activeTab === 1 && (
            <div className="space-y-4">
              {/* Slot Filters Row */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs">
                <button
                  type="button"
                  onClick={() => setWardrobeFilter("Все")}
                  className={`chip cursor-pointer transition-colors ${
                    wardrobeFilter === "Все" ? "border-vi text-tx font-semibold bg-s2" : ""
                  }`}
                >
                  {dict.slots.all}
                </button>
                {SLOTS.map((slot) => {
                  const slotKeyMap: Record<string, string> = {
                    Голова: "head",
                    Верх: "top",
                    Верхняя: "outer",
                    Низ: "bottom",
                    Обувь: "shoes",
                    Плащ: "cloak",
                    Перчатки: "gloves",
                    Аксессуар: "accessory",
                    Аура: "aura",
                    Компаньон: "companion",
                  };
                  const label = (dict.slots as any)[slotKeyMap[slot] || "top"] || slot;
                  const isActive = wardrobeFilter === slot;

                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setWardrobeFilter(slot)}
                      className={`chip cursor-pointer transition-colors ${
                        isActive ? "border-vi text-tx font-semibold bg-s2" : ""
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Item Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {filteredItems.map((it) => {
                  const isLocked = gameState.level < it.reqLevel;
                  const isPreview = previewItem === it.id;
                  const isEquipped = gameState.equipment[it.slot] === it.id;

                  const rarityKey = it.rarity === 2 ? "epic" : it.rarity === 1 ? "rare" : "common";
                  const rarityText = (dict.rarity as any)[rarityKey];
                  const nameKeyShort = it.nameKey.replace("items.", "");
                  const itemName = (dict.items as any)[nameKeyShort] || it.nameKey;

                  let borderStyle = "border-line";
                  if (it.rarity === 2) borderStyle = "border-go";
                  else if (it.rarity === 1) borderStyle = "border-vi";

                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => setPreviewItem(it.id)}
                      className={`rounded-xl border p-2 text-center text-xs transition-all relative ${borderStyle} ${
                        isPreview ? "ring-2 ring-vi bg-[#50348f33]" : "bg-s2/40 hover:bg-s2/70"
                      } ${isLocked ? "opacity-50" : ""}`}
                    >
                      {/* Color Preview Tile */}
                      <div
                        className="h-9 rounded-lg mb-1.5 shadow-inner"
                        style={{ backgroundColor: it.color }}
                      />
                      <b className="block text-tx truncate text-[11px]">{itemName}</b>
                      <div className="text-[10px] text-mu mt-0.5">
                        {rarityText}
                        {isLocked && (
                          <span className="block text-go font-semibold mt-0.5">
                            {formatString(dict.profile.wardrobe.lockedLabel, {
                              level: formatNumber(lang, it.reqLevel),
                            })}
                          </span>
                        )}
                      </div>

                      {isEquipped && (
                        <span className="absolute top-1.5 right-1.5 bg-vi text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Wardrobe Action Controls Row */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-line">
                {previewItem != null && (
                  <button
                    type="button"
                    onClick={handleEquipPreview}
                    disabled={gameState.level < (ITEMS[previewItem]?.reqLevel || 1)}
                    className="btn text-xs py-2"
                  >
                    {gameState.level < (ITEMS[previewItem]?.reqLevel || 1)
                      ? formatString(dict.profile.wardrobe.opensAtLevel, {
                          level: formatNumber(lang, ITEMS[previewItem]?.reqLevel || 1),
                        })
                      : dict.profile.wardrobe.equipBtn}
                  </button>
                )}

                {wardrobeFilter !== "Все" && gameState.equipment[wardrobeFilter] != null && (
                  <button
                    type="button"
                    onClick={() => handleUnequipSlot(wardrobeFilter)}
                    className="btn-ghost text-xs py-2"
                  >
                    {formatString(dict.profile.wardrobe.unequipBtn, {
                      slot:
                        (dict.slots as any)[
                          {
                            Голова: "head",
                            Верх: "top",
                            Верхняя: "outer",
                            Низ: "bottom",
                            Обувь: "shoes",
                            Плащ: "cloak",
                            Перчатки: "gloves",
                            Аксессуар: "accessory",
                            Аура: "aura",
                            Компаньон: "companion",
                          }[wardrobeFilter] || "top"
                        ] || wardrobeFilter,
                    })}
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSaveToLoadout}
                  className="btn-ghost text-xs py-2"
                >
                  {formatString(dict.profile.wardrobe.saveToLoadoutBtn, {
                    name: gameState.activeLoadout || "Сессия",
                  })}
                </button>
              </div>

              {/* Loadouts Inline Confirmation Row if Empty */}
              {confirmEmptyLoadout && (
                <div className="rounded-xl border border-go bg-go/10 p-3 text-xs flex flex-wrap items-center justify-between gap-2">
                  <span className="text-go font-semibold">
                    {dict.profile.wardrobe.loadoutEmptyConfirm}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleConfirmEmptyLoadout}
                      className="btn text-xs py-1 px-3"
                    >
                      {dict.profile.wardrobe.confirmAction}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmEmptyLoadout(null)}
                      className="btn-ghost text-xs py-1 px-3"
                    >
                      {dict.profile.wardrobe.cancelAction}
                    </button>
                  </div>
                </div>
              )}

              {/* Loadout Tabs Row */}
              <div className="pt-2 border-t border-line space-y-1.5">
                <div className="text-[11px] text-mu font-semibold">
                  Лоадауты / Loadouts:
                </div>
                <div className="flex gap-2">
                  {Object.keys(gameState.loadouts).map((ldName) => {
                    const isActive = gameState.activeLoadout === ldName;
                    return (
                      <button
                        key={ldName}
                        type="button"
                        onClick={() => handleSelectLoadout(ldName)}
                        className={`rounded-xl border px-3 py-1.5 text-xs transition-colors ${
                          isActive
                            ? "border-vi bg-pri/30 text-tx font-bold"
                            : "border-line bg-s1 text-mu hover:border-vi hover:text-tx"
                        }`}
                      >
                        {ldName}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ACHIEVEMENTS (Достижения) */}
          {activeTab === 2 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  id: "firstQuest",
                  titleKey: "firstQuest",
                  descKey: "firstQuestDesc",
                },
                {
                  id: "stylist",
                  titleKey: "stylist",
                  descKey: "stylistDesc",
                },
                {
                  id: "streakDay",
                  titleKey: "streakDay",
                  descKey: "streakDayDesc",
                },
                {
                  id: "level3",
                  titleKey: "level3",
                  descKey: "level3Desc",
                },
                {
                  id: "author",
                  titleKey: "author",
                  descKey: "authorDesc",
                },
              ].map((ach) => {
                const isUnlocked = !!gameState.achievements[ach.id];
                const title = (dict.profile.achievements as any)[ach.titleKey];
                const desc = (dict.profile.achievements as any)[ach.descKey];

                return (
                  <div
                    key={ach.id}
                    className={`rounded-xl border p-3 flex items-start gap-3 transition-colors ${
                      isUnlocked
                        ? "border-go bg-go/10 text-tx"
                        : "border-line bg-s2/40 opacity-50"
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg grid place-items-center font-bold text-sm flex-none ${
                        isUnlocked ? "bg-go text-black" : "bg-s2 text-mu"
                      }`}
                    >
                      {isUnlocked ? "★" : "🔒"}
                    </div>
                    <div className="space-y-0.5">
                      <b className="block text-xs font-bold">{title}</b>
                      <p className="text-[11px] text-mu leading-tight">{desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 3: CHRONICLE (Хроника) */}
          {activeTab === 3 && (
            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
              {gameState.chronicle.length === 0 ? (
                <div className="text-xs text-mu py-8 text-center">
                  {dict.home.chronicleBlock.empty}
                </div>
              ) : (
                gameState.chronicle.map(renderChronicleItem)
              )}
            </div>
          )}

          {/* TAB 4: POSTS (Посты) */}
          {activeTab === 4 && (
            <div className="space-y-4">
              {/* Post Input Form */}
              <div className="space-y-2">
                <textarea
                  value={postText}
                  onChange={(e) => setPostText(e.target.value.slice(0, 280))}
                  maxLength={280}
                  rows={3}
                  placeholder={dict.profile.posts.placeholder}
                  className="w-full rounded-xl border border-line bg-s2 p-3 text-xs text-tx focus:outline-none focus:border-vi"
                />
                <div className="flex justify-between items-center text-xs text-mu">
                  <span className="italic">{dict.profile.posts.disclaimer}</span>
                  <span>{postText.length}/280</span>
                </div>
                <button
                  type="button"
                  onClick={handlePublishPost}
                  disabled={!postText.trim()}
                  className="btn text-xs py-2 px-4"
                >
                  {dict.profile.posts.publishBtn}
                </button>
              </div>

              {/* User Posts List */}
              <div className="space-y-3 pt-3 border-t border-line">
                {gameState.posts.length === 0 ? (
                  <div className="text-xs text-mu text-center py-6">
                    {dict.profile.posts.empty}
                  </div>
                ) : (
                  gameState.posts.map((post, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-line bg-s2/40 p-3 text-xs text-tx whitespace-pre-wrap leading-relaxed"
                    >
                      {post}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 5: STATS (Статистика) */}
          {activeTab === 5 && (
            <div className="space-y-5">
              {/* Counter Summaries */}
              <div className="grid grid-cols-3 gap-3 text-center p-3 rounded-xl border border-line bg-s2/40">
                <div>
                  <b className="text-lg font-bold text-tx">{gameState.history.length}</b>
                  <small className="block text-[10px] text-mu">
                    {dict.profile.stats.questsCompleted}
                  </small>
                </div>
                <div>
                  <b className="text-lg font-bold text-tx">{gameState.itemsEquippedCount}</b>
                  <small className="block text-[10px] text-mu">
                    {dict.profile.stats.itemsEquipped}
                  </small>
                </div>
                <div>
                  <b className="text-lg font-bold text-tx">
                    {Object.keys(gameState.achievements).length} / 5
                  </b>
                  <small className="block text-[10px] text-mu">
                    {dict.profile.stats.achievementsUnlocked}
                  </small>
                </div>
              </div>

              {/* 8 Stats Enlarged */}
              <div className="space-y-3">
                <h4 className="h4">{dict.profile.statsHeader}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {Object.entries(dummyStats).map(([key, val]) => (
                    <div key={key} className="p-2.5 rounded-xl border border-line bg-s1 space-y-1.5">
                      <div className="flex justify-between text-mu">
                        <span className="font-semibold">{key}</span>
                        <span className="text-tx font-bold">{val}</span>
                      </div>
                      <div className="xp h-2">
                        <i className="block h-full bg-vi" style={{ width: `${Math.min(100, val * 5)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-mu italic text-center pt-2">
                {dict.profile.stats.browserStorageNote}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* EDIT PROFILE MODAL */}
      {isEditModalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditModalOpen(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        >
          <div
            ref={modalContainerRef}
            className="w-full max-w-md rounded-2xl border border-line bg-s1 p-5 shadow-2xl space-y-4"
          >
            <div className="flex justify-between items-center border-b border-line pb-2.5">
              <b className="text-base font-bold text-tx">
                {dict.profile.editModal.title}
              </b>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="text-mu hover:text-tx p-1"
                aria-label={dict.addModal.close}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              {/* Nickname Input */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-mu">
                  {dict.profile.editModal.nicknameLabel}
                </label>
                <input
                  ref={editInputRef}
                  type="text"
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value);
                    setEditError("");
                  }}
                  maxLength={24}
                  placeholder={dict.profile.editModal.nicknamePlaceholder}
                  className="w-full rounded-xl border border-line bg-s2 p-2.5 text-xs text-tx focus:outline-none focus:border-vi"
                />
              </div>

              {/* Bio Textarea */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-semibold text-mu">
                  <label>{dict.profile.editModal.bioLabel}</label>
                  <span>{editBio.length}/160</span>
                </div>
                <textarea
                  value={editBio}
                  onChange={(e) => {
                    setEditBio(e.target.value.slice(0, 160));
                    setEditError("");
                  }}
                  maxLength={160}
                  rows={3}
                  placeholder={dict.profile.editModal.bioPlaceholder}
                  className="w-full rounded-xl border border-line bg-s2 p-2.5 text-xs text-tx focus:outline-none focus:border-vi"
                />
              </div>

              {/* Error Message */}
              {editError && (
                <div className="text-xs font-semibold text-red-400 bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                  {editError}
                </div>
              )}

              {/* Submit Button */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="btn-ghost text-xs py-2 px-4"
                >
                  {dict.profile.wardrobe.cancelAction}
                </button>
                <button type="submit" className="btn text-xs py-2 px-5">
                  {dict.profile.editModal.saveBtn}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
