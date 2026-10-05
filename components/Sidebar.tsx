"use client";

import React, { useState } from "react";
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

const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/market", label: "Market", icon: TrendingUp },
  { href: "/quests", label: "Quests", icon: CheckSquare },
  { href: "/community", label: "Community", icon: Users },
  { href: "/academy", label: "Academy", icon: GraduationCap },
];

export function Sidebar() {
  const pathname = usePathname();
  const { showToast } = useApp();

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
          <div className="relative grid h-10 w-10 flex-none place-items-center overflow-hidden rounded-full border-2 border-vi bg-[#241d3a]">
            <span className="font-serif text-sm font-bold text-tx">T</span>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-xs font-semibold text-tx">
              TraderOne
            </span>
            <span className="text-[11px] text-mu">Lv 1 · Новичок пути</span>
            <div className="xp h-1 w-full bg-white/10">
              <i className="block h-full bg-vi" style={{ width: "40%" }} />
            </div>
            <span className="text-[10px] text-mu">Репутация: Растёт</span>
          </div>
        </Link>

        {/* Settings & Help */}
        <div className="flex flex-col gap-0.5 text-xs text-mu">
          <Link
            href="/settings"
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-s2 hover:text-tx"
          >
            <Settings size={15} />
            <span>Settings</span>
          </Link>
          <Link
            href="/help"
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-s2 hover:text-tx"
          >
            <HelpCircle size={15} />
            <span>Help</span>
          </Link>
        </div>
      </div>
    </aside>
  );
}
