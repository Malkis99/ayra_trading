"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useAttachments } from "@/lib/journal/attachments/hooks";
import { processImageFile } from "@/lib/journal/attachments/image-processor";
import { AttachmentKind, AttachmentRecord } from "@/lib/journal/attachments/types";
import { GAME_CONFIG } from "@/lib/game-config";
import { LightboxViewer } from "./LightboxViewer";
import { recordScreenshotAdded } from "@/lib/game";

interface AttachmentManagerProps {
  tradeId?: string | null;
  tradeOpenedAt?: string;
  onAttachmentsChanged?: (attachmentIds: string[]) => void;
  readOnly?: boolean;
}

export function AttachmentManager({
  tradeId,
  tradeOpenedAt,
  onAttachmentsChanged,
  readOnly = false,
}: AttachmentManagerProps) {
  const { dict, showToast } = useApp();
  const { gameState, setGameState } = useGame();
  const dictAtt = dict.journal.attachments;

  const {
    attachments,
    loading,
    error,
    addAttachment,
    updateMetadata,
    deleteAttachment,
  } = useAttachments(tradeId);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Lightbox State
  const [activeLightboxIndex, setActiveLightboxIndex] = useState<number | null>(null);

  // File Input Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Notify parent of updated attachment IDs
  useEffect(() => {
    if (onAttachmentsChanged) {
      onAttachmentsChanged(attachments.map((a) => a.id));
    }
  }, [attachments, onAttachmentsChanged]);

  // Process and upload file
  const handleProcessAndAddFile = useCallback(
    async (file: File) => {
      if (!tradeId) {
        setLocalError("Save trade before attaching screenshot");
        return;
      }

      if (attachments.length >= GAME_CONFIG.MAX_ATTACHMENTS_PER_TRADE) {
        showToast(dictAtt.limitReached.replace("{max}", String(GAME_CONFIG.MAX_ATTACHMENTS_PER_TRADE)));
        return;
      }

      setProcessing(true);
      setLocalError(null);

      try {
        const processed = await processImageFile(file);

        // Check duplicate hash within same trade
        const isDuplicate = attachments.some((att) => att.hash === processed.hash);
        if (isDuplicate) {
          showToast(dictAtt.alreadyAdded);
          setProcessing(false);
          return;
        }

        const saved = await addAttachment({
          tradeId,
          kind: "before",
          width: processed.width,
          height: processed.height,
          bytes: processed.bytes,
          mime: processed.mime,
          hash: processed.hash,
          originalBlob: processed.originalBlob,
          previewBlob: processed.previewBlob,
        });

        // Award XP and check achievement
        const rewardRes = recordScreenshotAdded(gameState, {
          hash: saved.hash,
          width: saved.width,
          height: saved.height,
          tradeOpenedAt,
        });

        setGameState(rewardRes.state);

        if (rewardRes.xpAwarded > 0) {
          showToast(`+${rewardRes.xpAwarded} XP (${dict.stats.trading})`);
        } else if (rewardRes.leveledUp) {
          showToast(`Level up! Lv ${rewardRes.newLevel}`);
        } else {
          showToast(dict.journal.addTradeModal.tradeSavedToast);
        }
      } catch (err: any) {
        console.error("Error processing attachment:", err);
        let errorMsg = dictAtt.errors.uploadFailed;
        if (err.message === "UNSUPPORTED_FORMAT") {
          errorMsg = dictAtt.errors.unsupportedFormat;
        } else if (err.message === "FILE_TOO_LARGE") {
          errorMsg = dictAtt.errors.fileTooLarge;
        } else if (err.message === "IMAGE_TOO_LARGE_PIXELS") {
          errorMsg = dictAtt.errors.imageTooLargePixels;
        } else if (err.message === "EMPTY_FILE") {
          errorMsg = dictAtt.errors.emptyFile;
        }
        setLocalError(errorMsg);
      } finally {
        setProcessing(false);
      }
    },
    [
      tradeId,
      attachments,
      addAttachment,
      gameState,
      setGameState,
      showToast,
      dict,
      dictAtt,
      tradeOpenedAt,
    ]
  );

  // File input change handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      Array.from(files).forEach((file) => handleProcessAndAddFile(file));
      e.target.value = "";
    }
  };

  // Drag & drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      Array.from(e.dataTransfer.files).forEach((file) => handleProcessAndAddFile(file));
    }
  };

  // Clipboard paste listener
  useEffect(() => {
    if (readOnly || !tradeId) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            handleProcessAndAddFile(file);
          }
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [readOnly, tradeId, handleProcessAndAddFile]);

  return (
    <div className="space-y-3">
      {/* Privacy Warning Banner */}
      <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-xs flex items-center gap-2">
        <span>🔒</span>
        <span>{dictAtt.privacyNotice}</span>
      </div>

      {/* Error displays */}
      {(error || localError) && (
        <div className="p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs">
          {localError || error}
        </div>
      )}

      {/* Thumbnails Grid */}
      {attachments.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {attachments.map((item, idx) => (
            <AttachmentThumbnailCard
              key={item.id}
              record={item}
              onClick={() => setActiveLightboxIndex(idx)}
            />
          ))}
        </div>
      )}

      {/* Dropzone Area */}
      {!readOnly && attachments.length < GAME_CONFIG.MAX_ATTACHMENTS_PER_TRADE && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`p-4 border-2 border-dashed rounded-xl cursor-pointer text-center transition-colors ${
            isDraggingOver
              ? "border-acc bg-acc/10 text-acc"
              : "border-line/80 bg-s2/40 hover:border-acc/60 hover:bg-s2/80 text-mu"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="flex flex-col items-center justify-center gap-1">
            <span className="text-xl">📷</span>
            <span className="text-xs font-medium text-tx">{dictAtt.addBtn}</span>
            <p className="text-[11px] text-mu max-w-xs">{dictAtt.dragDropHint}</p>
            {processing && (
              <span className="text-xs text-acc font-mono animate-pulse mt-1">
                Processing image...
              </span>
            )}
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {activeLightboxIndex !== null && (
        <LightboxViewer
          attachments={attachments}
          currentIndex={activeLightboxIndex}
          isOpen={activeLightboxIndex !== null}
          onClose={() => setActiveLightboxIndex(null)}
          onIndexChange={(idx) => setActiveLightboxIndex(idx)}
          onUpdateMetadata={updateMetadata}
          onDeleteAttachment={deleteAttachment}
        />
      )}
    </div>
  );
}

function AttachmentThumbnailCard({
  record,
  onClick,
}: {
  record: AttachmentRecord;
  onClick: () => void;
}) {
  const { dict } = useApp();
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(record.previewBlob);
    setThumbUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [record.previewBlob]);

  const dictAtt = dict.journal.attachments;

  return (
    <div
      onClick={onClick}
      className="group relative aspect-video bg-s2 border border-line rounded-xl overflow-hidden cursor-pointer hover:border-acc transition-colors flex flex-col justify-between p-1"
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt={record.caption || record.kind}
          className="absolute inset-0 w-full h-full object-cover transition-transform group-hover:scale-105"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-s2 text-xs text-mu">
          Loading...
        </div>
      )}

      {/* Kind Badge overlay */}
      <div className="relative z-10 self-start">
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/70 border border-white/20 text-white shadow">
          {dictAtt.kinds[record.kind]}
        </span>
      </div>

      {/* Caption overlay if present */}
      {record.caption && (
        <div className="relative z-10 bg-black/70 text-[10px] text-white px-1.5 py-0.5 rounded truncate">
          {record.caption}
        </div>
      )}
    </div>
  );
}
