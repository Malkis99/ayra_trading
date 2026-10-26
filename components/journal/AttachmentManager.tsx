"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useAttachments } from "@/lib/journal/attachments/hooks";
import { processScreenshot } from "@/lib/journal/attachments/image-processor";
import { AttachmentKind, AttachmentMetadata, AttachmentRecord } from "@/lib/journal/attachments/types";
import { useJournal } from "@/lib/journal/context";
import { GAME_CONFIG } from "@/lib/game-config";
import { LightboxViewer } from "./LightboxViewer";
import { recordScreenshotAdded } from "@/lib/game";
import { formatString } from "@/lib/i18n";
import { noCloudAttachments, notOnDevice, screenshotsElsewhere, type CloudAttachmentStore } from "@/lib/journal/attachments/elsewhere";

interface AttachmentManagerProps {
  tradeId?: string | null;
  tradeOpenedAt?: string;
  onAttachmentsChanged?: (attachmentIds: string[]) => void;
  /** Screenshot ids the trade record lists (synced): ids missing here belong to another device and are kept. */
  expectedIds?: string[];
  /** Called after the user adds or deletes a screenshot, with the full id list for the trade record. */
  onPersistIds?: (attachmentIds: string[]) => void;
  cloudStore?: CloudAttachmentStore;
  readOnly?: boolean;
}

export function AttachmentManager({
  tradeId,
  tradeOpenedAt,
  onAttachmentsChanged,
  expectedIds,
  onPersistIds,
  cloudStore = noCloudAttachments,
  readOnly = false,
}: AttachmentManagerProps) {
  const { dict, showToast } = useApp();
  const { gameState, setGameState } = useGame();
  const {
    syncMode,
    cloudActive,
    attachmentCloudState,
    downloadAttachment,
    attachmentFilesVersion,
    deletedAttachmentIds: deletedIds,
    saveAttachmentRecord,
    updateAttachmentRecord,
    deleteAttachmentRecord,
    restoreAttachmentRecord,
  } = useJournal();
  const dictAtt = dict.journal.attachments;

  const {
    attachments: stored,
    loading,
    error,
    addAttachment,
    updateMetadata,
    deleteAttachment,
    forget,
    reload,
  } = useAttachments(tradeId, undefined, attachmentFilesVersion);

  // A screenshot deleted here (or elsewhere) is hidden at once, even while its file waits for «Undo»
  const attachments = useMemo(() => stored.filter((a) => !deletedIds.has(a.id)), [stored, deletedIds]);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Lightbox State
  const [activeLightboxIndex, setActiveLightboxIndex] = useState<number | null>(null);

  // File Input Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ids the trade lists that are not on this device (added on another device): kept in the record, never dropped
  // by an edit here. A screenshot deleted here is not listed again.
  const [deletedHere, setDeletedHere] = useState<string[]>([]);
  const remoteIds = useMemo(
    () => notOnDevice(expectedIds, attachments.map((a) => a.id)).filter((id) => !deletedHere.includes(id) && !deletedIds.has(id)),
    [expectedIds, attachments, deletedHere, deletedIds]
  );
  const allIds = useMemo(() => [...attachments.map((a) => a.id), ...remoteIds], [attachments, remoteIds]);

  // Screenshots of this trade whose file is in the cloud but not here (0005). Read on every render: the answer
  // changes with the files arriving and with the exchange, both of which re-render this component.
  const cloudState = new Map(remoteIds.map((id) => [id, attachmentCloudState(id)]));
  const inCloud = remoteIds.filter((id) => cloudState.get(id) === "inCloud");
  const inCloudKey = inCloud.join("|");
  const downloadingIds = remoteIds.filter((id) => cloudState.get(id) === "downloading");
  const noSpaceHere = cloudActive && attachments.some((a) => attachmentCloudState(a.id) === "noSpace");
  const knownKey = remoteIds.filter((id) => cloudState.get(id) !== "none").join("|");
  const contextStore = useMemo<CloudAttachmentStore>(() => {
    const known = new Set(knownKey ? knownKey.split("|") : []);
    return { has: async (ids) => new Set(ids.filter((id) => known.has(id))) };
  }, [knownKey]);
  const store = cloudStore === noCloudAttachments ? contextStore : cloudStore;

  // «Automatic»: opening the trade downloads its screenshots from the cloud by themselves
  const autoTried = useRef(new Set<string>());
  useEffect(() => {
    if (syncMode !== "auto" || !inCloudKey) return;
    for (const id of inCloudKey.split("|")) {
      if (autoTried.current.has(id)) continue;
      autoTried.current.add(id);
      void downloadAttachment(id);
    }
  }, [syncMode, inCloudKey, downloadAttachment]);

  const [downloadError, setDownloadError] = useState(false);
  const downloadAll = useCallback(async () => {
    setDownloadError(false);
    const ids = inCloudKey ? inCloudKey.split("|") : [];
    const results = await Promise.all(ids.map((id) => downloadAttachment(id, { byUser: true })));
    if (results.some((ok) => !ok)) setDownloadError(true);
    reload();
  }, [inCloudKey, downloadAttachment, reload]);

  // «Stored on another device»: listed ids found neither here nor in the cloud store
  const [elsewhere, setElsewhere] = useState<string[]>([]);
  useEffect(() => {
    if (loading) return;
    let alive = true;
    screenshotsElsewhere(remoteIds, attachments.map((a) => a.id), store).then((ids) => {
      if (alive) setElsewhere((prev) => (prev.join("|") === ids.join("|") ? prev : ids));
    });
    return () => {
      alive = false;
    };
  }, [loading, remoteIds, attachments, store]);

  // Notify parent of updated attachment IDs (after loading, so a slow load never reports an empty list)
  useEffect(() => {
    if (onAttachmentsChanged && !loading) {
      onAttachmentsChanged(allIds);
    }
  }, [allIds, loading, onAttachmentsChanged]);

  // After a user add/delete, hand the new list to the trade record
  const userChangedRef = useRef(false);
  useEffect(() => {
    if (!userChangedRef.current || loading) return;
    userChangedRef.current = false;
    onPersistIds?.(allIds);
  }, [allIds, loading, onPersistIds]);

  const handleDeleteAttachment = useCallback(
    async (id: string) => {
      // Described in the journal (0005): a soft delete with «Undo»; the file leaves this browser after a pause and
      // stays in the cloud 30 days. A screenshot from before 0005 (no description) is deleted at once, as before.
      if (deleteAttachmentRecord(id)) {
        forget(id);
        userChangedRef.current = true;
        setDeletedHere((prev) => [...prev, id]);
        showToast(dictAtt.deletedToast, dict.confirmDialog.undo, () => {
          restoreAttachmentRecord(id);
          setDeletedHere((prev) => prev.filter((x) => x !== id));
          userChangedRef.current = true;
          reload();
        });
        return true;
      }
      const ok = await deleteAttachment(id);
      if (ok) {
        userChangedRef.current = true;
        setDeletedHere((prev) => [...prev, id]);
      }
      return ok;
    },
    [deleteAttachment, deleteAttachmentRecord, restoreAttachmentRecord, forget, showToast, dictAtt, dict, reload]
  );

  const handleUpdateMetadata = useCallback(
    async (id: string, updates: Partial<Pick<AttachmentMetadata, "kind" | "caption">>) => {
      const meta = await updateMetadata(id, updates);
      if (meta) updateAttachmentRecord(id, updates);
      return meta;
    },
    [updateMetadata, updateAttachmentRecord]
  );

  // Process and upload file
  const handleProcessAndAddFile = useCallback(
    async (file: File) => {
      if (!tradeId) {
        setLocalError("Save trade before attaching screenshot");
        return;
      }

      if (allIds.length >= GAME_CONFIG.MAX_ATTACHMENTS_PER_TRADE) {
        showToast(dictAtt.limitReached.replace("{max}", String(GAME_CONFIG.MAX_ATTACHMENTS_PER_TRADE)));
        return;
      }

      setProcessing(true);
      setLocalError(null);

      try {
        const processed = await processScreenshot(file);

        // Check duplicate hash within same trade
        const isDuplicate = attachments.some((att) => att.hash === processed.hash);
        if (isDuplicate) {
          showToast(dictAtt.alreadyAdded);
          setProcessing(false);
          return;
        }

        userChangedRef.current = true;
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
        // The journal describes it too: the description is synced, the file goes to the cloud first (0005)
        const { originalBlob: _o, previewBlob: _p, ...meta } = saved;
        saveAttachmentRecord(meta);

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
        userChangedRef.current = false;
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
        } else if (err.message === "TOO_BIG_AFTER_COMPRESSION") {
          errorMsg = dictAtt.errors.tooBigAfterCompression;
        }
        setLocalError(errorMsg);
      } finally {
        setProcessing(false);
      }
    },
    [
      tradeId,
      attachments,
      allIds,
      addAttachment,
      saveAttachmentRecord,
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

      {noSpaceHere && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300" data-testid="screenshots-no-space">
          {dictAtt.noSpaceHere}
        </p>
      )}

      {downloadingIds.length > 0 && (
        <p className="rounded-xl border border-line bg-s2/40 p-2.5 text-xs text-mu" role="status" data-testid="screenshots-downloading">
          {dictAtt.downloading}
        </p>
      )}

      {syncMode === "manual" && inCloud.length > 0 && downloadingIds.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-s2/40 p-2.5 text-xs text-mu" data-testid="screenshots-in-cloud">
          <span>{inCloud.length === 1 ? dictAtt.inCloudOne : formatString(dictAtt.inCloudMany, { count: inCloud.length })}</span>
          <button
            type="button"
            onClick={() => void downloadAll()}
            className="rounded-lg border border-line px-2.5 py-1 font-semibold text-tx hover:border-acc focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acc"
            data-testid="screenshots-download"
          >
            {dictAtt.downloadBtn}
          </button>
        </div>
      )}

      {downloadError && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-300" role="alert">
          {dictAtt.downloadFailed}
        </p>
      )}

      {elsewhere.length > 0 && (
        <p className="rounded-xl border border-line bg-s2/40 p-2.5 text-xs text-mu" data-testid="screenshots-elsewhere">
          {elsewhere.length === 1 ? dictAtt.elsewhereOne : formatString(dictAtt.elsewhereMany, { count: elsewhere.length })}
        </p>
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
      {!readOnly && allIds.length < GAME_CONFIG.MAX_ATTACHMENTS_PER_TRADE && (
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
          onUpdateMetadata={handleUpdateMetadata}
          onDeleteAttachment={handleDeleteAttachment}
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
