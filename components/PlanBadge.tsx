"use client";

import React from "react";
import { Star, Crown } from "lucide-react";

interface PlanBadgeProps {
  plan: "Free" | "Pro" | "Elite";
  className?: string;
}

export function PlanBadge({ plan, className = "" }: PlanBadgeProps) {
  if (plan === "Elite") {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-lg border border-[#ffd700]/60 bg-gradient-to-r from-[#d6a94a22] via-[#ffd70033] to-[#d6a94a22] px-2.5 py-1 text-xs font-black uppercase tracking-wider text-[#ffd700] shadow-[0_0_12px_#d6a94a44] transition-all hover:scale-105 ${className}`}
      >
        <Crown size={13} className="text-[#ffd700] fill-[#ffd700]" />
        <span>Elite</span>
      </div>
    );
  }

  if (plan === "Pro") {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-lg border border-vi/60 bg-gradient-to-r from-[#50348f33] to-[#a38ad133] px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-[#c2a3f0] shadow-[0_0_8px_#50348f44] transition-all hover:scale-105 ${className}`}
      >
        <Star size={13} className="text-[#a38ad1] fill-[#a38ad1]" />
        <span>Pro</span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-lg border border-line bg-s2/80 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-mu transition-all hover:border-vi/40 ${className}`}
    >
      <span className="w-2 h-2 rounded-full bg-mu/60" />
      <span>Free</span>
    </div>
  );
}
