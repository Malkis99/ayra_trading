"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Camera, List, Plus, Rows3, Search, ShieldAlert } from "lucide-react";
import type { Account, Strategy, Trade } from "@/lib/journal/types";
import { groupTradesByDay, hasViolation, sortTrades, type SortDir, type TradeSortKey } from "@/lib/journal/overview";
import type { Dictionary } from "@/lib/i18n/types";
import { AppStorage } from "@/lib/storage";
import { Button, EmptyState, FilterChip, Input, Segmented, Select } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { formatSignedMoney, formatSignedR, type JournalUnit } from "./JournalKpiStrip";

type Density = "comfortable" | "compact";
const DENSITY_KEY = "ayra_journal_density";
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

/** Trades list: filter chips, sorting, grouping by day, R bars, density, mobile cards. Opens a trade in the quick view. */
export function TradesTable({ trades, accounts, strategies, tz, unit, dict, lang, formatTradeValue, onOpenTrade, onAddTrade, readOnly, onFilteredChange }: Props) {
  const t = dict.journal.overview;
  const tt = dict.journal.tradesTab;
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sortKey, setSortKey] = useState<TradeSortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [density, setDensity] = useState<Density>("comfortable");
  const [page, setPage] = useState(1);

  useEffect(() => {
    try {
      const saved = AppStorage.getItem(DENSITY_KEY);
      if (saved === "compact" || saved === "comfortable") setDensity(saved);
    } catch {}
  }, []);
  const changeDensity = (d: Density) => {
    setDensity(d);
    try {
      AppStorage.setItem(DENSITY_KEY, d);
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
      if (filters.result && x.result !== filters.result) return false;
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

  const sorted = useMemo(() => sortTrades(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);
  useEffect(() => {
    onFilteredChange?.(filtered);
  }, [filtered, onFilteredChange]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageTrades = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const groups = sortKey === "date" ? groupTradesByDay(pageTrades, tz) : [{ dateKey: "", trades: pageTrades, netR: 0, netMoney: null }];
  const maxAbsR = Math.max(1, ...pageTrades.map((x) => Math.abs(x.rMultiple ?? 0)));

  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const dayLabel = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "long" }).format(new Date(y, m - 1, d));
  };
  const timeLabel = (iso: string) =>
    new Intl.DateTimeFormat(locale, sortKey === "date" ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const dayTotal = (g: { netR: number; netMoney: number | null; trades: Trade[] }) => {
    if (unit === "money") {
      const cur = accounts.find((a) => a.id === g.trades[0]?.accountId)?.currency ?? "USD";
      return formatSignedMoney(g.netMoney, cur, lang);
    }
    return formatSignedR(g.netR);
  };

  const toggleSort = (key: TradeSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "instrument" ? "asc" : "desc");
    }
    setPage(1);
  };

  const resultTone = (x: Trade) => (x.result === "win" ? "text-long" : x.result === "loss" ? "text-short" : "text-tx");
  const compact = density === "compact";

  const rBar = (x: Trade) =>
    typeof x.rMultiple === "number" ? (
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
          <div className="flex flex-1 items-end gap-2 md:justify-end">
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
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            >
              {sortDir === "asc" ? <ArrowUp size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />}
            </Button>
            <Segmented<Density>
              name={t.density.label}
              value={density}
              onChange={changeDensity}
              className="w-[104px] shrink-0"
              options={[
                { value: "comfortable", label: <span className="sr-only">{t.density.comfortable}</span>, icon: <Rows3 size={16} aria-hidden="true" />, tone: "neutral" },
                { value: "compact", label: <span className="sr-only">{t.density.compact}</span>, icon: <List size={16} aria-hidden="true" />, tone: "neutral" },
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

      {sorted.length === 0 ? (
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
              {groups.map((g) => (
                <tbody key={g.dateKey || "all"} className="border-b border-line last:border-b-0">
                  {g.dateKey && (
                    <tr className="bg-s2/50">
                      <th scope="rowgroup" colSpan={7} className="px-3 py-1.5 text-xs font-semibold text-mu">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-tx first-letter:uppercase">{dayLabel(g.dateKey)}</span>
                          <span className="tabular-nums">
                            {dict.journal.overview.dayTotal}:{" "}
                            <span className={cn("font-semibold", g.netR > 0 ? "text-long" : g.netR < 0 ? "text-short" : "text-tx")}>{dayTotal(g)}</span>
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
                        <td className={cn("px-3 tabular-nums text-mu", compact ? "py-1.5" : "py-3")}>{timeLabel(x.openedAt)}</td>
                        <td className={cn("px-3 font-semibold text-tx", compact ? "py-1.5" : "py-3")}>
                          <span className="inline-flex items-center gap-1.5">
                            {x.instrument}
                            {x.attachmentIds && x.attachmentIds.length > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-vi/15 px-1.5 py-0.5 text-[11px] font-medium text-vi">
                                <Camera size={11} aria-hidden="true" />
                                {x.attachmentIds.length}
                              </span>
                            )}
                            <span title={tt.unverifiedTooltip} className="text-mu/70">
                              <ShieldAlert size={13} aria-label={tt.unverifiedBadge} />
                            </span>
                          </span>
                        </td>
                        <td className={cn("px-3", compact ? "py-1.5" : "py-3")}>{directionPill(x)}</td>
                        <td className={cn("px-3 text-right", compact ? "py-1.5" : "py-3")}>
                          <span className="inline-flex items-center justify-end gap-2">
                            {rBar(x)}
                            <span className={cn("font-semibold tabular-nums", resultTone(x))}>{formatTradeValue(x)}</span>
                          </span>
                        </td>
                        <td className={cn("max-w-[160px] truncate px-3 text-mu", compact ? "py-1.5" : "py-3")}>
                          {strat ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: strat.color }} aria-hidden="true" />
                              {strat.name || dict.journal.strategiesTab.defaultName}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className={cn("px-3 text-right tabular-nums", compact ? "py-1.5" : "py-3", hasViolation(x) ? "text-short" : "text-mu")}>
                          {x.processScore ?? "—"}
                        </td>
                        <td className={cn("max-w-[140px] truncate px-3 text-mu", compact ? "py-1.5" : "py-3")}>{accountName(x.accountId)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>

          {/* Phone cards */}
          <div className="space-y-3 md:hidden">
            {groups.map((g) => (
              <section key={g.dateKey || "all"} className="space-y-2">
                {g.dateKey && (
                  <div className="flex items-center justify-between px-1 text-xs font-semibold text-mu">
                    <span className="text-tx first-letter:uppercase">{dayLabel(g.dateKey)}</span>
                    <span className={cn("tabular-nums", g.netR > 0 ? "text-long" : g.netR < 0 ? "text-short" : "text-mu")}>{dayTotal(g)}</span>
                  </div>
                )}
                {g.trades.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => onOpenTrade(x)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border border-line bg-s1 px-3 text-left transition-colors hover:border-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi",
                      compact ? "min-h-[48px] py-1.5" : "min-h-[64px] py-3"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-tx">{x.instrument}</span>
                        {directionPill(x)}
                        {x.attachmentIds && x.attachmentIds.length > 0 && <Camera size={13} className="text-vi" aria-hidden="true" />}
                      </span>
                      {!compact && (
                        <span className="mt-0.5 block truncate text-xs text-mu">
                          {timeLabel(x.openedAt)} · {accountName(x.accountId)}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className={cn("font-semibold tabular-nums", resultTone(x))}>{formatTradeValue(x)}</span>
                      {rBar(x)}
                    </span>
                  </button>
                ))}
              </section>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-1 text-sm text-mu">
              <Button variant="ghost" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                {dict.journal.prevBtn}
              </Button>
              <span>{dict.journal.pageOf.replace("{page}", String(page)).replace("{total}", String(totalPages))}</span>
              <Button variant="ghost" disabled={page === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                {dict.journal.nextBtn}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

