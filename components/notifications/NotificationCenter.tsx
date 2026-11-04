"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Drawer } from "@/components/ui/Drawer";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { TYPE_CODES, TYPES, isNotificationType } from "@/lib/notifications/registry";
import { safeNotificationHref } from "@/lib/notifications/preferences";
import { useNotificationInbox } from "@/lib/notifications/use-notifications";

export function NotificationCenter({ onClose }: { onClose: () => void }) {
  const { dict, lang } = useApp();
  const { user } = useAuth();
  const t = dict.notifications;
  const [unread, setUnread] = useState(false);
  const [type, setType] = useState("");
  const inbox = useNotificationInbox(user?.id, unread, type);
  return (
    <Drawer isOpen onClose={onClose} title={t.title} closeLabel={t.close} width="lg" data-testid="notification-center"
      footer={<Link className="text-sm text-vi underline" href="/settings/notifications" onClick={onClose}>{t.settings}</Link>}>
      <div className="space-y-4 text-sm">
        <p className="text-xs text-mu">{t.retention}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost px-3 py-2" aria-pressed={!unread} onClick={() => setUnread(false)}>{t.all}</button>
          <button className="btn-ghost px-3 py-2" aria-pressed={unread} onClick={() => setUnread(true)}>{t.unread}</button>
          <button className="btn-ghost px-3 py-2" disabled={inbox.busy || inbox.loading || !!inbox.error || !inbox.rows.length} onClick={() => void inbox.markRead()}>{t.readAll}</button>
        </div>
        <label className="block space-y-1">
          <span>{t.filterType}</span>
          <select className="w-full rounded-lg border border-line bg-s1 p-2" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{t.allTypes}</option>
            {TYPE_CODES.map((code) => <option key={code} value={code}>{t.types[code]}</option>)}
          </select>
        </label>
        {inbox.error && <div role="alert" className="rounded-xl border border-line p-3"><p>{inbox.error === "setup" ? t.setup : t.error}</p><button className="btn-ghost mt-2 p-2" onClick={() => void inbox.load()}>{t.retry}</button></div>}
        {inbox.loading && <p role="status">{t.loading}</p>}
        {!inbox.loading && !inbox.error && !inbox.rows.length && <p className="rounded-xl border border-line p-5 text-mu">{t.empty}</p>}
        <ul className="space-y-3">
          {inbox.rows.map((item) => {
            const known = isNotificationType(item.type_code);
            const market = known && ["market", "price"].includes(TYPES[item.type_code as keyof typeof TYPES].group);
            const href = safeNotificationHref(item.href);
            return <li key={item.id} className={`space-y-2 rounded-xl border p-3 ${item.read_at ? "border-line bg-s1" : "border-vi/60 bg-pri/10"}`} data-testid="notification-item">
              <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{known ? t.types[item.type_code as keyof typeof TYPES] : t.generic}</h3>{!item.read_at && <span className="text-xs text-vi">{t.unread}</span>}</div>
              {item.payload.subject && <p className="break-words">{item.payload.subject}</p>}
              {item.payload.actual && <p>{t.actual}: {item.payload.actual}</p>}
              {item.payload.previous && <p>{t.previous}: {item.payload.previous}</p>}
              {item.payload.source && <p className="text-xs text-mu">{t.source}: {item.payload.source}</p>}
              <time className="block text-xs text-mu" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString(lang === "ru" ? "ru-RU" : "en-US")}</time>
              {market && <p className="text-xs text-mu">{t.disclaimer}</p>}
              <div className="flex flex-wrap gap-3">
                {href && <Link href={href} onClick={onClose} className="text-vi underline">{t.open}</Link>}
                {!item.read_at && <button className="text-vi underline disabled:opacity-50" disabled={inbox.busy} onClick={() => void inbox.markRead(item.id)}>{t.read}</button>}
              </div>
            </li>;
          })}
        </ul>
        {inbox.more && <button className="btn-ghost w-full p-3" disabled={inbox.loading} onClick={() => void inbox.load(true)}>{t.more}</button>}
      </div>
    </Drawer>
  );
}
