"use client";

import React, { useState } from "react";
import { Check, Lock } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { cn } from "@/components/ui/cn";
import { ITEMS, SLOT_KEY_MAP, type SlotName } from "@/lib/items";
import { filterWardrobe, itemState, wardrobeSlots, type WardrobeStatus } from "@/lib/profile";
import { formatString } from "@/lib/i18n";

const STATUSES: WardrobeStatus[] = ["all", "equipped", "available", "locked"];

/** Item grid with type and state filters; equip / take off in one click. Gold only marks rare items. */
export function WardrobeTab() {
  const { dict, showToast } = useApp();
  const { gameState, equipItem, unequipSlot } = useGame();
  const w = dict.profile.wardrobe;
  const w2 = dict.profile.wardrobeV2;
  const slotNames = dict.slots as unknown as Record<string, string>;
  const itemNames = dict.items as unknown as Record<string, string>;
  const [slot, setSlot] = useState<SlotName | "all">("all");
  const [status, setStatus] = useState<WardrobeStatus>("all");
  const items = filterWardrobe(gameState, slot, status);
  const slotLabel = (s: SlotName) => slotNames[SLOT_KEY_MAP[s]] || s;
  const rarityLabel = [dict.rarity.common, dict.rarity.rare, dict.rarity.epic];

  const chip = (selected: boolean) =>
    cn(
      "inline-flex min-h-[36px] shrink-0 items-center rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
      selected ? "border-vi bg-vi/20 text-tx" : "border-edge bg-field text-mu hover:border-vi/60 hover:text-tx"
    );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div role="group" aria-label={w2.typeLabel} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button type="button" aria-pressed={slot === "all"} onClick={() => setSlot("all")} className={chip(slot === "all")}>
            {slotNames.all}
          </button>
          {wardrobeSlots().map((s) => (
            <button key={s} type="button" aria-pressed={slot === s} onClick={() => setSlot(s)} className={chip(slot === s)}>
              {slotLabel(s)}
            </button>
          ))}
        </div>
        <div role="group" aria-label={w2.statusLabel} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {STATUSES.map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={chip(status === s)}>
              {w.statusFilter[s]}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-line bg-s1/60 p-6 text-center text-sm text-mu">{w2.empty}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {items.map((it) => {
            const st = itemState(it, gameState);
            const rare = it.rarity > 0;
            const name = itemNames[it.nameKey.replace("items.", "")] || it.nameKey;
            return (
              <li
                key={it.id}
                data-testid="wardrobe-item"
                data-state={st}
                className={cn(
                  "flex flex-col gap-2 rounded-2xl border p-3 transition-colors",
                  st === "equipped" ? "border-vi bg-vi/10" : rare ? "border-go/40 bg-s1/70" : "border-line bg-s1/70",
                  st === "locked" && "opacity-60"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    aria-hidden="true"
                    className={cn("grid h-12 w-12 place-items-center rounded-xl border", rare ? "border-go/50" : "border-line")}
                    style={{ background: `radial-gradient(circle at 50% 40%, ${it.color}, #121117 75%)` }}
                  >
                    {st === "locked" && <Lock size={16} className="text-tx/80" />}
                  </span>
                  <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", rare ? "bg-go/15 text-go" : "bg-s2 text-mu")}>
                    {rarityLabel[it.rarity]}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-tx">{name}</p>
                  <p className="text-xs text-mu">{slotLabel(it.slot)}</p>
                </div>
                {st === "equipped" ? (
                  <button
                    type="button"
                    onClick={() => {
                      unequipSlot(it.slot);
                      showToast(formatString(dict.chronicleEvents.itemUnequipped, { name: slotLabel(it.slot) }));
                    }}
                    className="mt-auto inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-vi/60 text-xs font-semibold text-tx transition hover:bg-vi/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                  >
                    <Check size={14} aria-hidden="true" />
                    {w2.unequip}
                  </button>
                ) : st === "available" ? (
                  <button
                    type="button"
                    onClick={() => {
                      equipItem(it.id);
                      showToast(formatString(dict.chronicleEvents.itemEquipped, { name }));
                    }}
                    className="mt-auto inline-flex min-h-[40px] items-center justify-center rounded-xl bg-pri text-xs font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
                  >
                    {w.equipBtn}
                  </button>
                ) : (
                  <p className="mt-auto flex min-h-[40px] items-center justify-center rounded-xl border border-dashed border-line text-center text-xs text-mu">
                    {formatString(w2.lockedHint, { level: it.reqLevel })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="sr-only" aria-live="polite">
        {items.length}/{ITEMS.length}
      </p>
    </div>
  );
}
