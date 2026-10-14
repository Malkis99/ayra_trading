"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import type { AvatarAppearance } from "@/lib/avatar";
import { Character } from "@/components/Character";
import { cn } from "@/components/ui/cn";
import { formatString } from "@/lib/i18n";
import { useApp } from "@/lib/context";
import { FINALE_MAX_PARTICLES_DESKTOP, FINALE_MAX_PARTICLES_MOBILE } from "@/lib/awakening-scene";
import { usePageVisible, usePrefersReducedMotion } from "./usePageVisible";

/** Timeline of the awakening (ms from start). */
export const FINALE_TIMELINE = {
  spark: 0, // a) darkness, silhouette, pulsing spark
  gather: 1200, // b) energy lines, particles converge
  flash: 3000, // c) soft flash, reveal: contour → colours → clothes → eyes
  colors: 3300,
  clothes: 3600,
  eyes: 3900,
  aura: 4000, // d) aura ring + golden orbit symbols
  title: 5200, // e) nickname, level, greeting
  summary: 6200, // f) summary card, then the start button
  start: 7400,
} as const;

export type SummaryRow = { label: string; value: string };

type Props = {
  appearance: AvatarAppearance;
  equipment: Record<string, number>;
  nickname: string;
  summary: SummaryRow[];
  onStart: () => void;
  isNavigating: boolean;
  /** The animation already played (e.g. the page was reloaded on the finale): show the final frame. */
  alreadyPlayed: boolean;
  onPlayed: () => void;
  startLabel: string;
};

/** Energy lines + converging particles, drawn on a canvas only during the "gather" phase. */
function GatherCanvas({ active, running, targetRef }: { active: boolean; running: boolean; targetRef: React.RefObject<HTMLElement> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!active || !running) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    const max = window.innerWidth < 768 ? FINALE_MAX_PARTICLES_MOBILE : FINALE_MAX_PARTICLES_DESKTOP;
    const w = () => canvas.width;
    const h = () => canvas.height;
    const particles = Array.from({ length: max }, (_, i) => {
      const angle = (i / max) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 0.45 + Math.random() * 0.4;
      return { angle, dist, speed: 0.004 + Math.random() * 0.004, size: 1 + Math.random() * 2.2 };
    });
    let frame = 0;
    let t = 0;
    const draw = () => {
      t += 1;
      // converge on the silhouette (its chest), wherever the layout puts it
      const box = canvas.getBoundingClientRect();
      const target = targetRef.current?.getBoundingClientRect();
      const cx = target ? (target.left + target.width / 2 - box.left) * dpr : w() / 2;
      const cy = target ? (target.top + target.height * 0.46 - box.top) * dpr : h() * 0.46;
      const R = Math.min(w(), h());
      ctx.clearRect(0, 0, w(), h());
      // energy lines growing from the spark
      const lines = 10;
      for (let i = 0; i < lines; i++) {
        const a = (i / lines) * Math.PI * 2 + t * 0.004;
        const len = Math.min(1, t / 90) * R * 0.32;
        const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        grad.addColorStop(0, "rgba(214,169,74,0.55)");
        grad.addColorStop(1, "rgba(163,138,209,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.2 * dpr;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        ctx.stroke();
      }
      // particles converge to the silhouette
      for (const p of particles) {
        p.dist = Math.max(0.03, p.dist - p.speed);
        p.angle += 0.01;
        const x = cx + Math.cos(p.angle) * p.dist * R;
        const y = cy + Math.sin(p.angle) * p.dist * R * 0.8;
        ctx.fillStyle = `rgba(190,168,235,${Math.min(1, 1.2 - p.dist)})`;
        ctx.beginPath();
        ctx.arc(x, y, p.size * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [active, running, targetRef]);
  return <canvas ref={ref} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-500", active ? "opacity-100" : "opacity-0")} />;
}

/** Small golden candlesticks orbiting the hero (gold only in this moment). */
function OrbitSymbols() {
  const items = Array.from({ length: 6 });
  return (
    <div aria-hidden="true" className="absolute inset-0 motion-safe:animate-[spin_24s_linear_infinite]">
      {items.map((_, i) => {
        const a = (i / items.length) * Math.PI * 2;
        const up = i % 2 === 0;
        return (
          <svg
            key={i}
            viewBox="0 0 12 28"
            className="absolute h-7 w-3 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_0_6px_rgba(214,169,74,0.8)]"
            style={{ left: `${50 + 50 * Math.cos(a)}%`, top: `${50 + 50 * Math.sin(a)}%` }}
          >
            <line x1="6" y1="0" x2="6" y2="28" stroke="#d6a94a" strokeWidth="1.2" />
            <rect x="2" y={up ? 6 : 10} width="8" height={up ? 14 : 10} rx="1.5" fill={up ? "#d6a94a" : "transparent"} stroke="#d6a94a" strokeWidth="1.4" />
          </svg>
        );
      })}
    </div>
  );
}

/**
 * The awakening finale (≈7.4 s, once). Time only advances while the tab is visible.
 * Reduced motion: a 600 ms fade to the final frame, no particles or flash.
 */
export function AwakeningFinale({ appearance, equipment, nickname, summary, onStart, isNavigating, alreadyPlayed, onPlayed, startLabel }: Props) {
  const { dict } = useApp();
  const f = dict.awakening.wow.finale;
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  const [elapsed, setElapsed] = useState(alreadyPlayed ? FINALE_TIMELINE.start : 0);
  const [fadeIn, setFadeIn] = useState(false);
  const playedRef = useRef(alreadyPlayed);
  const startBtn = useRef<HTMLButtonElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const done = elapsed >= FINALE_TIMELINE.start;

  const finish = useCallback(() => {
    setElapsed(FINALE_TIMELINE.start);
    if (!playedRef.current) {
      playedRef.current = true;
      onPlayed();
    }
  }, [onPlayed]);

  // Reduced motion: jump to the end with a soft fade
  useEffect(() => {
    if (reduced && !done) finish();
  }, [reduced, done, finish]);
  useEffect(() => {
    const t = requestAnimationFrame(() => setFadeIn(true));
    return () => cancelAnimationFrame(t);
  }, []);

  // Timeline clock (paused while the tab is hidden)
  useEffect(() => {
    if (done || reduced || !visible) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      setElapsed((e) => {
        const next = e + dt;
        return next >= FINALE_TIMELINE.start ? FINALE_TIMELINE.start : next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [done, reduced, visible]);

  useEffect(() => {
    if (done) {
      if (!playedRef.current) {
        playedRef.current = true;
        onPlayed();
      }
      startBtn.current?.focus();
    }
  }, [done, onPlayed]);

  const at = (ms: number) => elapsed >= ms;
  const T = FINALE_TIMELINE;

  // character reveal filter: silhouette → contour → colours → full
  const charFilter = !at(T.flash)
    ? "brightness(0) saturate(0)"
    : !at(T.colors)
    ? "brightness(0.35) saturate(0) contrast(1.4)"
    : !at(T.clothes)
    ? "brightness(0.8) saturate(0.4)"
    : "none";

  return (
    <section
      aria-label={f.sceneLabel}
      data-testid="awakening-finale"
      data-phase={done ? "done" : at(T.summary) ? "summary" : at(T.title) ? "title" : at(T.aura) ? "aura" : at(T.flash) ? "reveal" : at(T.gather) ? "gather" : "spark"}
      className={cn(
        "fixed inset-0 z-40 overflow-hidden bg-[#050409] text-tx transition-opacity",
        reduced ? "duration-[600ms]" : "duration-300",
        fadeIn ? "opacity-100" : "opacity-0",
        !visible && "[&_*]:[animation-play-state:paused]"
      )}
    >
      {/* ambient light grows */}
      <div
        aria-hidden="true"
        className="absolute inset-0 transition-opacity duration-1000"
        style={{
          opacity: at(T.aura) ? 1 : at(T.gather) ? 0.55 : 0.15,
          background: "radial-gradient(80% 50% at 50% 100%, rgba(80,52,143,0.5), transparent 70%)",
        }}
      />
      {!reduced && <GatherCanvas active={at(T.gather) && !at(T.aura)} running={visible} targetRef={heroRef} />}


      <div className="relative mx-auto flex h-full max-w-[1280px] flex-col items-center justify-center gap-4 px-4 pb-24 pt-10 md:flex-row md:gap-16 md:px-10 md:pb-10">
        {/* hero */}
        <div ref={heroRef} className="relative flex h-[50dvh] shrink-0 items-center justify-center md:h-[72dvh]" style={{ aspectRatio: "100 / 230" }}>
          {/* light around the hero */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-[46%] aspect-square w-[420%] -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-1000"
            style={{ opacity: at(T.aura) ? 1 : at(T.gather) ? 0.55 : 0.15, background: "radial-gradient(closest-side, rgba(163,138,209,0.32), transparent 75%)" }}
          />
          {/* soft flash (single, ~650ms, no strobe) */}
          {!reduced && at(T.flash) && !at(T.flash + 700) && (
            <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[46%] z-10 -ml-[150%] -mt-[150%] aspect-square w-[300%] rounded-full motion-safe:animate-[ayraPulse_650ms_ease-out_forwards]" style={{ background: "radial-gradient(closest-side, rgba(255,247,230,0.6), transparent 80%)" }} />
          )}
          {/* aura ring */}
          <div
            aria-hidden="true"
            className={cn(
              "absolute left-1/2 top-[46%] aspect-square w-[260%] -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-1000",
              at(T.aura) ? "scale-100 opacity-100" : "scale-75 opacity-0"
            )}
          >
            <div className="absolute inset-[18%] rounded-full border border-go/50 shadow-[0_0_40px_rgba(214,169,74,0.35),inset_0_0_40px_rgba(163,138,209,0.25)]" />
            <div className="absolute inset-[26%] rounded-full border border-dashed border-vi/40 motion-safe:animate-[spin_60s_linear_infinite_reverse]" />
            <div className="absolute inset-[18%]">{at(T.aura) && <OrbitSymbols />}</div>
          </div>
          {/* floor */}
          <div aria-hidden="true" className="absolute -bottom-2 left-1/2 h-8 w-[90%] -translate-x-1/2 rounded-[50%] bg-vi/30 blur-xl" />
          <div className="relative h-full w-full transition-[filter] duration-300" style={{ filter: charFilter }}>
            <Character appearance={appearance} equipment={equipment} size="fill" className="h-full w-full" />
            {/* eyes light up */}
            <svg aria-hidden="true" viewBox="0 0 100 230" preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 h-full w-full">
              <g className={cn("transition-opacity duration-500", at(T.eyes) && !done ? "opacity-100" : "opacity-0")}>
                <circle cx="44" cy="35" r="2.6" fill="#f3e3b5" style={{ filter: "drop-shadow(0 0 2px #d6a94a)" }} />
                <circle cx="56" cy="35" r="2.6" fill="#f3e3b5" style={{ filter: "drop-shadow(0 0 2px #d6a94a)" }} />
              </g>
            </svg>
          </div>
          {/* spark */}
          {!at(T.flash) && (
            <span aria-hidden="true" className="absolute z-10 left-1/2 top-[46%] -ml-2 -mt-2 h-4 w-4 rounded-full bg-go shadow-[0_0_24px_8px_rgba(214,169,74,0.55)] motion-safe:animate-[ayraBreath_1.1s_ease-in-out_infinite]" />
          )}
        </div>

        {/* title + summary */}
        <div className="flex w-full max-w-md flex-col items-center gap-4 text-center md:items-start md:text-left">
          <div className={cn("space-y-1 transition-all duration-700", at(T.title) ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")}>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-go">{f.awakened}</p>
            <h1 className="break-all font-serif text-4xl font-bold leading-tight text-tx md:text-6xl" data-testid="finale-nickname">
              {nickname}
            </h1>
            <p className="font-serif text-xl text-vi md:text-2xl">{formatString(f.level, { level: 1 })}</p>
            <p className="pt-1 text-sm text-mu md:text-base">{f.greeting}</p>
          </div>

          {summary.length > 0 && (
            <dl
              className={cn(
                "w-full space-y-2 rounded-xl border border-vi/30 bg-s1/70 p-4 text-left backdrop-blur transition-all duration-700",
                at(T.summary) ? "translate-x-0 opacity-100" : "translate-x-10 opacity-0"
              )}
            >
              <dt className="sr-only">{f.summaryTitle}</dt>
              <p className="text-xs font-semibold uppercase tracking-wide text-mu" aria-hidden="true">
                {f.summaryTitle}
              </p>
              {summary.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-3 text-sm">
                  <dt className="text-mu">{row.label}</dt>
                  <dd className="text-right font-semibold text-tx">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className={cn("fixed inset-x-4 bottom-5 md:relative md:inset-auto md:bottom-auto md:w-full", done ? "opacity-100" : "pointer-events-none opacity-0")}>
            {done && (
              <>
              {/* soft pulse behind the button (the button itself stays still so it is easy to hit) */}
              <span aria-hidden="true" className="pointer-events-none absolute -inset-1 rounded-2xl bg-vi/35 blur-md motion-safe:animate-[ayraBreath_2.4s_ease-in-out_infinite]" />
              <button
                ref={startBtn}
                type="button"
                onClick={onStart}
                disabled={isNavigating}
                className="group relative flex h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-pri via-[#6b4bb4] to-pri text-base font-semibold text-white shadow-[0_10px_30px_-8px_rgba(163,138,209,0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-go focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:cursor-wait disabled:opacity-70"
              >
                {isNavigating ? (
                  <Loader2 size={20} className="animate-spin" aria-hidden="true" />
                ) : (
                  <>
                    <span>{startLabel}</span>
                    <ArrowRight size={18} aria-hidden="true" className="transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </button>
              </>
            )}
          </div>
        </div>
      </div>

      {!done && (
        <button
          type="button"
          onClick={finish}
          className="absolute right-4 top-4 rounded-md px-3 py-2 text-xs text-mu/80 hover:bg-white/5 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
        >
          {f.skip}
        </button>
      )}
    </section>
  );
}
