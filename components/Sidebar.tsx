"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  BookOpen,
  TrendingUp,
  CheckSquare,
  Users,
  GraduationCap,
  Settings,
  HelpCircle,
} from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { Figure } from "@/components/Figure";
import { xpForNextLevel } from "@/lib/game";
import { FRAMES, TITLES } from "@/lib/items";

export function Sidebar() {
  const pathname = usePathname();
  const { dict } = useApp();
  const { gameState } = useGame();

  const navItems = [
    { href: "/", label: dict.nav.home, icon: Home },
    { href: "/journal", label: dict.nav.journal, icon: BookOpen },
    { href: "/market", label: dict.nav.market, icon: TrendingUp },
    { href: "/quests", label: dict.nav.quests, icon: CheckSquare },
    { href: "/community", label: dict.nav.community, icon: Users },
    { href: "/academy", label: dict.nav.academy, icon: GraduationCap },
  ];

  const frameColor = FRAMES[gameState.frame]?.color || "#a38ad1";
  const titleName =
    gameState.title === 1
      ? dict.titles.titleNovice
      : gameState.title === 2
      ? dict.titles.titleDisciplined
      : gameState.title === 3
      ? dict.titles.titleStrategist
      : "";

  const nextLevelXp = xpForNextLevel(gameState.level);
  const xpPercent = Math.min(
    100,
    Math.round((gameState.xp / nextLevelXp) * 100)
  );

  return (
    <aside className="hidden h-full w-[220px] flex-col border-r border-line bg-gradient-to-b from-[#17161e] to-[#121117] p-3 md:flex">
      {/* Logo */}
      <div className="px-2.5 pb-3.5 pt-1.5 font-serif text-xl font-semibold tracking-widest text-tx">
        AYRA<b className="text-go">·</b>
      </div>

      {/* Navigation Links */}
      <nav className="flex flex-col gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-gradient-to-r from-pri/25 to-transparent text-tx"
                  : "text-mu hover:bg-s2 hover:text-tx"
              }`}
            >
              <div
                className={`grid h-7 w-7 place-items-center rounded-lg ${
                  isActive ? "bg-pri text-white" : "bg-white/5 text-mu"
                }`}
              >
                <Icon size={16} />
              </div>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Footer Area with Profile Card, Settings, Help */}
      <div className="flex flex-col gap-1.5">
        {/* Profile Card */}
        <Link
          href="/profile"
          className={`flex items-center gap-2.5 rounded-xl border border-line bg-gradient-to-b from-[#211f2b] to-[#1a1922] p-2.5 transition-colors hover:border-vi ${
            pathname === "/profile" ? "border-vi" : ""
          }`}
        >
          {/* Avatar Container */}
          <div
            className="relative grid h-10 w-10 flex-none place-items-center overflow-hidden rounded-full border-2 bg-[#241d3a]"
            style={{ borderColor: frameColor }}
          >
            <Figure equipment={gameState.equipment} width={32} height={38} />
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 w-full">
            <span className="truncate text-xs font-semibold text-tx">
              {gameState.name}
            </span>
            <span className="text-[11px] text-mu truncate">
              {dict.topbar.level} {gameState.level}
              {titleName ? ` · ${titleName}` : ` · ${dict.titles.titleNovice}`}
            </span>
            <div className="xp h-1 w-full bg-white/10">
              <i
                className="block h-full bg-vi"
                style={{ width: `${xpPercent}%` }}
              />
            </div>
            <span className="text-[10px] text-mu">{dict.topbar.reputation}</span>
          </div>
        </Link>

        {/* Settings & Help */}
        <div className="flex flex-col gap-0.5 text-xs text-mu">
          <Link
            href="/settings"
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-s2 hover:text-tx"
          >
            <Settings size={15} />
            <span>{dict.nav.settings}</span>
          </Link>
          <Link
            href="/help"
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-s2 hover:text-tx"
          >
            <HelpCircle size={15} />
            <span>{dict.nav.help}</span>
          </Link>
        </div>
      </div>
    </aside>
  );
}
