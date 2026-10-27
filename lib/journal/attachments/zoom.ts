/**
 * Scale of a screenshot in the viewer (owner's rules 2026-10-27): by default the whole picture fits the window, any
 * format (tall 9:16, wide 16:9, square); a picture smaller than the window is shown at its real size, never blown up.
 * «100%» is the real size; then the picture scrolls and can be dragged. Scale = displayed pixels / picture pixels.
 */

export interface Size {
  w: number;
  h: number;
}

export const ZOOM_STEP = 1.25;
export const ZOOM_MAX = 4;

/** The whole picture inside the window (at most its real size). */
export function fitScale(picture: Size, window: Size): number {
  if (picture.w <= 0 || picture.h <= 0 || window.w <= 0 || window.h <= 0) return 1;
  return Math.min(1, window.w / picture.w, window.h / picture.h);
}

/** Smaller than «fit» makes no sense: the picture is already whole. */
export function clampScale(scale: number, fit: number): number {
  return Math.min(ZOOM_MAX, Math.max(Math.min(fit, 1), scale));
}

/** Close enough to «fit» to call it that (the button and the label show it). */
export const isFit = (scale: number, fit: number) => Math.abs(scale - fit) < 0.005;

/** Double click / double tap: fit ↔ real size (a picture that already fits at real size goes to 200%). */
export function toggledScale(scale: number, fit: number): number {
  if (!isFit(scale, fit)) return fit;
  return fit < 1 ? 1 : Math.min(ZOOM_MAX, 2);
}

/**
 * Where to scroll after a change of scale so the same point of the picture stays under `at` (a point of the window,
 * by default its centre).
 */
export function scrollToKeep(
  before: { scale: number; scrollLeft: number; scrollTop: number },
  after: number,
  window: Size,
  at: { x: number; y: number } = { x: window.w / 2, y: window.h / 2 }
): { left: number; top: number } {
  const px = (before.scrollLeft + at.x) / before.scale;
  const py = (before.scrollTop + at.y) / before.scale;
  return { left: Math.max(0, px * after - at.x), top: Math.max(0, py * after - at.y) };
}
