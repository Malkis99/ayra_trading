"use client";

import React, { useState, useEffect, useRef } from "react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { CharacterStage } from "@/components/CharacterStage";
import { TabHeader } from "@/components/TabHeader";
import { Sparkline } from "@/components/Sparkline";
import {
  ITEMS,
  SLOTS,
  FRAMES,
  BACKGROUNDS,
  SlotName,
  SLOT_KEY_MAP,
} from "@/lib/items";
import { TITLES_CATALOG } from "@/lib/titles";
import {
  getReputation,
  calculateStats,
  getCharacterPower,
  getStatBalance,
  getProfileObservations,
  calculateJournalStats,
  exportProfileDataJSON,
  StatKey,
} from "@/lib/stats";
import { xpForNextLevel, ChronicleEntry } from "@/lib/game";
import { GAME_CONFIG } from "@/lib/game-config";
import { formatString, formatNumber } from "@/lib/i18n";
import {
  Pencil,
  Shield,
  HelpCircle,
  X,
  Lock,
  Sparkles,
  TrendingUp,
  Brain,
  Target,
  Smile,
  BookOpen,
  Activity,
  Zap,
  ChevronRight,
  Download,
  Trash2,
  Plus,
} from "lucide-react";

export default function ProfilePage() {
  const { dict, lang, showToast, openAddModal } = useApp();
  const {
    gameState,
    previewItem,
    setPreviewItem,
    wardrobeFilter,
    setWardrobeFilter,
    equipItem,
    unequipSlot,
    applyLoadout,
    saveLoadout,
    updateProfile,
    selectTitle,
    setFrame,
    deletePost,
  } = useGame();
  const { trades: journalTrades } = useJournal();

  const [activeTab, setActiveTab] = useState<number>(0);

  // Wardrobe sub-tab switch: "items" | "styling" | "loadouts"
  const [wardrobeSection, setWardrobeSection] = useState<"items" | "styling" | "loadouts">("items");
  const [statusFilter, setStatusFilter] = useState<"all" | "equipped" | "available" | "locked">("all");
  const [raritySort, setRaritySort] = useState<"default" | "rarityDesc">("default");

  // Stats tab period switch: "7d" | "30d" | "90d" | "all"
  const [statsPeriod, setStatsPeriod] = useState<"7d" | "30d" | "90d" | "all">("30d");
  const [activityMetric, setActivityMetric] = useState<"quests" | "xp">("quests");

  // Posts tab filter
  const [deletingPostIdx, setDeletingPostIdx] = useState<number | null>(null);

  // Edit Modal state
  const [isEditModalOpen, setEditModalOpen] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>("");
  const [editBio, setEditBio] = useState<string>("");
  const [editError, setEditError] = useState<string>("");

  // Reputation Tooltip state
  const [showRepTooltip, setShowRepTooltip] = useState<boolean>(false);
  const [confirmEmptyLoadout, setConfirmEmptyLoadout] = useState<string | null>(null);

  const editInputRef = useRef<HTMLInputElement>(null);

  // Tabs list
  const tabs = [
    dict.profile.tabs.overview,
    dict.profile.tabs.wardrobe,
    dict.profile.tabs.achievements,
    dict.profile.tabs.chronicle,
    dict.profile.tabs.posts,
    dict.profile.tabs.stats,
  ];

  // Handle Esc key to cancel post deletion
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && deletingPostIdx !== null) {
        setDeletingPostIdx(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deletingPostIdx]);

  // Handle URL tab parameter
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

  const handleTabChange = (idx: number) => {
    setActiveTab(idx);
    setPreviewItem(null);
    setConfirmEmptyLoadout(null);
  };

  // Click slot from CharacterStage opens Wardrobe with slot filter
  const handleSlotClick = (slot: SlotName) => {
    setWardrobeFilter(slot);
    setWardrobeSection("items");
    setActiveTab(1);
    setPreviewItem(null);
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      window.scrollTo({ top: 380, behavior: "smooth" });
    }
  };

  const openEditModal = () => {
    setEditName(gameState.name);
    setEditBio(gameState.bio || "");
    setEditError("");
    setEditModalOpen(true);
  };

  const handleSaveProfile = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = editName.trim();
    if (!trimmed) {
      setEditError(dict.profile.editModal.errorEmptyNickname);
      return;
    }

    if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) {
      setEditError(dict.profile.editModal.nicknameErrorLatin);
      return;
    }

    if (trimmed.length < 3 || trimmed.length > 24) {
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

  // Calculations for Overview & Stats
  const nextLevelXp = xpForNextLevel(gameState.level);
  const xpPercent = Math.min(100, Math.round((gameState.xp / nextLevelXp) * 100));

  const reputation = getReputation(gameState);
  const currentTitleObj = TITLES_CATALOG.find((t) => t.id === gameState.selectedTitle) || TITLES_CATALOG[0];
  const translatedTitleName =
    currentTitleObj.id === "novice"
      ? dict.titles.titleNovice
      : currentTitleObj.id === "disciplined"
      ? dict.titles.titleDisciplined
      : currentTitleObj.id === "strategist"
      ? dict.titles.titleStrategist
      : currentTitleObj.id;

  const statsMap = calculateStats(gameState);
  const characterPower = getCharacterPower(statsMap);
  const statBalance = getStatBalance(statsMap);

  // Wardrobe Filtering & Sorting
  let filteredItems = ITEMS.filter((it) => {
    if (wardrobeFilter !== "all" && it.slot !== wardrobeFilter) return false;

    const isEquipped = gameState.equipment[it.slot] === it.id;
    const isUnlocked = gameState.level >= it.reqLevel;

    if (statusFilter === "equipped") return isEquipped;
    if (statusFilter === "available") return isUnlocked && !isEquipped;
    if (statusFilter === "locked") return !isUnlocked;
    return true;
  });

  if (raritySort === "rarityDesc") {
    filteredItems = [...filteredItems].sort((a, b) => b.rarity - a.rarity);
  }

  // Put currently equipped item first in the list if filtering by slot
  if (wardrobeFilter !== "all") {
    filteredItems.sort((a, b) => {
      const aEq = gameState.equipment[a.slot] === a.id ? 1 : 0;
      const bEq = gameState.equipment[b.slot] === b.id ? 1 : 0;
      return bEq - aEq;
    });
  }

  const handleUnequipSlot = (slot: string) => {
    unequipSlot(slot);
    const slotKey = SLOT_KEY_MAP[slot as SlotName] || "top";
    const translatedSlotName = (dict.slots as any)[slotKey] || slot;

    showToast(
      formatString(dict.chronicleEvents.itemUnequipped, {
        name: translatedSlotName,
      })
    );
  };

  const handleSaveToLoadout = (ldKey: string) => {
    saveLoadout(ldKey);
    showToast(
      formatString(dict.profile.wardrobe.loadoutSavedToast, {
        name: ldKey,
      })
    );
  };

  const handleSelectLoadout = (ldKey: string) => {
    const targetEq = gameState.loadouts[ldKey] || {};
    if (Object.keys(targetEq).length === 0) {
      setConfirmEmptyLoadout(ldKey);
    } else {
      setConfirmEmptyLoadout(null);
      applyLoadout(ldKey);
    }
  };

  const handleExportJSON = () => {
    const jsonStr = exportProfileDataJSON(gameState);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const todayStr = new Date().toISOString().split("T")[0];
    const a = document.createElement("a");
    a.href = url;
    a.download = `ayra-profile-${gameState.name || "TraderOne"}-${todayStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(dict.profile.statsTab.downloadedToast);
  };

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
          const slotKey = SLOT_KEY_MAP[entry.slot as SlotName] || "top";
          const slotName = (dict.slots as any)[slotKey] || entry.slot;
          text = formatString(dict.chronicleEvents.itemUnequipped, { name: slotName });
          break;
        }
        case "titleSelected":
          text = `${dict.chronicleEvents.profileUpdated}: ${entry.titleId}`;
          break;
        case "titleUnlocked":
          text = `${dict.chronicleEvents.profileUpdated}: ${entry.titleId}`;
          break;
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
      <div key={idx} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-line/60 bg-s2/40 text-xs text-tx">
        <span className="w-2 h-2 rounded-full bg-vi flex-none" />
        <span className="truncate">{text}</span>
      </div>
    );
  };

  const statIcons: Record<StatKey, React.ComponentType<{ size?: number | string; className?: string }>> = {
    discipline: Shield,
    trading: TrendingUp,
    intelligence: Brain,
    focus: Target,
    psychology: Smile,
    knowledge: BookOpen,
    endurance: Activity,
    strength: Zap,
  };

  // Heatmap generation for 26 weeks
  const today = new Date();
  const heatmapDays = Array.from({ length: 26 * 7 }).map((_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (26 * 7 - 1 - i));
    const dateStr = d.toISOString().split("T")[0];
    const isBeforeCreated = dateStr < gameState.createdAt;
    const record = gameState.dailyStats?.[dateStr];
    const count = record ? record.totalQuestsCompleted : 0;
    return { dateStr, isBeforeCreated, count, record };
  });

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl font-bold text-tx">{dict.profile.title}</h1>
      </div>

      {/* Main Grid: Left Sticky Scene & Right Panel */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left Column: Interactive 360° Character Stage */}
        <div className="lg:col-span-5 lg:sticky lg:top-20">
          <CharacterStage onSlotClick={handleSlotClick} selectedSlot={activeTab === 1 ? (wardrobeFilter as SlotName) : null} />
        </div>

        {/* Right Column: Unified Card Container */}
        <div className="lg:col-span-7 rounded-2xl border border-line bg-s1 p-4 sm:p-5 shadow-2xl space-y-5">
          {/* Top Tabs Bar */}
          <TabHeader tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />

          {/* TAB 0: OVERVIEW (Обзор) */}
          {activeTab === 0 && (
            <div className="space-y-4">
              {/* Header Profile Card */}
              <div className="p-3.5 rounded-xl border border-line/60 bg-s2/40 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="lvbadge flex-none">{gameState.level}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <b className="font-serif text-xl font-semibold text-tx truncate">
                        {gameState.name}
                      </b>
                      <button
                        type="button"
                        onClick={openEditModal}
                        aria-label={dict.profile.editBtn}
                        className="p-1 text-mu hover:text-tx transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                      >
                        <Pencil size={14} />
                      </button>
                    </div>

                    <div className="text-xs font-semibold text-vi">
                      {translatedTitleName}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-mu italic max-w-xs line-clamp-2" title={gameState.bio || dict.profile.editModal.bioPlaceholder}>
                  {gameState.bio || dict.profile.editModal.bioPlaceholder}
                </div>
              </div>

              {/* Followers / Following / Useful 3-Card Block */}
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {[
                  { label: dict.profile.followers, count: 0 },
                  { label: dict.profile.following, count: 0 },
                  { label: dict.profile.markedUseful, count: 0 },
                ].map((card, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => showToast(dict.profile.statsTab.community.comingSoon)}
                    className="p-3 rounded-xl border border-line/60 bg-s2/40 hover:bg-s2/80 hover:border-vi/50 transition-all text-center relative overflow-hidden group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                  >
                    <b className="text-lg font-bold text-tx block font-mono">{card.count}</b>
                    <span className="text-[11px] text-mu truncate block mt-0.5">{card.label}</span>
                  </button>
                ))}
              </div>

              {/* Reputation Block */}
              <div className="p-4 rounded-xl border border-line bg-black/60 space-y-3 relative">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-vi/20 border border-vi/40 grid place-items-center text-vi">
                      <Shield size={18} />
                    </div>
                    <div>
                      <b className="text-xs font-bold text-tx block">
                        {dict.profile.reputationTitle.split(":")[0]}: {((dict.profile.reputationTiers as any)[reputation.tierId] || reputation.tierId).toUpperCase()}
                      </b>
                      <span className="text-[11px] text-mu">
                        {dict.profile.reputationNote}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <b className="text-sm font-bold font-mono text-tx">
                      {formatString(dict.profile.pointsUnit, { points: reputation.points })}
                    </b>
                    <button
                      type="button"
                      onClick={() => setShowRepTooltip(!showRepTooltip)}
                      className="text-mu hover:text-tx p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                      aria-label={dict.profile.reputationDetailsTooltip}
                    >
                      <HelpCircle size={15} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-5 gap-1.5 h-2">
                  {[0, 1, 2, 3, 4].map((idx) => (
                    <div
                      key={idx}
                      className={`h-full rounded-full transition-all ${
                        idx <= reputation.tierIndex
                          ? "bg-gradient-to-r from-pri to-vi shadow-[0_0_8px_#50348f66]"
                          : "bg-s2"
                      }`}
                    />
                  ))}
                </div>

                {showRepTooltip && (
                  <div className="p-3 rounded-xl border border-line bg-s1 text-xs space-y-1.5 shadow-xl">
                    <div className="flex justify-between">
                      <span>Usefulness:</span>
                      <b className="text-tx font-mono">{reputation.usefulness}%</b>
                    </div>
                    <div className="flex justify-between">
                      <span>Quality:</span>
                      <b className="text-tx font-mono">{reputation.quality}%</b>
                    </div>
                    <div className="flex justify-between">
                      <span>Consistency:</span>
                      <b className="text-tx font-mono">{reputation.consistency}%</b>
                    </div>
                  </div>
                )}
              </div>

              {/* Level XP Progress */}
              <div className="p-3.5 rounded-xl border border-line/60 bg-s2/40 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-vi">{dict.topbar.level} {gameState.level}</span>
                  <span className="text-mu font-mono">{gameState.xp} / {nextLevelXp} XP</span>
                  <span className="font-bold text-tx">{dict.topbar.level} {gameState.level + 1}</span>
                </div>
                <div className="xp w-full h-2.5 rounded-full overflow-hidden bg-s2">
                  <i
                    className="block h-full bg-gradient-to-r from-pri via-vi to-go shadow-[0_0_10px_#a38ad188]"
                    style={{ width: `${xpPercent}%` }}
                  />
                </div>
              </div>

              {/* 8 Compact Characteristic Rows */}
              <div className="p-3.5 rounded-xl border border-line/60 bg-s2/40 space-y-3">
                <div className="flex justify-between items-center">
                  <h4 className="h4 text-sm">{dict.profile.statsHeader}</h4>
                  <button
                    type="button"
                    onClick={() => setActiveTab(5)}
                    className="text-xs text-vi font-semibold hover:underline flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi cursor-pointer"
                  >
                    <span>{dict.profile.details}</span>
                    <ChevronRight size={14} />
                  </button>
                </div>

                <div className="space-y-2">
                  {(Object.keys(statsMap) as StatKey[]).map((key) => {
                    const s = statsMap[key];
                    const IconComp = statIcons[key];
                    const name = dict.stats[s.key] || s.key;
                    const progressPercent = Math.min(100, Math.round((s.currentLevelXp / s.nextLevelXp) * 100));

                    return (
                      <div key={key} className="flex flex-col gap-1 p-2 rounded-lg border border-line/40 bg-s1 text-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded bg-s2 grid place-items-center text-vi">
                              <IconComp size={12} />
                            </div>
                            <span className="font-semibold text-tx">{name}</span>
                          </div>
                          <span className="text-[11px] text-mu font-mono">
                            {dict.topbar.level} {s.level}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="xp flex-1 h-2 rounded-full overflow-hidden bg-s2">
                            <i
                              className="block h-full bg-gradient-to-r from-pri to-vi"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-mu font-mono whitespace-nowrap">
                            {s.currentLevelXp}/{s.nextLevelXp} XP <span className="text-go font-semibold">+{s.weeklyGain}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 1: WARDROBE (Гардероб) */}
          {activeTab === 1 && (
            <div className="space-y-4">
              {/* 3-Section Segmented Switch */}
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl border border-line bg-s2/60 text-xs text-center">
                <button
                  type="button"
                  onClick={() => setWardrobeSection("items")}
                  className={`py-1.5 rounded-lg font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi ${
                    wardrobeSection === "items" ? "bg-pri text-white font-semibold" : "text-mu hover:text-tx"
                  }`}
                >
                  {dict.profile.wardrobe.sections.items}
                </button>
                <button
                  type="button"
                  onClick={() => setWardrobeSection("styling")}
                  className={`py-1.5 rounded-lg font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi ${
                    wardrobeSection === "styling" ? "bg-pri text-white font-semibold" : "text-mu hover:text-tx"
                  }`}
                >
                  {dict.profile.wardrobe.sections.styling}
                </button>
                <button
                  type="button"
                  onClick={() => setWardrobeSection("loadouts")}
                  className={`py-1.5 rounded-lg font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi ${
                    wardrobeSection === "loadouts" ? "bg-pri text-white font-semibold" : "text-mu hover:text-tx"
                  }`}
                >
                  {dict.profile.wardrobe.sections.loadouts}
                </button>
              </div>

              {/* SECTION: ITEMS */}
              {wardrobeSection === "items" && (
                <div className="space-y-4">
                  {/* Slot Filter Chips */}
                  <div className="flex gap-1.5 overflow-x-auto text-xs pb-1">
                    <button
                      type="button"
                      onClick={() => setWardrobeFilter("all")}
                      className={`chip cursor-pointer transition-colors ${
                        wardrobeFilter === "all" ? "border-vi text-tx font-semibold bg-s2" : ""
                      }`}
                    >
                      {dict.slots.all}
                    </button>
                    {SLOTS.map((slot) => {
                      const slotKey = SLOT_KEY_MAP[slot] || "top";
                      const label = (dict.slots as any)[slotKey] || slot;
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

                  {/* Status Filters & Sorting */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs border-y border-line/60 py-2">
                    <div className="flex gap-1">
                      {(["all", "equipped", "available", "locked"] as const).map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setStatusFilter(st)}
                          className={`chip text-[11px] cursor-pointer transition-colors ${
                            statusFilter === st ? "border-vi bg-pri/30 text-tx font-bold" : ""
                          }`}
                        >
                          {dict.profile.wardrobe.statusFilter[st]}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setRaritySort(raritySort === "default" ? "rarityDesc" : "default")}
                      className="text-[11px] text-mu hover:text-tx transition-colors cursor-pointer"
                    >
                      {raritySort === "rarityDesc" ? dict.profile.sortingRarity : dict.profile.sortingDefault}
                    </button>
                  </div>

                  {/* Item Grid Cards */}
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
                        <div
                          key={it.id}
                          onClick={() => setPreviewItem(it.id)}
                          className={`rounded-xl border p-2.5 text-center text-xs flex flex-col justify-between transition-all relative cursor-pointer ${borderStyle} ${
                            isPreview ? "ring-2 ring-vi bg-[#50348f33]" : "bg-s2/40 hover:bg-s2/70"
                          } ${isLocked ? "opacity-60" : ""}`}
                        >
                          <div>
                            <div
                              className="h-10 rounded-lg mb-1.5 shadow-inner flex items-center justify-center relative"
                              style={{ backgroundColor: it.color }}
                            >
                              {isLocked && <Lock size={16} className="text-white/80" />}
                            </div>

                            <b className="block text-tx truncate text-[11px]">{itemName}</b>
                            <div className="text-[10px] text-mu mt-0.5">{rarityText}</div>

                            {isLocked && (
                              <div className="text-[10px] text-go font-semibold mt-0.5">
                                {formatString(dict.profile.wardrobe.opensAtLevel, {
                                  level: formatNumber(lang, it.reqLevel),
                                })}
                              </div>
                            )}

                            {isEquipped && (
                              <span className="inline-block mt-1 bg-vi/30 text-vi text-[9px] px-1.5 py-0.5 rounded-full font-bold">
                                {dict.profile.wardrobe.equippedBadge}
                              </span>
                            )}
                          </div>

                          {/* Explicit Action Buttons on Card */}
                          <div className="mt-2.5 pt-2 border-t border-line/40 flex flex-col gap-1">
                            {isEquipped ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUnequipSlot(it.slot);
                                }}
                                className="btn-ghost text-[10px] py-1 w-full cursor-pointer"
                              >
                                {formatString(dict.profile.wardrobe.unequipBtn, {
                                  slot: (dict.slots as any)[SLOT_KEY_MAP[it.slot as SlotName] || "top"] || it.slot,
                                })}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!isLocked) {
                                    equipItem(it.id);
                                    showToast(
                                      formatString(dict.chronicleEvents.itemEquipped, {
                                        name: itemName,
                                      })
                                    );
                                  }
                                }}
                                disabled={isLocked}
                                className="btn text-[10px] py-1 w-full disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                              >
                                {dict.profile.wardrobe.equipBtn}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* SECTION: STYLING (Frame & Title Cards) */}
              {wardrobeSection === "styling" && (
                <div className="space-y-5">
                  {/* Profile Frames Section */}
                  <div className="space-y-2">
                    <h4 className="h4 text-xs font-semibold text-mu">
                      {dict.profile.frameLabel.split(":")[0]}
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {FRAMES.map((f) => {
                        const isUnlocked = gameState.level >= f.reqLevel;
                        const isSelected = gameState.frame === f.id;
                        const nameKeyShort = f.nameKey.replace("frames.", "");
                        const frameName = (dict.frames as any)[nameKeyShort] || f.nameKey;

                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => {
                              if (isUnlocked) {
                                setFrame(f.id);
                                showToast(formatString(dict.profile.frameLabel, { name: frameName }));
                              }
                            }}
                            disabled={!isUnlocked}
                            className={`p-3 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center justify-between ${
                              isSelected ? "ring-2 ring-vi border-vi bg-pri/20" : "border-line bg-s2/40 hover:bg-s2"
                            } ${!isUnlocked ? "opacity-50 cursor-not-allowed" : ""}`}
                          >
                            <div
                              className="w-10 h-10 rounded-xl mb-2 flex items-center justify-center border-2 shadow-sm"
                              style={{ borderColor: f.color }}
                            >
                              <Sparkles size={16} style={{ color: f.color }} />
                            </div>
                            <b className="text-xs text-tx block truncate">{frameName}</b>
                            <span className="text-[10px] text-mu block mt-0.5">
                              {!isUnlocked ? `${dict.topbar.level} ${f.reqLevel}` : isSelected ? "✓" : dict.profile.apply}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Titles Selection Section */}
                  <div className="space-y-2 pt-2 border-t border-line">
                    <h4 className="h4 text-xs font-semibold text-mu">
                      {dict.profile.titleLabel.split(":")[0]}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {TITLES_CATALOG.map((t) => {
                        const isUnlocked = gameState.unlockedTitles.includes(t.id);
                        const isSelected = gameState.selectedTitle === t.id;

                        let borderStyle = "border-line";
                        if (t.rarity === "rare") borderStyle = "border-vi/60 bg-vi/5";
                        if (t.rarity === "epic") borderStyle = "border-go/60 bg-go/5";
                        if (t.rarity === "legendary") borderStyle = "border-[#ffd700]/60 bg-[#ffd700]/5";

                        return (
                          <div
                            key={t.id}
                            className={`p-3 rounded-xl border flex items-center justify-between transition-all ${borderStyle} ${
                              isSelected ? "ring-2 ring-vi" : ""
                            } ${!isUnlocked ? "opacity-50" : ""}`}
                          >
                            <div>
                              <b className="text-xs font-bold block text-tx">{t.id}</b>
                              <span className="text-[10px] text-mu capitalize">
                                {t.source} · {t.rarity}
                              </span>
                            </div>

                            {isUnlocked ? (
                              <button
                                type="button"
                                onClick={() => {
                                  selectTitle(t.id);
                                  showToast(formatString(dict.profile.titleLabel, { name: t.id }));
                                }}
                                disabled={isSelected}
                                className="btn text-[10px] py-1 px-3 disabled:opacity-50 cursor-pointer"
                              >
                                {isSelected ? "✓" : dict.profile.apply}
                              </button>
                            ) : (
                              <span className="text-[10px] text-go font-semibold flex items-center gap-1">
                                <Lock size={12} />
                                {t.reqLevel ? `${dict.topbar.level} ${t.reqLevel}` : "—"}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION: LOADOUTS */}
              {wardrobeSection === "loadouts" && (
                <div className="space-y-4">
                  {confirmEmptyLoadout && (
                    <div className="rounded-xl border border-go bg-go/10 p-3 text-xs flex flex-wrap items-center justify-between gap-2">
                      <span className="text-go font-semibold">
                        {dict.profile.wardrobe.loadoutEmptyConfirm}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const ldKey = confirmEmptyLoadout;
                            setConfirmEmptyLoadout(null);
                            applyLoadout(ldKey);
                          }}
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(["session", "community"] as const).map((ldKey) => {
                      const isActive = gameState.activeLoadout === ldKey;
                      const displayName = (dict.profile.loadoutsList as any)[ldKey] || ldKey;
                      const itemsCount = Object.keys(gameState.loadouts[ldKey] || {}).length;

                      return (
                        <div
                          key={ldKey}
                          className={`p-4 rounded-xl border space-y-3 transition-all ${
                            isActive ? "border-vi bg-pri/20 shadow-md" : "border-line bg-s2/40"
                          }`}
                        >
                          <div className="flex justify-between items-center">
                            <b className="text-sm font-bold text-tx">{displayName}</b>
                            <span className="text-xs text-mu">{formatString(dict.profile.itemsCount, { count: itemsCount })}</span>
                          </div>

                          <div className="flex gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleSelectLoadout(ldKey)}
                              className="btn text-xs py-1.5 flex-1 cursor-pointer"
                            >
                              {dict.profile.apply}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveToLoadout(ldKey)}
                              className="btn-ghost text-xs py-1.5 flex-1 cursor-pointer"
                            >
                              {dict.profile.save}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ACHIEVEMENTS (Достижения) */}
          {activeTab === 2 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { id: "firstQuest", titleKey: "firstQuest", descKey: "firstQuestDesc" },
                { id: "stylist", titleKey: "stylist", descKey: "stylistDesc" },
                { id: "streakDay", titleKey: "streakDay", descKey: "streakDayDesc" },
                { id: "level3", titleKey: "level3", descKey: "level3Desc" },
                { id: "author", titleKey: "author", descKey: "authorDesc" },
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
              <div className="flex items-center justify-between pb-2 border-b border-line">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-tx">
                    {formatString(dict.profile.postsCount, { count: gameState.posts.length })}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => openAddModal("post")}
                  className="btn text-xs py-1.5 px-3 flex items-center gap-1 cursor-pointer"
                >
                  <Plus size={14} />
                  <span>{dict.profile.createPost}</span>
                </button>
              </div>

              {gameState.posts.length === 0 ? (
                <div className="text-center py-12 space-y-3">
                  <div className="text-xs text-mu">{dict.profile.posts.emptyState}</div>
                  <button
                    type="button"
                    onClick={() => openAddModal("post")}
                    className="btn text-xs py-2 px-4 cursor-pointer"
                  >
                    {dict.profile.createPost}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {gameState.posts.map((postContent, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-line bg-s2/40 p-4 space-y-2 text-xs relative"
                    >
                      <div className="flex justify-between items-center text-mu text-[11px]">
                        <span>{dict.profile.post}</span>
                        <div className="flex items-center gap-2">
                          <span>{formatString(dict.profile.posts.markedUsefulCount, { count: 0 })}</span>
                          <button
                            type="button"
                            onClick={() => setDeletingPostIdx(idx)}
                            className="text-mu hover:text-red-400 p-1 transition-colors cursor-pointer"
                            aria-label={dict.profile.posts.deleteBtn}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <p className="text-tx leading-relaxed whitespace-pre-wrap">{postContent}</p>

                      {/* Inline Delete Confirmation */}
                      {deletingPostIdx === idx && (
                        <div className="mt-2 p-3 rounded-lg border border-red-500/30 bg-red-500/10 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-red-300">
                            {dict.profile.posts.deleteConfirm}
                          </span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                deletePost(idx);
                                setDeletingPostIdx(null);
                                showToast(dict.profile.posts.deletedToast);
                              }}
                              className="btn bg-red-600 hover:bg-red-700 text-xs py-1 px-3 border-none cursor-pointer"
                            >
                              {dict.profile.posts.deleteBtn}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingPostIdx(null)}
                              className="btn-ghost text-xs py-1 px-3 cursor-pointer"
                              autoFocus
                            >
                              {dict.profile.wardrobe.cancelAction}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: STATS (Статистика - Full Activity Profile) */}
          {activeTab === 5 && (
            <div className="space-y-6">
              {/* Period Selector Header */}
              <div className="flex items-center justify-between pb-2 border-b border-line">
                <h3 className="font-serif text-lg font-bold text-tx">
                  {dict.profile.activityProfile}
                </h3>
                <div className="flex gap-1 bg-s2/60 p-1 rounded-xl border border-line text-xs">
                  {(["7d", "30d", "90d", "all"] as const).map((p) => {
                    const keyMap: Record<string, "d7" | "d30" | "d90" | "all"> = {
                      "7d": "d7",
                      "30d": "d30",
                      "90d": "d90",
                      all: "all",
                    };
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setStatsPeriod(p)}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                          statsPeriod === p ? "bg-pri text-white font-bold" : "text-mu hover:text-tx"
                        }`}
                      >
                        {dict.profile.statsTab.periodSelector[keyMap[p]]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* BLOCK 1: Summary (Сводка) */}
              <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-3">
                <b className="text-xs font-bold text-tx block">{dict.profile.statsTab.summary.title}</b>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-2.5 rounded-lg border border-line/50 bg-s1">
                    <span className="text-[10px] text-mu block">{dict.profile.statsTab.summary.characterPower}</span>
                    <b className="text-base font-bold text-vi font-mono">{characterPower}</b>
                  </div>
                  <div className="p-2.5 rounded-lg border border-line/50 bg-s1">
                    <span className="text-[10px] text-mu block">{dict.profile.statsTab.summary.levelXp}</span>
                    <b className="text-sm font-bold text-tx font-mono">{dict.topbar.level} {gameState.level} · {gameState.xp} XP</b>
                  </div>
                  <div className="p-2.5 rounded-lg border border-line/50 bg-s1">
                    <span className="text-[10px] text-mu block">{dict.profile.statsTab.summary.daysWithAyra}</span>
                    <b className="text-sm font-bold text-tx font-mono">
                      {Math.max(1, Math.ceil((Date.now() - new Date(gameState.createdAt).getTime()) / (1000 * 60 * 60 * 24)))}
                    </b>
                    <span className="text-[9px] text-mu italic block">{dict.profile.statsTab.calculatedFromUpdate}</span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-line/50 bg-s1">
                    <span className="text-[10px] text-mu block">{dict.profile.statsTab.summary.activeDays}</span>
                    <b className="text-sm font-bold text-tx font-mono">
                      {Object.values(gameState.dailyStats || {}).filter((d) => d.totalQuestsCompleted > 0 || d.isRestDay).length}
                    </b>
                  </div>
                  <div className="p-2.5 rounded-lg border border-line/50 bg-s1">
                    <span className="text-[10px] text-mu block">{dict.profile.statsTab.summary.streak}</span>
                    <b className="text-sm font-bold text-tx font-mono">{gameState.currentStreak} / {gameState.bestStreak}</b>
                  </div>
                  <div className="p-2.5 rounded-lg border border-line/50 bg-s1">
                    <span className="text-[10px] text-mu block">{dict.profile.statsTab.summary.questsCompleted}</span>
                    <b className="text-sm font-bold text-tx font-mono">{gameState.history.length}</b>
                  </div>
                </div>
              </div>

              {/* BLOCK 2: Activity Heatmap (26 weeks / 12 mobile) */}
              <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-3">
                <div className="flex justify-between items-center">
                  <b className="text-xs font-bold text-tx">{dict.profile.statsTab.activity.title}</b>
                  <div className="flex gap-1 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setActivityMetric("quests")}
                      className={`px-2 py-0.5 rounded border cursor-pointer ${activityMetric === "quests" ? "border-vi bg-pri/30 text-tx" : "border-line text-mu"}`}
                    >
                      {dict.profile.statsTab.activity.toggleQuests}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActivityMetric("xp")}
                      className={`px-2 py-0.5 rounded border cursor-pointer ${activityMetric === "xp" ? "border-vi bg-pri/30 text-tx" : "border-line text-mu"}`}
                    >
                      {dict.profile.statsTab.activity.toggleXp}
                    </button>
                  </div>
                </div>

                {/* Heatmap Grid */}
                <div className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto py-1">
                  {heatmapDays.map((day, i) => {
                    let cellBg = "bg-s2/20 border-line/30";
                    let tooltip = `${day.dateStr}: ${dict.profile.statsTab.noDataYet}`;

                    if (!day.isBeforeCreated) {
                      if (day.count === 0) {
                        cellBg = "bg-s2/60 border-line";
                        tooltip = `${day.dateStr}: ${dict.profile.statsTab.noActivity}`;
                      } else if (day.count === 1) {
                        cellBg = "bg-vi/40 border-vi/50";
                        tooltip = `${day.dateStr}: 1`;
                      } else if (day.count === 2) {
                        cellBg = "bg-vi/70 border-vi";
                        tooltip = `${day.dateStr}: 2`;
                      } else {
                        cellBg = "bg-go border-go text-black";
                        tooltip = `${day.dateStr}: ${day.count}`;
                      }
                    }

                    return (
                      <div
                        key={i}
                        title={tooltip}
                        className={`w-3 h-3 rounded-[3px] border ${cellBg} transition-colors`}
                      />
                    );
                  })}
                </div>
              </div>

              {/* BLOCK 3: Progress Chart */}
              <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-3">
                <b className="text-xs font-bold text-tx block">{dict.profile.statsTab.progress.title}</b>
                <div className="h-20 flex items-center justify-center bg-s1 rounded-xl p-2 border border-line/50">
                  <Sparkline points={[10, 20, 15, 30, 45, 60, 50, 75, 80]} isUp={true} />
                </div>
                <div className="text-[11px] text-mu flex justify-between">
                  <span>{dict.profile.statsTab.progress.levelsReached}</span>
                  <span className="font-mono text-tx">{dict.topbar.level} 1 ({gameState.createdAt}) → {dict.topbar.level} {gameState.level}</span>
                </div>
              </div>

              {/* BLOCK 4: Quests Breakdown */}
              <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-3 text-xs">
                <b className="font-bold text-tx block">{dict.profile.statsTab.quests.title}</b>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="p-2 rounded bg-s1 border border-line/40">
                    <span className="text-[10px] text-mu block">{dict.slots.all}</span>
                    <b className="text-sm font-mono text-tx">{gameState.history.length}</b>
                  </div>
                  <div className="p-2 rounded bg-s1 border border-line/40">
                    <span className="text-[10px] text-mu block">{dict.profile.statsTab.quests.completionRate}</span>
                    <b className="text-sm font-mono text-vi">100%</b>
                  </div>
                  <div className="p-2 rounded bg-s1 border border-line/40">
                    <span className="text-[10px] text-mu block">{dict.profile.statsTab.quests.weeklyAverage}</span>
                    <b className="text-sm font-mono text-tx">{Math.round(gameState.history.length / 2)} {dict.profile.perWeek}</b>
                  </div>
                  <div className="p-2 rounded bg-s1 border border-line/40">
                    <span className="text-[10px] text-mu block">{dict.questsPage.todayTab.restDayToggle}</span>
                    <b className="text-sm font-mono text-tx">{gameState.isRestDay ? 1 : 0}</b>
                  </div>
                </div>
              </div>

              {/* BLOCK 5: 8 Characteristic Cards with "What develops" */}
              <div className="space-y-3">
                <b className="text-xs font-bold text-tx block">{dict.profile.statsTab.characteristics.title}</b>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {(Object.keys(statsMap) as StatKey[]).map((key) => {
                    const s = statsMap[key];
                    const IconComp = statIcons[key];
                    const name = dict.stats[s.key] || s.key;
                    const developsCats = GAME_CONFIG.STAT_DEVELOPED_BY_CATEGORIES[key] || [];

                    return (
                      <div key={key} className="p-3 rounded-xl border border-line bg-s1 space-y-2">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <IconComp size={16} className="text-vi" />
                            <b className="text-tx">{name}</b>
                          </div>
                          <span className="text-mu text-[11px]">{dict.topbar.level} {s.level}</span>
                        </div>

                        <div className="text-[10px] text-mu">
                          <span className="font-semibold">{dict.profile.statsTab.characteristics.develops}</span>{" "}
                          {developsCats.map((catKey) => (dict.categories as any)[catKey] || catKey).join(", ")}
                        </div>

                        <div className="flex justify-between text-[11px] text-mu pt-1">
                          <span>+{s.weeklyGain} {dict.profile.perWeek}</span>
                          <a href="/quests" className="text-vi font-semibold hover:underline">
                            {dict.profile.statsTab.characteristics.howToLevel}
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* BLOCK 6: JournalStats Contract */}
              {(() => {
                const jStats = calculateJournalStats(journalTrades, 30);

                return (
                  <div className="p-4 rounded-xl border border-line/60 bg-s2/40 space-y-3 text-xs">
                    <b className="font-bold text-tx block">{dict.profile.statsTab.journal.title}</b>
                    {journalTrades.length === 0 ? (
                      <div className="p-4 rounded-xl border border-line bg-s1 text-center space-y-3">
                        <div className="text-mu">{dict.profile.statsTab.journal.willAppear}</div>
                        <button
                          type="button"
                          onClick={() => openAddModal("trade")}
                          className="btn text-xs py-2 px-4 cursor-pointer"
                        >
                          {dict.profile.statsTab.journal.recordTradeBtn}
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                        <div className="p-2.5 rounded-lg border border-line bg-s1">
                          <span className="text-[10px] text-mu block">{dict.journal.dashboard.kpi.trades}</span>
                          <b className="text-sm font-mono text-tx">{jStats.totalTrades}</b>
                        </div>
                        <div className="p-2.5 rounded-lg border border-line bg-s1">
                          <span className="text-[10px] text-mu block">
                            {dict.journal.dashboard.filters.period30d} (R)
                          </span>
                          <b className={`text-sm font-mono ${jStats.periodRResult > 0 ? "text-emerald-400" : jStats.periodRResult < 0 ? "text-rose-400" : "text-tx"}`}>
                            {jStats.periodRResult > 0 ? `+${jStats.periodRResult}` : jStats.periodRResult} R
                          </b>
                        </div>
                        <div className="p-2.5 rounded-lg border border-line bg-s1">
                          <span className="text-[10px] text-mu block">
                            {dict.awakening.skills3m.plan_compliance}
                          </span>
                          <b className="text-sm font-mono text-vi">{jStats.planCompliancePercent}%</b>
                        </div>
                        <div className="p-2.5 rounded-lg border border-line bg-s1">
                          <span className="text-[10px] text-mu block">{dict.journal.processScoreLabel}</span>
                          <b className="text-sm font-mono text-go">
                            {jStats.averageProcessScore > 0 ? `${jStats.averageProcessScore}/100` : "—"}
                          </b>
                        </div>
                        <div className="p-2.5 rounded-lg border border-line bg-s1">
                          <span className="text-[10px] text-mu block">{dict.journal.journalStreak}</span>
                          <b className="text-sm font-mono text-tx">
                            {jStats.journalStreakDays} {dict.journal.daysShort}
                          </b>
                        </div>
                        <div className="p-2.5 rounded-lg border border-line bg-s1">
                          <span className="text-[10px] text-mu block">{dict.journal.tabs.notes}</span>
                          <b className="text-sm font-mono text-tx">{jStats.notesCount}</b>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* BLOCK 7: Collection */}
              <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-2 text-xs">
                <b className="font-bold text-tx block">{dict.profile.statsTab.collection.title}</b>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="p-2 rounded bg-s1 border border-line/40">
                    <span className="text-[10px] text-mu block">{dict.profile.statsTab.collection.itemsOpened}</span>
                    <b className="text-sm font-mono text-tx">{ITEMS.length}</b>
                  </div>
                  <div className="p-2 rounded bg-s1 border border-line/40">
                    <span className="text-[10px] text-mu block">{dict.profile.statsTab.collection.equipped}</span>
                    <b className="text-sm font-mono text-vi">{Object.keys(gameState.equipment).length}</b>
                  </div>
                  <div className="p-2 rounded bg-s1 border border-line/40">
                    <span className="text-[10px] text-mu block">{dict.profile.statsTab.collection.titlesOpened}</span>
                    <b className="text-sm font-mono text-tx">{gameState.unlockedTitles.length}</b>
                  </div>
                  <div className="p-2 rounded bg-s1 border border-line/40">
                    <span className="text-[10px] text-mu block">{dict.profile.statsTab.collection.achievements}</span>
                    <b className="text-sm font-mono text-go">{Object.keys(gameState.achievements).length}/5</b>
                  </div>
                </div>
              </div>

              {/* BLOCK 8: Economy */}
              <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-2 text-xs">
                <b className="font-bold text-tx block">{dict.profile.statsTab.economy.title}</b>
                <div className="flex justify-between items-center p-2 rounded bg-s1 border border-line/40">
                  <span>{dict.profile.statsTab.economy.coinsEarned}</span>
                  <b className="text-go font-mono">{gameState.coins} Coins</b>
                </div>
              </div>

              {/* BLOCK 9: Community */}
              <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-2 text-xs">
                <b className="font-bold text-tx block">{dict.profile.statsTab.community.title}</b>
                <div className="flex justify-between text-mu">
                  <span>{dict.profile.statsTab.community.posts}: {gameState.posts.length}</span>
                  <span>{dict.profile.statsTab.community.comingSoon}</span>
                </div>
              </div>

              {/* BLOCK 10: Records */}
              <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-2 text-xs">
                <b className="font-bold text-tx block">{dict.profile.statsTab.records.title}</b>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 rounded bg-s1">
                    <span className="text-mu block">{dict.profile.statsTab.records.bestStreak}</span>
                    <b className="text-tx font-mono">{gameState.bestStreak}</b>
                  </div>
                  <div className="p-2 rounded bg-s1">
                    <span className="text-mu block">{dict.profile.statsTab.records.strongestStat}</span>
                    <b className="text-vi font-mono capitalize">{dict.stats[statBalance.strongestStat] || statBalance.strongestStat}</b>
                  </div>
                </div>
              </div>

              {/* BLOCK 11: Rules-based Observations */}
              {(() => {
                const obs = getProfileObservations(gameState, statsMap);
                const items: string[] = [];

                if (obs.topCategory) {
                  const catTranslated = (dict.categories as any)[obs.topCategory] || obs.topCategory;
                  items.push(formatString(dict.profile.statsTab.observations.topCategory, { category: catTranslated }));
                } else {
                  items.push(formatString(dict.profile.statsTab.observations.topCategory, { category: (dict.categories as any)["trading"] || "Trading" }));
                }

                const weakStatTranslated = dict.stats[obs.growthZone] || obs.growthZone;
                items.push(formatString(dict.profile.statsTab.observations.growthZone, { stat: weakStatTranslated }));

                if (obs.streakInsight === "strongStreak") {
                  items.push(formatString(dict.profile.statsTab.observations.streakStrong, { streak: gameState.currentStreak }));
                } else {
                  items.push(dict.profile.statsTab.observations.streakBuilding);
                }

                if (obs.adviceTextKey === "balancedProfile") {
                  items.push(dict.profile.statsTab.observations.balanced);
                } else {
                  items.push(dict.profile.statsTab.observations.focusGrowth);
                }

                return (
                  <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-2 text-xs">
                    <b className="font-bold text-tx block">{dict.profile.statsTab.observations.title}</b>
                    <ul className="space-y-1.5 pl-4 list-disc text-mu leading-relaxed">
                      {items.map((it, idx) => (
                        <li key={idx}>{it}</li>
                      ))}
                    </ul>
                  </div>
                );
              })()}

              {/* BLOCK 12: Recent Milestones */}
              <div className="p-4 rounded-xl border border-line bg-s2/40 space-y-2 text-xs">
                <b className="font-bold text-tx block">{dict.profile.statsTab.milestones.title}</b>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {gameState.chronicle.slice(0, 10).map(renderChronicleItem)}
                </div>
              </div>

              {/* Export JSON Button */}
              <div className="pt-2 flex justify-center">
                <button
                  type="button"
                  onClick={handleExportJSON}
                  className="btn text-xs py-2 px-5 flex items-center gap-2 cursor-pointer"
                >
                  <Download size={15} />
                  <span>{dict.profile.statsTab.exportJsonBtn}</span>
                </button>
              </div>

              {/* Footer Disclaimer */}
              <p className="text-[11px] text-mu italic text-center pt-2">
                {dict.profile.statsTab.footerDisclaimer}
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
          <div className="w-full max-w-md rounded-2xl border border-line bg-s1 p-5 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-line pb-2.5">
              <b className="text-base font-bold text-tx">
                {dict.profile.editModal.title}
              </b>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="text-mu hover:text-tx p-1 cursor-pointer"
                aria-label={dict.addModal.close}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
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

              {editError && (
                <div className="text-xs font-semibold text-red-400 bg-red-500/10 p-2 rounded-lg border border-red-500/20">
                  {editError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="btn-ghost text-xs py-2 px-4 cursor-pointer"
                >
                  {dict.profile.wardrobe.cancelAction}
                </button>
                <button type="submit" className="btn text-xs py-2 px-5 cursor-pointer">
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
