"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Search, Plus, Bell } from "lucide-react";
import { useApp } from "@/lib/context";

export function Topbar() {
  const {
    dict,
    focusMode,
    setFocusMode,
    setAddModalOpen,
    setSearchOpen,
    showToast,
    userPlan,
  } = useApp();

  const [isProfileMenuOpen, setProfileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2.5 border-b border-line bg-[#121117cc] px-4 backdrop-blur-md">
      {/* Compact Search Trigger (~120px on sm+, icon-only on mobile) */}
      <button
        onClick={() => setSearchOpen(true)}
        className="flex w-9 sm:w-[120px] items-center justify-center sm:justify-start gap-2 rounded-xl border border-line bg-white/5 p-2 sm:px-3 sm:py-1.5 text-xs text-mu transition-colors hover:border-vi"
        aria-label={dict.topbar.search}
      >
        <Search size={14} className="flex-none" />
        <span className="hidden sm:inline truncate">{dict.topbar.search}</span>
      </button>

      {/* Add Button ("＋ Добавить" in RU, "Add" in EN) */}
      <button
        onClick={() => setAddModalOpen(true)}
        className="btn flex items-center gap-1 text-xs py-1.5 px-3"
      >
        <Plus size={16} />
        <span>{dict.topbar.add}</span>
      </button>

      {/* Focus / Game Mode Switch */}
      <div className="hidden sm:flex rounded-xl border border-line bg-s1 p-0.5 text-xs">
        <button
          onClick={() => setFocusMode(true)}
          className={`rounded-lg px-2.5 py-1 transition-colors ${
            focusMode ? "bg-s2 text-tx" : "text-mu hover:text-tx"
          }`}
        >
          {dict.nav.focusMode}
        </button>
        <button
          onClick={() => setFocusMode(false)}
          className={`rounded-lg px-2.5 py-1 transition-colors ${
            !focusMode ? "bg-s2 text-tx" : "text-mu hover:text-tx"
          }`}
        >
          {dict.nav.gameMode}
        </button>
      </div>

      <div className="flex-1" />

      {/* Plan Chip */}
      <Link
        href="/plans"
        className="rounded-xl border border-go bg-go/10 px-3 py-1 text-xs font-semibold text-go transition-colors hover:bg-go/20"
      >
        ★ {userPlan}
      </Link>

      {/* Notification Bell */}
      <button
        onClick={() => showToast(dict.topbar.notificationsToast)}
        className="rounded-xl border border-line bg-s1 p-2 text-mu transition-colors hover:border-vi hover:text-tx"
        aria-label={dict.topbar.notifications}
      >
        <Bell size={16} />
      </button>

      {/* Avatar (Mobile Topbar) */}
      <div className="relative md:hidden">
        <button
          onClick={() => setProfileMenuOpen((prev) => !prev)}
          className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-full border-2 border-go bg-[#241d3a] font-serif font-bold text-tx text-xs"
          aria-label={dict.topbar.profile}
        >
          T
          <small className="absolute -bottom-1 -right-1 rounded bg-go px-1 text-[8px] font-bold text-black">
            1
          </small>
        </button>

        {isProfileMenuOpen && (
          <div className="absolute right-0 top-11 z-30 min-w-[180px] rounded-xl border border-line bg-s1 p-1.5 shadow-xl">
            <Link
              href="/profile"
              onClick={() => setProfileMenuOpen(false)}
              className="block rounded-lg px-3 py-2 text-xs text-tx hover:bg-s2"
            >
              {dict.nav.profile}
            </Link>
            <Link
              href="/profile?tab=wardrobe"
              onClick={() => setProfileMenuOpen(false)}
              className="block rounded-lg px-3 py-2 text-xs text-tx hover:bg-s2"
            >
              {dict.nav.wardrobe}
            </Link>
            <Link
              href="/profile?tab=achievements"
              onClick={() => setProfileMenuOpen(false)}
              className="block rounded-lg px-3 py-2 text-xs text-tx hover:bg-s2"
            >
              {dict.nav.achievements}
            </Link>
            <Link
              href="/settings"
              onClick={() => setProfileMenuOpen(false)}
              className="block rounded-lg px-3 py-2 text-xs text-tx hover:bg-s2"
            >
              {dict.nav.settings}
            </Link>
            <hr className="my-1 border-line" />
            <button
              onClick={() => {
                setProfileMenuOpen(false);
                showToast(dict.topbar.logoutToast);
              }}
              className="w-full text-left rounded-lg px-3 py-2 text-xs text-tx hover:bg-s2"
            >
              {dict.topbar.logout}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
