"use client";

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useApp } from "@/lib/context";
import { AttachmentKind, AttachmentMetadata, AttachmentRecord } from "@/lib/journal/attachments/types";
import { Segmented } from "@/components/ui";
import { ZOOM_STEP, clampScale, fitScale, isFit, scrollToKeep, toggledScale, type Size } from "@/lib/journal/attachments/zoom";

interface LightboxViewerProps {
  attachments: AttachmentRecord[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onIndexChange: (newIndex: number) => void;
  onUpdateMetadata?: (
    id: string,
    updates: Partial<Pick<AttachmentMetadata, "kind" | "caption">>
  ) => Promise<any>;
  onDeleteAttachment?: (id: string) => Promise<any>;
  /** The picture could not be drawn (a broken copy on this device). */
  onImageError?: (id: string) => void;
}

/** `null` = «fit to window» (follows the window size); a number = a chosen scale (1 = 100%, the real size). */
type Zoom = number | null;

export function LightboxViewer({
  attachments,
  currentIndex,
  isOpen,
  onClose,
  onIndexChange,
  onUpdateMetadata,
  onDeleteAttachment,
  onImageError,
}: LightboxViewerProps) {
  const { dict } = useApp();
  const currentItem = attachments[currentIndex] || null;

  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // Scale: the picture is drawn at its displayed width and height inside a scrolling area, so at «100%» it scrolls
  // with the wheel or a finger and can be dragged with the mouse; by default it fits the window whole.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Size>({ w: 0, h: 0 });
  const [natural, setNatural] = useState<Size>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<Zoom>(null);
  const fit = fitScale(natural, box);
  const scale = zoom === null ? fit : clampScale(zoom, fit);
  const fitted = isFit(scale, fit);
  const shown = { w: Math.round(natural.w * scale), h: Math.round(natural.h * scale) };
  const overflows = shown.w > box.w + 1 || shown.h > box.h + 1;
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Delete inline confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Caption editing
  const [captionText, setCaptionText] = useState<string>("");

  // Clean object URL handling
  useEffect(() => {
    if (!currentItem) {
      setImageUrl(null);
      return;
    }

    const url = URL.createObjectURL(currentItem.originalBlob);
    setImageUrl(url);
    setNatural({ w: currentItem.width, h: currentItem.height });
    setZoom(null);
    pendingScroll.current = { left: 0, top: 0 };
    setCaptionText(currentItem.caption || "");
    setShowDeleteConfirm(false);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [currentItem]);

  // The picture area's size (the window, rotation, the keyboard on a phone)
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isOpen, currentItem]);

  // After a change of scale: scroll so the same point stays where it was (centre, cursor or fingers)
  useLayoutEffect(() => {
    const el = viewportRef.current;
    const next = pendingScroll.current;
    if (!el || !next) return;
    pendingScroll.current = null;
    el.scrollLeft = next.left;
    el.scrollTop = next.top;
  }, [scale, shown.w, shown.h]);

  /** New scale around a point of the window (default: its centre). */
  const zoomTo = useCallback(
    (next: number, at?: { x: number; y: number }) => {
      const el = viewportRef.current;
      const target = clampScale(next, fit);
      if (el) pendingScroll.current = scrollToKeep({ scale, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }, target, box, at);
      setZoom(isFit(target, fit) ? null : target);
    },
    [fit, scale, box]
  );
  const fitToWindow = useCallback(() => {
    pendingScroll.current = { left: 0, top: 0 };
    setZoom(null);
  }, []);
  const toggle = useCallback((at?: { x: number; y: number }) => zoomTo(toggledScale(scale, fit), at), [zoomTo, scale, fit]);

  const pointIn = (clientX: number, clientY: number) => {
    const r = viewportRef.current?.getBoundingClientRect();
    return r ? { x: clientX - r.left, y: clientY - r.top } : undefined;
  };

  // Ctrl + wheel / trackpad pinch: zoom around the cursor (a plain wheel scrolls). Pinch with two fingers on a phone.
  // Native listeners: React's wheel and touch listeners are passive and cannot stop the page from zooming.
  const latest = useRef({ scale, zoomTo, toggle });
  latest.current = { scale, zoomTo, toggle };
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !isOpen) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      latest.current.zoomTo(latest.current.scale * Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    let pinch: { dist: number; scale: number } | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    let moved = false;
    const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const middle = (t: TouchList) => {
      const r = el.getBoundingClientRect();
      return { x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top };
    };
    const onTouchStart = (e: TouchEvent) => {
      moved = false;
      if (e.touches.length === 2) pinch = { dist: distance(e.touches), scale: latest.current.scale };
    };
    const onTouchMove = (e: TouchEvent) => {
      moved = true;
      if (e.touches.length !== 2 || !pinch) return;
      e.preventDefault();
      latest.current.zoomTo((pinch.scale * distance(e.touches)) / pinch.dist, middle(e.touches));
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
      // double tap: fit ↔ 100%
      if (moved || e.changedTouches.length !== 1 || e.touches.length) return;
      const t = e.changedTouches[0];
      const now = Date.now();
      if (lastTap && now - lastTap.t < 300 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 30) {
        e.preventDefault(); // no synthetic double click after it
        const r = el.getBoundingClientRect();
        latest.current.toggle({ x: t.clientX - r.left, y: t.clientY - r.top });
        lastTap = null;
      } else lastTap = { t: now, x: t.clientX, y: t.clientY };
    };
    const onGesture = (e: Event) => e.preventDefault(); // Safari's own page zoom
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("gesturestart", onGesture);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("gesturestart", onGesture);
    };
  }, [isOpen, currentItem]);

  // Drag with the mouse when the picture is larger than the window (a finger scrolls by itself)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || !overflows || !viewportRef.current) return;
    drag.current = { x: e.clientX, y: e.clientY, left: viewportRef.current.scrollLeft, top: viewportRef.current.scrollTop };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const el = viewportRef.current;
    if (!drag.current || !el) return;
    el.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
    el.scrollTop = drag.current.top - (e.clientY - drag.current.y);
  };
  const onPointerUp = () => {
    drag.current = null;
    setDragging(false);
  };

  // Handle focus when inline delete confirmation opens
  useEffect(() => {
    if (showDeleteConfirm) {
      setTimeout(() => cancelButtonRef.current?.focus(), 50);
    }
  }, [showDeleteConfirm]);

  // Keyboard navigation & Esc listener
  const handlePrev = useCallback(() => {
    if (attachments.length <= 1) return;
    const nextIdx = (currentIndex - 1 + attachments.length) % attachments.length;
    onIndexChange(nextIdx);
  }, [currentIndex, attachments.length, onIndexChange]);

  const handleNext = useCallback(() => {
    if (attachments.length <= 1) return;
    const nextIdx = (currentIndex + 1) % attachments.length;
    onIndexChange(nextIdx);
  }, [currentIndex, attachments.length, onIndexChange]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Handled here first (capture), so a drawer or dialog behind the viewer stays open.
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      } else if (e.key === "ArrowRight") {
        handleNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, onClose, handlePrev, handleNext]);

  // Download handler
  const handleDownload = () => {
    if (!currentItem || !imageUrl) return;
    const a = document.createElement("a");
    a.href = imageUrl;
    const ext = currentItem.mime.split("/")[1] || "webp";
    a.download = `trade_${currentItem.tradeId}_${currentItem.kind}_${currentItem.id}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Save caption update
  const handleCaptionBlur = async () => {
    if (!currentItem || !onUpdateMetadata) return;
    if (captionText.trim() !== (currentItem.caption || "")) {
      await onUpdateMetadata(currentItem.id, { caption: captionText.trim() });
    }
  };

  // Kind update
  const handleKindChange = async (newKind: AttachmentKind) => {
    if (!currentItem || !onUpdateMetadata) return;
    await onUpdateMetadata(currentItem.id, { kind: newKind });
  };

  // Delete handler
  const handleConfirmDelete = async () => {
    if (!currentItem || !onDeleteAttachment) return;
    await onDeleteAttachment(currentItem.id);
    setShowDeleteConfirm(false);
    if (attachments.length <= 1) {
      onClose();
    } else {
      const nextIdx = Math.min(currentIndex, attachments.length - 2);
      onIndexChange(nextIdx);
    }
  };

  if (!isOpen || !currentItem) return null;

  const fileSizeMb = (currentItem.bytes / (1024 * 1024)).toFixed(2);
  const dictAtt = dict.journal.attachments;
  const tl = dictAtt.lightbox;
  const several = attachments.length > 1;
  const toolBtn =
    "btn-secondary h-8 min-w-8 px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acc disabled:opacity-40";
  const arrowBtn =
    "w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-s1/80 border border-line text-tx hover:bg-acc hover:text-black grid place-items-center shadow-lg transition-colors text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acc";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-0 sm:p-4 text-tx select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={dictAtt.title}
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-6xl h-[100dvh] sm:h-[92vh] flex flex-col bg-s1/90 border-line/80 sm:border sm:rounded-2xl overflow-hidden shadow-2xl"
      >
        {/* Header: what it is, then the tools — its own rows, never over the picture */}
        <div className="flex-none space-y-2 p-2 sm:p-3 bg-s2/80 border-b border-line/60 z-10">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-acc/20 border border-acc/40 text-acc flex-none">
                {dictAtt.kinds[currentItem.kind]}
              </span>
              <span className="text-xs text-mu truncate font-mono">
                {currentItem.width}×{currentItem.height} px ({fileSizeMb} MB)
              </span>
              {several && (
                <span className="text-xs text-mu flex-none">
                  · {currentIndex + 1} / {attachments.length}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1 text-mu hover:text-tx text-lg font-bold transition-colors flex-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acc rounded"
              aria-label={tl.close}
            >
              ✕
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onUpdateMetadata && (
              <Segmented<AttachmentKind>
                name={dictAtt.kindLabel}
                value={currentItem.kind}
                onChange={handleKindChange}
                className="w-full sm:w-[240px]"
                options={[
                  { value: "before", label: dictAtt.kinds.before, tone: "neutral" },
                  { value: "after", label: dictAtt.kinds.after, tone: "neutral" },
                  { value: "other", label: dictAtt.kinds.other, tone: "neutral" },
                ]}
              />
            )}

            <div className="flex items-center gap-1" role="group" aria-label={tl.zoomGroup}>
              <button
                type="button"
                onClick={() => zoomTo(scale / ZOOM_STEP)}
                disabled={fitted || scale <= Math.min(fit, 1)}
                className={toolBtn}
                aria-label={tl.zoomOut}
                title={tl.zoomOut}
                data-testid="lightbox-zoom-out"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => zoomTo(1)}
                className={`${toolBtn} font-mono tabular-nums`}
                aria-label={tl.actualSize}
                title={tl.actualSize}
                data-testid="lightbox-zoom-level"
              >
                {Math.round(scale * 100)}%
              </button>
              <button
                type="button"
                onClick={() => zoomTo(scale * ZOOM_STEP)}
                className={toolBtn}
                aria-label={tl.zoomIn}
                title={tl.zoomIn}
                data-testid="lightbox-zoom-in"
              >
                +
              </button>
              <button
                type="button"
                onClick={fitToWindow}
                disabled={fitted}
                aria-pressed={fitted}
                className={toolBtn}
                data-testid="lightbox-fit"
              >
                {tl.fit}
              </button>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button onClick={handleDownload} className="btn-secondary h-8 px-2.5 text-xs font-medium" title={dictAtt.download}>
                ↓ {dictAtt.download}
              </button>
              {onDeleteAttachment && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="h-8 px-2.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg transition-colors"
                  title={dictAtt.delete}
                >
                  ✕ {dictAtt.delete}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Picture with the arrows in their own columns */}
        <div className="relative flex-1 min-h-0 flex bg-black/40">
          {several && (
            <div className="flex-none grid place-items-center px-1 sm:px-2">
              <button onClick={handlePrev} className={arrowBtn} aria-label={tl.prev}>
                ←
              </button>
            </div>
          )}

          <div
            ref={viewportRef}
            className={`relative flex-1 min-w-0 overflow-auto overscroll-contain ${overflows ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""}`}
            style={{ touchAction: "pan-x pan-y" }}
            onDoubleClick={(e) => toggle(pointIn(e.clientX, e.clientY))}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            data-testid="lightbox-viewport"
            data-fit={fitted ? "true" : "false"}
          >
            {/* centred while smaller than the window; from the top-left corner when larger (scrolls both ways) */}
            <div className="flex min-w-full min-h-full w-max">
              {imageUrl && (
                // a box of the displayed size holds the picture: a picture as a flex item gets squeezed to the window
                // height in Chromium (its aspect ratio), whatever width and height it is given
                <div
                  className="m-auto flex-none"
                  style={shown.w && shown.h ? { width: shown.w, height: shown.h } : { maxWidth: "100%", maxHeight: "100%" }}
                >
                  <img
                    data-testid="lightbox-image"
                    src={imageUrl}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (img.naturalWidth && img.naturalHeight) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
                    }}
                    onError={() => onImageError?.(currentItem.id)}
                    alt={currentItem.caption || dictAtt.title}
                    width={shown.w || undefined}
                    height={shown.h || undefined}
                    className="block w-full h-full max-w-none pointer-events-none select-none"
                    draggable={false}
                  />
                </div>
              )}
            </div>
          </div>

          {several && (
            <div className="flex-none grid place-items-center px-1 sm:px-2">
              <button onClick={handleNext} className={arrowBtn} aria-label={tl.next}>
                →
              </button>
            </div>
          )}
        </div>

        {/* Bottom Caption Bar */}
        <div className="p-2 sm:p-3 bg-s2/90 border-t border-line/60 flex items-center justify-between gap-2 z-10 flex-none">
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={captionText}
              onChange={(e) => setCaptionText(e.target.value)}
              onBlur={handleCaptionBlur}
              placeholder={dictAtt.captionPlaceholder}
              maxLength={120}
              className="input text-xs w-full py-1.5 px-3 bg-s1/80 border-line"
            />
          </div>
          <div className="text-[11px] text-mu font-mono flex-none">
            {captionText.length}/120
          </div>
        </div>

        {/* Delete Confirmation Modal Overlay */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 z-30 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="card w-full max-w-sm space-y-3 p-4 border border-rose-500/40 bg-s1 shadow-2xl">
              <h4 className="font-bold text-sm text-tx">{dictAtt.deleteConfirm}</h4>
              <p className="text-xs text-mu">{currentItem.caption || `${currentItem.kind} (${fileSizeMb} MB)`}</p>

              <div className="flex gap-2 pt-2">
                <button
                  ref={cancelButtonRef}
                  onClick={() => setShowDeleteConfirm(false)}
                  className="btn-secondary flex-1 py-1.5 text-xs font-medium"
                >
                  {dictAtt.cancelBtn}
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="py-1.5 px-4 text-xs font-semibold text-black bg-rose-500 hover:bg-rose-400 rounded-xl transition-colors"
                  data-testid="lightbox-confirm-delete"
                >
                  {dictAtt.confirmDeleteBtn}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
