"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Search, Plus, Bell, LogIn } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { Character } from "@/components/Character";
import { CoinsChip } from "@/components/CoinsChip";
import { SyncBadge } from "@/components/SyncBadge";
import { FRAMES } from "@/lib/items";

export function Topbar() {
  const {
    dict,
    focusMode,
    setFocusMode,
    setAddModalOpen,
    setSearchOpen,
    showToast,
    lang,
    setLanguage,
  } = useApp();

  const { gameState } = useGame();
  const { isPublicVisitor, authState, isConfigured } = useAuth();
  // Personal badges (coins, plan, notifications) exist only for a signed-in account.
  const isSignedIn = authState === "authenticated";
  const [isProfileMenuOpen, setProfileMenuOpen] = useState(false);

  const frameColor = FRAMES[gameState.frame]?.color || "#a38ad1";

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-1.5 border-b border-line bg-[#121117cc] px-3 backdrop-blur-md sm:gap-2.5 sm:px-4">
      {/* Compact Search Trigger (~120px on sm+, icon-only on mobile) */}
      <button
        onClick={() => setSearchOpen(true)}
        className="flex w-9 sm:w-[120px] items-center justify-center sm:justify-start gap-2 rounded-xl border border-line bg-white/5 p-2 sm:px-3 sm:py-1.5 text-xs text-mu transition-colors hover:border-vi"
        aria-label={dict.topbar.search}
      >
        <Search size={14} className="flex-none" />
        <span className="hidden sm:inline truncate">{dict.topbar.search}</span>
      </button>

      {/* Add Button ("Добавить" / "Add") */}
      <button
        onClick={() => setAddModalOpen(true)}
        aria-label={dict.topbar.add}
      className="btn flex flex-none items-center gap-1 text-xs py-1.5 px-2.5 sm:px-3"
      >
        <Plus size={16} aria-hidden="true" />
        <span className="hidden sm:inline">{dict.topbar.add}</span>
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

      {isSignedIn ? (
        <>
          <CoinsChip value={gameState.coins} />

          {/* Cloud sync (only with sync on for this account): coins → cloud → bell → plan → avatar */}
          <SyncBadge />

          <button
            onClick={() => showToast(dict.topbar.notificationsToast)}
            className="rounded-xl border border-line bg-s1 p-2 text-mu transition-colors hover:border-vi hover:text-tx"
            aria-label={dict.topbar.notifications}
          >
            <Bell size={16} />
          </button>

          {/* Plan chip after the bell; on phones the avatar stays last */}
          <Link
            href="/plans"
            className="rounded-xl border border-go bg-go/10 px-2 py-1 text-xs font-semibold text-go transition-colors hover:bg-go/20 flex-none sm:px-3"
          >
            ★ {gameState.plan}
          </Link>
        </>
      ) : (
        <>
          {/* Guests: only the language switch and the sign-in entry */}
          <div className="flex flex-none items-center rounded-xl border border-line bg-s1 p-0.5" role="group" aria-label={dict.settings.languageLabel}>
            {(["ru", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={lang === l}
                onClick={() => setLanguage(l)}
                className={`h-7 min-w-[32px] rounded-lg px-1.5 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi ${
                  lang === l ? "bg-pri text-white" : "text-mu hover:text-tx"
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          {isConfigured && (
            <Link
              href="/login"
              aria-label={dict.publicHome.signInBtn}
              className="flex h-9 flex-none items-center gap-1.5 rounded-xl border border-vi/50 bg-pri/25 px-2.5 text-xs font-semibold text-tx transition-colors hover:bg-pri/40 sm:px-3"
            >
              <LogIn size={15} aria-hidden="true" />
              <span className="hidden sm:inline">{dict.publicHome.signInBtn}</span>
            </Link>
          )}
        </>
      )}

      {/* Avatar (Mobile Topbar) */}
      {!isPublicVisitor && (
      <div className="relative md:hidden">
        <button
          onClick={() => setProfileMenuOpen((prev) => !prev)}
          className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-full border-2 bg-[#241d3a]"
          style={{ borderColor: frameColor }}
          aria-label={dict.topbar.profile}
        >
          <Character appearance={gameState.profile.appearance} equipment={gameState.equipment} size="avatar" />
          <small className="absolute -bottom-1 -right-1 rounded bg-go px-1 text-[8px] font-bold text-black">
            {gameState.level}
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
      )}
    </header>
  );
}
