"use client";

import React from "react";
import { Check, Lock } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { Modal } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { ITEMS, SLOT_KEY_MAP, type SlotName } from "@/lib/items";
import { filterWardrobe, itemState } from "@/lib/profile";
import { formatString } from "@/lib/i18n";

/** Compact chooser for one equipment slot (a dialog; a bottom sheet on phones). Equip / take off in one click. */
export function SlotPicker({ slot, onClose }: { slot: SlotName | null; onClose: () => void }) {
  const { dict, showToast } = useApp();
  const { gameState, equipItem, unequipSlot } = useGame();
  const slotNames = dict.slots as unknown as Record<string, string>;
  const itemNames = dict.items as unknown as Record<string, string>;
  const w = dict.profile.wardrobe;
  const w2 = dict.profile.wardrobeV2;
  const rarity = [dict.rarity.common, dict.rarity.rare, dict.rarity.epic];
  const slotLabel = slot ? slotNames[SLOT_KEY_MAP[slot]] || slot : "";
  const items = slot ? filterWardrobe(gameState, slot, "all", ITEMS) : [];

  return (
    <Modal
      isOpen={slot !== null}
      onClose={onClose}
      title={slotLabel}
      subtitle={dict.profile.slotPicker.hint}
      closeLabel={dict.profile.slotPicker.close}
      size="sm"
      sheetOnMobile
      data-testid="slot-picker"
    >
      {items.length === 0 ? (
        <p className="text-sm text-mu">{dict.profile.slotPicker.empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const state = itemState(it, gameState);
            const rare = it.rarity > 0;
            const name = itemNames[it.nameKey.replace("items.", "")] || it.nameKey;
            return (
              <li
                key={it.id}
                data-testid="slot-item"
                data-state={state}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-2.5",
                  state === "equipped" ? "border-vi bg-vi/10" : rare ? "border-go/40 bg-s2/40" : "border-line bg-s2/40",
                  state === "locked" && "opacity-60"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg border", rare ? "border-go/50" : "border-line")}
                  style={{ background: `radial-gradient(circle at 50% 40%, ${it.color}, #121117 75%)` }}
                >
                  {state === "locked" && <Lock size={14} className="text-tx/80" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-tx">{name}</p>
                  <p className={cn("text-[11px] font-semibold uppercase tracking-wide", rare ? "text-go" : "text-mu")}>{rarity[it.rarity]}</p>
                </div>
                {state === "equipped" ? (
                  <button
                    type="button"
                    onClick={() => {
                      unequipSlot(it.slot);
                      showToast(formatString(dict.chronicleEvents.itemUnequipped, { name: slotLabel }));
                    }}
                    className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg border border-vi/60 px-3 text-xs font-semibold text-tx hover:bg-vi/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                  >
                    <Check size={14} aria-hidden="true" />
                    {w2.unequip}
                  </button>
                ) : state === "available" ? (
                  <button
                    type="button"
                    onClick={() => {
                      equipItem(it.id);
                      showToast(formatString(dict.chronicleEvents.itemEquipped, { name }));
                    }}
                    className="inline-flex min-h-[40px] shrink-0 items-center rounded-lg bg-pri px-3 text-xs font-semibold text-white hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                  >
                    {w.equipBtn}
                  </button>
                ) : (
                  <span className="shrink-0 text-right text-[11px] text-mu">{formatString(w2.lockedHint, { level: it.reqLevel })}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
