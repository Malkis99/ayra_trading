"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useApp } from "@/lib/context";
import { AttachmentKind, AttachmentMetadata, AttachmentRecord } from "@/lib/journal/attachments/types";

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
}

export function LightboxViewer({
  attachments,
  currentIndex,
  isOpen,
  onClose,
  onIndexChange,
  onUpdateMetadata,
  onDeleteAttachment,
}: LightboxViewerProps) {
  const { dict } = useApp();
  const currentItem = attachments[currentIndex] || null;

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

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
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    setCaptionText(currentItem.caption || "");
    setShowDeleteConfirm(false);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [currentItem]);

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
        onClose();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      } else if (e.key === "ArrowRight") {
        handleNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, handlePrev, handleNext]);

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      setZoomLevel((prev) => Math.min(3, prev + 0.25));
    } else {
      setZoomLevel((prev) => {
        const next = Math.max(1, prev - 0.25);
        if (next === 1) setPanOffset({ x: 0, y: 0 });
        return next;
      });
    }
  };

  // Double tap / click toggle zoom
  const handleDoubleClick = () => {
    if (zoomLevel > 1) {
      setZoomLevel(1);
      setPanOffset({ x: 0, y: 0 });
    } else {
      setZoomLevel(2);
    }
  };

  // Drag & Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoomLevel > 1) {
      setPanOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-2 sm:p-4 text-tx select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={dictAtt.title}
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-5xl h-[92vh] flex flex-col justify-between bg-s1/90 border border-line/80 rounded-2xl overflow-hidden shadow-2xl"
      >
        {/* Top Header Controls */}
        <div className="flex items-center justify-between p-3 bg-s2/80 border-b border-line/60 gap-2 z-10 flex-none">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-acc/20 border border-acc/40 text-acc flex-none">
              {dictAtt.kinds[currentItem.kind]}
            </span>
            <span className="text-xs text-mu truncate font-mono">
              {currentItem.width}×{currentItem.height} px ({fileSizeMb} MB)
            </span>
            <span className="text-xs text-mu hidden sm:inline">
              · {currentIndex + 1} / {attachments.length}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-none">
            {/* Kind Switcher */}
            {onUpdateMetadata && (
              <select
                value={currentItem.kind}
                onChange={(e) => handleKindChange(e.target.value as AttachmentKind)}
                className="input py-1 px-2 text-xs bg-s1 border-line"
              >
                <option value="before">{dictAtt.kinds.before}</option>
                <option value="after">{dictAtt.kinds.after}</option>
                <option value="other">{dictAtt.kinds.other}</option>
              </select>
            )}

            {/* Zoom level indicator */}
            <button
              onClick={() => {
                if (zoomLevel > 1) {
                  setZoomLevel(1);
                  setPanOffset({ x: 0, y: 0 });
                } else {
                  setZoomLevel(2);
                }
              }}
              className="btn-secondary py-1 px-2 text-xs font-mono"
              title={zoomLevel > 1 ? dictAtt.lightbox.zoomOut : dictAtt.lightbox.zoomIn}
            >
              {Math.round(zoomLevel * 100)}%
            </button>

            {/* Download */}
            <button
              onClick={handleDownload}
              className="btn-secondary py-1 px-2.5 text-xs font-medium"
              title={dictAtt.download}
            >
              ↓ {dictAtt.download}
            </button>

            {/* Delete */}
            {onDeleteAttachment && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="py-1 px-2.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg transition-colors"
                title={dictAtt.delete}
              >
                ✕ {dictAtt.delete}
              </button>
            )}

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-1 text-mu hover:text-tx text-lg font-bold transition-colors ml-1"
              aria-label={dictAtt.lightbox.close}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Image Display Area with Navigation Arrows */}
        <div
          className="relative flex-1 w-full h-full min-h-0 grid place-items-center overflow-hidden bg-black/40 cursor-grab active:cursor-grabbing"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
        >
          {/* Left Arrow */}
          {attachments.length > 1 && (
            <button
              onClick={handlePrev}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-s1/80 border border-line text-tx hover:bg-acc hover:text-black grid place-items-center shadow-lg transition-colors text-lg"
              aria-label={dictAtt.lightbox.prev}
            >
              ←
            </button>
          )}

          {/* Image */}
          {imageUrl && (
            <img
              src={imageUrl}
              alt={currentItem.caption || dictAtt.title}
              style={{
                transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
                transition: isDragging ? "none" : "transform 0.15s ease-out",
              }}
              className="max-w-full max-h-full object-contain pointer-events-none select-none"
              draggable={false}
            />
          )}

          {/* Right Arrow */}
          {attachments.length > 1 && (
            <button
              onClick={handleNext}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-s1/80 border border-line text-tx hover:bg-acc hover:text-black grid place-items-center shadow-lg transition-colors text-lg"
              aria-label={dictAtt.lightbox.next}
            >
              →
            </button>
          )}
        </div>

        {/* Bottom Caption Bar */}
        <div className="p-3 bg-s2/90 border-t border-line/60 flex flex-col sm:flex-row items-center justify-between gap-2 z-10 flex-none">
          <div className="w-full sm:flex-1">
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
