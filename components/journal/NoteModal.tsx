"use client";

import React, { useState, useEffect, useRef } from "react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { useGame } from "@/lib/game-context";
import { useJournal } from "@/lib/journal/context";
import { Note, NoteTemplateKey, NoteLinks } from "@/lib/journal/types";
import { dirtyFormRegistry } from "@/lib/auth/space-channel";
import { Pin, Trash2, Archive, X, Plus } from "lucide-react";
import { Modal } from "@/components/ui";

interface NoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialNote?: Note | null;
  initialLinks?: NoteLinks;
  initialTemplateKey?: NoteTemplateKey;
}

export function NoteModal({
  isOpen,
  onClose,
  initialNote,
  initialLinks,
  initialTemplateKey,
}: NoteModalProps) {
  const { dict, lang, showToast } = useApp();
  const { recordNoteSaved } = useGame();
  const { notes, saveNote, archiveNote, deleteNote } = useJournal();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [pinned, setPinned] = useState(false);
  const [links, setLinks] = useState<NoteLinks>({});
  const [templateKey, setTemplateKey] = useState<NoteTemplateKey | undefined>(undefined);

  // Inline confirmation state for archive/delete
  const [confirmAction, setConfirmAction] = useState<"archive" | "delete" | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (initialNote) {
      setTitle(initialNote.title || "");
      setBody(initialNote.body || "");
      setTags(initialNote.tags || []);
      setPinned(initialNote.pinned || false);
      setLinks(initialNote.links || {});
      setTemplateKey(initialNote.templateKey);
    } else {
      setTitle("");
      setBody("");
      setTags([]);
      setPinned(false);
      setLinks(initialLinks || {});
      setTemplateKey(initialTemplateKey);

      if (initialTemplateKey) {
        applyTemplate(initialTemplateKey);
      }
    }

    setConfirmAction(null);
    setTagInput("");
  }, [isOpen, initialNote, initialLinks, initialTemplateKey]);

  useEffect(() => {
    if (confirmAction && cancelButtonRef.current) {
      cancelButtonRef.current.focus();
    }
  }, [confirmAction]);

  useEffect(() => {
    if (!isOpen) {
      dirtyFormRegistry.unregisterForm("note_modal");
      return;
    }

    const isDirty = Boolean(title.trim() || body.trim() || tags.length > 0);
    dirtyFormRegistry.updateForm(
      "note_modal",
      isDirty,
      async () => {
        handleSave();
        return { success: true };
      },
      () => `${title}\n\n${body}`
    );
  }, [isOpen, title, body, tags]);

  useEffect(() => {
    // Esc first cancels an open archive/delete confirmation; otherwise the Modal closes itself.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && confirmAction) {
        e.preventDefault();
        setConfirmAction(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, confirmAction]);

  if (!isOpen) return null;

  const applyTemplate = (key: NoteTemplateKey) => {
    setTemplateKey(key);

    let templateText = "";
    if (key === "session_review") {
      templateText = dict.journal.notes.templateBodySession;
    } else if (key === "weekly_mistake") {
      templateText = dict.journal.notes.templateBodyMistake;
    } else if (key === "idea") {
      templateText = dict.journal.notes.templateBodyIdea;
    } else if (key === "lesson") {
      templateText = dict.journal.notes.templateBodyLesson;
    }

    if (!body) {
      setBody(templateText);
    } else {
      setBody((prev) => `${prev}\n\n${templateText}`);
    }
  };

  const handleAddTag = () => {
    const trimmed = tagInput.trim().toLowerCase().replace(/^#/, "");
    if (!trimmed || tags.includes(trimmed) || tags.length >= 8) return;
    setTags([...tags, trimmed.slice(0, 24)]);
    setTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSave = () => {
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      showToast(dict.journal.notes.emptyBodyError);
      return;
    }

    const nowIso = new Date().toISOString();
    const noteToSave: Note = {
      id: initialNote?.id || `note_${Date.now()}`,
      title: title.trim().slice(0, 80) || undefined,
      body: trimmedBody.slice(0, 5000),
      tags,
      pinned,
      links: Object.keys(links).length > 0 ? links : undefined,
      templateKey,
      createdAt: initialNote?.createdAt || nowIso,
      updatedAt: nowIso,
      archivedAt: initialNote?.archivedAt || null,
    };

    saveNote(noteToSave);

    // Reward Knowledge XP & Quest closure check
    // Only a new note can earn XP: an edit is not a new action
    const rewardRes = initialNote ? { xpAwarded: 0 } : recordNoteSaved(noteToSave, notes);
    if (rewardRes.xpAwarded > 0) {
      showToast(`+${rewardRes.xpAwarded} XP (${dict.stats.knowledge})`);
    } else {
      showToast(
        initialNote
          ? dict.journal.notes.noteUpdatedToast
          : dict.journal.notes.noteSavedToast
      );
    }

    onClose();
  };

  const handleArchiveConfirm = () => {
    if (initialNote) {
      archiveNote(initialNote.id);
      showToast(dict.journal.notes.noteArchivedToast);
      onClose();
    }
  };

  const handleDeleteConfirm = () => {
    if (initialNote) {
      deleteNote(initialNote.id);
      showToast(dict.journal.notes.noteDeletedToast);
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      closeLabel={dict.journal.addTradeModal.closeLabel}
      data-testid="note-modal"
      title={
        <span className="flex items-center gap-2">
          {initialNote ? dict.journal.notes.editNoteTitle : dict.journal.notes.createNoteTitle}
          <button
            type="button"
            onClick={() => setPinned(!pinned)}
            aria-pressed={pinned}
            aria-label={dict.journal.notes.pinTooltip}
            title={dict.journal.notes.pinTooltip}
            className={`grid h-9 w-9 place-items-center rounded-md border transition-colors ${
              pinned ? "border-amber-400/50 bg-amber-400/15 text-amber-300" : "border-line bg-s2 text-mu hover:text-tx"
            }`}
          >
            <Pin size={15} aria-hidden="true" />
          </button>
        </span>
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
                  {initialNote ? (
                    <div className="flex gap-2">
                      {!initialNote.archivedAt && (
                        <button
                          type="button"
                          onClick={() => setConfirmAction("archive")}
                          className="btn-ghost text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1"
                        >
                          <Archive size={14} />
                          <span>{dict.journal.notes.archiveBtn}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setConfirmAction("delete")}
                        className="btn-ghost text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
                      >
                        <Trash2 size={14} />
                        <span>{dict.journal.notes.deleteBtn}</span>
                      </button>
                    </div>
                  ) : (
                    <div />
                  )}
        
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="btn-ghost text-xs py-2 px-4"
                    >
                      {dict.journal.cancel}
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      className="btn-primary text-xs py-2 px-5 font-semibold"
                    >
                      {dict.journal.save}
                    </button>
                  </div>
                </div>
      }
    >
      <div className="space-y-4">
        {/* Inline Confirmation Warning */}
        {confirmAction && (
          <div className="p-3 bg-rose-500/15 border border-rose-500/40 rounded-xl space-y-3">
            <p className="text-xs font-semibold text-rose-200">
              {confirmAction === "archive"
                ? dict.journal.notes.confirmArchive
                : dict.journal.notes.confirmDelete}
            </p>
            <div className="flex justify-end gap-2">
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={() => setConfirmAction(null)}
                className="btn-secondary text-xs py-1.5 px-4"
              >
                {dict.journal.cancel}
              </button>
              <button
                type="button"
                onClick={confirmAction === "archive" ? handleArchiveConfirm : handleDeleteConfirm}
                className="bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs py-1.5 px-4 rounded-lg transition-colors"
              >
                {confirmAction === "archive"
                  ? dict.journal.notes.archiveBtn
                  : dict.journal.notes.deleteBtn}
              </button>
            </div>
          </div>
        )}

        {/* Templates Bar */}
        {!initialNote && (
          <div className="space-y-1">
            <span className="text-[11px] text-mu block font-semibold">
              {dict.journal.notes.templatesTitle}
            </span>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => applyTemplate("session_review")}
                className="px-2.5 py-1 rounded-lg bg-s2 border border-line text-tx hover:border-vi transition-colors font-medium"
              >
                {dict.journal.notes.templateSession}
              </button>
              <button
                type="button"
                onClick={() => applyTemplate("weekly_mistake")}
                className="px-2.5 py-1 rounded-lg bg-s2 border border-line text-tx hover:border-vi transition-colors font-medium"
              >
                {dict.journal.notes.templateMistake}
              </button>
              <button
                type="button"
                onClick={() => applyTemplate("idea")}
                className="px-2.5 py-1 rounded-lg bg-s2 border border-line text-tx hover:border-vi transition-colors font-medium"
              >
                {dict.journal.notes.templateIdea}
              </button>
              <button
                type="button"
                onClick={() => applyTemplate("lesson")}
                className="px-2.5 py-1 rounded-lg bg-s2 border border-line text-tx hover:border-vi transition-colors font-medium"
              >
                {dict.journal.notes.templateLesson}
              </button>
            </div>
          </div>
        )}

        {/* Title Input */}
        <div>
          <label className="text-xs text-mu block mb-1">
            {dict.journal.notes.titleLabel}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 80))}
            maxLength={80}
            placeholder={dict.journal.notes.titlePlaceholder}
            className="input text-xs w-full"
          />
        </div>

        {/* Body Textarea with Counter */}
        <div className="space-y-1">
          <div className="flex justify-between items-center text-xs text-mu">
            <span>{dict.journal.notes.bodyLabel}</span>
            <span>{body.length}/5000</span>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 5000))}
            maxLength={5000}
            rows={8}
            placeholder={dict.journal.notes.bodyPlaceholder}
            className="input text-xs w-full font-mono leading-relaxed"
          />
        </div>

        {/* Tags Section */}
        <div className="space-y-1">
          <label className="text-xs text-mu block font-medium">
            {dict.journal.notes.tagsLabel}
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 rounded-full bg-s2 border border-line text-[11px] text-acc font-semibold flex items-center gap-1"
              >
                #{t}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(t)}
                  className="hover:text-rose-400 font-bold ml-0.5"
                >
                  ×
                </button>
              </span>
            ))}
            {tags.length < 8 && (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder={dict.journal.notes.addTagPlaceholder}
                  className="input text-xs py-0.5 px-2 w-28"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="btn-secondary py-0.5 px-2 text-xs"
                >
                  <Plus size={12} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Links Badge if any */}
        {(links.tradeId || links.instrument || links.strategyId || links.date) && (
          <div className="p-2.5 bg-s2/60 border border-line rounded-xl text-xs text-mu flex flex-wrap items-center gap-2">
            <span className="font-semibold text-tx">
              {dict.journal.notes.linkedToLabel}
            </span>
            {links.instrument && (
              <span className="chip font-bold text-[10px] uppercase">
                {links.instrument}
              </span>
            )}
            {links.tradeId && (
              <span className="badge-free text-[10px]">
                {formatString(dict.journal.notes.linkedTradePrefix, { id: links.tradeId.slice(-6) })}
              </span>
            )}
            {links.date && (
              <span className="chip text-[10px]">{links.date}</span>
            )}
          </div>
        )}

      </div>
    </Modal>
  );
}
