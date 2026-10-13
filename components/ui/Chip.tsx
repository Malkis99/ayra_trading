import React from "react";
import { cn } from "./cn";

type ChipProps = React.HTMLAttributes<HTMLSpanElement> & {
  /** "gold" is reserved for achievements and rare items. */
  tone?: "neutral" | "accent" | "gold";
};

const TONES = {
  neutral: "border-line bg-s2 text-mu",
  accent: "border-vi/40 bg-pri/20 text-tx",
  gold: "border-go/50 bg-go/10 text-go",
};

export function Chip({ tone = "neutral", className, ...rest }: ChipProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", TONES[tone], className)}
      {...rest}
    />
  );
}
