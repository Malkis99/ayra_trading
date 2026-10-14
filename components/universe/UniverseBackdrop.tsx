"use client";

import React, { useMemo } from "react";
import { cn } from "@/components/ui/cn";
import { usePageVisible, usePrefersReducedMotion } from "@/components/awakening/usePageVisible";

/** PLACEHOLDER limits for the star particles (performance on mid-range phones). */
export const UNIVERSE_STARS_DESKTOP = 36;
export const UNIVERSE_STARS_MOBILE = 16;

/** Deterministic pseudo-random numbers so server and client render the same stars. */
function seeded(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Calm "universe" background for the sign-in pages: graphite, a deep violet nebula and a few slow stars.
 * Reduced motion: static background without stars. Stars pause while the tab is hidden.
 */
export function UniverseBackdrop({ className }: { className?: string }) {
  const visible = usePageVisible();
  const reduced = usePrefersReducedMotion();
  const stars = useMemo(
    () =>
      Array.from({ length: UNIVERSE_STARS_DESKTOP }, (_, i) => ({
        left: seeded(i, 1) * 100,
        top: seeded(i, 2) * 100,
        size: 1 + seeded(i, 3) * 2,
        delay: -seeded(i, 4) * 9,
        dur: 6 + seeded(i, 5) * 8,
        mobile: i < UNIVERSE_STARS_MOBILE,
      })),
    []
  );

  return (
    <div aria-hidden="true" className={cn("pointer-events-none fixed inset-0 -z-0 overflow-hidden bg-[#0b0a10]", className)}>
      {/* nebula */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 45% at 50% 45%, rgba(80,52,143,0.38), transparent 70%), radial-gradient(40% 35% at 18% 20%, rgba(163,138,209,0.14), transparent 70%), radial-gradient(45% 40% at 85% 85%, rgba(80,52,143,0.28), transparent 70%), linear-gradient(180deg, #0b0a10 0%, #100d1a 55%, #0b0a10 100%)",
        }}
      />
      {/* stars */}
      {!reduced && (
        <div className={cn("absolute inset-0 motion-reduce:hidden", !visible && "[&_*]:[animation-play-state:paused]")}>
          {stars.map((s, i) => (
            <span
              key={i}
              className={cn("absolute rounded-full bg-[#d9cdf3] motion-safe:animate-[ayraTwinkle_var(--dur)_ease-in-out_infinite]", !s.mobile && "hidden md:block")}
              style={
                {
                  left: `${s.left}%`,
                  top: `${s.top}%`,
                  width: s.size,
                  height: s.size,
                  opacity: 0.5,
                  boxShadow: "0 0 6px rgba(190,168,235,0.8)",
                  animationDelay: `${s.delay}s`,
                  "--dur": `${s.dur}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}
      {/* vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_50%,transparent_55%,rgba(0,0,0,0.55))]" />
    </div>
  );
}

/** Centred column on top of the universe background (sign-in, auth routing pages). */
export function UniverseScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-[100dvh] w-full items-center justify-center overflow-x-hidden px-4 pb-10 pt-16 text-tx sm:py-16">
      <UniverseBackdrop />
      <div className="relative z-10 flex w-full justify-center">{children}</div>
    </div>
  );
}

/** Glass card used on the sign-in pages: blur, thin violet border, soft glow behind, gentle rise on appear. */
export function UniverseCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="relative w-full max-w-[420px] motion-safe:animate-[ayraRise_500ms_ease-out]">
      <div aria-hidden="true" className="absolute -inset-6 rounded-[32px] bg-pri/25 blur-3xl" />
      <div className={cn("relative rounded-2xl border border-vi/30 bg-[#15131d]/70 p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl sm:p-8", className)}>
        {children}
      </div>
    </div>
  );
}

/** Centred spinner on the universe background (auth routing, loading). */
export function UniverseLoader({ label }: { label?: string }) {
  return (
    <UniverseScreen>
      <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
        <span className="font-serif text-2xl font-bold tracking-[0.3em] text-tx">AYRA</span>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-vi/30 border-t-vi motion-reduce:animate-none" aria-hidden="true" />
        {label && <span className="text-sm text-mu">{label}</span>}
      </div>
    </UniverseScreen>
  );
}
