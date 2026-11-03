import React from "react";
import Image from "next/image";
import { cn } from "@/components/ui/cn";

/**
 * The AYRA Trading logo (owner's final kit, brand-assets → public/brand). PNG with a transparent background, made
 * for dark backgrounds: shown as it is — never stretched, recoloured or given an extra glow.
 * - `mark`: the «A» sign (narrow screens, phones, small places);
 * - `horizontal`: the sign with «AYRA / TRADING» beside it (wide sidebar and headers);
 * - `full`: the sign over «AYRA / TRADING» (sign-in, public Home, loading).
 * Size is set by height; the width follows the picture's own proportions.
 */
export const LOGO_FILES = {
  mark: { src: "/brand/mark.png", width: 1108, height: 808 },
  horizontal: { src: "/brand/logo-horizontal.png", width: 2984, height: 808 },
  full: { src: "/brand/logo-full.png", width: 2064, height: 1372 },
} as const;

export type LogoVariant = keyof typeof LOGO_FILES;

export function Logo({
  variant,
  height,
  className,
  priority,
  decorative,
}: {
  variant: LogoVariant;
  /** Height in CSS pixels. */
  height: number;
  className?: string;
  priority?: boolean;
  /** The name is said next to it already: hide the picture from screen readers. */
  decorative?: boolean;
}) {
  const file = LOGO_FILES[variant];
  const width = Math.round((height * file.width) / file.height);
  return (
    <Image
      src={file.src}
      width={width}
      height={height}
      alt={decorative ? "" : "AYRA Trading"}
      aria-hidden={decorative || undefined}
      priority={priority}
      draggable={false}
      className={cn("shrink-0 select-none object-contain", className)}
      style={{ width, height }}
      data-testid={`brand-logo-${variant}`}
    />
  );
}
