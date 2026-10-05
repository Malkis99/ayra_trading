"use client";

import React from "react";
import { AppProvider } from "@/lib/context";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { BottomNav } from "@/components/BottomNav";
import { Starfield } from "@/components/Starfield";
import { AddModal } from "@/components/AddModal";
import { SearchModal } from "@/components/SearchModal";
import { Toast } from "@/components/Toast";
import { Language } from "@/lib/i18n/types";

export function Shell({
  children,
  initialLang = "ru",
}: {
  children: React.ReactNode;
  initialLang?: Language;
}) {
  return (
    <AppProvider initialLang={initialLang}>
      <div className="flex h-screen overflow-hidden bg-ink text-tx">
        {/* Fixed Desktop Sidebar */}
        <Sidebar />

        {/* Main View Area */}
        <div className="relative flex flex-1 flex-col min-w-0 h-full overflow-hidden">
          {/* Canvas Starfield Particles */}
          <Starfield />

          {/* Top Header Bar */}
          <Topbar />

          {/* Internal Scrollable Main Content */}
          <main className="relative z-10 flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
            {children}
          </main>
        </div>

        {/* Mobile Bottom Navigation */}
        <BottomNav />

        {/* Overlay Modals & Toasts */}
        <AddModal />
        <SearchModal />
        <Toast />
      </div>
    </AppProvider>
  );
}
