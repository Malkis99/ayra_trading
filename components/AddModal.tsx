"use client";

import React from "react";
import { useApp } from "@/lib/context";
import { ArrowLeftRight, Edit3, Smile, Mail, Calendar, X } from "lucide-react";
import { formatString } from "@/lib/i18n";

export function AddModal() {
  const { isAddModalOpen, setAddModalOpen, showToast, dict } = useApp();

  if (!isAddModalOpen) return null;

  const actions = [
    { label: dict.addModal.actions.trade, icon: ArrowLeftRight },
    { label: dict.addModal.actions.note, icon: Edit3 },
    { label: dict.addModal.actions.emotion, icon: Smile },
    { label: dict.addModal.actions.post, icon: Mail },
    { label: dict.addModal.actions.event, icon: Calendar },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) setAddModalOpen(false);
      }}
    >
      <div className="relative w-full max-w-md rounded-2xl border border-line bg-s1 p-6 shadow-2xl">
        <button
          onClick={() => setAddModalOpen(false)}
          className="absolute right-4 top-4 text-mu hover:text-tx"
          aria-label={dict.addModal.close}
        >
          <X size={18} />
        </button>

        <h3 className="font-serif text-lg font-semibold text-tx">{dict.addModal.title}</h3>
        <p className="mt-1 text-xs text-mu">{dict.addModal.subtitle}</p>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {actions.map((act) => {
            const Icon = act.icon;
            return (
              <button
                key={act.label}
                onClick={() => {
                  setAddModalOpen(false);
                  showToast(formatString(dict.search.formToast, { action: act.label }));
                }}
                className="flex flex-col items-center gap-2 rounded-xl border border-line bg-s2 p-4 text-center transition-all hover:border-vi hover:bg-pri/20"
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
    </div>
  );
}
