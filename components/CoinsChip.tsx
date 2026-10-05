"use client";

import React, { useState, useEffect, useRef } from "react";
import { Coins } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatNumber } from "@/lib/i18n";

interface CoinsChipProps {
  value: number;
}

export function CoinsChip({ value }: CoinsChipProps) {
  const { dict, lang } = useApp();
  const [displayValue, setDisplayValue] = useState<number>(value);
  const [popup, setPopup] = useState<{ text: string; isPositive: boolean } | null>(null);
  const [isFlashing, setIsFlashing] = useState<boolean>(false);

  const prevValueRef = useRef<number>(value);
  const isInitialMount = useRef<boolean>(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      prevValueRef.current = value;
      setDisplayValue(value);
      return;
    }

    const prev = prevValueRef.current;
    if (prev === value) return;

    const diff = value - prev;
    const isPositive = diff > 0;
    const popupText = isPositive ? `+${diff}` : `${diff}`;

    setPopup({ text: popupText, isPositive });
    setIsFlashing(true);

    const flashTimeout = setTimeout(() => setIsFlashing(false), 400);
    const popupTimeout = setTimeout(() => setPopup(null), 1200);

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      setDisplayValue(value);
    } else {
      const startTime = performance.now();
      const duration = 350;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const current = Math.round(prev + diff * progress);
        setDisplayValue(current);

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          setDisplayValue(value);
        }
      };

      requestAnimationFrame(animate);
    }

    prevValueRef.current = value;

    return () => {
      clearTimeout(flashTimeout);
      clearTimeout(popupTimeout);
    };
  }, [value]);

  return (
    <div className="relative inline-flex items-center">
      <div
        title={dict.topbar.coinsTooltip}
        className={`group relative overflow-hidden flex items-center gap-1.5 rounded-xl border border-go/30 bg-gradient-to-r from-[#211a0c] to-[#121117] px-2.5 py-1 text-xs font-bold text-go transition-all duration-300 hover:border-go hover:shadow-[0_0_12px_rgba(214,169,74,0.3)] ${
          isFlashing ? "border-go bg-go/20 shadow-[0_0_14px_rgba(214,169,74,0.5)]" : ""
        }`}
      >
        <Coins size={14} className="text-go flex-none drop-shadow-[0_0_4px_rgba(214,169,74,0.6)]" />
        <span className="font-mono tabular-nums">{formatNumber(lang, displayValue)}</span>

        {/* Hover shine effect */}
        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 ease-in-out group-hover:translate-x-full motion-reduce:hidden" />
      </div>

      {popup && (
        <span
          className={`absolute -top-3 right-0 -translate-y-full text-[11px] font-extrabold animate-bounce pointer-events-none ${
            popup.isPositive ? "text-go drop-shadow-[0_0_6px_#d6a94a]" : "text-mu opacity-75"
          }`}
        >
          {popup.text}
        </span>
      )}
    </div>
  );
}
