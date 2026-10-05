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
} from "lucide-react";
import { useApp } from "@/lib/context";

export function BottomNav() {
  const pathname = usePathname();
  const { dict } = useApp();

  const mobileItems = [
    { href: "/", label: dict.nav.home, icon: Home },
    { href: "/journal", label: dict.nav.journal, icon: BookOpen },
    { href: "/market", label: dict.nav.market, icon: TrendingUp },
    { href: "/quests", label: dict.nav.quests, icon: CheckSquare },
    { href: "/community", label: dict.nav.community, icon: Users },
    { href: "/academy", label: dict.nav.academy, icon: GraduationCap },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 flex border-t border-line bg-[#121117f2] backdrop-blur-md md:hidden">
      {mobileItems.map((item) => {
        const Icon = item.icon;
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] transition-colors ${
              isActive ? "text-tx font-semibold" : "text-mu hover:text-tx"
            }`}
          >
            <Icon size={18} />
            <span className="truncate max-w-[50px]">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
