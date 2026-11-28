"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Camera, List, Plus, Rows3, Search, ShieldAlert } from "lucide-react";
import type { Account, Strategy, Trade } from "@/lib/journal/types";
import { hasViolation, type SortDir, type TradeSortKey } from "@/lib/journal/overview";
import type { Dictionary } from "@/lib/i18n/types";
import { AppStorage } from "@/lib/storage";
import { Button, EmptyState, FilterChip, Input, Segmented, Select } from "@/components/ui";
import { tradeDays, tradeDayPages, tradeDaySummary, type TradeDay, type TradeView } from "@/lib/journal/trades-view";
import { cn } from "@/components/ui/cn";
import { formatSignedMoney, formatSignedR, type JournalUnit } from "./JournalKpiStrip";

const VIEW_KEY = "ayra_journal_trade_view_v1";
const PAGE_SIZE = 50;

type Props = {
  trades: Trade[];
  accounts: Account[];
  strategies: Strategy[];
  tz: string;
  unit: JournalUnit;
  dict: Dictionary;
  lang: string;
  formatTradeValue: (t: Trade) => string;
  onOpenTrade: (t: Trade) => void;
  onAddTrade: () => void;
  readOnly?: boolean;
  /** Reports the trades left after the table filters (used by "Export → as in the table"). */
  onFilteredChange?: (trades: Trade[]) => void;
};

type Filters = {
  account: string | null;
  instrument: string | null;
  strategy: string | null;
  result: string | null;
  mistakes: string | null;
  period: string | null;
  direction: string | null;
  screenshots: string | null;
};
const NO_FILTERS: Filters = { account: null, instrument: null, strategy: null, result: null, mistakes: null, period: null, direction: null, screenshots: null };

/** Two read-only layouts share filters, account, sorting and the same complete local-day groups. */
export function TradesTable({ trades, accounts, strategies, tz, unit, dict, lang, formatTradeValue, onOpenTrade, onAddTrade, readOnly, onFilteredChange }: Props) {
  const t = dict.journal.overview;
  const tt = dict.journal.tradesTab;
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sortKey, setSortKey] = useState<TradeSortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [view, setView] = useState<TradeView>("list");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);

  useEffect(() => {
    try {
      const saved = AppStorage.getItem(VIEW_KEY);
      if (saved === "list" || saved === "days") setView(saved);
    } catch {}
  }, []);
  const changeView = (d: TradeView) => {
    setView(d);
    try {
      AppStorage.setItem(VIEW_KEY, d);
    } catch {}
  };

  const setFilter = (key: keyof Filters, value: string | null) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  const activeCount = Object.values(filters).filter(Boolean).length + (query.trim() ? 1 : 0);

  const accountName = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a?.name || dict.journal.accountsTab.mainAccountDefaultName;
  };
  const strategyOf = (id?: string | null) => strategies.find((s) => s.id === id);

  const instruments = useMemo(() => Array.from(new Set(trades.map((x) => x.instrument))).sort(), [trades]);

  const filtered = useMemo(() => {
    const nowMs = Date.now();
    const q = query.trim().toUpperCase();
    return trades.filter((x) => {
      if (filters.account && x.accountId !== filters.account) return false;
      if (filters.instrument && x.instrument !== filters.instrument) return false;
      if (filters.strategy && (filters.strategy === "none" ? Boolean(x.strategyId) : x.strategyId !== filters.strategy)) return false;
      if (filters.result && (x.status !== "closed" || x.result !== filters.result)) return false;
      if (filters.mistakes === "with" && !hasViolation(x)) return false;
      if (filters.mistakes === "without" && hasViolation(x)) return false;
      if (filters.direction && x.direction !== filters.direction) return false;
      const shots = Boolean(x.attachmentIds && x.attachmentIds.length > 0);
      if (filters.screenshots === "with" && !shots) return false;
      if (filters.screenshots === "without" && shots) return false;
      if (filters.period) {
        const days = (nowMs - new Date(x.openedAt || x.createdAt).getTime()) / 86_400_000;
        if (days > Number(filters.period)) return false;
      }
      if (q && !x.instrument.toUpperCase().includes(q)) return false;
      return true;
    });
  }, [trades, filters, query]);

  useEffect(() => {
    onFilteredChange?.(filtered);
  }, [filtered, onFilteredChange]);
  const pages = useMemo(() => tradeDayPages(tradeDays(filtered, tz, sortKey, sortDir, unit, accounts), PAGE_SIZE), [filtered, tz, sortKey, sortDir, unit, accounts]);
  const totalPages = pages.length;
  const currentPage = Math.min(page, totalPages);
  const groups = pages[currentPage - 1];
  const pageTrades = groups.flatMap(g => g.trades);
  const maxAbsR = Math.max(1, ...pageTrades.map(x => Math.abs(x.rMultiple ?? 0)));

  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const dayLabel = (key: string) => {
    if (key === "unknown") return t.views.unknownDate;
    const [y, m, d] = key.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "long", year: "numeric" }).format(new Date(y, m - 1, d));
  };
  const timeLabel = (iso: string) =>
    Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";
  const dayTotal = (g: TradeDay) => {
    const summary = tradeDaySummary(g.trades, accounts);
    if (!summary.closed) return <span>{t.views.noClosed}</span>;
    if (unit === "money" || (unit === "R" && summary.netR === null)) {
      return <span>{summary.money.length ? summary.money.map(v => formatSignedMoney(v.value, v.currency, lang)).join(" · ") : "—"}{summary.partialMoney && <span className="ml-1 text-xs text-mu">{t.views.partial}</span>}</span>;
    }
    if (unit === "percent") return <span title={t.views.percentBase}>{summary.percent == null ? "—" : `${summary.percent > 0 ? "+" : ""}${summary.percent.toFixed(2)}%`}</span>;
    return <span>{formatSignedR(summary.netR)}{summary.partialR && <span className="ml-1 text-xs text-mu">{t.views.partial}</span>}</span>;
  };
  const daySign = (g: TradeDay) => {
    const s = tradeDaySummary(g.trades, accounts);
    return unit === "percent" ? s.percent ?? 0 : unit === "R" && s.netR !== null ? s.netR : s.money.length === 1 ? s.money[0].value : 0;
  };

  const toggleSort = (key: TradeSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "instrument" ? "asc" : "desc");
    }
    setPage(1);
  };

  const resultTone = (x: Trade) => (x.status === "open" ? "text-mu" : x.result === "win" ? "text-long" : x.result === "loss" ? "text-short" : "text-tx");


  const rBar = (x: Trade) =>
    x.status === "closed" && typeof x.rMultiple === "number" ? (
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-s2" aria-hidden="true">
        <span
          className={cn("block h-full rounded-full", x.rMultiple >= 0 ? "bg-long" : "bg-short")}
          style={{ width: `${Math.max(4, (Math.abs(x.rMultiple) / maxAbsR) * 100)}%` }}
        />
      </span>
    ) : null;

  const directionPill = (x: Trade) => (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", x.direction === "long" ? "bg-long/15 text-long" : "bg-short/15 text-short")}>
      {x.direction === "long" ? dict.journal.addTradeModal.directionLong.split(" ")[0] : dict.journal.addTradeModal.directionShort.split(" ")[0]}
    </span>
  );

  const sortHeader = (key: TradeSortKey, label: string, align: "left" | "right" = "left") => (
    <th scope="col" aria-sort={sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className={cn("px-3 py-2", align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={cn("inline-flex min-h-[32px] items-center gap-1 rounded font-semibold hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi", sortKey === key ? "text-tx" : "text-mu")}
      >
        {label}
        {sortKey === key && (sortDir === "asc" ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />)}
      </button>
    </th>
  );

  const renderRows = (rows: TradeDay[], showHeaders: boolean) => <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border border-line bg-s1 md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-mu">
                <tr>
                  {sortHeader("date", tt.colDate)}
                  {sortHeader("instrument", tt.colInstrument)}
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {tt.colDirection}
                  </th>
                  {sortHeader("result", tt.colResult, "right")}
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {t.filters.strategy}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {dict.journal.overview.kpiProcess}
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    {tt.colAccount}
                  </th>
                </tr>
              </thead>
              {rows.map((g) => (
                <tbody key={g.dateKey || "all"} className="border-b border-line last:border-b-0">
                  {showHeaders && g.dateKey && (
                    <tr className="bg-s2/50">
                      <th scope="rowgroup" colSpan={7} className="px-3 py-1.5 text-xs font-semibold text-mu">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-tx first-letter:uppercase">{dayLabel(g.dateKey)}</span>
                          <span className="tabular-nums">
                            {dict.journal.overview.dayTotal}:{" "}
                            <span className={cn("font-semibold", daySign(g) > 0 ? "text-long" : daySign(g) < 0 ? "text-short" : "text-tx")}>{dayTotal(g)}</span>
                            <span className="ml-2">· {g.trades.length}</span>
                          </span>
                        </div>
                      </th>
                    </tr>
                  )}
                  {g.trades.map((x) => {
                    const strat = strategyOf(x.strategyId);
                    return (
                      <tr
                        key={x.id}
                        tabIndex={0}
                        onClick={() => onOpenTrade(x)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onOpenTrade(x);
                          }
                        }}
                        className="cursor-pointer transition-colors hover:bg-s2/60 focus-visible:bg-s2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vi"
                      >
                        <td className={cn("px-3 tabular-nums text-mu", "py-1.5")}>{timeLabel(x.openedAt || x.createdAt)}</td>
                        <td className={cn("px-3 font-semibold text-tx", "py-1.5")}>
                          <span className="inline-flex items-center gap-1.5">
                            {x.instrument}
                            {x.attachmentIds && x.attachmentIds.length > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-vi/15 px-1.5 py-0.5 text-[11px] font-medium text-vi" data-testid="trade-shots-count">
                                <Camera size={11} aria-hidden="true" />
                                {x.attachmentIds.length}
                              </span>
                            )}
                            <span title={tt.unverifiedTooltip} className="text-mu/70">
                              <ShieldAlert size={13} aria-label={tt.unverifiedBadge} />
                            </span>
                          </span>
                        </td>
                        <td className={cn("px-3", "py-1.5")}>{directionPill(x)}</td>
                        <td className={cn("px-3 text-right", "py-1.5")}>
                          <span className="inline-flex items-center justify-end gap-2">
                            {rBar(x)}
                            <span className={cn("font-semibold tabular-nums", resultTone(x))}>{x.status === "open" ? t.views.openTrade : formatTradeValue(x)}</span>
                          </span>
                        </td>
                        <td className={cn("max-w-[160px] truncate px-3 text-mu", "py-1.5")}>
                          {strat ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: strat.color }} aria-hidden="true" />
                              {strat.name || dict.journal.strategiesTab.defaultName}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className={cn("px-3 text-right tabular-nums", "py-1.5", hasViolation(x) ? "text-short" : "text-mu")}>
                          {x.processScore ?? "—"}
                        </td>
                        <td className={cn("max-w-[140px] truncate px-3 text-mu", "py-1.5")}>{accountName(x.accountId)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>

          {/* Phone cards */}
          <div className="space-y-3 md:hidden">
            {rows.map((g) => (
              <section key={g.dateKey || "all"} className="space-y-2">
                {showHeaders && g.dateKey && (
                  <div className="flex items-center justify-between px-1 text-xs font-semibold text-mu">
                    <span className="text-tx first-letter:uppercase">{dayLabel(g.dateKey)}</span>
                    <span className={cn("tabular-nums", daySign(g) > 0 ? "text-long" : daySign(g) < 0 ? "text-short" : "text-mu")}>{dayTotal(g)}</span>
                  </div>
                )}
                {g.trades.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => onOpenTrade(x)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border border-line bg-s1 px-3 text-left transition-colors hover:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                      "min-h-[64px] py-2"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-tx">{x.instrument}</span>
                        {directionPill(x)}
                        {x.attachmentIds && x.attachmentIds.length > 0 && <Camera size={13} className="text-vi" aria-hidden="true" />}
                      </span>
                      {(
                        <span className="mt-0.5 block truncate text-xs text-mu">
                          {timeLabel(x.openedAt || x.createdAt)} · {accountName(x.accountId)}
                          <span className="block">{strategyOf(x.strategyId)?.name || (x.strategyId ? dict.journal.strategiesTab.defaultName : "—")} · {t.kpiProcess}: {x.processScore ?? "—"}</span>
                        </span>
                      )}
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className={cn("font-semibold tabular-nums", resultTone(x))}>{x.status === "open" ? t.views.openTrade : formatTradeValue(x)}</span>
                      {rBar(x)}
                    </span>
                  </button>
                ))}
              </section>
            ))}
          </div>

  </>;

  if (trades.length === 0) {
    return (
      <EmptyState
        title={tt.emptyTitle}
        description={tt.emptyDesc}
        action={
          !readOnly && (
            <Button onClick={onAddTrade}>
              <Plus size={16} aria-hidden="true" />
              {dict.home.quickActions.addTrade}
            </Button>
          )
        }
      />
    );
  }

  return (
    <div className="space-y-3" data-testid="trades-table">
      {/* Toolbar */}
      <div className="space-y-3 rounded-lg border border-line bg-s1 p-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <Input
            aria-label={tt.searchPlaceholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder={tt.searchPlaceholder}
            leading={<Search size={16} aria-hidden="true" />}
            containerClassName="md:max-w-xs md:flex-1"
          />
          <div className="flex flex-1 flex-wrap items-end gap-2 md:justify-end">
            <Select<TradeSortKey>
              aria-label={t.sort.label}
              value={sortKey}
              onChange={(k) => {
                setSortKey(k);
                setSortDir(k === "instrument" ? "asc" : "desc");
                setPage(1);
              }}
              className="min-w-0 flex-1 md:w-44 md:flex-none"
              options={[
                { value: "date", label: t.sort.date },
                { value: "result", label: t.sort.result },
                { value: "instrument", label: t.sort.instrument },
              ]}
            />
            <Button
              variant="secondary"
              className="w-11 shrink-0 px-0"
              aria-label={`${t.sort.label}: ${sortDir === "asc" ? "↑" : "↓"}`}
              onClick={() => { setSortDir((d) => (d === "asc" ? "desc" : "asc")); setPage(1); }}
            >
              {sortDir === "asc" ? <ArrowUp size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />}
            </Button>
            <Segmented<TradeView>
              name={t.views.label}
              value={view}
              onChange={changeView}
              className="shrink-0"
              options={[
                { value: "list", label: t.views.list, icon: <List size={16} aria-hidden="true" />, tone: "accent" },
                { value: "days", label: t.views.days, icon: <Rows3 size={16} aria-hidden="true" />, tone: "accent" },
              ]}
            />
          </div>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={dict.journal.overview.filters.result}>
          <FilterChip
            name={t.filters.account}
            value={filters.account}
            onChange={(v) => setFilter("account", v)}
            clearLabel={t.filters.clearFilter}
            data-testid="filter-account"
            options={accounts.map((a) => ({ value: a.id, label: a.name || dict.journal.accountsTab.mainAccountDefaultName }))}
          />
          <FilterChip
            name={t.filters.instrument}
            value={filters.instrument}
            onChange={(v) => setFilter("instrument", v)}
            clearLabel={t.filters.clearFilter}
            options={instruments.map((i) => ({ value: i, label: i }))}
          />
          <FilterChip
            name={t.filters.strategy}
            value={filters.strategy}
            onChange={(v) => setFilter("strategy", v)}
            clearLabel={t.filters.clearFilter}
            options={[
              { value: "none", label: t.filters.noStrategy },
              ...strategies.map((s) => ({ value: s.id, label: s.name || dict.journal.strategiesTab.defaultName })),
            ]}
          />
          <FilterChip
            name={t.filters.result}
            value={filters.result}
            onChange={(v) => setFilter("result", v)}
            clearLabel={t.filters.clearFilter}
            data-testid="filter-result"
            options={[
              { value: "win", label: tt.resultWin },
              { value: "loss", label: tt.resultLoss },
              { value: "breakeven", label: tt.resultBreakeven },
            ]}
          />
          <FilterChip
            name={t.filters.mistakes}
            value={filters.mistakes}
            onChange={(v) => setFilter("mistakes", v)}
            clearLabel={t.filters.clearFilter}
            options={[
              { value: "with", label: t.filters.withMistakes },
              { value: "without", label: t.filters.withoutMistakes },
            ]}
          />
          <FilterChip
            name={t.filters.period}
            value={filters.period}
            onChange={(v) => setFilter("period", v)}
            clearLabel={t.filters.clearFilter}
            options={[
              { value: "7", label: tt.period7d },
              { value: "30", label: tt.period30d },
              { value: "90", label: tt.period90d },
            ]}
          />
          <FilterChip
            name={t.filters.direction}
            value={filters.direction}
            onChange={(v) => setFilter("direction", v)}
            clearLabel={t.filters.clearFilter}
            options={[
              { value: "long", label: dict.journal.addTradeModal.directionLong },
              { value: "short", label: dict.journal.addTradeModal.directionShort },
            ]}
          />
          <FilterChip
            name={t.filters.screenshots}
            value={filters.screenshots}
            onChange={(v) => setFilter("screenshots", v)}
            clearLabel={t.filters.clearFilter}
            options={[
              { value: "with", label: dict.journal.attachments.filterWithScreenshots },
              { value: "without", label: dict.journal.attachments.filterWithoutScreenshots },
            ]}
          />
          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setFilters(NO_FILTERS);
                setQuery("");
                setPage(1);
              }}
              className="min-h-[40px] shrink-0 rounded-full px-3 text-sm font-semibold text-vi hover:bg-vi/10"
            >
              {t.filters.clearAll}
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-mu">{t.views.filterScope}</p>
      <p className="text-xs text-mu">{t.views.sortHint}</p>
      {unit === "percent" && <p className="text-xs text-mu">{t.views.percentBase}</p>}
      {filtered.length === 0 ? (
        <EmptyState
          title={t.emptyFiltered}
          description={t.emptyFilteredHint}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setFilters(NO_FILTERS);
                setQuery("");
              }}
            >
              {t.filters.clearAll}
            </Button>
          }
        />
      ) : (
        <>
          {view === "list" ? renderRows(groups, true) : (
            <div className="space-y-2" data-testid="trades-days">
              {groups.map(g => {
                const summary = tradeDaySummary(g.trades, accounts);
                return <details key={g.dateKey} open={expanded.has(g.dateKey)} data-testid="trade-day" className="rounded-lg border border-line bg-s1"
                  onToggle={e => { const open = e.currentTarget.open; setExpanded(old => { if (old.has(g.dateKey) === open) return old; const next = new Set(old); if (open) next.add(g.dateKey); else next.delete(g.dateKey); return next; }); }}>
                  <summary className="cursor-pointer rounded-lg px-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi">
                    <span className="ml-1 inline-flex max-w-full flex-wrap items-center gap-x-4 gap-y-1 align-middle">
                      <span className="font-semibold">{dayLabel(g.dateKey)}</span>
                      <span className="font-semibold tabular-nums">{dayTotal(g)}</span>
                      <span className="text-xs text-mu">{t.tradesCount.replace("{count}", String(g.trades.length))} · {t.views.wins}: {summary.wins} · {t.views.losses}: {summary.losses} · {t.views.breakeven}: {summary.breakeven}{summary.open > 0 && ` · ${t.views.open}: ${summary.open}`}</span>
                    </span>
                  </summary>
                  {expanded.has(g.dateKey) && renderRows([g], false)}
                </details>;
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-1 text-sm text-mu">
              <Button variant="ghost" disabled={currentPage === 1} onClick={() => setPage(() => Math.max(1, currentPage - 1))}>
                {dict.journal.prevBtn}
              </Button>
              <span>{dict.journal.pageOf.replace("{page}", String(currentPage)).replace("{total}", String(totalPages))}</span>
              <Button variant="ghost" disabled={currentPage === totalPages} onClick={() => setPage(() => Math.min(totalPages, currentPage + 1))}>
                {dict.journal.nextBtn}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

