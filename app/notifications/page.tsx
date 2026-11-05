"use client";

import React, { useCallback } from "react";
import { useRouter } from "next/navigation";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { useAuth } from "@/lib/auth/auth-context";
import { useApp } from "@/lib/context";
import { useUnreadCount } from "@/lib/notifications/use-notifications";
import { safeNotificationHref } from "@/lib/notifications/preferences";

/** Mobile bell opens an ordinary app page; browser Back and direct links work normally. */
export default function NotificationsPage({ searchParams }: { searchParams: { from?: string } }) {
  const { user } = useAuth();
  const { dict } = useApp();
  const router = useRouter();
  const unreadCount = useUnreadCount(user?.id);
  const candidate = safeNotificationHref(typeof searchParams.from === "string" ? searchParams.from : null);
  const backHref = candidate && !candidate.startsWith("/notifications") ? candidate : "/";
  const goBack = useCallback(() => router.replace(backHref), [router, backHref]);
  if (!user) return <p className="text-sm text-mu">{dict.notifications.signIn}</p>;
  return <NotificationCenter key={user.id} presentation="page" unreadCount={unreadCount} onClose={goBack} />;
}
