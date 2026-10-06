"use client";

import React, { useState, useEffect, useRef } from "react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { CharacterStage } from "@/components/CharacterStage";
import { TabHeader } from "@/components/TabHeader";
import { Figure } from "@/components/Figure";
import { PlanBadge } from "@/components/PlanBadge";
import { CoinsChip } from "@/components/CoinsChip";
import {
  ITEMS,
  SLOTS,
  FRAMES,
  BACKGROUNDS,
  SlotName,
} from "@/lib/items";
import { TITLES_CATALOG } from "@/lib/titles";
import { getReputation, calculateStats, getCharacterPower, getStatBalance, StatKey } from "@/lib/stats";
import { xpForNextLevel, ChronicleEntry } from "@/lib/game";
import { formatString, formatNumber } from "@/lib/i18n";
import {
  Pencil,
  ChevronDown,
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
  Award,
  ChevronRight,
} from "lucide-react";

export default function ProfilePage() {
  const { dict, lang, showToast } = useApp();
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
    addPost,
    updateProfile,
    selectTitle,
    cycleFrame,
    cycleBackground,
  } = useGame();

  const [activeTab, setActiveTab] = useState<number>(0);

  // Edit Modal state
  const [isEditModalOpen, setEditModalOpen] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>("");
  const [editBio, setEditBio] = useState<string>("");
  const [editError, setEditError] = useState<string>("");

  // Title Selection Modal state
  const [isTitleModalOpen, setTitleModalOpen] = useState<boolean>(false);

  // Reputation Tooltip state
  const [showRepTooltip, setShowRepTooltip] = useState<boolean>(false);

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
    setActiveTab(1);
    setPreviewItem(null);
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      window.scrollTo({ top: 400, behavior: "smooth" });
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

    // Check Latin nickname requirement
    if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) {
      setEditError(
        lang === "ru"
          ? "Только латиница, цифры и _ . -"
          : "Latin letters, digits and _ . - only"
      );
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

  // Calculations for Overview tab
  const nextLevelXp = xpForNextLevel(gameState.level);
  const xpPercent = Math.min(100, Math.round((gameState.xp / nextLevelXp) * 100));

  const reputation = getReputation(gameState);
  const repPercent = Math.min(100, Math.round((reputation.points / 1000) * 100));

  const currentTitleObj = TITLES_CATALOG.find((t) => t.id === gameState.selectedTitle) || TITLES_CATALOG[0];
  const translatedTitleName =
    currentTitleObj.id === "novice"
      ? dict.titles.titleNovice
      : currentTitleObj.id === "disciplined"
      ? dict.titles.titleDisciplined
      : currentTitleObj.id === "strategist"
      ? dict.titles.titleStrategist
      : currentTitleObj.id;

  const currentFrameObj = FRAMES[gameState.frame] || FRAMES[0];
  const translatedFrameName =
    (dict.frames as any)[currentFrameObj.nameKey.replace("frames.", "")] || currentFrameObj.nameKey;

  const currentBgObj = BACKGROUNDS[gameState.background % 3] || BACKGROUNDS[0];
  const translatedBgName =
    (dict.backgrounds as any)[currentBgObj.nameKey.replace("backgrounds.", "")] || currentBgObj.nameKey;

  // 8 Stats calculations
  const statsMap = calculateStats(gameState);
  const characterPower = getCharacterPower(statsMap);
  const statBalance = getStatBalance(statsMap);

  const filteredItems = ITEMS.filter((it) => {
    if (wardrobeFilter === "Все") return true;
    return it.slot === wardrobeFilter;
  });

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

    equipItem(previewItem);
    showToast(
      formatString(dict.chronicleEvents.itemEquipped, {
        name: (dict.items as any)[item.nameKey.replace("items.", "")] || item.nameKey,
      })
    );
  };

  const handleUnequipSlot = (slot: string) => {
    unequipSlot(slot);
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

  const handleSaveToLoadout = () => {
    const activeLd = gameState.activeLoadout || "session";
    saveLoadout(activeLd);
    const ldDisplayName = activeLd === "session" ? (lang === "ru" ? "Сессия" : "Session") : (lang === "ru" ? "Сообщество" : "Community");
    showToast(
      formatString(dict.profile.wardrobe.loadoutSavedToast, {
        name: ldDisplayName,
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

  const handleConfirmEmptyLoadout = () => {
    if (!confirmEmptyLoadout) return;
    const ldKey = confirmEmptyLoadout;
    setConfirmEmptyLoadout(null);
    applyLoadout(ldKey);
  };

  const handlePublishPost = () => {
    const trimmed = postText.trim();
    if (!trimmed) return;
    addPost(trimmed);
    setPostText("");
    showToast(dict.chronicleEvents.postPublished);
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
        case "titleSelected":
          text = `Выбрано звание: ${entry.titleId}`;
          break;
        case "titleUnlocked":
          text = `Открыто звание: ${entry.titleId}`;
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

  const statNamesRu: Record<StatKey, string> = {
    discipline: "Дисциплина",
    trading: "Трейдинг",
    intelligence: "Интеллект",
    focus: "Фокус",
    psychology: "Психология",
    knowledge: "Знания",
    endurance: "Выносливость",
    strength: "Сила",
  };

  const statNamesEn: Record<StatKey, string> = {
    discipline: "Discipline",
    trading: "Trading",
    intelligence: "Intelligence",
    focus: "Focus",
    psychology: "Psychology",
    knowledge: "Knowledge",
    endurance: "Endurance",
    strength: "Strength",
  };

  const rankNamesRu: Record<string, string> = {
    novice: "Новичок",
    adept: "Адепт",
    skilled: "Опытный",
    expert: "Эксперт",
    master: "Мастер",
  };

  const rankNamesEn: Record<string, string> = {
    novice: "Novice",
    adept: "Adept",
    skilled: "Skilled",
    expert: "Expert",
    master: "Master",
  };

  return (
    <div className="space-y-4">
      {/* Page Header - Single Line */}
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl font-bold text-tx">{dict.profile.title}</h1>
      </div>

      {/* Main Grid: Left Sticky Scene & Right Single Card Block */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* Left Column: Interactive 360° Character Stage (Vertical Sticky) */}
        <div className="lg:col-span-5 lg:sticky lg:top-20">
          <CharacterStage onSlotClick={handleSlotClick} selectedSlot={activeTab === 1 ? (wardrobeFilter as SlotName) : null} />
        </div>

        {/* Right Column: Single Container with Outer Border and Inner Cards */}
        <div className="lg:col-span-7 rounded-2xl border border-line bg-s1 p-4 sm:p-5 shadow-2xl space-y-5">
          {/* Top Tabs Bar */}
          <TabHeader tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />

          {/* TAB 0: OVERVIEW (Обзор) */}
          {activeTab === 0 && (
            <div className="space-y-4">
              {/* Compact Header Card */}
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
                        aria-label="Редактировать профиль"
                        className="p-1 text-mu hover:text-tx transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                    </div>

                    {/* Selected Title Dropdown Trigger */}
                    <button
                      type="button"
                      onClick={() => setTitleModalOpen(true)}
                      className="flex items-center gap-1 text-xs font-semibold text-vi hover:underline"
                    >
                      <span>{translatedTitleName}</span>
                      <ChevronDown size={12} />
                    </button>
                  </div>
                </div>

                {/* Bio (Truncated to 2 lines) */}
                <div className="text-xs text-mu italic max-w-xs line-clamp-2" title={gameState.bio || (lang === "ru" ? "Мой путь — дисциплина и процесс." : "My path is discipline and process.")}>
                  {gameState.bio || (lang === "ru" ? "Мой путь — дисциплина и процесс." : "My path is discipline and process.")}
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
                    onClick={() => showToast(lang === "ru" ? "Скоро" : "Coming soon")}
                    className="p-3 rounded-xl border border-line/60 bg-s2/40 hover:bg-s2/80 hover:border-vi/50 transition-all text-center relative overflow-hidden group cursor-pointer"
                  >
                    {/* Shimmer Shimmer Effect on Hover */}
                    <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />
                    <b className="text-lg font-bold text-tx block font-mono">{card.count}</b>
                    <span className="text-[11px] text-mu truncate block mt-0.5">{card.label}</span>
                  </button>
                ))}
              </div>

              {/* Single Dark Reputation Block */}
              <div className="p-4 rounded-xl border border-line bg-black/60 space-y-3 relative">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-vi/20 border border-vi/40 grid place-items-center text-vi">
                      <Shield size={18} />
                    </div>
                    <div>
                      <b className="text-xs font-bold text-tx block">
                        {dict.profile.reputationTitle.split(":")[0]}: {reputation.tierId.toUpperCase()}
                      </b>
                      <span className="text-[11px] text-mu">
                        {dict.profile.reputationNote}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <b className="text-sm font-bold font-mono text-tx">{reputation.points} pt</b>
                    <button
                      type="button"
                      onClick={() => setShowRepTooltip(!showRepTooltip)}
                      className="text-mu hover:text-tx p-1"
                      aria-label="Подробнее о репутации"
                    >
                      <HelpCircle size={15} />
                    </button>
                  </div>
                </div>

                {/* Segmented Bar for 5 Tiers */}
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

                <div className="text-[11px] text-mu">
                  {lang === "ru" ? `До следующей ступени: ${reputation.pointsToNext} очков` : `To next tier: ${reputation.pointsToNext} points`}
                </div>

                {/* Tooltip Breakdown Popup */}
                {showRepTooltip && (
                  <div className="p-3 rounded-xl border border-line bg-s1 text-xs space-y-1.5 shadow-xl">
                    <div className="flex justify-between">
                      <span>Полезность / Usefulness:</span>
                      <b className="text-tx font-mono">{reputation.usefulness}%</b>
                    </div>
                    <div className="flex justify-between">
                      <span>Качество / Quality:</span>
                      <b className="text-tx font-mono">{reputation.quality}%</b>
                    </div>
                    <div className="flex justify-between">
                      <span>Стабильность / Consistency:</span>
                      <b className="text-tx font-mono">{reputation.consistency}%</b>
                    </div>
                  </div>
                )}
              </div>

              {/* Full Width Level Progress */}
              <div className="p-3.5 rounded-xl border border-line/60 bg-s2/40 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-vi">Ур. {gameState.level}</span>
                  <span className="text-mu font-mono">{gameState.xp} / {nextLevelXp} XP</span>
                  <span className="font-bold text-tx">Ур. {gameState.level + 1}</span>
                </div>
                <div className="xp w-full h-2.5 rounded-full overflow-hidden bg-s2">
                  <i
                    className="block h-full bg-gradient-to-r from-pri via-vi to-go shadow-[0_0_10px_#a38ad188]"
                    style={{ width: `${xpPercent}%` }}
                  />
                </div>
                <div className="flex justify-between items-center text-[11px] pt-1">
                  <div className="flex gap-2">
                    <span className="chip text-[10px]">Задания сегодня: {Object.keys(gameState.completedQuestsToday).length}/3</span>
                    <span className="chip text-[10px]">Серия: {gameState.currentStreak} дн.</span>
                  </div>
                  <span className="text-mu">
                    ещё {nextLevelXp - gameState.xp} XP до уровня
                  </span>
                </div>
              </div>

              {/* Stage Design Choices (Frames & Backgrounds moved here) */}
              <div className="p-3.5 rounded-xl border border-line/60 bg-s2/40 space-y-2">
                <span className="text-xs font-semibold text-mu block">Оформление сцены / Stage Styling</span>
                <div className="flex flex-wrap gap-2">
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
                </div>
              </div>

              {/* 8 Horizontal Stat Bars */}
              <div className="p-3.5 rounded-xl border border-line/60 bg-s2/40 space-y-3">
                <div className="flex justify-between items-center">
                  <h4 className="h4 text-sm">{dict.profile.statsHeader}</h4>
                  <button
                    type="button"
                    onClick={() => setActiveTab(5)}
                    className="text-xs text-vi font-semibold hover:underline flex items-center gap-1"
                  >
                    <span>Подробнее</span>
                    <ChevronRight size={14} />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(Object.keys(statsMap) as StatKey[]).map((key) => {
                    const s = statsMap[key];
                    const IconComp = statIcons[key];
                    const isStrongest = key === statBalance.strongestStat;
                    const isWeakest = key === statBalance.weakestStat;
                    const name = lang === "ru" ? statNamesRu[key] : statNamesEn[key];
                    const rank = lang === "ru" ? rankNamesRu[s.rank] : rankNamesEn[s.rank];
                    const progressPercent = Math.min(100, Math.round((s.currentLevelXp / s.nextLevelXp) * 100));

                    return (
                      <div
                        key={key}
                        className="p-2.5 rounded-xl border border-line bg-s1 space-y-1.5 relative overflow-hidden group hover:border-vi/50 transition-all"
                      >
                        {/* Hover Shimmer */}
                        <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/5 to-transparent pointer-events-none" />

                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-md bg-s2 grid place-items-center text-vi">
                              <IconComp size={14} />
                            </div>
                            <span className="font-semibold text-tx">{name}</span>
                            {isStrongest && (
                              <span className="w-2 h-2 rounded-full bg-go shadow-[0_0_6px_#d6a94a]" title="Сильнейшая сторона" />
                            )}
                          </div>
                          <div className="text-[11px] text-mu font-mono">
                            {rank} · Lv.{s.level}
                          </div>
                        </div>

                        {/* Segmented Long Bar */}
                        <div className="xp h-3 rounded-full overflow-hidden bg-s2">
                          <i
                            className="block h-full bg-gradient-to-r from-pri to-vi transition-all duration-500 shadow-[0_0_8px_#50348f]"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>

                        <div className="flex justify-between text-[10px] text-mu">
                          <span>{s.currentLevelXp}/{s.nextLevelXp} XP</span>
                          <span className="text-go font-semibold">+{s.weeklyGain}</span>
                        </div>

                        {isWeakest && (
                          <div className="text-[9px] text-go/80 italic">
                            Зона роста: упражнения в квестах
                          </div>
                        )}
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
              <div className="flex items-center justify-between pb-1">
                <div className="flex gap-1.5 overflow-x-auto text-xs">
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

              {/* Wardrobe Controls */}
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
                    name: gameState.activeLoadout === "session" ? (lang === "ru" ? "Сессия" : "Session") : (lang === "ru" ? "Сообщество" : "Community"),
                  })}
                </button>
              </div>

              {/* Loadouts Confirmation if Empty */}
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
                  {Object.keys(gameState.loadouts).map((ldKey) => {
                    const isActive = gameState.activeLoadout === ldKey;
                    const displayName = ldKey === "session" ? (lang === "ru" ? "Сессия" : "Session") : (lang === "ru" ? "Сообщество" : "Community");

                    return (
                      <button
                        key={ldKey}
                        type="button"
                        onClick={() => handleSelectLoadout(ldKey)}
                        className={`rounded-xl border px-3 py-1.5 text-xs transition-colors ${
                          isActive
                            ? "border-vi bg-pri/30 text-tx font-bold"
                            : "border-line bg-s1 text-mu hover:border-vi hover:text-tx"
                        }`}
                      >
                        {displayName}
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
              {/* Top 4 Summary Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center p-3 rounded-xl border border-line bg-s2/40">
                <div>
                  <b className="text-lg font-bold text-vi font-mono">{characterPower}</b>
                  <small className="block text-[10px] text-mu">Сила персонажа</small>
                </div>
                <div>
                  <b className="text-sm font-bold text-go block truncate">
                    {lang === "ru" ? statNamesRu[statBalance.strongestStat] : statNamesEn[statBalance.strongestStat]}
                  </b>
                  <small className="block text-[10px] text-mu">Сильнейшая сторона</small>
                </div>
                <div>
                  <b className="text-sm font-bold text-tx block truncate">
                    {lang === "ru" ? statNamesRu[statBalance.weakestStat] : statNamesEn[statBalance.weakestStat]}
                  </b>
                  <small className="block text-[10px] text-mu">Зона роста</small>
                </div>
                <div>
                  <b className="text-sm font-bold text-tx">
                    {statBalance.isBalanced ? "Сбалансирован" : "С перекосом"}
                  </b>
                  <small className="block text-[10px] text-mu">Баланс профиля</small>
                </div>
              </div>

              {/* 8 Expandable Cards */}
              <div className="space-y-3">
                <h4 className="h4">{dict.profile.statsHeader}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {(Object.keys(statsMap) as StatKey[]).map((key) => {
                    const s = statsMap[key];
                    const IconComp = statIcons[key];
                    const name = lang === "ru" ? statNamesRu[key] : statNamesEn[key];
                    const rank = lang === "ru" ? rankNamesRu[s.rank] : rankNamesEn[s.rank];
                    const progressPercent = Math.min(100, Math.round((s.currentLevelXp / s.nextLevelXp) * 100));

                    return (
                      <div key={key} className="p-3 rounded-xl border border-line bg-s1 space-y-2">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <IconComp size={16} className="text-vi" />
                            <b className="text-tx">{name}</b>
                          </div>
                          <span className="text-mu text-[11px]">{rank} · Lv.{s.level}</span>
                        </div>

                        <div className="xp h-2.5 rounded-full overflow-hidden bg-s2">
                          <i
                            className="block h-full bg-gradient-to-r from-pri to-vi"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>

                        <div className="flex justify-between text-[11px] text-mu">
                          <span>Прирост за неделю: +{s.weeklyGain}</span>
                          <a href="/quests" className="text-vi font-semibold hover:underline">
                            Как прокачать →
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <p className="text-[11px] text-mu italic text-center pt-2">
                Характеристики отражают привычки и обучение в AYRA, а не торговые результаты.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* TITLE SELECTION MODAL */}
      {isTitleModalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setTitleModalOpen(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-2xl border border-line bg-s1 p-5 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-line pb-2.5">
              <b className="text-base font-bold text-tx">Выбрать звание / Choose Title</b>
              <button
                type="button"
                onClick={() => setTitleModalOpen(false)}
                className="text-mu hover:text-tx p-1"
                aria-label={dict.addModal.close}
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
              {TITLES_CATALOG.map((t) => {
                const isUnlocked = gameState.unlockedTitles.includes(t.id);
                const isSelected = gameState.selectedTitle === t.id;

                let rarityColor = "text-tx border-line";
                if (t.rarity === "rare") rarityColor = "text-vi border-vi/40 bg-vi/5";
                if (t.rarity === "epic") rarityColor = "text-go border-go/40 bg-go/5";
                if (t.rarity === "legendary") rarityColor = "text-[#ffd700] border-[#ffd700]/40 bg-[#ffd700]/5";

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      if (isUnlocked) {
                        selectTitle(t.id);
                        setTitleModalOpen(false);
                        showToast(`Звание "${t.id}" выбрано`);
                      }
                    }}
                    disabled={!isUnlocked}
                    className={`w-full p-3 rounded-xl border text-left flex items-center justify-between transition-all ${rarityColor} ${
                      isSelected ? "ring-2 ring-vi" : ""
                    } ${!isUnlocked ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:scale-[1.01]"}`}
                  >
                    <div>
                      <b className="text-xs font-bold block">{t.id}</b>
                      <span className="text-[10px] text-mu capitalize">
                        {t.source} · {t.rarity}
                      </span>
                    </div>

                    {!isUnlocked && (
                      <span className="text-[10px] text-go font-semibold flex items-center gap-1">
                        <Lock size={12} />
                        {t.isPlaceholder ? "Скоро" : t.reqLevel ? `Ур. ${t.reqLevel}` : "Достижение"}
                      </span>
                    )}

                    {isSelected && <span className="text-vi text-xs font-bold">✓ Selected</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

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
                <span className="text-[10px] text-mu block">
                  {lang === "ru"
                    ? "Только латиница, цифры и _ . -"
                    : "Latin letters, digits and _ . - only"}
                </span>
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
