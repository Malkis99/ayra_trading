"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/context";
import { Search, X } from "lucide-react";

const searchTargets = [
  { label: "Перейти: Home", href: "/" },
  { label: "Перейти: Journal", href: "/journal" },
  { label: "Перейти: Journal › Trades", href: "/journal?tab=trades" },
  { label: "Перейти: Market", href: "/market" },
  { label: "Перейти: Quests", href: "/quests" },
  { label: "Перейти: Community", href: "/community" },
  { label: "Перейти: Academy", href: "/academy" },
  { label: "Перейти: Профиль", href: "/profile" },
  { label: "Перейти: Тарифы", href: "/plans" },
  { label: "Добавить: Сделка", action: "Сделка" },
  { label: "Добавить: Заметка", action: "Заметка" },
  { label: "Добавить: Эмоция", action: "Эмоция" },
  { label: "Добавить: Пост", action: "Пост" },
  { label: "Добавить: Событие", action: "Событие" },
];

export function SearchModal() {
  const router = useRouter();
  const { isSearchOpen, setSearchOpen, showToast } = useApp();
  const [query, setQuery] = useState("");

  if (!isSearchOpen) return null;

  const filtered = searchTargets
    .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  const handleSelect = (item: (typeof searchTargets)[0]) => {
    setSearchOpen(false);
    setQuery("");
    if (item.href) {
      router.push(item.href);
    } else if (item.action) {
      showToast(`Откроется форма: ${item.action}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setSearchOpen(false);
          setQuery("");
        }
      }}
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-line bg-s1 p-4 shadow-2xl">
        <div className="relative flex items-center">
          <Search size={18} className="absolute left-3 text-mu" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Перейти или добавить…"
            className="w-full rounded-xl border border-line bg-s2 py-2.5 pl-10 pr-10 text-sm text-tx placeholder-mu focus:border-vi focus:outline-none"
          />
          <button
            onClick={() => {
              setSearchOpen(false);
              setQuery("");
            }}
            className="absolute right-3 text-mu hover:text-tx"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-1">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-xs text-mu">Ничего не найдено</div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.label}
                onClick={() => handleSelect(item)}
                className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-xs font-medium text-tx transition-colors hover:bg-s2 ${
                  idx === 0 ? "bg-s2" : ""
                }`}
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
