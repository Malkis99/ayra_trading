import React from "react";
import Image from "next/image";
import { cn } from "@/components/ui/cn";

/**
 * The AYRA Trading logo, kit v2 (owner 2026-11-03, brand-assets-v2 → public/brand): vector files, crisp at any size,
 * made for the dark site. Shown as they are — never stretched, recoloured or given an extra glow.
 * - `mark`: the «A + arrow» sign without the halo (`mark_flat`) — phone header, small places, footer;
 * - `lockup`: the sign with the word AYRA beside it — the sidebar and wide headers. The kit's horizontal logo has
 *   «TRADING» about 4 px tall at the sidebar's 196 px width, unreadable; the owner allowed the sign with one word;
 * - `full`: the vertical logo (sign over AYRA / TRADING) — sign-in, the public Home, loading.
 * Size is set by height; the width follows the picture's own proportions.
 */
export const LOGO_FILES = {
  mark: { src: "/brand/mark-flat.svg", width: 1156, height: 856 },
  wordmark: { src: "/brand/wordmark-ayra.svg", width: 1593, height: 262 },
  full: { src: "/brand/logo-full.svg", width: 2000, height: 1239 },
} as const;

/** The word's height next to the sign in the lockup (the sign's cap height). */
const WORD_RATIO = 0.55;

export type LogoVariant = "mark" | "lockup" | "full";

const widthOf = (file: { width: number; height: number }, height: number) => Math.round((height * file.width) / file.height);

function Picture({ file, height, alt, priority, className, testId }: { file: (typeof LOGO_FILES)[keyof typeof LOGO_FILES]; height: number; alt: string; priority?: boolean; className?: string; testId?: string }) {
  const width = widthOf(file, height);
  return (
    <Image
      src={file.src}
      width={width}
      height={height}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      priority={priority}
      // vector files: served as they are (no resizing needed for a sharp picture)
      unoptimized
      draggable={false}
      className={cn("shrink-0 select-none", className)}
      style={{ width, height }}
      data-testid={testId}
    />
  );
}

export function Logo({
  variant,
  height,
  className,
  priority,
  decorative,
}: {
  variant: LogoVariant;
  /** Height in CSS pixels (for the lockup: the sign's height). */
  height: number;
  className?: string;
  priority?: boolean;
  /** The name is said next to it already: hide the picture from screen readers. */
  decorative?: boolean;
}) {
  const alt = decorative ? "" : "AYRA Trading";
  if (variant === "lockup") {
    const word = Math.round(height * WORD_RATIO);
    return (
      <span
        className={cn("inline-flex shrink-0 items-center", className)}
        style={{ gap: Math.round(height * 0.26) }}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : alt}
        aria-hidden={decorative || undefined}
        data-testid="brand-logo-lockup"
      >
        <Picture file={LOGO_FILES.mark} height={height} alt="" priority={priority} testId="brand-logo-lockup-mark" />
        <Picture file={LOGO_FILES.wordmark} height={word} alt="" priority={priority} testId="brand-logo-lockup-word" />
      </span>
    );
  }
  return <Picture file={LOGO_FILES[variant]} height={height} alt={alt} priority={priority} className={className} testId={`brand-logo-${variant}`} />;
}
