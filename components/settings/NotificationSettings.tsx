"use client";

import React, { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/context";
import { useAuth } from "@/lib/auth/auth-context";
import { Toggle } from "@/components/ui/forms/choice";
import { InstrumentPicker } from "@/components/market/InstrumentPicker";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { SettingRow } from "@/components/ui/SettingRow";
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
  const visibleChannels = CHANNELS.filter((channel) => channel !== "mobile_push");
  return <form onSubmit={save} className="space-y-4" data-testid="notification-settings">
    {loading && <p role="status">{t.loading}</p>}
    {error && <div role="alert" className="card text-sm"><p>{error === "setup" ? t.setup : t.error}</p><button type="button" className="btn-ghost mt-2 p-2" onClick={() => { if (dirty) { setError(null); } else { setLoading(true); setRetry((r) => r + 1); } }}>{t.retry}</button></div>}
    <fieldset disabled={blocked} className="card min-w-0 space-y-4 disabled:opacity-60">
      <Toggle label={t.disableAll} description={t.securityException} checked={!settings.all_disabled} onChange={(enabled) => change({ all_disabled: !enabled })} />
      <Toggle label={t.quiet} checked={settings.quiet_enabled} onChange={(quiet_enabled) => change({ quiet_enabled })} />
      {settings.quiet_enabled && <>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 space-y-1 text-sm"><span className="block">{t.quietStart}</span><input type="time" className="w-full min-w-0 rounded-lg border border-line bg-s1 p-2" value={settings.quiet_start} onChange={(e) => change({ quiet_start: e.target.value })} required /></label>
        <label className="min-w-0 space-y-1 text-sm"><span className="block">{t.quietEnd}</span><input type="time" className="w-full min-w-0 rounded-lg border border-line bg-s1 p-2" value={settings.quiet_end} onChange={(e) => change({ quiet_end: e.target.value })} required /></label>
      </div>
      </>}
      <TimezoneSelect label={t.timezone} value={settings.timezone} disabled={blocked} onChange={(timezone) => change({ timezone })} />
      <label className="block space-y-1 text-sm"><span>{t.importance}</span><select className="w-full rounded-lg border border-line bg-s1 p-2" value={settings.min_importance} onChange={(e) => change({ min_importance: Number(e.target.value) })}>{([1, 2, 3] as const).map((v) => <option value={v} key={v}>{t.importances[v]}</option>)}</select></label>
      <details><summary className="cursor-pointer text-sm font-semibold">{t.instruments}</summary>
        <SettingRow title={t.instruments} hint={t.instrumentHelp} hintLabel={dict.journalSettings.hintLabel} className="mt-3">
        <InstrumentPicker idPrefix="notification-instruments" selected={(id) => settings.instrument_ids.includes(id)} onPick={(id) => change({ instrument_ids: settings.instrument_ids.includes(id) ? settings.instrument_ids.filter((x) => x !== id) : [...settings.instrument_ids, id] })} />
        </SettingRow>
      </details>
    </fieldset>
    <section aria-label={t.matrix} className="card min-w-0 space-y-3">
      <h3 className="h4">{t.matrix}</h3>
      <table className="w-full table-fixed border-collapse text-xs" data-testid="notification-matrix">
        <caption className="sr-only">{t.matrix}</caption>
        <colgroup><col className="w-[32%] sm:w-[36%]" />{visibleChannels.map((channel) => <col key={channel} />)}</colgroup>
        <thead><tr className="border-b border-line text-[10px] text-mu sm:text-xs">
          <th scope="col" className="py-3 pr-1 text-left font-medium">{t.eventType}</th>
          {visibleChannels.map((channel) => <th key={channel} scope="col" className="px-0.5 py-3 text-center font-medium"><span className={channel === "telegram" ? "whitespace-nowrap" : undefined}>{t.channels[channel]}</span>{!TYPE_CODES.some((type) => channelAvailable(type, channel)) && <span className="mt-1 block text-[9px] font-normal text-mu">{t.soon}</span>}</th>)}
        </tr></thead>
        <tbody>{TYPE_CODES.map((type, index) => <React.Fragment key={type}>
          {(index === 0 || TYPES[TYPE_CODES[index - 1]].group !== TYPES[type].group) && <tr><th colSpan={visibleChannels.length + 1} scope="rowgroup" className="pb-1 pt-4 text-left text-[11px] font-semibold text-vi">{t.groups[TYPES[type].group]}</th></tr>}
          <tr className="border-b border-line/50 last:border-0">
            <th scope="row" className="py-2 pr-1 text-left text-[11px] font-normal leading-snug text-tx sm:text-xs">{t.types[type]}</th>
            {visibleChannels.map((channel) => {
            const available = channelAvailable(type, channel);
            const locked = TYPES[type].critical && channel === "site";
            const checked = available && preferenceEnabled(type, channel, prefs);
            return <td key={channel} className="px-0.5 text-center"><button type="button" role="switch" aria-label={`${t.types[type]}: ${t.channels[channel]}`} aria-checked={checked}
              disabled={blocked || !available || locked} onClick={() => changePreference(type, channel, !checked)}
              className="mx-auto flex min-h-11 w-full items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:cursor-not-allowed disabled:opacity-40">
              <span aria-hidden="true" className={`relative h-[18px] w-8 rounded-full border ${checked ? "border-pri bg-pri" : "border-edge bg-field"}`}><span className={`absolute top-[2px] h-3 w-3 rounded-full ${checked ? "left-[16px] bg-white" : "left-[3px] bg-mu"}`} /></span>
            </button></td>;
          })}</tr>
        </React.Fragment>)}</tbody>
      </table>
    </section>
    <p className="text-xs text-mu">{t.disclaimer}</p><p className="text-xs text-mu">{t.retention}</p>
    {dirty && !validSettings(settings) && <p role="alert" className="text-sm text-mu">{t.invalid}</p>}
    <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={blocked || !dirty || !validSettings(settings)} className="btn px-4 py-2 disabled:opacity-50">{saving ? t.saving : t.save}</button><span role="status" className="text-xs text-mu">{saved ? t.saved : dirty ? t.unsaved : ""}</span></div>
  </form>;
}
