"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppProvider } from "@/lib/context";
import { GameProvider, useGame } from "@/lib/game-context";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { BottomNav } from "@/components/BottomNav";
import { Starfield } from "@/components/Starfield";
import { AddModal } from "@/components/AddModal";
import { SearchModal } from "@/components/SearchModal";
import { Toast } from "@/components/Toast";
import { Language } from "@/lib/i18n/types";

function ShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoaded } = useGame();
  const [isCleanRedirecting, setIsCleanRedirecting] = useState<boolean>(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (pathname === "/awakening") return;

    try {
      const saved = localStorage.getItem("ayra_demo_v1");
      if (!saved) {
        setIsCleanRedirecting(true);
        router.replace("/awakening");
      }
    } catch {
      // ignore storage errors
    }
  }, [isLoaded, pathname, router]);

  if (pathname === "/awakening") {
    return <>{children}</>;
  }

  if (!isLoaded || isCleanRedirecting) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-ink text-tx">
        <div className="font-serif text-xl font-bold tracking-wider text-tx animate-pulse">AYRA</div>
      </div>
    );
  }

  return (
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
  );
}

export function Shell({
  children,
  initialLang = "ru",
}: {
  children: React.ReactNode;
  initialLang?: Language;
}) {
  return (
    <AppProvider initialLang={initialLang}>
      <GameProvider>
        <ShellContent>{children}</ShellContent>
      </GameProvider>
    </AppProvider>
  );
}
