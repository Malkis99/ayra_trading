"use client";

import React, { useState, useMemo } from "react";
import { useApp } from "@/lib/context";
import { useJournal } from "@/lib/journal/context";
import { Note } from "@/lib/journal/types";
import { NoteModal } from "./NoteModal";
import {
  Search,
  Plus,
  Pin,
  Tag,
  Link as LinkIcon,
  Archive,
  Edit2,
  FileText,
} from "lucide-react";

export function NotesTab() {
  const { dict, lang } = useApp();
  const { notes } = useJournal();

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState("all");
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [selectedLinkType, setSelectedLinkType] = useState("all");
  const [showArchived, setShowArchived] = useState(false);

  // Modal state
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  // Collect all unique user tags across active notes
  const allUserTags = useMemo(() => {
    const set = new Set<string>();
    notes.forEach((n) => {
      if (Array.isArray(n.tags)) {
        n.tags.forEach((t) => set.add(t));
      }
    });
    return Array.from(set).sort();
  }, [notes]);

  // Filter notes
  const filteredNotes = useMemo(() => {
    const nowMs = Date.now();

    return notes
      .filter((n) => {
        // Active vs Archived
        if (showArchived) {
          if (!n.archivedAt) return false;
        } else {
          if (n.archivedAt) return false;
        }

        // Tag filter
        if (selectedTag !== "all" && (!n.tags || !n.tags.includes(selectedTag))) {
          return false;
        }

        // Period filter
        if (selectedPeriod !== "all") {
          const noteMs = new Date(n.createdAt).getTime();
          const diffDays = (nowMs - noteMs) / (1000 * 60 * 60 * 24);
          if (selectedPeriod === "7d" && diffDays > 7) return false;
          if (selectedPeriod === "30d" && diffDays > 30) return false;
          if (selectedPeriod === "90d" && diffDays > 90) return false;
        }

        // Link filter
        if (selectedLinkType !== "all") {
          if (selectedLinkType === "trade" && !n.links?.tradeId) return false;
          if (selectedLinkType === "date" && !n.links?.date) return false;
          if (selectedLinkType === "instrument" && !n.links?.instrument) return false;
          if (selectedLinkType === "strategy" && !n.links?.strategyId) return false;
        }

        // Search text
        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          const matchTitle = (n.title || "").toLowerCase().includes(q);
          const matchBody = (n.body || "").toLowerCase().includes(q);
          const matchTags = (n.tags || []).some((t) => t.toLowerCase().includes(q));
          const matchInst = (n.links?.instrument || "").toLowerCase().includes(q);
          if (!matchTitle && !matchBody && !matchTags && !matchInst) return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Pinned on top
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [notes, showArchived, selectedTag, selectedPeriod, selectedLinkType, searchQuery]);

  const handleOpenCreateModal = () => {
    setEditingNote(null);
    setIsNoteModalOpen(true);
  };

  const handleOpenEditModal = (note: Note) => {
    setEditingNote(note);
    setIsNoteModalOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Header & Main Create Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="h3">{dict.journal.notes.title}</h3>
          <p className="text-xs text-mu mt-0.5">
            {dict.journal.notes.subtitle}
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="btn text-xs py-2 px-4 flex items-center gap-1.5 font-semibold self-start sm:self-auto"
        >
          <Plus size={16} />
          <span>{dict.journal.notes.addNoteBtn}</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="card p-3 space-y-3 border border-line">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mu" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={dict.journal.notes.searchPlaceholder}
              className="input text-xs pl-8 w-full"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`btn-ghost text-xs py-1 px-3 border rounded-xl flex items-center gap-1.5 transition-colors ${
                showArchived
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                  : "border-line text-mu hover:text-tx"
              }`}
            >
              <Archive size={13} />
              <span>
                {showArchived
                  ? dict.journal.notes.showActiveBtn
                  : dict.journal.notes.showArchivedBtn}
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          {/* Tag Filter */}
          <select
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            className="input text-xs"
          >
            <option value="all">{dict.journal.notes.allTags}</option>
            {allUserTags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>

          {/* Period Filter */}
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="input text-xs"
          >
            <option value="all">{dict.journal.tradesTab.periodAll}</option>
            <option value="7d">{dict.journal.tradesTab.period7d}</option>
            <option value="30d">{dict.journal.tradesTab.period30d}</option>
            <option value="90d">{dict.journal.tradesTab.period90d}</option>
          </select>

          {/* Link Filter */}
          <select
            value={selectedLinkType}
            onChange={(e) => setSelectedLinkType(e.target.value)}
            className="input text-xs col-span-2 sm:col-span-1"
          >
            <option value="all">{dict.journal.notes.allLinks}</option>
            <option value="trade">{dict.journal.notes.linkTrade}</option>
            <option value="date">{dict.journal.notes.linkDate}</option>
            <option value="instrument">{dict.journal.notes.linkInstrument}</option>
            <option value="strategy">{dict.journal.notes.linkStrategy}</option>
          </select>
        </div>
      </div>

      {/* Notes Grid List */}
      {filteredNotes.length === 0 ? (
        <div className="card text-center p-8 space-y-3 border-dashed border border-line">
          <FileText size={32} className="mx-auto text-mu opacity-50" />
          <h4 className="font-serif font-bold text-sm text-tx">
            {dict.journal.notes.emptyTitle}
          </h4>
          <p className="text-xs text-mu max-w-sm mx-auto">
            {dict.journal.notes.emptyDesc}
          </p>
          <button
            onClick={handleOpenCreateModal}
            className="btn text-xs py-2 px-4 inline-flex items-center gap-1.5"
          >
            <Plus size={15} />
            <span>{dict.journal.notes.addNoteBtn}</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredNotes.map((note) => (
            <div
              key={note.id}
              onClick={() => handleOpenEditModal(note)}
              className={`card p-4 space-y-3 cursor-pointer hover:border-vi transition-all relative ${
                note.pinned ? "border-amber-500/40 bg-s2/80 shadow-md" : "border-line"
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <h4 className="font-bold text-sm text-tx line-clamp-1">
                  {note.title || (note.body.split("\n")[0] || dict.journal.notes.untitled)}
                </h4>
                {note.pinned && (
                  <Pin size={14} className="text-amber-400 flex-none fill-amber-400/20" />
                )}
              </div>

              {/* Rendered safely as plain text */}
              <p className="text-xs text-tx/80 line-clamp-4 whitespace-pre-wrap font-sans">
                {note.body}
              </p>

              {/* Tags & Links */}
              <div className="space-y-2 pt-2 border-t border-line/40 text-[11px] text-mu">
                {note.tags && note.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {note.tags.map((t) => (
                      <span
                        key={t}
                        className="px-1.5 py-0.2 rounded bg-s1 border border-line/60 text-acc text-[10px] font-semibold"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex justify-between items-center text-[10px] pt-1">
                  <span className="text-mu">
                    {new Date(note.createdAt).toLocaleDateString(
                      lang === "ru" ? "ru-RU" : "en-US",
                      {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      }
                    )}
                  </span>

                  {note.links && Object.keys(note.links).length > 0 && (
                    <div className="flex items-center gap-1 text-acc font-semibold">
                      <LinkIcon size={11} />
                      <span>
                        {note.links.instrument ||
                          (note.links.tradeId ? `#${note.links.tradeId.slice(-4)}` : dict.journal.notes.linkFallback)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Note Edit Modal */}
      <NoteModal
        isOpen={isNoteModalOpen}
        onClose={() => setIsNoteModalOpen(false)}
        initialNote={editingNote}
      />
    </div>
  );
}
