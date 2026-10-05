"use client";

import React from "react";
import { Users, UserCheck, ThumbsUp } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatNumber } from "@/lib/i18n";

export function FollowersBlock() {
  const { dict, showToast, lang } = useApp();

  const handleCardClick = () => {
    showToast(dict.followers.soonToast);
  };

  const cards = [
    {
      id: "subscribers",
      label: dict.followers.subscribers,
      count: 0,
      icon: <Users size={18} className="text-vi-lt" />,
    },
    {
      id: "subscriptions",
      label: dict.followers.subscriptions,
      count: 0,
      icon: <UserCheck size={18} className="text-blue-400" />,
    },
    {
      id: "helpful",
      label: dict.followers.helpful,
      count: 0,
      icon: <ThumbsUp size={18} className="text-go" />,
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {cards.map((card) => (
        <button
          key={card.id}
          onClick={handleCardClick}
          className="group relative overflow-hidden card flex flex-col items-center justify-center p-3 text-center transition-all duration-300 hover:-translate-y-0.5 hover:border-vi hover:shadow-[0_0_16px_rgba(163,138,209,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi motion-reduce:hover:transform-none"
        >
          {/* Diagonal Light Sheen Effect (~600ms) */}
          <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-600 ease-in-out group-hover:translate-x-full motion-reduce:hidden" />

          <div className="mb-1.5 flex h-8 w-8 items-center justify-center rounded-xl bg-s2/80 border border-line group-hover:border-vi/50">
            {card.icon}
          </div>

          <span className="font-serif text-xl font-bold text-tx tabular-nums">
            {formatNumber(lang, card.count)}
          </span>

          <span className="text-[11px] text-mu mt-0.5 font-medium">
            {card.label}
          </span>
        </button>
      ))}
    </div>
  );
}
