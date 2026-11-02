"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Info, Maximize2, Minimize2, SlidersHorizontal, Star } from "lucide-react";
import { useApp } from "@/lib/context";
import { useOptionalGame } from "@/lib/game-context";
import { formatString } from "@/lib/i18n";
import { browserTimeZone } from "@/lib/timezones";
import { cn } from "@/components/ui";
import { useOutsideClose } from "@/components/ui/forms/popover";
import { categoryOf, INSTRUMENTS, instrumentBySymbol, type ChartInterval, type InstrumentId, instrumentName } from "@/lib/market/instruments";
import { displayZoneOf, sessionDefs } from "@/lib/market/sessions";
import { useMarketSettings } from "@/lib/market/settings-store";
import { addTo, isFull, removeFrom } from "@/lib/market/watchlist";
import { useChartNotes, useChartPrefs, useChartView, useWatchlist } from "@/lib/market/watchlist-store";
import { ChartClock } from "./ChartClock";
import { ChartNotes } from "./ChartNotes";
import { ChartViewSettings } from "./ChartViewSettings";
import { ChartWatchlistPanel } from "./ChartWatchlistPanel";
import { InstrumentPicker } from "./InstrumentPicker";
import { IntervalBar } from "./IntervalBar";
import { ChartTypeMenu, IndicatorsMenu } from "./ChartToolsMenus";
import { LayoutMenu, PaneHeader } from "./ChartLayout";
import { effectiveLayout, paneInstrument, withPane } from "@/lib/market/chart-layout";
import { HOTKEY_COUNT, studiesOf } from "@/lib/market/chart-tools";
import { SourceLine } from "./SourceLine";
import { TradingViewWidget, widgetConfig } from "./TradingViewWidget";

/** The site's surfaces for TradingView's `backgroundColor` and `gridColor` (candle colours cannot be set there). */
const CHART_BACKGROUND = "#18171f";
const CHART_GRID = "rgba(163, 138, 209, 0.07)";
const MIN_HEIGHT = 380;
const WIDE_QUERY = "(min-width: 1024px)";
/** Phones: layouts 1 and 2 only (owner 2026-11-01). */
const PHONE_QUERY = "(max-width: 767px)";
/** A window's header in layouts 2 and 4, the gap between windows, the least height of a window on a phone. */
const PANE_HEADER = 32;
const PANE_GAP = 8;
const PHONE_PANE_MIN = 360;

/** The instrument in the address: `?symbol=` (our links) or `?tvwidgetsymbol=` (a click inside a widget). */
function symbolFromUrl(): { id?: InstrumentId; unknown?: string } {
  const params = new URLSearchParams(window.location.search);
  const symbol = params.get("symbol") ?? params.get("tvwidgetsymbol");
  if (!symbol) return {};
  const found = instrumentBySymbol(symbol);
  return found ? { id: found.id } : { unknown: symbol };
}

function keepInUrl(id: InstrumentId) {
  const url = new URL(window.location.href);
  url.searchParams.set("symbol", INSTRUMENTS[id].symbol);
  url.searchParams.delete("tvwidgetsymbol");
  window.history.replaceState(window.history.state, "", url.toString());
}

function useMedia(query: string): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, [query]);
  return wide;
}
const useWide = () => useMedia(WIDE_QUERY);

/** The chart row takes the height of the page's scroll area (minus its padding and the toolbar above the chart). */
function useFillHeight(row: React.RefObject<HTMLElement>, toolbar: React.RefObject<HTMLElement>, shown: boolean, full: boolean): number {
  const [height, setHeight] = useState(MIN_HEIGHT);
  const measure = useCallback(() => {
    const bar = (toolbar.current?.offsetHeight ?? 0) + 12;
    if (full) {
      // full screen: the window minus the overlay's padding and the toolbar
      setHeight(Math.max(MIN_HEIGHT, Math.round(window.innerHeight - FULL_PADDING - bar)));
      return;
    }
    const main = row.current?.closest("main");
    if (!main) return;
    const style = getComputedStyle(main);
    const free = main.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - bar;
    setHeight(Math.max(MIN_HEIGHT, Math.round(free)));
  }, [row, toolbar, full]);
  useEffect(() => {
    if (!shown) return;
    measure();
    window.addEventListener("resize", measure);
    const main = row.current?.closest("main");
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (ro && main) ro.observe(main);
    if (ro && toolbar.current) ro.observe(toolbar.current);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [measure, row, toolbar, shown]);
  return height;
}

/** The overlay's padding, top and bottom (p-3). */
const FULL_PADDING = 24;

/**
 * «Full screen» (PR «Fullscreen + time and session»): the workspace covers the whole site; the browser's own full
 * screen is asked for the page too (so the dialogs and popovers still show). Esc or the button leaves it. Where the
 * browser has no full screen (iPhone), the overlay alone covers the site.
 */
function useFullScreen(canLeaveByEsc: boolean): [boolean, () => void, () => void] {
  const [full, setFull] = useState(false);
  const enter = useCallback(() => {
    // before the browser starts its own full screen, so the site never shows over the workspace
    document.documentElement.setAttribute("data-market-fullscreen", "");
    setFull(true);
    const root = document.documentElement;
    if (document.fullscreenEnabled && !document.fullscreenElement && root.requestFullscreen) root.requestFullscreen().catch(() => {});
  }, []);
  const leave = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }, []);
  // the page's scroll area is its own layer under the header: lift it while the workspace covers the site
  useEffect(() => {
    document.documentElement.toggleAttribute("data-market-fullscreen", full);
    return () => document.documentElement.removeAttribute("data-market-fullscreen");
  }, [full]);
  useEffect(() => {
    if (!full) return;
    // Esc in the browser's full screen leaves it first: follow it
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && canLeaveByEsc) leave();
    };
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
    };
  }, [full, leave, canLeaveByEsc]);
  // leaving the tab or the page ends it
  useEffect(() => () => {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }, []);
  return [full, enter, leave];
}

/**
 * Market → Chart (PR 1.3, 1.3b): a workspace as tall as the window — TradingView's chart of a catalog instrument with
 * the site's background and grid, our timeframe bar with favourites, the Watchlist panel beside it (a click switches
 * the chart), notes per instrument, and «Set up the view». The widget's top toolbar stays hidden (its «Indicators»
 * menu has «buy / sell» ratings); its left drawing toolbar is on by default — drawings are not saved by the widget.
 */
export function MarketChart() {
  const { dict, lang } = useApp();
  const t = dict.market;
  const game = useOptionalGame();
  const [prefs, setPrefs, prefsLoaded] = useChartPrefs();
  const [watchlist, setWatchlist, listLoaded] = useWatchlist();
  const [view, setView, viewLoaded] = useChartView();
  const [notes, setNotes, notesLoaded] = useChartNotes();
  const [settings, , settingsLoaded] = useMarketSettings();
  const [origin, setOrigin] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [picking, setPicking] = useState(false);
  const [editingView, setEditingView] = useState(false);
  const wide = useWide();
  const phone = useMedia(PHONE_QUERY);
  const row = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const pickerButton = useRef<HTMLButtonElement>(null);
  const pickerPanel = useRef<HTMLDivElement>(null);
  useOutsideClose([pickerButton, pickerPanel], picking, () => setPicking(false));

  // Keys 1–6: the first six timeframes of the bar (owner's idea 2026-11-01). Only on our page — inside TradingView's
  // frame the keys belong to the widget — and never while typing or with a window open.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  useEffect(() => {
    if (!prefsLoaded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || picking || editingView) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (target?.closest("[role=dialog]")) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > HOTKEY_COUNT) return;
      const next = prefsRef.current.favorites[n - 1];
      if (!next || next === prefsRef.current.interval) return;
      e.preventDefault();
      setPrefs({ ...prefsRef.current, interval: next });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefsLoaded, picking, editingView, setPrefs]);
  const loaded = ready && listLoaded && viewLoaded && notesLoaded && settingsLoaded && !!origin;
  const [full, enterFull, leaveFull] = useFullScreen(!picking && !editingView);
  const height = useFillHeight(row, toolbar, loaded, full);

  // The address wins over the last instrument on this device
  useEffect(() => {
    if (!prefsLoaded || ready) return;
    setOrigin(window.location.origin);
    const fromUrl = symbolFromUrl();
    const id = fromUrl.id ?? prefs.instrument;
    if (fromUrl.unknown) setNotice(formatString(t.chart.notInCatalog, { symbol: fromUrl.unknown, name: instrumentName(id, t.instruments) }));
    if (id !== prefs.instrument) setPrefs({ ...prefs, instrument: id });
    keepInUrl(id);
    setReady(true);
  }, [prefsLoaded, ready, prefs, setPrefs, t]);

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

  if (!loaded) return <section className="min-h-[480px]" data-testid="market-chart" aria-busy="true" />;

  const id = prefs.instrument;
  const inst = INSTRUMENTS[id];
  const name = instrumentName(id, t.instruments);
  const inList = watchlist.ids.includes(id);
  const listFull = !inList && isFull(watchlist);
  const profileZone = game?.gameState.profile.timezone || browserTimeZone();
  const zone = displayZoneOf(settings.display, profileZone);
  const mainDefs = sessionDefs(settings.sessions);

  const pick = (next: InstrumentId) => {
    setNotice(null);
    setPicking(false);
    setPrefs({ ...prefs, instrument: next });
    keepInUrl(next);
  };
  const chooseInterval = (interval: ChartInterval) => setPrefs({ ...prefs, interval });

  // layouts: what is shown, the row height (two windows one under another on phones get room), each chart's height
  const shown = effectiveLayout(prefs.layout, phone);
  const stacked = shown === 4 || (shown === 2 && phone);
  const rowHeight = shown === 2 && phone ? Math.max(height, 2 * PHONE_PANE_MIN + PANE_GAP) : height;
  const paneHeight = shown === 1 ? height - 2 : Math.round((stacked ? (rowHeight - PANE_GAP) / 2 : rowHeight) - PANE_HEADER - 2);
  const chartConfig = (symbol: string, interval: ChartInterval) =>
    widgetConfig(
      {
        autosize: true,
        width: "100%",
        height: "100%",
        symbol,
        interval,
        timezone: zone === "UTC" ? "Etc/UTC" : zone,
        style: prefs.style,
        studies: studiesOf(prefs.indicators),
        backgroundColor: CHART_BACKGROUND,
        gridColor: CHART_GRID,
        hide_top_toolbar: true,
        hide_side_toolbar: !view.drawing,
        hide_volume: true,
        allow_symbol_change: false,
        save_image: false,
        calendar: false,
        details: false,
        hotlist: false,
        withdateranges: false,
        support_host: "https://www.tradingview.com",
      },
      lang === "en" ? "en" : "ru",
      origin
    );

  const panel = view.watchlist && (
    <ChartWatchlistPanel
      ids={watchlist.ids}
      current={id}
      onPick={pick}
      folded={view.watchlistFolded}
      onFold={(watchlistFolded) => setView({ ...view, watchlistFolded })}
      side={view.watchlistSide}
      wide={wide}
    />
  );
  const notesBlock = (className?: string) => view.notes && <ChartNotes key={id} id={id} notes={notes} onChange={setNotes} className={className} />;
  // Beside the chart only on wide screens; on phones everything goes under it
  const notesBeside = wide && view.notes && view.notesPlace === "side" && view.watchlist && !view.watchlistFolded;
  // «time + session + market»: a card in the right column (on phones under the chart), a strip over it, or hidden
  const clockCard = (view.clock === "top" || view.clock === "bottom") && (
    <ChartClock instrument={id} zone={profileZone} defs={mainDefs} variant="card" className={wide ? "w-60 shrink-0" : undefined} />
  );
  const side = wide && (panel || notesBeside || clockCard) && (
    <div className="flex min-h-0 shrink-0 flex-col gap-3 overflow-y-auto" data-testid="market-chart-side">
      {view.clock === "top" && clockCard}
      {panel}
      {notesBeside && notesBlock("w-60 max-h-[45%]")}
      {view.clock === "bottom" && clockCard}
    </div>
  );

  return (
    <section
      className={cn("space-y-2", full && "fixed inset-0 z-[90] overflow-y-auto bg-ink p-3")}
      data-testid="market-chart"
      data-fullscreen={full ? "true" : "false"}
      aria-labelledby="market-chart-title"
    >
      <div ref={toolbar} className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="relative min-w-0">
            <button
              ref={pickerButton}
              type="button"
              onClick={() => setPicking((v) => !v)}
              aria-expanded={picking}
              aria-controls="market-chart-picker-panel"
              aria-label={`${t.chart.change}: ${name}`}
              className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-s2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
              data-testid="market-chart-change"
            >
              <span className="min-w-0">
                <span id="market-chart-title" className="block truncate font-serif text-lg font-bold leading-tight text-tx" data-testid="market-chart-name">
                  {name}
                </span>
                <span className="block text-[11px] text-mu">{inst.ticker}</span>
              </span>
              <ChevronDown size={16} aria-hidden="true" className={cn("shrink-0 text-mu transition-transform motion-reduce:transition-none", picking && "rotate-180")} />
            </button>
          </div>
          <IntervalBar value={prefs.interval} favorites={prefs.favorites} onChange={chooseInterval} onFavorites={(favorites) => setPrefs({ ...prefs, favorites })} />
          <div className="flex items-center gap-1">
            <ChartTypeMenu value={prefs.style} onChange={(style) => setPrefs({ ...prefs, style })} />
            <IndicatorsMenu value={prefs.indicators} onChange={(indicators) => setPrefs({ ...prefs, indicators })} />
            <LayoutMenu
              layout={prefs.layout}
              shown={shown}
              narrow={phone}
              link={prefs.link}
              onLayout={(layout) => setPrefs({ ...prefs, layout })}
              onLink={(link) => setPrefs({ ...prefs, link })}
            />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setWatchlist(inList ? removeFrom(watchlist, id) : addTo(watchlist, id))}
              disabled={listFull}
              aria-pressed={inList}
              title={listFull ? formatString(t.watchlist.full, { n: watchlist.ids.length }) : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                inList ? "border-vi/70 bg-pri/25 text-tx" : "border-line text-tx hover:border-vi/50",
                listFull && "cursor-not-allowed opacity-50"
              )}
              data-testid="market-chart-watch"
            >
              <Star size={14} aria-hidden="true" className={inList ? "fill-current text-vi" : undefined} />
              {inList ? t.chart.inList : t.chart.addToList}
            </button>
            <button
              type="button"
              onClick={() => setEditingView(true)}
              aria-haspopup="dialog"
              aria-label={t.chart.view.open}
              title={t.chart.view.open}
              className="grid h-8 w-8 place-items-center rounded-md border border-line text-mu hover:border-vi/50 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
              data-testid="market-chart-view-open"
            >
              <SlidersHorizontal size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={full ? leaveFull : enterFull}
              aria-pressed={full}
              aria-label={full ? t.chart.fullscreen.exit : t.chart.fullscreen.enter}
              title={full ? t.chart.fullscreen.exit : t.chart.fullscreen.enter}
              className={cn(
                "grid h-8 w-8 place-items-center rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                full ? "border-vi/70 bg-pri/25 text-tx" : "border-line text-mu hover:border-vi/50 hover:text-tx"
              )}
              data-testid="market-chart-fullscreen"
            >
              {full ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
            </button>
          </div>
        </div>

        {picking && (
          <div ref={pickerPanel} id="market-chart-picker-panel" className="rounded-xl border border-line bg-s1 p-3 shadow-float">
            <InstrumentPicker idPrefix="market-chart" selected={(x) => x === id} onPick={pick} initialCategory={categoryOf(id)} />
          </div>
        )}
        {view.clock === "strip" && <ChartClock instrument={id} zone={profileZone} defs={mainDefs} variant="strip" />}
        {notice && (
          <p className="rounded-md bg-s2/50 px-3 py-2 text-xs text-tx" role="status" data-testid="market-chart-notice">
            {notice}
          </p>
        )}
      </div>

      <div ref={row} className={cn("flex gap-3", view.watchlistSide === "left" && "flex-row-reverse")} style={{ height: rowHeight }} data-testid="market-chart-row">
        {/* layouts 1 / 2 / 4 (on phones 1 and 2): window 1 is the main chart, windows 2–4 have their own header */}
        <div
          className={cn(
            "grid min-w-0 flex-1 gap-2",
            shown === 2 && (phone ? "grid-rows-2" : "grid-cols-2"),
            shown === 4 && "grid-cols-2 grid-rows-2"
          )}
          data-testid="market-chart-grid"
          data-layout={shown}
        >
          {Array.from({ length: shown }, (_, i) => {
            const paneId = paneInstrument(i, id, prefs.panes, prefs.link);
            const paneInterval = i === 0 ? prefs.interval : prefs.panes[i - 1].interval;
            const symbol = INSTRUMENTS[paneId].symbol;
            return (
              <div key={i} className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-s1" data-testid={`market-chart-pane-${i + 1}`}>
                {shown > 1 && (
                  <PaneHeader
                    index={i}
                    instrument={paneId}
                    interval={paneInterval}
                    favorites={prefs.favorites}
                    locked={i === 0 || prefs.link}
                    onInstrument={(next) => setPrefs({ ...prefs, panes: withPane(prefs.panes, i, { instrument: next }) })}
                    onInterval={(next) => setPrefs({ ...prefs, panes: withPane(prefs.panes, i, { interval: next }) })}
                  />
                )}
                <TradingViewWidget
                  key={`${symbol}-${paneInterval}-${prefs.style}-${prefs.indicators.join(",")}-${zone}-${lang}-${view.drawing}`}
                  widget="advanced-chart"
                  config={chartConfig(symbol, paneInterval)}
                  height={paneHeight}
                  label={formatString(t.chart.label, { name: instrumentName(paneId, t.instruments) })}
                  loadingText={t.overview.loading}
                  errorText={t.overview.unavailable}
                  retryLabel={t.overview.retry}
                  testId={i === 0 ? "market-chart-widget" : `market-chart-widget-${i + 1}`}
                />
              </div>
            );
          })}
        </div>
        {side}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <SourceLine delay={inst.delay} testId="market-chart-source" />
        {view.drawing && (
          <p className="flex items-start gap-1.5 text-[11px] text-mu" data-testid="market-chart-drawing-note">
            <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{t.chart.drawingNote}</span>
          </p>
        )}
      </div>

      {!wide && clockCard}
      {!wide && panel}
      {view.notes && !notesBeside && notesBlock()}

      <ChartViewSettings open={editingView} onClose={() => setEditingView(false)} value={view} onChange={setView} />
    </section>
  );
}
