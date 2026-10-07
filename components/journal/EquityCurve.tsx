"use client";

import React, { useState } from "react";
import { EquityPoint } from "@/lib/journal/stats";

interface EquityCurveProps {
  points: EquityPoint[];
  unit: "R" | "money" | "percent";
  currencySymbol?: string;
  dict: any;
}

export const EquityCurve: React.FC<EquityCurveProps> = ({
  points,
  unit,
  currencySymbol = "$",
  dict,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!points || points.length === 0) {
    return (
      <div className="card p-8 text-center border-dashed space-y-2">
        <p className="text-xs text-mu">{dict.journal.dashboard.equityCurve.emptyState}</p>
      </div>
    );
  }

  // Extract numeric Y values based on unit
  const getYValue = (pt: EquityPoint) => {
    if (unit === "R") return pt.rMultipleCum;
    if (unit === "percent") return pt.percentCum ?? 0;
    return pt.moneyCum ?? 0;
  };

  const yValues = points.map(getYValue);
  const minY = Math.min(0, ...yValues);
  const maxY = Math.max(1, ...yValues);
  const yRange = maxY - minY || 1;

  const width = 600;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 35, left: 45 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Map data points to SVG coordinates
  const svgPoints = points.map((pt, idx) => {
    const x = padding.left + (idx / Math.max(1, points.length - 1)) * chartWidth;
    const yVal = getYValue(pt);
    const y = padding.top + chartHeight - ((yVal - minY) / yRange) * chartHeight;
    return { x, y, pt, yVal };
  });

  // Zero Y line
  const zeroY = padding.top + chartHeight - ((0 - minY) / yRange) * chartHeight;

  // Line path d attribute
  const pathD = svgPoints.reduce((acc, p, i) => {
    return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
  }, "");

  // Gradient fill path
  const fillD = `${pathD} L ${svgPoints[svgPoints.length - 1].x} ${padding.top + chartHeight} L ${svgPoints[0].x} ${padding.top + chartHeight} Z`;

  const formatValue = (val: number) => {
    if (unit === "R") return `${val > 0 ? "+" : ""}${val.toFixed(2)} R`;
    if (unit === "percent") return `${val > 0 ? "+" : ""}${val.toFixed(2)}%`;
    return `${val > 0 ? "+" : ""}${val.toFixed(0)} ${currencySymbol}`;
  };

  const activePoint = hoverIndex !== null ? svgPoints[hoverIndex] : null;

  // Accessible text description
  const startVal = yValues[0];
  const endVal = yValues[yValues.length - 1];
  const accessibleLabel = `Equity curve chart with ${points.length} points. Starting value ${formatValue(
    startVal
  )}, ending value ${formatValue(endVal)}, peak ${formatValue(maxY)}, trough ${formatValue(minY)}.`;

  return (
    <div className="card p-4 space-y-3 relative">
      <div className="flex justify-between items-center">
        <h4 className="h4 text-sm font-serif">{dict.journal.dashboard.equityCurve.title}</h4>
        <span className="text-[11px] text-mu font-mono">
          {points.length} {dict.journal.tradesWord}
        </span>
      </div>

      <div className="relative w-full overflow-hidden select-none">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible cursor-crosshair"
          aria-label={accessibleLabel}
          role="img"
          onMouseLeave={() => setHoverIndex(null)}
          onTouchEnd={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line
            x1={padding.left}
            y1={zeroY}
            x2={width - padding.right}
            y2={zeroY}
            stroke="#334155"
            strokeDasharray="3 3"
            strokeWidth="1"
          />

          {/* Fill Gradient */}
          <path d={fillD} fill="url(#equityGradient)" />

          {/* SVG Line */}
          <path
            d={pathD}
            fill="none"
            stroke="#a855f7"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Hover interactive areas & dots */}
          {svgPoints.map((p, idx) => (
            <g
              key={idx}
              onMouseEnter={() => setHoverIndex(idx)}
              onTouchStart={() => setHoverIndex(idx)}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={hoverIndex === idx ? 5 : 2.5}
                className={`transition-all ${
                  hoverIndex === idx
                    ? "fill-white stroke-purple-500 stroke-2"
                    : "fill-purple-400 opacity-60"
                }`}
              />
              {/* Invisible touch target area */}
              <rect
                x={p.x - 10}
                y={padding.top}
                width={20}
                height={chartHeight}
                fill="transparent"
              />
            </g>
          ))}

          {/* Vertical hover line */}
          {activePoint && (
            <line
              x1={activePoint.x}
              y1={padding.top}
              x2={activePoint.x}
              y2={padding.top + chartHeight}
              stroke="#cbd5e1"
              strokeDasharray="2 2"
              strokeWidth="1"
            />
          )}

          {/* Y Axis Labels */}
          <text
            x={padding.left - 6}
            y={padding.top + 10}
            textAnchor="end"
            className="text-[10px] fill-slate-400 font-mono"
          >
            {formatValue(maxY)}
          </text>
          <text
            x={padding.left - 6}
            y={padding.top + chartHeight - 4}
            textAnchor="end"
            className="text-[10px] fill-slate-400 font-mono"
          >
            {formatValue(minY)}
          </text>

          {/* X Axis Date Labels (Start, Middle, End) */}
          {points.length > 0 && (
            <>
              <text
                x={padding.left}
                y={height - 8}
                textAnchor="start"
                className="text-[10px] fill-slate-400 font-mono"
              >
                {points[0].dateStr}
              </text>
              {points.length > 2 && (
                <text
                  x={width / 2}
                  y={height - 8}
                  textAnchor="middle"
                  className="text-[10px] fill-slate-400 font-mono"
                >
                  {points[Math.floor(points.length / 2)].dateStr}
                </text>
              )}
              <text
                x={width - padding.right}
                y={height - 8}
                textAnchor="end"
                className="text-[10px] fill-slate-400 font-mono"
              >
                {points[points.length - 1].dateStr}
              </text>
            </>
          )}
        </svg>

        {/* Floating Tooltip */}
        {activePoint && (
          <div
            className="absolute z-10 bg-slate-900 border border-slate-700 text-slate-100 text-[11px] p-2 rounded-lg shadow-xl pointer-events-none transform -translate-x-1/2 -translate-y-full mb-2 whitespace-nowrap"
            style={{
              left: `${(activePoint.x / width) * 100}%`,
              top: `${(activePoint.y / height) * 100}%`,
            }}
          >
            <div className="font-bold">{activePoint.pt.dateStr}</div>
            <div className="text-purple-400 font-mono">
              {dict.journal.dashboard.equityCurve.tradeTooltip
                .replace("{index}", String(activePoint.pt.index))
                .replace("{date}", activePoint.pt.dateStr)
                .replace("{val}", formatValue(activePoint.yVal))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
