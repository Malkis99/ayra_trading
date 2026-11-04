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
import { OwnCalendar } from "./OwnCalendar";
import { OfficialNews } from "./OfficialNews";
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
function Footnote({ testId, official }: { testId: string; official?: boolean }) {
  const { dict } = useApp();
  const t = dict.market;
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-[11px] text-mu">
      {official ? (
        <p data-testid="market-calendar-sources">{t.calendar.own.sourcesLine}</p>
      ) : (
      <p>
        {t.overview.sourcePrefix}{" "}
        <a href={TRADINGVIEW_HOME} target="_blank" rel="noopener noreferrer nofollow" className="text-vi hover:underline">
          {t.overview.sourceName}
        </a>
      </p>
      )}
      <p className="font-semibold text-tx" data-testid={testId}>
        {t.notAdvice}
      </p>
    </div>
  );
}

type CalendarView = "own" | "world";

/**
 * The Calendar opens on this part. «World» while our own calendar is still partial (no ADP, ISM, PMI or forecasts —
 * owner 2026-11-03); set it to "own" to open on the official events again.
 */
export const DEFAULT_CALENDAR_VIEW: CalendarView = "world";
const CALENDAR_VIEWS: readonly CalendarView[] = DEFAULT_CALENDAR_VIEW === "world" ? ["world", "own"] : ["own", "world"];

/** A part kept in the address (`?view=…`) when it is not the default one: a link or a reload opens the same one. */
function useView<V extends string>(fallback: V, allowed: readonly V[]): [V | null, (v: V) => void] {
  const [view, setView] = useState<V | null>(null);
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("view") as V | null;
    setView(fromUrl && allowed.includes(fromUrl) ? fromUrl : fallback);
  }, [fallback, allowed]);
  const choose = (v: V) => {
    setView(v);
    const url = new URL(window.location.href);
    if (v === fallback) url.searchParams.delete("view");
    else url.searchParams.set("view", v);
    window.history.replaceState(window.history.state, "", url.toString());
  };
  return [view, choose];
}
const useCalendarView = () => useView<CalendarView>(DEFAULT_CALENDAR_VIEW, CALENDAR_VIEWS);

/**
 * Market → Calendar: «Official events» (our own calendar from the 0009 table, PR 3 — times in the user's zone, the
 * figures from BLS / BEA) and «World calendar» (TradingView's economic calendar with forecasts for every country;
 * its times follow the device's clock — the widget has no time zone option, the line under it says so and warns
 * when the profile's zone is different). The importance and country filters are shared.
 */
export function MarketCalendar() {
  const { dict, lang } = useApp();
  const t = dict.market.calendar;
  const game = useOptionalGame();
  const [prefs, setPrefs, loaded] = useCalendarNews();
  const phone = usePhone();
  const origin = useOrigin();
  const [device, setDevice] = useState<string | null>(null);
  const [view, setView] = useCalendarView();
  useEffect(() => setDevice(deviceTimeZone()), []);

  if (!loaded || !origin || !device || !view) return <section className="min-h-[480px]" data-testid="market-calendar" aria-busy="true" />;

  const profile = game?.gameState.profile.timezone || device;
  const now = new Date();
  const differs = !sameClock(device, profile, now);
  const options = eventsOptions(prefs);

  return (
    <section className="space-y-3" data-testid="market-calendar" data-view={view} aria-label={t.title}>
      <div className="inline-flex rounded-lg border border-line bg-s1 p-0.5 text-xs font-semibold" role="group" aria-label={t.title} data-testid="market-calendar-views">
        {CALENDAR_VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={cn("rounded-md px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi", view === v ? "bg-pri/40 text-tx" : "text-mu hover:text-tx")}
            data-testid={`market-calendar-view-${v}`}
          >
            {t.views[v]}
          </button>
        ))}
      </div>

      <CalendarFilters prefs={prefs} onChange={setPrefs} />

      {view === "own" ? (
        <>
          <p className="flex items-start gap-2 text-xs text-mu" data-testid="own-calendar-zone">
            <Info size={14} className="mt-0.5 shrink-0 text-vi" aria-hidden="true" />
            <span>{formatString(t.own.zone, { zone: timeZoneLabel(profile, lang, now) })}</span>
          </p>
          <OwnCalendar prefs={prefs} zone={profile} />
        </>
      ) : (
        <>
      <p className="text-xs text-mu" data-testid="market-calendar-world-note">{t.worldNote}</p>
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
        </>
      )}
      <Footnote testId="market-calendar-disclaimer" official={view === "own"} />
      <MarketSyncLine />
    </section>
  );
}

/**
 * Market → News (1.4): TradingView's news, all top stories or one catalog instrument's. Headlines come in English
 * (TradingView sends them so); links lead to TradingView's news pages only — no brokers, no ads (16–17 mode too).
 */
type NewsView = "official" | "market";
const NEWS_VIEWS: readonly NewsView[] = ["official", "market"];

/** Market → News: «Official» (the Fed, the ECB, the White House, BLS, BEA — PR 5) and «Market» (TradingView). */
export function MarketNews() {
  const { dict } = useApp();
  const [view, setView] = useView<NewsView>("official", NEWS_VIEWS);
  if (!view) return <section className="min-h-[480px]" data-testid="market-news-tab" aria-busy="true" />;
  return (
    <div className="space-y-3" data-testid="market-news-tab" data-view={view}>
      <div className="inline-flex rounded-lg border border-line bg-s1 p-0.5 text-xs font-semibold" role="group" aria-label={dict.market.news.title} data-testid="market-news-views">
        {NEWS_VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={cn("rounded-md px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi", view === v ? "bg-pri/40 text-tx" : "text-mu hover:text-tx")}
            data-testid={`market-news-view-${v}`}
          >
            {dict.market.news.views[v]}
          </button>
        ))}
      </div>
      {view === "official" ? <OfficialNews /> : <TradingViewNews />}
    </div>
  );
}

/** «Market»: TradingView's news widget (1.4), top stories or one catalog instrument's. */
function TradingViewNews() {
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
