"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notificationRepository as repo, NotificationRepositoryError } from "./repository";
import { PAGE_SIZE, type NotificationError, type NotificationItem } from "./types";

const CHANGED = "ayra:notifications-changed";
export function announceNotificationsChanged() { window.dispatchEvent(new Event(CHANGED)); }
export const errorKind = (e: unknown): NotificationError => e instanceof NotificationRepositoryError ? e.kind : "network";

/** Clear previous identity synchronously; late requests must never reveal a previous account's data. */
export function useUnreadCount(userId: string | undefined) {
  const identity = useRef(userId); identity.current = userId;
  const [state, setState] = useState({ userId, count: 0 });
  useEffect(() => {
    if (!userId) return;
    let live = true;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const count = await repo.count(userId);
        if (live && identity.current === userId) setState({ userId, count });
      } catch { if (live && identity.current === userId) setState({ userId, count: 0 }); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh); window.addEventListener(CHANGED, refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { live = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener(CHANGED, refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [userId]);
  return state.userId === userId ? state.count : 0;
}

export function useNotificationInbox(userId: string | undefined, unread: boolean, type: string) {
  const key = `${userId}:${unread}:${type}`;
  const latest = useRef(key); latest.current = key;
  const sequence = useRef(0);
  const [state, setState] = useState<{ key: string; rows: NotificationItem[]; more: boolean; loading: boolean; error: NotificationError | null }>({ key, rows: [], more: false, loading: true, error: null });
  const [busy, setBusy] = useState(false);
  const loadingPage = useRef(false);
  const current = state.key === key ? state : { key, rows: [], more: false, loading: true, error: null };
  const rowsRef = useRef(current.rows); rowsRef.current = current.rows;
  const load = useCallback(async (append = false) => {
    if (!userId || (append && loadingPage.current)) return;
    loadingPage.current = true;
    const request = ++sequence.current;
    const oldRows = rowsRef.current;
    setState((s) => ({ key, rows: append && s.key === key ? s.rows : [], more: false, loading: true, error: null }));
    try {
      const last = append ? oldRows[oldRows.length - 1] : undefined;
      const rows = await repo.list(userId, unread, type, last);
      if (latest.current === key && sequence.current === request) {
        setState({ key, rows: append ? [...oldRows, ...rows.filter((r) => !oldRows.some((old) => old.id === r.id))] : rows, more: rows.length === PAGE_SIZE, loading: false, error: null });
      }
    } catch (e) {
      if (latest.current === key && sequence.current === request) setState({ key, rows: append ? oldRows : [], more: false, loading: false, error: errorKind(e) });
    } finally { if (sequence.current === request) loadingPage.current = false; }
  }, [userId, unread, type, key]);
  useEffect(() => {
    void load();
    const requests = sequence;
    const refresh = () => { if (!document.hidden) void load(); };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { ++requests.current; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load]);
  const markRead = async (id?: string) => {
    if (!userId || busy) return;
    setBusy(true);
    try {
      await repo.markRead(userId, id);
      if (latest.current === key) { announceNotificationsChanged(); await load(); }
    } catch (e) {
      if (latest.current === key) setState((s) => ({ ...s, error: errorKind(e) }));
    } finally { setBusy(false); }
  };
  return { ...current, busy, load, markRead };
}
