"use client";

import React, { useState } from "react";
import { X } from "lucide-react";
import { useGame } from "@/lib/game-context";
import { useApp } from "@/lib/context";
import { validateNickname } from "@/lib/game";

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EditProfileModal({ isOpen, onClose }: EditProfileModalProps) {
  const { gameState, updateProfile } = useGame();
  const { dict, showToast } = useApp();

  const [name, setName] = useState(gameState.name);
  const [bio, setBio] = useState(gameState.bio || "");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    const val = validateNickname(name);
    if (!val.isValid) {
      const msg = val.errorKey
        ? (dict as any).profile[val.errorKey.split(".")[1]] || "Invalid nickname"
        : "Invalid nickname";
      setErrorMsg(msg);
      return;
    }

    const res = updateProfile(name, bio);
    if (!res.isValid) {
      const msg = res.errorKey
        ? (dict as any).profile[res.errorKey.split(".")[1]] || "Invalid nickname"
        : "Invalid nickname";
      setErrorMsg(msg);
      return;
    }

    setErrorMsg(null);
    showToast(dict.profile.savedToast);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
      <div className="card w-full max-w-md bg-s1 p-6 border border-line shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-mu hover:bg-s2 hover:text-tx"
          aria-label={dict.addModal.close}
        >
          <X size={18} />
        </button>

        <h3 className="font-serif text-xl font-bold text-tx mb-4">
          {dict.profile.editModalTitle}
        </h3>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-tx mb-1">
              {dict.profile.nicknameLabel}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrorMsg(null);
              }}
              className="w-full rounded-xl border border-line bg-s2 px-3 py-2 text-sm text-tx placeholder-mu focus:border-vi focus:outline-none"
              placeholder="TraderOne"
              maxLength={24}
            />
            <p className="text-[11px] text-mu mt-1">
              {dict.profile.nicknameHint}
            </p>
            {errorMsg && (
              <p className="text-[11px] text-red-400 mt-1 font-semibold">
                {errorMsg}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-tx mb-1">
              {dict.profile.bioLabel}
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={2}
              maxLength={120}
              className="w-full rounded-xl border border-line bg-s2 px-3 py-2 text-sm text-tx placeholder-mu focus:border-vi focus:outline-none resize-none"
              placeholder={dict.profile.bioPlaceholder}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost text-xs px-4 py-2"
            >
              {dict.profile.cancelBtn}
            </button>
            <button
              type="submit"
              className="btn text-xs px-4 py-2 bg-vi text-white hover:bg-vi-dk"
            >
              {dict.profile.saveBtn}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
