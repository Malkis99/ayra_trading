"use client";

import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../cn";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type Placement = { top?: number; bottom?: number; left: number; width: number; maxHeight: number };

/** Fixed position under (or above, if there is no room) the anchor; follows scroll and resize. */
function usePlacement(anchor: React.RefObject<HTMLElement>, open: boolean, minWidth: number, preferredHeight: number) {
  const [placement, setPlacement] = useState<Placement | null>(null);
  const update = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, minWidth), vw - 16);
    const left = Math.min(Math.max(8, r.left), vw - width - 8);
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    if (below >= Math.min(preferredHeight, 240) || below >= above) {
      setPlacement({ top: r.bottom + 6, left, width, maxHeight: Math.max(160, Math.min(preferredHeight, below - 6)) });
    } else {
      setPlacement({ bottom: vh - r.top + 6, left, width, maxHeight: Math.max(160, Math.min(preferredHeight, above - 6)) });
    }
  }, [anchor, minWidth, preferredHeight]);

  useIsoLayoutEffect(() => {
    if (!open) return;
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, update]);

  return placement;
}

/** Closes on a pointer down outside both the anchor and the panel. */
export function useOutsideClose(refs: Array<React.RefObject<HTMLElement>>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (refs.some((r) => r.current?.contains(target))) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, onClose, refs]);
}

type PopoverProps = {
  anchor: React.RefObject<HTMLElement>;
  open: boolean;
  panelRef: React.RefObject<HTMLDivElement>;
  children: React.ReactNode;
  className?: string;
  minWidth?: number;
  preferredHeight?: number;
  id?: string;
  role?: string;
  "aria-label"?: string;
};

/** Floating panel rendered into <body>, above drawers and dialogs, never clipped by scroll containers. */
export function Popover({ anchor, open, panelRef, children, className, minWidth = 220, preferredHeight = 320, ...aria }: PopoverProps) {
  const placement = usePlacement(anchor, open, minWidth, preferredHeight);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      {...aria}
      style={
        placement
          ? { position: "fixed", top: placement.top, bottom: placement.bottom, left: placement.left, width: placement.width, maxHeight: placement.maxHeight }
          : { position: "fixed", visibility: "hidden" }
      }
      className={cn(
        "z-[120] flex flex-col overflow-hidden rounded-md border border-edge bg-s1 shadow-float",
        "motion-safe:animate-[ayraPop_120ms_ease-out]",
        className
      )}
    >
      {children}
    </div>,
    document.body
  );
}
