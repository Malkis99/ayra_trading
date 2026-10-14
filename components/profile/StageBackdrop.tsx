"use client";

import React from "react";
import { cn } from "@/components/ui/cn";
import type { StageBackgroundId } from "@/lib/stage-backgrounds";

/** Static star field (two layers of tiny dots), no animation. */
const STARS =
  "radial-gradient(1px 1px at 12% 18%, rgba(255,255,255,.7), transparent 60%), radial-gradient(1px 1px at 72% 12%, rgba(255,255,255,.6), transparent 60%), radial-gradient(1.5px 1.5px at 38% 34%, rgba(214,205,243,.8), transparent 60%), radial-gradient(1px 1px at 86% 42%, rgba(255,255,255,.5), transparent 60%), radial-gradient(1px 1px at 22% 58%, rgba(255,255,255,.5), transparent 60%), radial-gradient(1.5px 1.5px at 58% 8%, rgba(214,205,243,.7), transparent 60%), radial-gradient(1px 1px at 92% 70%, rgba(255,255,255,.4), transparent 60%), radial-gradient(1px 1px at 6% 80%, rgba(255,255,255,.4), transparent 60%)";

function CitySkyline() {
  // two rows of buildings with a few lit windows
  return (
    <svg aria-hidden="true" viewBox="0 0 400 140" preserveAspectRatio="none" className="absolute inset-x-0 bottom-[18%] h-[34%] w-full">
      <path d="M0 140V70h22V52h18v30h16V38h26v44h14V60h20v22h18V30h24v52h16V58h22v24h14V44h28v38h18V64h24v18h16V40h22v42h18V56h22v84z" fill="#151324" />
      <path d="M0 140V96h30V84h24v18h20V78h30v28h22V90h26v16h20V72h28v34h18V88h24v18h26V82h30v24h20V92h24v14h28v34z" fill="#1d1a31" />
      {[
        [96, 50], [104, 62], [150, 40], [158, 52], [214, 66], [268, 50], [276, 62], [330, 60], [120, 96], [246, 92],
      ].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="4" height="5" fill="#a38ad1" opacity={0.55} />
      ))}
    </svg>
  );
}

function TradingHall() {
  // back wall with a soft candlestick "chart" and floor lines
  const candles = [
    [40, 70, 40, true], [70, 60, 46, true], [100, 74, 30, false], [130, 50, 50, true], [160, 44, 40, true],
    [190, 58, 34, false], [220, 40, 46, true], [250, 34, 40, true], [280, 46, 30, false], [310, 30, 44, true], [340, 24, 40, true],
  ] as const;
  return (
    <svg aria-hidden="true" viewBox="0 0 400 200" preserveAspectRatio="none" className="absolute inset-x-0 top-[8%] h-[46%] w-full opacity-60">
      {candles.map(([x, y, h, up], i) => (
        <g key={i}>
          <line x1={x} y1={y - 8} x2={x} y2={y + h + 8} stroke={up ? "#7fd1b9" : "#e58fa6"} strokeWidth="1" opacity={0.6} />
          <rect x={x - 5} y={y} width="10" height={h} rx="1.5" fill={up ? "#7fd1b9" : "#e58fa6"} opacity={0.45} />
        </g>
      ))}
      <polyline points="20,150 80,140 140,146 200,120 260,112 320,96 380,90" fill="none" stroke="#a38ad1" strokeWidth="1.5" opacity={0.6} />
    </svg>
  );
}

function PerspectiveGrid({ color }: { color: string }) {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-x-[-30%] bottom-0 h-[38%] origin-bottom [transform:perspective(380px)_rotateX(58deg)]"
      style={{
        backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
        backgroundSize: "36px 36px",
        maskImage: "linear-gradient(to top, black 30%, transparent)",
        WebkitMaskImage: "linear-gradient(to top, black 30%, transparent)",
      }}
    />
  );
}

const BASE: Record<StageBackgroundId, string> = {
  graphite: "linear-gradient(180deg, #1b1a22 0%, #121117 60%, #0d0c11 100%)",
  nebula:
    "radial-gradient(55% 45% at 50% 38%, rgba(163,138,209,0.30), transparent 70%), radial-gradient(40% 30% at 20% 20%, rgba(80,52,143,0.35), transparent 70%), radial-gradient(90% 55% at 50% 100%, rgba(80,52,143,0.55), transparent 70%), #0e0c16",
  deep_space: `${STARS}, radial-gradient(70% 50% at 50% 100%, rgba(80,52,143,0.35), transparent 70%), #07060c`,
  night_city: "linear-gradient(180deg, #0b0a18 0%, #171230 55%, #241a44 100%)",
  trading_hall: "radial-gradient(70% 50% at 50% 30%, rgba(80,52,143,0.25), transparent 70%), linear-gradient(180deg, #121019 0%, #0e0d14 100%)",
  midnight_grid: "radial-gradient(60% 40% at 50% 60%, rgba(163,138,209,0.25), transparent 70%), linear-gradient(180deg, #08070f 0%, #120d24 100%)",
  gold_dawn:
    "radial-gradient(70% 40% at 50% 82%, rgba(214,169,74,0.38), transparent 70%), radial-gradient(50% 30% at 50% 60%, rgba(214,169,74,0.14), transparent 70%), linear-gradient(180deg, #120f1c 0%, #1c1622 60%, #2a2016 100%)",
};

/** The stage background (also used small, as a thumbnail in the picker). */
export function StageBackdrop({ id, className }: { id: StageBackgroundId; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("absolute inset-0 overflow-hidden", className)} style={{ background: BASE[id] }}>
      {id === "night_city" && <CitySkyline />}
      {id === "trading_hall" && (
        <>
          <TradingHall />
          <PerspectiveGrid color="rgba(163,138,209,0.18)" />
        </>
      )}
      {id === "midnight_grid" && <PerspectiveGrid color="rgba(163,138,209,0.35)" />}
      {/* floor */}
      <div className="absolute bottom-[6%] left-1/2 h-[7%] w-[60%] -translate-x-1/2 rounded-[50%] bg-black/45 blur-md" />
    </div>
  );
}
