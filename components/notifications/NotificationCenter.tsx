"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Check, ChevronLeft, X } from "lucide-react";
import { Popover, useOutsideClose } from "@/components/ui/forms/popover";
import { Select } from "@/components/ui/forms/Select";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { TYPE_CODES, TYPES, isNotificationType } from "@/lib/notifications/registry";
import { safeNotificationHref } from "@/lib/notifications/preferences";
import { useNotificationInbox } from "@/lib/notifications/use-notifications";

type Props = {
  onClose: () => void;
  unreadCount: number;
} & ({ presentation?: "popover"; anchor: React.RefObject<HTMLElement>; trigger: React.RefObject<HTMLButtonElement> }
  | { presentation: "page"; anchor?: never; trigger?: never });

export function NotificationCenter({ onClose, anchor, trigger: suppliedTrigger, unreadCount, presentation = "popover" }: Props) {
  const fallbackTrigger = useRef<HTMLButtonElement>(null);
  const trigger = suppliedTrigger ?? fallbackTrigger;
  const isPage = presentation === "page";
  const { dict, lang } = useApp();
  const { user } = useAuth();
  const t = dict.notifications;
  const [unread, setUnread] = useState(false);
  const [type, setType] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const filterId = useId();
  // Select's portalled list belongs to this popover's interaction boundary.
  const filterList = useMemo(() => ({ get current() { return document.getElementById(`${filterId}-list`); } }), [filterId]);
  useOutsideClose([trigger, panelRef, filterList], !isPage, onClose);
  const inbox = useNotificationInbox(user?.id, unread, type);
  const close = () => { onClose(); trigger.current?.focus(); };
  useEffect(() => {
    let frame = 0;
    let filterFrame = 0;
    const focusPanel = () => {
      const panel = panelRef.current;
      // Placement is measured by the shared Popover before it becomes visible.
      const first = panel?.querySelector<HTMLButtonElement>("[data-autofocus]");
      if (!panel || !first || getComputedStyle(first).visibility === "hidden") { frame = requestAnimationFrame(focusPanel); return; }
      first?.focus();
    };
    if (!isPage) frame = requestAnimationFrame(focusPanel);
    const focusFilter = () => {
      const list = filterList.current;
      if (!list) return;
      if (getComputedStyle(list).visibility === "hidden") { filterFrame = requestAnimationFrame(focusFilter); return; }
      if (panelRef.current?.contains(document.activeElement)) list.focus();
    };
    const observer = new MutationObserver(() => { if (filterList.current) filterFrame = requestAnimationFrame(focusFilter); });
    observer.observe(document.body, { childList: true });
    const inside = (target: Node) => [trigger, panelRef, filterList].some((ref) => ref.current?.contains(target));
    const onKey = (event: KeyboardEvent) => {
      if (!isPage && event.key === "Tab" && !filterList.current) {
        const controls = panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]');
        const edge = event.shiftKey ? controls?.[0] : controls?.[controls.length - 1];
        if (edge && document.activeElement === edge) { event.preventDefault(); onClose(); trigger.current?.focus(); return; }
      }
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        if (filterList.current) { panelRef.current?.querySelector<HTMLButtonElement>('[role="combobox"][aria-expanded="true"]')?.click(); return; }
        if (!isPage) { onClose(); trigger.current?.focus(); }
      }
    };
    const onFocus = (event: FocusEvent) => { if (!isPage && event.target instanceof Node && !inside(event.target)) onClose(); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(filterFrame); observer.disconnect(); window.removeEventListener("keydown", onKey); document.removeEventListener("focusin", onFocus); };
  }, [onClose, trigger, filterList, isPage]);

  const content = <div data-testid="notification-center" className={`flex min-h-0 flex-col text-sm ${isPage ? "min-h-[calc(100dvh-10rem)] pb-[env(safe-area-inset-bottom)]" : ""}`}>
      <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
        {isPage && <button ref={fallbackTrigger} type="button" onClick={onClose} aria-label={t.back} className="-ml-2 grid h-9 w-9 place-items-center rounded-lg text-mu hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"><ChevronLeft size={20} aria-hidden="true" /></button>}
        {isPage ? <h1 className="font-serif text-xl font-bold text-tx">{t.title}</h1> : <h2 className="font-semibold text-tx">{t.title}</h2>}
        {unreadCount > 0 && <span className="rounded-full bg-pri/25 px-1.5 py-0.5 text-[10px] text-vi" aria-label={`${t.unread}: ${unreadCount}`}>{unreadCount}</span>}
        {!isPage && <button type="button" onClick={close} aria-label={t.close} className="-mr-1 ml-auto grid h-8 w-8 place-items-center rounded-lg text-mu hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"><X size={16} aria-hidden="true" /></button>}
      </div>
      <div className="shrink-0 space-y-2 px-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex rounded-lg bg-s2/60 p-0.5 text-xs" role="group" aria-label={t.title}>
            {[false, true].map((value) => <button type="button" key={String(value)} data-autofocus={!value ? "" : undefined} aria-pressed={unread === value} onClick={() => setUnread(value)}
              className={`rounded-md px-2.5 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi ${unread === value ? "bg-s1 text-tx shadow-sm" : "text-mu hover:text-tx"}`}>{value ? t.unread : t.all}</button>)}
          </div>
          {unreadCount > 0 && <button type="button" className="py-2 text-[11px] text-mu hover:text-vi disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi" disabled={inbox.busy || !!inbox.error} onClick={() => void inbox.markRead()}>{t.readAll}</button>}
        </div>
        <Select id={filterId} aria-label={t.filterType} value={type} onChange={setType} searchable={false}
          options={[{ value: "", label: t.allTypes }, ...TYPE_CODES.map((code) => ({ value: code, label: t.types[code] }))]} />
      </div>
      <div className={`min-h-0 flex-1 border-t border-line/60 ${isPage ? "" : "overflow-y-auto overscroll-contain"}`} data-testid="notification-list">
        {inbox.error && <div role="alert" className="px-4 py-5 text-xs text-mu"><p>{inbox.error === "setup" ? t.setup : t.error}</p><button type="button" className="mt-2 py-1 text-vi" onClick={() => void inbox.load()}>{t.retry}</button></div>}
        {inbox.loading && <p role="status" className="px-4 py-5 text-xs text-mu">{t.loading}</p>}
        {!inbox.loading && !inbox.error && !inbox.rows.length && <div className="flex flex-col items-center gap-2 px-4 py-8 text-xs text-mu"><Bell size={24} strokeWidth={1.5} aria-hidden="true" /><p>{t.empty}</p></div>}
        <ul className="divide-y divide-line/50">
          {inbox.rows.map((item) => {
            const known = isNotificationType(item.type_code);
            const market = known && ["market", "price"].includes(TYPES[item.type_code as keyof typeof TYPES].group);
            const href = safeNotificationHref(item.href);
            return <li key={item.id} className={`space-y-1.5 px-4 py-3 [overflow-wrap:anywhere] ${item.read_at ? "text-mu" : "bg-pri/[0.06] text-tx"}`} data-testid="notification-item">
              <div className="flex items-start gap-2"><span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.read_at ? "bg-transparent" : "bg-vi"}`} /><h3 className="text-xs font-semibold">{known ? t.types[item.type_code as keyof typeof TYPES] : t.generic}</h3>{!item.read_at && <span className="sr-only">{t.unread}</span>}</div>
              {item.payload.subject && <p className="text-xs">{item.payload.subject}</p>}
              {(item.payload.actual || item.payload.previous) && <p className="text-xs">{item.payload.actual && <span>{t.actual}: {item.payload.actual}</span>}{item.payload.previous && <span className="ml-2 text-mu">{t.previous}: {item.payload.previous}</span>}</p>}
              <div className="flex flex-wrap gap-x-2 text-[10px] text-mu">{item.payload.source && <span>{item.payload.source}</span>}<time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString(lang === "ru" ? "ru-RU" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></div>
              {market && <p className="text-[10px] text-mu">{t.disclaimer}</p>}
              <div className="flex items-center gap-3 text-[11px]">
                {href && <Link href={href} onClick={isPage ? undefined : onClose} className="py-1 text-mu hover:text-vi">{t.open}</Link>}
                {!item.read_at && <button type="button" className="inline-flex items-center gap-1 py-1 text-mu hover:text-vi disabled:opacity-50" disabled={inbox.busy} onClick={() => void inbox.markRead(item.id)}><Check size={12} aria-hidden="true" />{t.read}</button>}
              </div>
            </li>;
          })}
        </ul>
        {inbox.more && <button type="button" className="w-full py-3 text-xs text-mu hover:text-vi" disabled={inbox.loading} onClick={() => void inbox.load(true)}>{t.more}</button>}
      </div>
      <Link className="shrink-0 border-t border-line/60 px-4 py-3 text-center text-xs text-mu hover:text-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vi" href="/settings/notifications" onClick={isPage ? undefined : onClose}>{t.settings}</Link>
    </div>;
  if (isPage) return <section ref={panelRef} className="mx-auto max-w-2xl" aria-label={t.title}>{content}</section>;
  return <Popover id="notification-center-popover" anchor={anchor!} open panelRef={panelRef} role="dialog" aria-label={t.title} minWidth={400} preferredHeight={560}
    className="rounded-2xl !max-h-[min(560px,calc(100dvh-72px-env(safe-area-inset-bottom)))] max-md:!left-[max(8px,env(safe-area-inset-left))] max-md:!right-[max(8px,env(safe-area-inset-right))] max-md:!w-auto">
    {content}
  </Popover>;
}
