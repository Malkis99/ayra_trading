import { useState, useEffect, useCallback, useRef } from "react";
import {
  AttachmentMetadata,
  AttachmentRecord,
  AttachmentRepository,
} from "./types";
import { defaultAttachmentRepository } from "./indexeddb-repository";

export function useAttachments(
  tradeId?: string | null,
  repository: AttachmentRepository = defaultAttachmentRepository
) {
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());

  const createPreviewUrl = useCallback((blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.add(url);
    return url;
  }, []);

  const revokeUrl = useCallback((url: string) => {
    if (objectUrlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(url);
    }
  }, []);

  const loadAttachments = useCallback(async () => {
    if (!tradeId) {
      setAttachments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const items = await repository.getAttachmentsByTradeId(tradeId);
      setAttachments(items);
    } catch (err: any) {
      console.error("Failed to load attachments:", err);
      setError(err?.message || "Failed to load attachments");
    } finally {
      setLoading(false);
    }
  }, [tradeId, repository]);

  useEffect(() => {
    loadAttachments();
  }, [loadAttachments]);

  // Clean up object URLs on unmount
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const addAttachment = useCallback(
    async (
      recordInput: Omit<AttachmentRecord, "id" | "createdAt"> & {
        id?: string;
        createdAt?: string;
      }
    ): Promise<AttachmentRecord> => {
      try {
        // First try requesting persistent storage silently
        repository.requestPersistentStorage().catch(() => {});

        const saved = await repository.addAttachment(recordInput);
        setAttachments((prev) => [...prev, saved]);
        return saved;
      } catch (err: any) {
        const msg = err?.message || "Failed to save attachment";
        setError(msg);
        throw err;
      }
    },
    [repository]
  );

  const updateMetadata = useCallback(
    async (
      id: string,
      updates: Partial<Pick<AttachmentMetadata, "kind" | "caption">>
    ): Promise<AttachmentMetadata | null> => {
      try {
        const updatedMeta = await repository.updateMetadata(id, updates);
        if (updatedMeta) {
          setAttachments((prev) =>
            prev.map((item) =>
              item.id === id
                ? {
                    ...item,
                    kind: updatedMeta.kind,
                    caption: updatedMeta.caption,
                  }
                : item
            )
          );
        }
        return updatedMeta;
      } catch (err: any) {
        setError(err?.message || "Failed to update metadata");
        throw err;
      }
    },
    [repository]
  );

  const deleteAttachment = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const success = await repository.deleteAttachment(id);
        if (success) {
          setAttachments((prev) => prev.filter((item) => item.id !== id));
        }
        return success;
      } catch (err: any) {
        setError(err?.message || "Failed to delete attachment");
        throw err;
      }
    },
    [repository]
  );

  return {
    attachments,
    loading,
    error,
    addAttachment,
    updateMetadata,
    deleteAttachment,
    reload: loadAttachments,
    createPreviewUrl,
    revokeUrl,
  };
}
