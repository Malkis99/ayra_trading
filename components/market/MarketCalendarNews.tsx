"use client";

import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Info, X } from "lucide-react";
import { useApp } from "@/lib/context";
import { useOptionalGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { timeZoneLabel } from "@/lib/timezones";
import { cn } from "@/components/ui";
import { useOutsideClose } from "@/components/ui/forms/popover";
import { categoryOf, instrumentName } from "@/lib/market/instruments";
import { deviceTimeZone, eventsOptions, sameClock, timelineOptions } from "@/lib/market/calendar-news";
import { useCalendarNews } from "@/lib/market/watchlist-store";
import { InstrumentPicker } from "./InstrumentPicker";
import { CalendarFilters } from "./CalendarFilters";
import { MarketSyncLine } from "./MarketSyncLine";
import { TRADINGVIEW_HOME, TradingViewWidget, widgetConfig } from "./TradingViewWidget";

const PHONE_QUERY = "(max-width: 767px)";

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return phone;
}

function useOrigin(): string {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

/** A filter option: a pill that is on or off (wraps to the next line — never a sideways scroll). */
function Pill({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: React.ReactNode; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
        on ? "border-vi/70 bg-pri/25 text-tx" : "border-line text-mu hover:border-vi/50 hover:text-tx"
      )}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

/** «Source: TradingView» and «Not financial advice» under each widget. */
function Footnote({ testId }: { testId: string }) {
  const { dict } = useApp();
  const t = dict.market;
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-[11px] text-mu">
      <p>
        {t.overview.sourcePrefix}{" "}
        <a href={TRADINGVIEW_HOME} target="_blank" rel="noopener noreferrer nofollow" className="text-vi hover:underline">
          {t.overview.sourceName}
        </a>
      </p>
      <p className="font-semibold text-tx" data-testid={testId}>
        {t.notAdvice}
      </p>
    </div>
  );
}

/**
 * Market → Calendar (1.4): TradingView's economic calendar with our filters by importance and country. The times
 * follow the device's clock (the widget has no time zone option): the line under the filters says which zone, and
 * warns when the profile's zone (the one in «Time and session») is different.
 */
export function MarketCalendar() {
  const { dict, lang } = useApp();
  const t = dict.market.calendar;
  const game = useOptionalGame();
  const [prefs, setPrefs, loaded] = useCalendarNews();
  const phone = usePhone();
  const origin = useOrigin();
  const [device, setDevice] = useState<string | null>(null);
  useEffect(() => setDevice(deviceTimeZone()), []);

  if (!loaded || !origin || !device) return <section className="min-h-[480px]" data-testid="market-calendar" aria-busy="true" />;

  const profile = game?.gameState.profile.timezone || device;
  const now = new Date();
  const differs = !sameClock(device, profile, now);
  const options = eventsOptions(prefs);

  return (
    <section className="space-y-3" data-testid="market-calendar" aria-label={t.title}>
      <CalendarFilters prefs={prefs} onChange={setPrefs} />

      <p className="flex items-start gap-2 text-xs text-mu" data-testid="market-calendar-zone" data-differs={differs}>
        <Info size={14} className="mt-0.5 shrink-0 text-vi" aria-hidden="true" />
        <span>
          {formatString(t.zone, { zone: timeZoneLabel(device, lang, now) })}
          {differs && <> {formatString(t.zoneDiffers, { profile: timeZoneLabel(profile, lang, now) })}</>}
        </span>
      </p>

      <div className="overflow-hidden rounded-xl border border-line bg-s1">
        <TradingViewWidget
          key={`${JSON.stringify(options)}-${lang}`}
          widget="events"
          config={widgetConfig(options, lang === "en" ? "en" : "ru", origin)}
          height={phone ? 560 : 640}
          label={t.title}
          loadingText={dict.market.overview.loading}
          errorText={dict.market.overview.unavailable}
          retryLabel={dict.market.overview.retry}
          testId="market-calendar-widget"
        />
      </div>
      <Footnote testId="market-calendar-disclaimer" />
      <MarketSyncLine />
    </section>
  );
}

/**
 * Market → News (1.4): TradingView's news, all top stories or one catalog instrument's. Headlines come in English
 * (TradingView sends them so); links lead to TradingView's news pages only — no brokers, no ads (16–17 mode too).
 */
export function MarketNews() {
  const { dict, lang } = useApp();
  const t = dict.market.news;
  const [prefs, setPrefs, loaded] = useCalendarNews();
  const phone = usePhone();
  const origin = useOrigin();
  const [picking, setPicking] = useState(false);
  const pickerButton = useRef<HTMLButtonElement>(null);
  const pickerPanel = useRef<HTMLDivElement>(null);
  useOutsideClose([pickerButton, pickerPanel], picking, () => setPicking(false));
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPicking(false);
        pickerButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking]);

  if (!loaded || !origin) return <section className="min-h-[480px]" data-testid="market-news" aria-busy="true" />;

  const options = timelineOptions(prefs, phone);
  const current = prefs.newsInstrument;
  const name = current ? instrumentName(current, dict.market.instruments) : null;

  return (
    <section className="space-y-3" data-testid="market-news" aria-label={t.title}>
      <div className="flex flex-wrap items-center gap-2" data-testid="market-news-scope">
        <Pill on={!current} onClick={() => setPrefs({ ...prefs, newsInstrument: null })} testId="market-news-all">
          {t.all}
        </Pill>
        <div className="relative inline-flex items-center">
          <button
            ref={pickerButton}
            type="button"
            onClick={() => setPicking((v) => !v)}
            aria-expanded={picking}
            aria-controls="market-news-picker-panel"
            aria-pressed={!!current}
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
              current ? "border-vi/70 bg-pri/25 text-tx" : "border-line text-mu hover:border-vi/50 hover:text-tx"
            )}
            data-testid="market-news-instrument"
          >
            <span className="truncate">{name ? formatString(t.instrument, { name }) : t.pick}</span>
            <ChevronDown size={14} aria-hidden="true" className={cn("shrink-0 transition-transform motion-reduce:transition-none", picking && "rotate-180")} />
          </button>
          {current && (
            <button
              type="button"
              onClick={() => setPrefs({ ...prefs, newsInstrument: null })}
              aria-label={t.clear}
              title={t.clear}
              className="ml-1 grid h-6 w-6 place-items-center rounded-full text-mu hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
              data-testid="market-news-clear"
            >
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {picking && (
        <div ref={pickerPanel} id="market-news-picker-panel" className="rounded-xl border border-line bg-s1 p-3 shadow-float">
          <InstrumentPicker
            idPrefix="market-news"
            selected={(x) => x === current}
            onPick={(id) => {
              setPrefs({ ...prefs, newsInstrument: id });
              setPicking(false);
            }}
            initialCategory={current ? categoryOf(current) : undefined}
          />
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-mu" data-testid="market-news-note">
        <Info size={14} className="mt-0.5 shrink-0 text-vi" aria-hidden="true" />
        <span>{t.note}</span>
      </p>

      <div className="overflow-hidden rounded-xl border border-line bg-s1">
        <TradingViewWidget
          key={`${JSON.stringify(options)}-${lang}`}
          widget="timeline"
          config={widgetConfig(options, lang === "en" ? "en" : "ru", origin)}
          height={phone ? 560 : 640}
          label={current ? formatString(t.instrument, { name: name! }) : t.title}
          loadingText={dict.market.overview.loading}
          errorText={dict.market.overview.unavailable}
          retryLabel={dict.market.overview.retry}
          testId="market-news-widget"
        />
      </div>
      <Footnote testId="market-news-disclaimer" />
      <MarketSyncLine />
    </section>
  );
}
