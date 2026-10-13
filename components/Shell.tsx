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
import { AppStorage } from "@/lib/storage";
import { NicknameConflictModal } from "./NicknameConflictModal";
import { SpaceChangeBanner } from "./SpaceChangeBanner";
import { OwnerDiagnosticsBlock } from "@/components/OwnerDiagnosticsBlock";
import { UserCheck } from "lucide-react";

function ShellSkeleton() {
  return (
    <div className="flex h-screen overflow-hidden bg-ink text-tx">
      {/* Sidebar Skeleton */}
      <aside className="hidden h-full w-[220px] flex-col border-r border-line bg-gradient-to-b from-[#17161e] to-[#121117] p-3 md:flex animate-pulse">
        <div className="px-2.5 pb-3.5 pt-1.5 font-serif text-xl font-semibold tracking-widest text-tx/30">
          AYRA<b className="text-go/30">·</b>
        </div>
        <div className="flex flex-col gap-2 pt-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-9 w-full rounded-xl bg-s2/50" />
          ))}
        </div>
        <div className="flex-1" />
        <div className="h-16 w-full rounded-xl bg-s2/50" />
      </aside>

      {/* Main View Area Skeleton */}
      <div className="relative flex flex-1 flex-col min-w-0 h-full overflow-hidden">
        {/* Topbar Skeleton */}
        <header className="flex h-14 items-center justify-between border-b border-line bg-[#16151d] px-4 md:px-6 animate-pulse">
          <div className="h-6 w-24 rounded bg-s2/50" />
          <div className="flex items-center gap-2">
            <div className="h-7 w-16 rounded-lg bg-s2/50" />
            <div className="h-7 w-16 rounded-lg bg-s2/50" />
          </div>
        </header>

        {/* Content Skeleton */}
        <main className="relative z-10 flex-1 overflow-y-auto p-4 md:p-6 space-y-4 animate-pulse">
          <div className="h-28 w-full rounded-2xl bg-s2/40 border border-line/40" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="h-40 rounded-2xl bg-s2/30 border border-line/30" />
            <div className="h-40 rounded-2xl bg-s2/30 border border-line/30" />
          </div>
        </main>
      </div>
    </div>
  );
}

function ShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoaded } = useGame();
  const { dict, isAddTradeModalOpen, setAddTradeModalOpen, isNoteModalOpen, setNoteModalOpen, noteModalLinks } = useApp();
  const {
    authState,
    loadingTimedOut,
    user,
    profile,
    isLoading: authLoading,
    isGuest,
    isConfigured,
    guestDismissed,
    lateSignInNotice,
    dismissLateSignInNotice,
    chooseGuestExplicitly,
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
        const saved = AppStorage.getItem("ayra_demo_v1");
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

      // If local onboarding not done or cloud nick still empty and no conflict modal -> go to /awakening (unless on /login where multi-tab card is rendered)
      if (pathname !== "/awakening" && pathname !== "/login" && !conflictNickname) {
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

  // When authState === 'loading', always show neutral skeleton (never show guest or account data)
  if (!isLoaded || authState === "loading") {
    if (loadingTimedOut) {
      return (
        <div className="flex h-screen w-full flex-col items-center justify-center p-4 bg-ink text-tx">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-6 text-center space-y-4 shadow-2xl backdrop-blur-md">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-violet/20 text-violet-glow border border-violet/30 font-serif text-xl font-bold">
              A
            </div>
            <div className="space-y-1">
              <h2 className="font-serif text-lg font-bold text-tx">{dict.auth.checkingAuth}</h2>
            </div>
            <button
              type="button"
              onClick={chooseGuestExplicitly}
              className="w-full rounded-xl bg-violet py-3 text-xs font-semibold text-white shadow-lg shadow-violet/30 hover:bg-violet-glow transition cursor-pointer"
            >
              {dict.auth.continueAsGuestBtn}
            </button>
            <div className="pt-2 text-left">
              <OwnerDiagnosticsBlock />
            </div>
          </div>
        </div>
      );
    }
    return <ShellSkeleton />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-ink text-tx">
      <SpaceChangeBanner />
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
