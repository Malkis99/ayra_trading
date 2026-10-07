"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { ArrowLeftRight, Edit3, Smile, Mail, Calendar, X, ArrowLeft } from "lucide-react";
import { formatString } from "@/lib/i18n";

export function AddModal() {
  const { isAddModalOpen, setAddModalOpen, addModalTab, setAddModalTab, setAddTradeModalOpen, showToast, dict } = useApp();
  const { addPost } = useGame();

  const [postType, setPostType] = useState<string>("analysis");
  const [postText, setPostText] = useState<string>("");

  if (!isAddModalOpen) return null;

  const actions = [
    { key: "trade", label: dict.addModal.actions.trade, icon: ArrowLeftRight },
    { key: "note", label: dict.addModal.actions.note, icon: Edit3 },
    { key: "emotion", label: dict.addModal.actions.emotion, icon: Smile },
    { key: "post", label: dict.addModal.actions.post, icon: Mail },
    { key: "event", label: dict.addModal.actions.event, icon: Calendar },
  ];

  const postSubtypes = [
    { key: "analysis", label: dict.addModal.subtypes.analysis },
    { key: "trade", label: dict.addModal.subtypes.trade },
    { key: "education", label: dict.addModal.subtypes.education },
    { key: "question", label: dict.addModal.subtypes.question },
    { key: "progress", label: dict.addModal.subtypes.progress },
  ];

  const handlePublish = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = postText.trim();
    if (!trimmed) return;

    const selectedSubtype = postSubtypes.find((s) => s.key === postType);
    const subtypeLabel = selectedSubtype?.label || "";
    const fullContent = `[${subtypeLabel}] ${trimmed}`;

    addPost(fullContent);
    setPostText("");
    setAddModalOpen(false);
    showToast(dict.chronicleEvents.postPublished);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) setAddModalOpen(false);
      }}
    >
      <div className="relative w-full max-w-md rounded-2xl border border-line bg-s1 p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            {addModalTab !== "grid" && (
              <button
                type="button"
                onClick={() => setAddModalTab("grid")}
                className="p-1 text-mu hover:text-tx transition-colors cursor-pointer"
                aria-label={dict.profile.back}
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <h3 className="font-serif text-lg font-semibold text-tx">
              {addModalTab === "post"
                ? dict.addModal.createPostTitle
                : dict.addModal.title}
            </h3>
          </div>
          <button
            onClick={() => setAddModalOpen(false)}
            className="text-mu hover:text-tx p-1 cursor-pointer"
            aria-label={dict.addModal.close}
          >
            <X size={18} />
          </button>
        </div>

        {addModalTab === "grid" ? (
          <div>
            <p className="text-xs text-mu mb-4">{dict.addModal.subtitle}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {actions.map((act) => {
                const Icon = act.icon;
                return (
                  <button
                    key={act.key}
                    onClick={() => {
                      if (act.key === "trade") {
                        setAddModalOpen(false);
                        setAddTradeModalOpen(true);
                      } else if (act.key === "post") {
                        setAddModalTab("post");
                      } else {
                        setAddModalOpen(false);
                        showToast(formatString(dict.search.formToast, { action: act.label }));
                      }
                    }}
                    className="flex flex-col items-center gap-2 rounded-xl border border-line bg-s2 p-4 text-center transition-all hover:border-vi hover:bg-pri/20 cursor-pointer"
                  >
                    <div className="grid h-10 w-10 place-items-center rounded-lg bg-pri/30 text-vi">
                      <Icon size={20} />
                    </div>
                    <span className="text-xs font-medium text-tx">{act.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <form onSubmit={handlePublish} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-mu">
                {dict.addModal.postType}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {postSubtypes.map((sub) => {
                  const isActive = postType === sub.key;
                  return (
                    <button
                      key={sub.key}
                      type="button"
                      onClick={() => setPostType(sub.key)}
                      className={`chip text-[11px] cursor-pointer transition-colors ${
                        isActive ? "border-vi bg-pri/30 text-tx font-semibold" : ""
                      }`}
                    >
                      {sub.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <textarea
                value={postText}
                onChange={(e) => setPostText(e.target.value.slice(0, 280))}
                maxLength={280}
                rows={4}
                placeholder={dict.profile.posts.placeholder}
                className="w-full rounded-xl border border-line bg-s2 p-3 text-xs text-tx focus:outline-none focus:border-vi"
              />
              <div className="flex justify-between items-center text-[11px] text-mu">
                <span className="italic">{dict.profile.posts.disclaimer}</span>
                <span>{postText.length}/280</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="btn-ghost text-xs py-2 px-4 cursor-pointer"
              >
                {dict.profile.wardrobe.cancelAction}
              </button>
              <button
                type="submit"
                disabled={!postText.trim()}
                className="btn text-xs py-2 px-5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {dict.profile.posts.publishBtn}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
