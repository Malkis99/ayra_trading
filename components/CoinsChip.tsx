"use client";

import React, { useState, useEffect, useRef } from "react";
import { Coins } from "lucide-react";
import { useApp } from "@/lib/context";

interface CoinsChipProps {
  value: number;
}

export function CoinsChip({ value }: CoinsChipProps) {
  const { dict } = useApp();
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

    // Check prefers-reduced-motion
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
        className={`flex items-center gap-1.5 rounded-xl border border-line bg-s1 px-2.5 py-1 text-xs font-bold text-go transition-all duration-300 ${
          isFlashing ? "border-go bg-go/20 shadow-[0_0_12px_#d6a94a66]" : ""
        }`}
      >
        <Coins size={14} className="text-go flex-none" />
        <span className="font-mono tabular-nums">{displayValue}</span>
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
