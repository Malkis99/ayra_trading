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

const mobileItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/market", label: "Market", icon: TrendingUp },
  { href: "/quests", label: "Quests", icon: CheckSquare },
  { href: "/community", label: "Community", icon: Users },
  { href: "/academy", label: "Academy", icon: GraduationCap },
];

export function BottomNav() {
  const pathname = usePathname();

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
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
