"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/context";
import { Search, X } from "lucide-react";
import { formatString } from "@/lib/i18n";

export function SearchModal() {
  const router = useRouter();
  const { isSearchOpen, setSearchOpen, showToast, dict } = useApp();
  const [query, setQuery] = useState("");

  if (!isSearchOpen) return null;

  const searchTargets = [
    { label: dict.search.targets.home, href: "/" },
    { label: dict.search.targets.journal, href: "/journal" },
    { label: dict.search.targets.journalTrades, href: "/journal?tab=trades" },
    { label: dict.search.targets.market, href: "/market" },
    { label: dict.search.targets.quests, href: "/quests" },
    { label: dict.search.targets.community, href: "/community" },
    { label: dict.search.targets.academy, href: "/academy" },
    { label: dict.search.targets.profile, href: "/profile" },
    { label: dict.search.targets.plans, href: "/plans" },
    { label: dict.search.targets.addTrade, action: dict.addModal.actions.trade },
    { label: dict.search.targets.addNote, action: dict.addModal.actions.note },
    { label: dict.search.targets.addEmotion, action: dict.addModal.actions.emotion },
    { label: dict.search.targets.addPost, action: dict.addModal.actions.post },
    { label: dict.search.targets.addEvent, action: dict.addModal.actions.event },
  ];

  const filtered = searchTargets
    .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  const handleSelect = (item: (typeof searchTargets)[0]) => {
    setSearchOpen(false);
    setQuery("");
    if (item.href) {
      router.push(item.href);
    } else if (item.action) {
      showToast(formatString(dict.search.formToast, { action: item.action }));
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
            placeholder={dict.search.placeholder}
            className="w-full rounded-xl border border-line bg-s2 py-2.5 pl-10 pr-10 text-sm text-tx placeholder-mu focus:border-vi focus:outline-none"
          />
          <button
            onClick={() => {
              setSearchOpen(false);
              setQuery("");
            }}
            className="absolute right-3 text-mu hover:text-tx"
            aria-label={dict.addModal.close}
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-1">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-xs text-mu">{dict.search.empty}</div>
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
