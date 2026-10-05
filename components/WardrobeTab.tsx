"use client";

import React, { useState } from "react";
import { useGame } from "@/lib/game-context";
import { useApp } from "@/lib/context";
import { SLOTS, SlotName, ITEMS, FRAMES, BACKGROUNDS, EquipmentItem } from "@/lib/items";
import { formatString } from "@/lib/i18n";
import { Shield, Check, Eye, RotateCcw, Sparkles } from "lucide-react";

interface WardrobeTabProps {
  onPreviewChange?: (preview: Record<string, number> | null) => void;
}

export function WardrobeTab({ onPreviewChange }: WardrobeTabProps) {
  const { gameState, equipItem, unequipItem, setFrame, setBackground } = useGame();
  const { dict, showToast } = useApp();

  const [selectedSlot, setSelectedSlot] = useState<SlotName>("Верх");
  const [previewEquipment, setPreviewEquipment] = useState<Record<string, number> | null>(null);

  const activeEquipment = previewEquipment || gameState.equipment || {};

  const itemsInSlot = ITEMS.map((item, idx) => ({ ...item, globalIdx: idx })).filter(
    (item) => item.slot === selectedSlot
  );

  const getItemName = (item: { nameKey: string }) => {
    const keyShort = item.nameKey.replace("items.", "");
    return (dict.items as any)[keyShort] || item.nameKey;
  };

  const getFrameName = (frame: { nameKey: string }) => {
    const keyShort = frame.nameKey.replace("frames.", "");
    return (dict.frames as any)[keyShort] || frame.nameKey;
  };

  const getBgName = (bg: { nameKey: string }) => {
    const keyShort = bg.nameKey.replace("backgrounds.", "");
    return (dict.backgrounds as any)[keyShort] || bg.nameKey;
  };

  const handlePreview = (slot: SlotName, globalIdx: number) => {
    const next = {
      ...(previewEquipment || gameState.equipment || {}),
      [slot]: globalIdx,
    };
    setPreviewEquipment(next);
    if (onPreviewChange) onPreviewChange(next);
  };

  const handleCancelPreview = () => {
    setPreviewEquipment(null);
    if (onPreviewChange) onPreviewChange(null);
  };

  const handleEquip = (slot: SlotName, globalIdx: number, item: EquipmentItem) => {
    const name = getItemName(item);
    equipItem(slot, globalIdx, name);
    setPreviewEquipment(null);
    if (onPreviewChange) onPreviewChange(null);
    showToast(formatString(dict.profile.wardrobe.equippedToast, { name }));
  };

  const handleUnequip = (slot: SlotName, item: EquipmentItem) => {
    const name = getItemName(item);
    unequipItem(slot);
    setPreviewEquipment(null);
    if (onPreviewChange) onPreviewChange(null);
    showToast(formatString(dict.profile.wardrobe.unequippedToast, { name }));
  };

  return (
    <div className="space-y-6">
      {/* SECTION 1: EQUIPMENT */}
      <div className="card p-4 border border-line space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-line">
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-vi-lt" />
            <h3 className="font-serif text-lg font-bold text-tx">
              {dict.profile.wardrobe.equipmentSection}
            </h3>
          </div>

          {previewEquipment && (
            <button
              onClick={handleCancelPreview}
              className="btn-ghost text-xs flex items-center gap-1.5 py-1 px-3 border border-amber-500/40 text-amber-400 rounded-lg hover:bg-amber-500/10"
            >
              <RotateCcw size={14} />
              <span>{dict.profile.wardrobe.cancelPreviewBtn}</span>
            </button>
          )}
        </div>

        {/* Slot Selector Chips */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {SLOTS.map((slot) => {
            const isSelected = selectedSlot === slot;
            const equippedIdx = activeEquipment[slot];
            const hasEquipped = equippedIdx != null && ITEMS[equippedIdx] != null;

            return (
              <button
                key={slot}
                onClick={() => setSelectedSlot(slot)}
                className={`relative flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold flex-none border transition-all duration-200 ${
                  isSelected
                    ? "bg-vi text-white border-vi shadow-[0_0_10px_rgba(163,138,209,0.3)]"
                    : "bg-s2/80 text-mu border-line hover:border-vi hover:text-tx"
                }`}
              >
                <span>{slot}</span>
                {hasEquipped && (
                  <span className="h-2 w-2 rounded-full bg-go" title="Item equipped" />
                )}
              </button>
            );
          })}
        </div>

        {/* Items List Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          {itemsInSlot.length === 0 ? (
            <p className="text-xs text-mu col-span-2 py-4 text-center italic">
              {dict.search.empty}
            </p>
          ) : (
            itemsInSlot.map((item) => {
              const itemName = getItemName(item);
              const isEquippedInState = gameState.equipment?.[selectedSlot] === item.globalIdx;
              const isPreviewed = previewEquipment?.[selectedSlot] === item.globalIdx;
              const isLocked = gameState.level < item.reqLevel;

              return (
                <div
                  key={item.globalIdx}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-all duration-200 ${
                    isEquippedInState
                      ? "border-vi bg-vi/15 shadow-[0_0_12px_rgba(163,138,209,0.2)]"
                      : isPreviewed
                      ? "border-amber-400 bg-amber-400/10"
                      : "border-line bg-s2/60 hover:border-vi/50 hover:bg-s2"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl border"
                      style={{
                        backgroundColor: `${item.color}20`,
                        borderColor: item.color,
                      }}
                    >
                      <span
                        className="h-4 w-4 rounded-full border border-black/40"
                        style={{ backgroundColor: item.color }}
                      />
                    </div>

                    <div>
                      <h4 className="font-semibold text-xs text-tx">{itemName}</h4>
                      <p className="text-[10px] text-mu">
                        {formatString(dict.profile.wardrobe.reqLevelShort, { level: item.reqLevel })}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isEquippedInState ? (
                      <button
                        onClick={() => handleUnequip(selectedSlot, item)}
                        className="btn-ghost text-xs py-1 px-2.5 border border-red-500/40 text-red-400 hover:bg-red-500/10 rounded-lg"
                      >
                        {dict.profile.wardrobe.unequipBtn}
                      </button>
                    ) : isLocked ? (
                      <span className="text-[10px] text-mu font-semibold px-2 py-1 rounded bg-s1">
                        {dict.profile.wardrobe.lockedBadge}
                      </span>
                    ) : (
                      <>
                        <button
                          onClick={() => handlePreview(selectedSlot, item.globalIdx)}
                          className="btn-ghost text-xs p-1.5 border border-line hover:border-vi rounded-lg text-mu hover:text-tx"
                          title={dict.profile.wardrobe.previewBtn}
                        >
                          <Eye size={14} />
                        </button>

                        <button
                          onClick={() => handleEquip(selectedSlot, item.globalIdx, item)}
                          className="btn text-xs py-1 px-3 bg-vi text-white hover:bg-vi-dk rounded-lg"
                        >
                          {dict.profile.wardrobe.equipBtn}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* SECTION 2: APPEARANCE (FRAMES & BACKGROUNDS WITH COLOR SWATCHES) */}
      <div className="card p-4 border border-line space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-line">
          <Sparkles size={18} className="text-go" />
          <h3 className="font-serif text-lg font-bold text-tx">
            {dict.profile.wardrobe.appearanceSection}
          </h3>
        </div>

        {/* Frames */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-tx">
            {dict.profile.wardrobe.frameLabel}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {FRAMES.map((f) => {
              const isSelected = gameState.frame === f.id;
              const isLocked = gameState.level < f.reqLevel;
              const fName = getFrameName(f);

              return (
                <button
                  key={f.id}
                  disabled={isLocked}
                  onClick={() => {
                    setFrame(f.id);
                    showToast(formatString(dict.profile.wardrobe.frameChangedToast, { name: fName }));
                  }}
                  className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs text-left transition-all duration-200 ${
                    isSelected
                      ? "border-vi bg-vi/15 font-bold"
                      : isLocked
                      ? "border-line/40 opacity-50 cursor-not-allowed"
                      : "border-line bg-s2/60 hover:border-vi/50"
                  }`}
                >
                  <span
                    className="h-4 w-4 rounded-full border border-black/50 flex-none shadow-xs"
                    style={{ backgroundColor: f.color }}
                  />
                  <span className="truncate flex-1">{fName}</span>
                  {isSelected && <Check size={14} className="text-vi-lt flex-none" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Backgrounds */}
        <div className="space-y-2 pt-2 border-t border-line/60">
          <label className="block text-xs font-semibold text-tx">
            {dict.profile.wardrobe.backgroundLabel}
          </label>
          <div className="grid grid-cols-3 gap-2.5">
            {BACKGROUNDS.map((bg) => {
              const isSelected = gameState.background === bg.id;
              const bgName = getBgName(bg);

              return (
                <button
                  key={bg.id}
                  onClick={() => {
                    setBackground(bg.id);
                    showToast(formatString(dict.profile.wardrobe.bgChangedToast, { name: bgName }));
                  }}
                  className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition-all duration-200 ${
                    isSelected
                      ? "border-vi bg-vi/15 font-bold text-tx"
                      : "border-line bg-s2/60 text-mu hover:border-vi/50 hover:text-tx"
                  }`}
                >
                  <span>{bgName}</span>
                  {isSelected && <Check size={14} className="text-vi-lt flex-none" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
