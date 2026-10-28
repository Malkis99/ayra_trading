"use client";

import React, { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { timeZoneLabel } from "@/lib/timezones";
import { Button, Input, Modal, Tabs, cn } from "@/components/ui";
import { DisplayZonePicker } from "./DisplayZonePicker";
import {
  ALL_SESSIONS,
  DEFAULT_KILLZONES,
  NEW_YORK,
  SESSION_DEFAULTS,
  convertClock,
  defaultSessionHours,
  isValidWindow,
  type Hours,
  type KillzoneId,
  type MarketSessionsSettings,
  type SessionId,
} from "@/lib/market/sessions";

type Section = "general" | "sessions" | "killzones";

/**
 * «Set up» (PR 1.1b): General (display time), Sessions (start and end of every session) and Killzones. Hours are
 * typed in the display time and saved in the city's own local time, so every country's summer time is followed by
 * itself. A wrong value is shown with its error and not saved; «Reset» per row and «Reset all».
 */
export function SessionsSettings({
  open,
  onClose,
  value,
  onChange,
  displayZone,
  profileZone,
  now,
}: {
  open: boolean;
  onClose: () => void;
  value: MarketSessionsSettings;
  onChange: (v: MarketSessionsSettings) => void;
  displayZone: string;
  profileZone: string;
  now: number;
}) {
  const { dict, lang } = useApp();
  const t = dict.market.sessions;
  const [section, setSection] = useState<Section>("general");
  const zoneName = displayZone === NEW_YORK ? t.display.newyork : displayZone === "UTC" ? "UTC" : timeZoneLabel(displayZone, lang, new Date(now));

  const row = (id: SessionId | KillzoneId, cityZone: string, hours: Hours, defaults: Hours, save: (h: Hours) => void) => (
    <HoursRow
      key={`${id}-${displayZone}`}
      id={id}
      name={t.names[id]}
      city={t.cityOf[id]}
      cityZone={cityZone}
      displayZone={displayZone}
      hours={hours}
      defaults={defaults}
      now={now}
      onSave={save}
    />
  );

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={t.settings.title}
      closeLabel={t.settings.close}
      size="lg"
      sheetOnMobile
      data-testid="market-settings"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-mu">{t.settings.saved}</span>
          <div className="flex gap-2">
            {section !== "general" && (
              <Button
                variant="ghost"
                onClick={() =>
                  onChange(section === "sessions" ? { ...value, sessions: defaultSessionHours() } : { ...value, killzones: { londonKz: { ...DEFAULT_KILLZONES.londonKz }, newyorkKz: { ...DEFAULT_KILLZONES.newyorkKz } } })
                }
                data-testid="market-settings-reset-all"
              >
                {t.settings.resetAll}
              </Button>
            )}
            <Button onClick={onClose} data-testid="market-settings-done">
              {t.settings.close}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Tabs<Section>
          items={[
            { id: "general", label: t.settings.tabs.general },
            { id: "sessions", label: t.settings.tabs.sessions },
            { id: "killzones", label: t.settings.tabs.killzones },
          ]}
          value={section}
          onChange={setSection}
          label={t.settings.title}
          idPrefix="market-settings"
        />
        <div role="tabpanel" id={`market-settings-panel-${section}`} aria-labelledby={`market-settings-tab-${section}`} className="space-y-3">
          {section === "general" && (
            <>
              <p className="text-xs text-mu">{t.settings.generalHint}</p>
              <DisplayZonePicker idPrefix="market-settings" value={value.display} profileZone={profileZone} onChange={(display) => onChange({ ...value, display })} />
            </>
          )}
          {section !== "general" && <p className="text-xs text-mu">{formatString(t.settings.inputHint, { zone: zoneName })}</p>}
          {section === "sessions" &&
            ALL_SESSIONS.map((id) =>
              row(id, SESSION_DEFAULTS[id].zone, value.sessions[id], { start: SESSION_DEFAULTS[id].start, end: SESSION_DEFAULTS[id].end }, (h) =>
                onChange({ ...value, sessions: { ...value.sessions, [id]: h } })
              )
            )}
          {section === "killzones" &&
            (["londonKz", "newyorkKz"] as const).map((id) =>
              row(id, NEW_YORK, value.killzones[id], DEFAULT_KILLZONES[id], (h) => onChange({ ...value, killzones: { ...value.killzones, [id]: h } }))
            )}
        </div>
      </div>
    </Modal>
  );
}

/** One window: start and end in the display time, the city's local hours next to them, «Reset». */
function HoursRow({
  id,
  name,
  city,
  cityZone,
  displayZone,
  hours,
  defaults,
  now,
  onSave,
}: {
  id: string;
  name: string;
  city: string;
  cityZone: string;
  displayZone: string;
  hours: Hours;
  defaults: Hours;
  now: number;
  onSave: (h: Hours) => void;
}) {
  const { dict } = useApp();
  const t = dict.market.sessions.settings;
  const shown = (h: Hours): Hours => ({ start: convertClock(h.start, cityZone, displayZone, now), end: convertClock(h.end, cityZone, displayZone, now) });
  // drafts in the display time: an invalid pair is shown with its error and not saved
  const [draft, setDraft] = useState<Hours>(() => shown(hours));
  // not on every minute of `now`: a half-typed value must not be replaced while the user types
  useEffect(() => setDraft(shown(hours)), [hours.start, hours.end, displayZone]); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = isValidWindow(draft.start, draft.end);
  const local: Hours = ok ? { start: convertClock(draft.start, displayZone, cityZone, now), end: convertClock(draft.end, displayZone, cityZone, now) } : hours;
  const set = (field: keyof Hours, v: string) => {
    const next = { ...draft, [field]: v };
    setDraft(next);
    if (isValidWindow(next.start, next.end)) onSave({ start: convertClock(next.start, displayZone, cityZone, now), end: convertClock(next.end, displayZone, cityZone, now) });
  };
  const isDefault = hours.start === defaults.start && hours.end === defaults.end;

  return (
    <fieldset className="space-y-2 rounded-md border border-line bg-s2/40 p-3" aria-labelledby={`market-hours-${id}-name`} data-testid={`market-hours-${id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={`market-hours-${id}-name`} className="text-sm font-semibold text-tx">
          {name}
        </span>
        <Button variant="ghost" onClick={() => onSave({ ...defaults })} disabled={isDefault} data-testid={`market-hours-${id}-reset`}>
          <RotateCcw size={14} aria-hidden="true" />
          <span>{t.reset}</span>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input type="time" label={t.start} value={draft.start} onChange={(e) => set("start", e.target.value)} data-testid={`market-hours-${id}-start`} />
        <Input type="time" label={t.end} value={draft.end} onChange={(e) => set("end", e.target.value)} data-testid={`market-hours-${id}-end`} />
      </div>
      <p className={cn("text-xs", ok ? "text-mu" : "text-rose-300")} role={ok ? undefined : "alert"} data-testid={`market-hours-${id}-local`}>
        {ok ? formatString(t.cityLocal, { from: local.start, to: local.end, city }) : t.invalid}
      </p>
    </fieldset>
  );
}
