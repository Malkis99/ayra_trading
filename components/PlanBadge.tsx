"use client";

import React from "react";
import Link from "next/link";
import { Star, Crown } from "lucide-react";

interface PlanBadgeProps {
  plan: "Free" | "Pro" | "Elite";
  className?: string;
}

export function PlanBadge({ plan, className = "" }: PlanBadgeProps) {
  let badgeStyles = "";
  let icon = <Star size={12} className="flex-none" />;

  if (plan === "Free") {
    badgeStyles =
      "border border-vi/40 bg-s2/80 text-mu hover:border-vi hover:text-tx hover:shadow-[0_0_12px_rgba(163,138,209,0.25)]";
    icon = <Star size={12} className="flex-none text-mu" />;
  } else if (plan === "Pro") {
    badgeStyles =
      "border border-vi bg-gradient-to-r from-[#50348f] to-[#7c51d3] text-white shadow-[0_0_12px_rgba(124,81,211,0.35)] hover:shadow-[0_0_18px_rgba(163,138,209,0.5)]";
    icon = <Crown size={12} className="flex-none text-vi-lt" />;
  } else {
    badgeStyles =
      "border border-go bg-gradient-to-r from-[#8a6a24] via-[#d6a94a] to-[#f3cf7a] text-black font-bold shadow-[0_0_12px_rgba(214,169,74,0.4)] hover:shadow-[0_0_20px_rgba(243,207,122,0.6)]";
    icon = <Crown size={12} className="flex-none text-black fill-black" />;
  }

  return (
    <Link
      href="/plans"
      className={`inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-semibold transition-all duration-300 ${badgeStyles} ${className}`}
      title={`Plan: ${plan}`}
    >
      {icon}
      <span>{plan}</span>
    </Link>
  );
}
