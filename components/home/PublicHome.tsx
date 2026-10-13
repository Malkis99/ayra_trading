"use client";

import React from "react";
import { useAuth } from "@/lib/auth/auth-context";
import {
  CalendarMiniCard,
  CommunityFeedCard,
  FinancialDisclaimer,
  MarketMiniCard,
  PublicWelcomeCard,
  QuestExampleCard,
  SignInPromptCard,
  TopicOfDayCard,
} from "./SharedBlocks";

/** Home for visitors who are not signed in: shared content only, no personal data. */
export function PublicHome() {
  const { setGuestDismissed } = useAuth();
  return (
    <div className="space-y-4">
      <PublicWelcomeCard />
      <SignInPromptCard onContinueAsGuest={() => setGuestDismissed(true)} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <MarketMiniCard />
          <CalendarMiniCard />
        </div>
        <div className="space-y-4">
          <TopicOfDayCard />
          <QuestExampleCard />
          <CommunityFeedCard />
        </div>
      </div>
      <FinancialDisclaimer />
    </div>
  );
}
