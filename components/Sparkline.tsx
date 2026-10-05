"use client";

import React from "react";

interface SparklineProps {
  points: number[];
  isUp: boolean;
}

export function Sparkline({ points, isUp }: SparklineProps) {
  if (!points || points.length === 0) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const width = 110;
  const height = 32;

  const coords = points.map((v, i) => {
    const x = (i * width) / (points.length - 1);
    const y = height - 2 - ((v - min) / range) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const strokeColor = isUp ? "#6fd3a0" : "#e58a8a";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-8 overflow-visible">
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
