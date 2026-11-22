"use client";

import React, { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/context";
import { AppStorage } from "@/lib/storage";
import { focusStorage, subscribeFocus } from "@/lib/storage/market-focus";
import { captureMarketAccount } from "@/lib/market/account-scope";
import { alertsOf, dueAlerts, type FocusAlertKind, type FocusAlerts } from "@/lib/market/focus-notifications";
import { parseFocus } from "@/lib/market/market-focus";
import { instrumentName, type InstrumentId } from "@/lib/market/instruments";
import { readMarketSettings } from "@/lib/market/settings-store";
import { notificationRepository } from "@/lib/notifications/repository";
import { inQuietHours, shouldStore } from "@/lib/notifications/preferences";
import { defaultSettings } from "@/lib/notifications/types";
import { Button } from "@/components/ui";

/** Visible-page local cues only; never inserts into Inbox or requests browser permission. */
export function MarketFocusNotifications({ space, id, ids, customSession = false }: { space: string; id: InstrumentId; ids: InstrumentId[]; customSession?: boolean }) {
  const { dict } = useApp(), t = dict.market.focus.alerts;
  const [config, setConfig] = useState<FocusAlerts | null>(null), [failed, setFailed] = useState(false), [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false), [messages, setMessages] = useState<{ kind: FocusAlertKind; id: InstrumentId }[]>([]);
  const message = messages[0];
  const [reminder, setReminder] = useState("");
  const [draft, setDraft] = useState<Partial<FocusAlerts> | null>(null);
  const ticket = useRef<number | null>(null);
  const idsKey = ids.join(",");
  const saveSequence = useRef(0);
  useEffect(() => {
    ticket.current = null;
    setConfig(null); setFailed(false); setBusy(false); setDraft(null);
    setMessages(old => old.filter(message => idsKey.split(",").includes(message.id)));
    const saves = saveSequence;
    let live = true, running = false, again = false;
    const scope = captureMarketAccount(() => AppStorage.getUserId());
    const current = () => live && scope.current() && (space === "guest" ? scope.userId === null : space === `account:${scope.userId}`);
    const refresh = async () => {
      if (ticket.current === null) return;
      const readTicket = ticket.current;
      try { const entry = await focusStorage.read(space, id, readTicket); if (current() && ticket.current === readTicket) { const next = alertsOf(entry); setConfig(old => old && old.revision > next.revision ? old : next); setFailed(false); } }
      catch { if (current() && ticket.current === readTicket) { setConfig(null); setFailed(true); } }
    };
    const check = async () => {
      if (document.hidden || !current() || ticket.current === null) return;
      if (running) { again = true; return; }
      running = true;
      try {
        const epoch = await focusStorage.epoch(space), snapshot = await focusStorage.exportSpace(space);
        const canDeliver = () => current() && ticket.current === epoch && !document.hidden;
        if (!canDeliver()) return;
        const entries = snapshot.entries.flatMap(raw => {
          try { const key = (raw as { instrumentId?: string })?.instrumentId; if (!idsKey.split(",").includes(key ?? "")) return []; const entry = parseFocus(raw, space, key as InstrumentId); alertsOf(entry); return [entry]; } catch { return []; }
        });
        const now = Date.now(), hours = readMarketSettings().sessions;
        const candidates = entries.flatMap(entry => dueAlerts(entry, now, hours).map(alert => ({ entry, alert })));
        if (!candidates.length) return;
        // Fail closed: a missing account policy is not permission to ignore a master pause.
        const policy = space === "guest" ? { settings: defaultSettings(), preferences: [] } : await notificationRepository.settings(space.slice(8), "UTC");
        if (!canDeliver()) return;
        let denied = false;
        for (const { entry, alert } of candidates) {
          if (!canDeliver()) break;
          const type = alert.kind === "session" ? "session_open" : `focus_${alert.kind}`;
          if (inQuietHours(policy.settings, new Date()) || !shouldStore(type, policy.settings, policy.preferences, 3, [entry.instrumentId])) { denied = true; continue; }
          if (await focusStorage.claimAlert(space, entry.instrumentId, alert, epoch, hours)) {
            if (canDeliver()) setMessages(old => [...old, { kind: alert.kind, id: entry.instrumentId }].slice(-Math.max(1, idsKey.split(",").length * 3)));
          }
        }
        if (current()) setPaused(denied);
      } catch { if (current()) setPaused(true); }
      finally { running = false; if (again) { again = false; void check(); } }
    };
    const notice = subscribeFocus(event => { if (event.spaceId !== space) return; if (event.instrumentId === null) { ticket.current = null; ++saveSequence.current; setMessages([]); setConfig(null); setFailed(true); return; } void refresh(); void check(); });
    const visible = () => { void refresh(); void check(); };
    void focusStorage.epoch(space).then(value => { if (current()) { ticket.current = value; void refresh(); void check(); } }, () => { if (current()) setFailed(true); });
    const timer = window.setInterval(() => { void check(); }, 20_000);
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    window.addEventListener("ayra:notifications-changed", visible);
    return () => { live = false; scope.dispose(); ++saves.current; notice(); clearInterval(timer); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); window.removeEventListener("ayra:notifications-changed", visible); };
  }, [space, id, idsKey]);
  const save = async (values: { completion?: boolean; session?: boolean; lead?: number; reminder?: number | null }) => {
    if (!config || busy || ticket.current === null) return;
    const epoch = ticket.current;
    const seq = ++saveSequence.current, scope = captureMarketAccount(() => AppStorage.getUserId());
    setDraft(values); setBusy(true);
    try {
      if (!scope.current()) return;
      const result = await focusStorage.configureAlerts(space, id, config.revision, { completion: config.completion, session: config.session, lead: config.lead, reminder: config.reminder && config.reminder > Date.now() ? config.reminder : null, ...values }, epoch);
      if (scope.current() && seq === saveSequence.current) { const next = alertsOf(result); setConfig(old => old && old.revision > next.revision ? old : next); setFailed(false); setReminder(""); }
    } catch { if (scope.current() && seq === saveSequence.current) setFailed(true); }
    finally { if (scope.current() && seq === saveSequence.current) { setBusy(false); setDraft(null); } scope.dispose(); }
  };
  const disabled = !config || busy || failed || ticket.current === null;
  const at = Date.parse(`${reminder}Z`); // Explicitly labelled UTC, never browser-local DST.
  return <div className="mt-4 border-t border-pri/30 pt-3" data-testid="focus-alerts">
    {message && <div role="status" className="mb-3 rounded border border-pri/40 bg-bg p-3 text-sm" data-testid="focus-alert-message"><strong>{instrumentName(message.id, dict.market.instruments)}</strong>: {t[message.kind]} <button type="button" className="ml-2 min-h-[44px] rounded px-2 text-vi focus-visible:ring-2 focus-visible:ring-vi" onClick={() => setMessages(old => old.slice(1))}>{t.dismiss}</button></div>}
    <details><summary className="cursor-pointer rounded py-2 text-xs text-vi focus-visible:ring-2 focus-visible:ring-vi">{t.title}</summary>
      <p className="my-2 text-xs text-mu">{t.local}</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
        <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={draft?.completion ?? config?.completion ?? false} disabled={disabled} onChange={e => void save({ completion: e.target.checked })} />{t.enableCompletion}</label>
        <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={!customSession && (draft?.session ?? config?.session ?? false)} disabled={disabled || customSession} onChange={e => void save({ session: e.target.checked })} />{t.enableSession}</label>
        <label className="flex min-h-[44px] items-center gap-2">{t.lead}<select className="rounded border border-pri bg-bg p-2" disabled={disabled || customSession} value={config?.lead ?? 5} onChange={e => void save({ lead: Number(e.target.value) })}>{[0, 5, 15].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      </div>
      <p className="my-2 text-xs text-mu">{t.sessionHint}</p>
      {customSession && <p role="status" className="my-2 text-xs text-vi">{dict.market.focus.catalog.sessionDisabled}</p>}
      <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-xs">{t.reminderLabel}<input className="mt-1 min-h-[44px] w-full min-w-0 rounded border border-pri bg-bg px-3" type="datetime-local" value={reminder} onChange={e => setReminder(e.target.value)} disabled={disabled} /></label>
        <Button size="sm" disabled={disabled || !Number.isFinite(at) || at <= Date.now()} onClick={() => void save({ reminder: at })}>{t.setReminder}</Button>
        {config?.reminder && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void save({ reminder: null })}>{t.cancelReminder}</Button>}
      </div>
      {config?.reminder && <p className="mt-2 break-words text-xs text-mu">{config.seenReminder >= config.reminder ? t.processed : config.reminder <= Date.now() ? t.elapsed : t.scheduled}: {new Date(config.reminder).toISOString()}</p>}
      <p role={failed || paused ? "alert" : "status"} className="mt-2 text-xs text-mu">{failed ? t.error : paused ? t.paused : busy ? t.pending : config ? config.revision ? t.saved : t.off : t.loading}</p>
      {failed && <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>{t.retry}</Button>}
    </details>
  </div>;
}
