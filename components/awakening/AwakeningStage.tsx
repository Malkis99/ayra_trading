"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bitcoin, CandlestickChart, DollarSign, Flame, Gem, LineChart, Shapes, type LucideIcon } from "lucide-react";
import type { AvatarAppearance } from "@/lib/avatar";
import { Character } from "@/components/Character";
import { cn } from "@/components/ui/cn";
import {
  STAGE_PARTICLES_DESKTOP,
  STAGE_PARTICLES_MOBILE,
  TONE_COLORS,
  sceneKey,
  type SceneState,
  type SceneSymbol,
} from "@/lib/awakening-scene";
import { usePageVisible } from "./usePageVisible";

const SYMBOL_ICON: Record<SceneSymbol, LucideIcon> = {
  fx: DollarSign,
  index: LineChart,
  metal: Gem,
  energy: Flame,
  stock: CandlestickChart,
  crypto: Bitcoin,
  other: Shapes,
};

const PACE_SECONDS = { calm: 18, steady: 12, fast: 7 };

/** Deterministic pseudo-random numbers so server and client render the same particles. */
function seeded(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

type Props = {
  appearance: AvatarAppearance;
  equipment: Record<string, number>;
  scene: SceneState;
  label: string;
  className?: string;
};

/**
 * Living stage behind the character: soft light in the aura tone, slow particles, floor reflection,
 * orbiting market symbols, light parallax from the mouse (not on touch screens).
 * A short light pulse plays only when the scene visibly changes.
 */
export function AwakeningStage({ appearance, equipment, scene, label, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = usePageVisible();
  const [pulse, setPulse] = useState(0);
  const key = sceneKey(scene);
  const appearanceKey = `${appearance.skinTone}|${appearance.hairstyle}|${appearance.hairColor}|${appearance.outfit}`;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setPulse((p) => p + 1);
  }, [key, appearanceKey]);

  // Parallax only for fine pointers (mouse / trackpad)
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia?.("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--px", ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
        el.style.setProperty("--py", ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
      });
    };
    const onLeave = () => {
      el.style.setProperty("--px", "0");
      el.style.setProperty("--py", "0");
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  const [light, deep] = TONE_COLORS[scene.tone];
  const particles = useMemo(
    () =>
      Array.from({ length: STAGE_PARTICLES_DESKTOP }, (_, i) => ({
        left: seeded(i, 1) * 100,
        top: seeded(i, 2) * 100,
        size: 2 + seeded(i, 3) * 3,
        delay: -seeded(i, 4) * 12,
        mobile: i < STAGE_PARTICLES_MOBILE,
      })),
    []
  );
  const filter = `saturate(${0.35 + scene.awaken * 0.65}) brightness(${0.55 + scene.awaken * 0.45})`;

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      data-testid="awakening-stage"
      data-scene={key}
      className={cn("relative isolate overflow-hidden rounded-2xl border border-vi/25 bg-[#0d0c12]", !visible && "[&_*]:[animation-play-state:paused]", className)}
      style={{ "--tone": light, "--tone-deep": deep } as React.CSSProperties}
    >
      {/* light */}
      <div
        aria-hidden="true"
        className="absolute inset-0 transition-[background] duration-700"
        style={{
          background: `radial-gradient(60% 55% at 50% 42%, rgb(var(--tone) / ${0.18 + scene.intensity * 0.22}), transparent 70%), radial-gradient(90% 60% at 50% 100%, rgb(var(--tone-deep) / 0.45), transparent 70%)`,
          transform: "translate3d(calc(var(--px,0) * -14px), calc(var(--py,0) * -10px), 0)",
        }}
      />
      {/* particles */}
      <div aria-hidden="true" className="absolute inset-0" style={{ transform: "translate3d(calc(var(--px,0) * -26px), calc(var(--py,0) * -18px), 0)" }}>
        {particles.map((p, i) => (
          <span
            key={i}
            className={cn("absolute rounded-full motion-safe:animate-[ayraDrift_var(--dur)_linear_infinite]", !p.mobile && "hidden md:block")}
            style={
              {
                left: `${p.left}%`,
                top: `${p.top}%`,
                width: p.size,
                height: p.size,
                background: `rgb(var(--tone) / 0.7)`,
                boxShadow: `0 0 8px rgb(var(--tone) / 0.8)`,
                animationDelay: `${p.delay}s`,
                "--dur": `${PACE_SECONDS[scene.pace]}s`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      {/* orbiting symbols */}
      {scene.symbols.length > 0 && (
        <div aria-hidden="true" className="absolute left-1/2 top-[44%] h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2">
          <div className="absolute inset-0 rounded-full border border-dashed opacity-30" style={{ borderColor: `rgb(var(--tone) / 0.6)` }} />
          <div className="absolute inset-0 motion-safe:animate-[spin_40s_linear_infinite]">
            {scene.symbols.map((sym, i) => {
              const Icon = SYMBOL_ICON[sym];
              const angle = (i / scene.symbols.length) * Math.PI * 2;
              return (
                <span
                  key={sym}
                  className="absolute grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-ink/70 motion-safe:animate-[ayraPop_300ms_ease-out]"
                  style={{ left: `${50 + 50 * Math.cos(angle)}%`, top: `${50 + 50 * Math.sin(angle)}%`, borderColor: `rgb(var(--tone) / 0.6)`, color: `rgb(var(--tone))` }}
                >
                  <Icon size={16} />
                </span>
              );
            })}
          </div>
        </div>
      )}
      {/* character + reflection */}
      <div
        className="absolute inset-x-0 bottom-[12%] top-[6%] flex items-end justify-center"
        style={{ transform: "translate3d(calc(var(--px,0) * 8px), calc(var(--py,0) * 6px), 0)" }}
      >
        <div className="relative h-full" style={{ aspectRatio: "100 / 230" }}>
          <div
            aria-hidden="true"
            className="absolute -bottom-3 left-1/2 h-6 w-[70%] -translate-x-1/2 rounded-[50%] blur-md"
            style={{ background: `rgb(var(--tone) / ${0.25 + scene.intensity * 0.25})` }}
          />
          <div className="relative h-full w-full transition-[filter] duration-500" style={{ filter }}>
            <Character appearance={appearance} equipment={equipment} size="fill" className="h-full w-full" />
          </div>
          {/* floor reflection */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-full h-[22%] w-full overflow-hidden opacity-20 [mask-image:linear-gradient(to_bottom,black,transparent)]"
          >
            <div className="h-[455%] w-full -scale-y-100" style={{ filter }}>
              <Character appearance={appearance} equipment={equipment} size="fill" className="h-full w-full" />
            </div>
          </div>
        </div>
      </div>
      {/* transition pulse */}
      {pulse > 0 && (
        <div
          key={pulse}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 motion-safe:animate-[ayraPulse_380ms_ease-out_forwards] motion-reduce:hidden"
          style={{ background: `radial-gradient(45% 40% at 50% 45%, rgb(var(--tone) / 0.35), transparent 70%)` }}
        />
      )}
    </div>
  );
}
