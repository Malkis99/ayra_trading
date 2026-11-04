"use client";

import React, { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { Toggle } from "@/components/ui/forms/choice";
import { InstrumentPicker } from "@/components/market/InstrumentPicker";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { CHANNELS, TYPES, TYPE_CODES, channelAvailable, type NotificationChannel, type NotificationType } from "@/lib/notifications/registry";
import { notificationRepository as repo } from "@/lib/notifications/repository";
import { defaultSettings, type NotificationPreference, type NotificationSettings as Settings, type NotificationError } from "@/lib/notifications/types";
import { preferenceEnabled, validSettings } from "@/lib/notifications/preferences";
import { errorKind } from "@/lib/notifications/use-notifications";

export function NotificationSettings() {
  const { user, profile } = useAuth();
  const { dict } = useApp();
  return user ? <AccountSettings key={user.id} userId={user.id} timezone={profile?.timezone ?? "UTC"} /> : <p className="card text-sm text-mu">{dict.notifications.signIn}</p>;
}

function AccountSettings({ userId, timezone }: { userId: string; timezone: string }) {
  const { dict } = useApp();
  const t = dict.notifications;
  const [settings, setSettings] = useState<Settings>(() => defaultSettings(timezone));
  const [prefs, setPrefs] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [error, setError] = useState<NotificationError | null>(null);
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      if (dirtyRef.current || document.hidden) return;
      try {
        const value = await repo.settings(userId, timezone);
        if (live && !dirtyRef.current) { setSettings(value.settings); setPrefs(value.preferences); setError(null); setLoaded(true); }
      } catch (e) { if (live) setError(errorKind(e)); }
      finally { if (live) setLoading(false); }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { live = false; window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, [userId, timezone, retry]);
  const change = (patch: Partial<Settings>) => {
    dirtyRef.current = true; setDirty(true); setSaved(false); setSettings((s) => ({ ...s, ...patch }));
  };
  const changePreference = (type: NotificationType, channel: NotificationChannel, enabled: boolean) => {
    if (!channelAvailable(type, channel) || (TYPES[type].critical && channel === "site")) return;
    dirtyRef.current = true; setDirty(true); setSaved(false);
    setPrefs((p) => [...p.filter((x) => x.type_code !== type || x.channel_code !== channel), { type_code: type, channel_code: channel, enabled }]);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validSettings(settings) || saving) return;
    setSaving(true); setSaved(false);
    try { await repo.save(userId, settings, prefs); dirtyRef.current = false; setDirty(false); setError(null); setSaved(true); }
    catch (e) { setError(errorKind(e)); }
    finally { setSaving(false); }
  };
  const blocked = loading || !loaded || error === "setup" || saving;
  return <form onSubmit={save} className="space-y-4" data-testid="notification-settings">
    <p className="rounded-xl border border-line bg-s1 p-3 text-xs text-mu">{t.foundation}</p>
    {loading && <p role="status">{t.loading}</p>}
    {error && <div role="alert" className="card text-sm"><p>{error === "setup" ? t.setup : t.error}</p><button type="button" className="btn-ghost mt-2 p-2" onClick={() => { if (dirty) { setError(null); } else { setLoading(true); setRetry((r) => r + 1); } }}>{t.retry}</button></div>}
    <fieldset disabled={blocked} className="card min-w-0 space-y-4 disabled:opacity-60">
      <Toggle label={t.disableAll} description={t.securityException} checked={settings.all_disabled} onChange={(all_disabled) => change({ all_disabled })} />
      <p className="text-xs text-mu">{t.securitySoon}</p>
      <Toggle label={t.quiet} description={t.quietHelp} checked={settings.quiet_enabled} onChange={(quiet_enabled) => change({ quiet_enabled })} />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 space-y-1 text-sm"><span className="block">{t.quietStart}</span><input type="time" className="w-full min-w-0 rounded-lg border border-line bg-s1 p-2" value={settings.quiet_start} onChange={(e) => change({ quiet_start: e.target.value })} required /></label>
        <label className="min-w-0 space-y-1 text-sm"><span className="block">{t.quietEnd}</span><input type="time" className="w-full min-w-0 rounded-lg border border-line bg-s1 p-2" value={settings.quiet_end} onChange={(e) => change({ quiet_end: e.target.value })} required /></label>
      </div>
      <TimezoneSelect label={t.timezone} value={settings.timezone} disabled={blocked} onChange={(timezone) => change({ timezone })} />
      <label className="block space-y-1 text-sm"><span>{t.importance}</span><select className="w-full rounded-lg border border-line bg-s1 p-2" value={settings.min_importance} onChange={(e) => change({ min_importance: Number(e.target.value) })}>{([1, 2, 3] as const).map((v) => <option value={v} key={v}>{t.importances[v]}</option>)}</select></label>
      <details><summary className="cursor-pointer text-sm font-semibold">{t.instruments} ({settings.instrument_ids.length})</summary><p className="my-2 text-xs text-mu">{t.instrumentHelp}</p>
        <InstrumentPicker idPrefix="notification-instruments" selected={(id) => settings.instrument_ids.includes(id)} onPick={(id) => change({ instrument_ids: settings.instrument_ids.includes(id) ? settings.instrument_ids.filter((x) => x !== id) : [...settings.instrument_ids, id] })} />
      </details>
    </fieldset>
    <section aria-label={t.matrix} className="space-y-3">
      <h3 className="font-semibold">{t.matrix}</h3><p className="text-xs text-mu">{t.matrixHelp}</p>
      {TYPE_CODES.map((type) => <fieldset key={type} className="min-w-0 rounded-xl border border-line bg-s1 p-3" disabled={blocked}>
        <legend className="px-1 text-sm font-semibold">{t.types[type]} — {t.soon}</legend>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {CHANNELS.map((channel) => {
            const available = channelAvailable(type, channel);
            const locked = TYPES[type].critical && channel === "site";
            return <Toggle key={channel} label={t.channels[channel]} description={locked ? t.required : available ? undefined : channel === "site" ? t.soon : t.notConnected}
              checked={available && preferenceEnabled(type, channel, prefs)} disabled={!available || locked} onChange={(enabled) => changePreference(type, channel, enabled)} />;
          })}
        </div>
      </fieldset>)}
    </section>
    <p className="text-xs text-mu">{t.disclaimer}</p><p className="text-xs text-mu">{t.retention}</p>
    {dirty && !validSettings(settings) && <p role="alert" className="text-sm text-mu">{t.invalid}</p>}
    <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={blocked || !dirty || !validSettings(settings)} className="btn px-4 py-2 disabled:opacity-50">{saving ? t.saving : t.save}</button><span role="status" className="text-xs text-mu">{saved ? t.saved : dirty ? t.unsaved : ""}</span></div>
  </form>;
}
