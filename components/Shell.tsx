"use client";

import React, { useEffect, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppProvider } from "@/lib/context";
import { GameProvider, useGame } from "@/lib/game-context";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { BottomNav } from "@/components/BottomNav";
import { Starfield } from "@/components/Starfield";
import { AddModal } from "@/components/AddModal";
import { AddTradeModal } from "@/components/AddTradeModal";
import { NoteModal } from "@/components/journal/NoteModal";
import { SearchModal } from "@/components/SearchModal";
import { Toast } from "@/components/Toast";
import { Language } from "@/lib/i18n/types";
import { JournalProvider } from "@/lib/journal/context";
import { AuthProvider, useAuth } from "@/lib/auth/auth-context";
import { useApp } from "@/lib/context";
import { sanitizeRedirectUrl } from "@/lib/auth/redirect-whitelist";
import { NicknameConflictModal } from "./NicknameConflictModal";
import { UserCheck } from "lucide-react";

function ShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoaded } = useGame();
  const { dict, isAddTradeModalOpen, setAddTradeModalOpen, isNoteModalOpen, setNoteModalOpen, noteModalLinks } = useApp();
  const {
    user,
    profile,
    isLoading: authLoading,
    isGuest,
    isConfigured,
    guestDismissed,
    lateSignInNotice,
    dismissLateSignInNotice,
    saveNickname,
  } = useAuth();

  const [conflictNickname, setConflictNickname] = useState<string | null>(null);

  const isPublicPath = ["/login", "/auth/callback", "/legal/terms", "/legal/privacy", "/logout"].some(
    (p) => pathname?.startsWith(p)
  );

  // Migration & routing logic
  const handleAuthAndLocalSync = useCallback(async () => {
    if (authLoading || !isLoaded) return;

    // 1. If Supabase is NOT configured and on /login, send to /
    if (!isConfigured && pathname === "/login") {
      router.replace("/");
      return;
    }

    // 2. If Supabase IS configured, no session, and !guestDismissed, send to /login
    if (isConfigured && isGuest && !guestDismissed && !isPublicPath) {
      const nextParam = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${nextParam}`);
      return;
    }

    // 3. If logged in, but cloud profile has no nickname yet
    if (user && profile && !profile.nickname) {
      try {
        const saved = localStorage.getItem("ayra_demo_v1");
        if (saved) {
          const parsed = JSON.parse(saved);
          const localNick = parsed.name?.trim();
          const localDone = parsed.onboarding?.status === "done";

          if (localDone && localNick) {
            // Attempt to save local nickname to cloud profile
            const res = await saveNickname(localNick);
            if (!res.success) {
              // Nickname taken -> show conflict modal
              setConflictNickname(localNick);
              return;
            }
          }
        }
      } catch {
        // ignore
      }

      // If local onboarding not done or cloud nick still empty and no conflict modal -> go to /awakening
      if (pathname !== "/awakening" && !conflictNickname) {
        router.replace("/awakening");
      }
    }

    // 4. If logged in with nickname, and user is on /login
    if (user && profile?.nickname && pathname === "/login") {
      router.replace("/");
    }
  }, [
    authLoading,
    isLoaded,
    isConfigured,
    isGuest,
    guestDismissed,
    isPublicPath,
    pathname,
    user,
    profile,
    saveNickname,
    conflictNickname,
    router,
  ]);

  useEffect(() => {
    handleAuthAndLocalSync();
  }, [handleAuthAndLocalSync]);

  if (pathname === "/awakening") {
    return <>{children}</>;
  }

  if (!isLoaded || (authLoading && !guestDismissed)) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-ink text-tx">
        <div className="font-serif text-xl font-bold tracking-wider text-tx animate-pulse">AYRA</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-ink text-tx">
      {/* Late Sign-In Notice Banner */}
      {lateSignInNotice && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-violet-glow bg-card/95 p-3.5 shadow-2xl backdrop-blur-md text-xs text-tx">
          <UserCheck className="h-4 w-4 text-violet-glow" />
          <span>{dict.auth.signedInBanner}</span>
          <button
            type="button"
            onClick={dismissLateSignInNotice}
            className="rounded-lg bg-violet px-3 py-1 font-semibold text-white hover:bg-violet-glow cursor-pointer"
          >
            {dict.auth.signedInContinue}
          </button>
        </div>
      )}

      {/* Nickname Conflict Resolver Modal */}
      {conflictNickname && (
        <NicknameConflictModal
          initialNickname={conflictNickname}
          onResolved={() => {
            setConflictNickname(null);
            router.replace("/");
          }}
        />
      )}

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
      <AddTradeModal
        isOpen={isAddTradeModalOpen}
        onClose={() => setAddTradeModalOpen(false)}
      />
      <NoteModal
        isOpen={isNoteModalOpen}
        onClose={() => setNoteModalOpen(false)}
        initialLinks={noteModalLinks}
      />
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
      <AuthProvider>
        <GameProvider>
          <JournalProvider>
            <ShellContent>{children}</ShellContent>
          </JournalProvider>
        </GameProvider>
      </AuthProvider>
    </AppProvider>
  );
}
