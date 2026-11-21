"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BarChart3, Eye, Pin, Plus, Search, X } from "lucide-react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";
import { Button, EmptyState, Select } from "@/components/ui";
import { PICKER_CATEGORIES, categoryOf, type InstrumentId, instrumentName, INSTRUMENTS } from "@/lib/market/instruments";
import { WATCHLIST_LIMIT, addTo, isFull, normalizeWatchlist, removeFrom, type Watchlist } from "@/lib/market/watchlist";
import { moveVisible, visibleWatchlistIds, type WatchlistCategory } from "@/lib/market/watchlist-view";
import { MARKET_WATCHLIST_KEY, readMarketKey, useWatchlist } from "@/lib/market/watchlist-store";
import { useMarketInAccount } from "@/lib/market/cloud-sync-engine";
import { MarketSyncLine } from "./MarketSyncLine";
import { InstrumentPicker } from "./InstrumentPicker";
import { WatchlistQuotes } from "./WatchlistQuotes";
import type { useWatchlistPriorities } from "@/lib/market/use-watchlist-priorities";
import { priorityDocument, priorityValue } from "@/lib/market/priority-queue";

/** WATCH-1A: one AYRA list; search/category are transient projections, never cloud fields. */
export function MarketWatchlist({ onOpenChart, priorities }: { onOpenChart: (id: InstrumentId) => void; priorities: ReturnType<typeof useWatchlistPriorities> }) {
  const { dict } = useApp();
  const t = dict.market, w = t.watchlist;
  const [list, setList, loaded] = useWatchlist();
  const inAccount = useMarketInAccount();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<WatchlistCategory>("all");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const p = w.priorities;
  const pinned = (id: InstrumentId) => !!priorities.userId && !!priorities.record && priorityValue(priorities.record, id);
  const include = (id: InstrumentId) => !pinnedOnly || pinned(id);
  const canPin = !!priorities.userId && priorities.record?.enabled === true && priorities.record.checked === true && !priorities.storageError && !["unsupported", "invalid", "error"].includes(priorities.record?.issue ?? "");
  const priorityIssue = !priorities.userId ? "guest" : priorities.storageError ? "storageError" : !priorities.record ? "loading"
    : priorities.record.enabled === false ? "disabled" : priorities.record.issue === "unsupported" ? "unsupported" : priorities.record.issue === "invalid" || priorities.record.issue === "error" ? "error" : priorities.record.issue === "network" ? "pending" : !priorities.record.checked ? "loading" : null;
  const [origin, setOrigin] = useState("");
  const [notice, setNotice] = useState<{ kind: "added" | "removed" | "moved"; id: InstrumentId } | null>(null);
  const root = useRef<HTMLElement>(null), addButton = useRef<HTMLButtonElement>(null), queryInput = useRef<HTMLInputElement>(null);
  const focusAfter = useRef<{ id?: InstrumentId; action?: "up" | "down" } | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => setPinnedOnly(false), [priorities.userId]);
  useEffect(() => {
    const next = focusAfter.current;
    if (!next) return;
    focusAfter.current = null;
    const action = next.id && next.action ? root.current?.querySelector<HTMLButtonElement>(`[data-testid="market-watchlist-${next.action}-${next.id}"]`) : null;
    const instrument = next.id ? root.current?.querySelector<HTMLButtonElement>(`[data-testid="market-watchlist-chart-${next.id}"]`) : null;
    if (action && !action.disabled) action.focus();
    else (instrument ?? (list.ids.length ? queryInput.current : addButton.current))?.focus();
  }, [list, priorities.record]);

  if (!loaded || !origin) return <section className="card min-h-[96px]" data-testid="market-watchlist" aria-busy="true" />;
  const full = isFull(list);
  const visible = visibleWatchlistIds(list, query, category, t.instruments, include);
  const filtered = !!query.trim() || category !== "all" || pinnedOnly;
  const queueStatus = priorities.record?.queue.some(q => q.status === "conflict") ? "conflict" : priorities.record?.queue.some(q => q.status === "error") ? "error" : priorities.record?.queue.length ? "pending" : null;
  // A cloud pull or another view may have changed the list since this row rendered.
  const apply = (change: (current: Watchlist) => Watchlist) => {
    const current = readMarketKey(MARKET_WATCHLIST_KEY, normalizeWatchlist);
    const next = change(current);
    if (next !== current) setList(next);
  };
  const toggle = (id: InstrumentId) => apply(current => {
    const removing = current.ids.includes(id);
    const next = removing ? removeFrom(current, id) : addTo(current, id);
    if (next !== current) setNotice({ kind: removing ? "removed" : "added", id });
    return next;
  });
  const remove = (id: InstrumentId) => apply(current => {
    const rows = visibleWatchlistIds(current, query, category, t.instruments, include), index = rows.indexOf(id);
    const next = removeFrom(current, id);
    if (next !== current) {
      focusAfter.current = { id: rows[index + 1] ?? rows[index - 1] };
      setNotice({ kind: "removed", id });
    }
    return next;
  });
  const move = (id: InstrumentId, step: -1 | 1) => apply(current => {
    const next = moveVisible(current, id, step, query, category, t.instruments, include);
    if (next !== current) { focusAfter.current = { id, action: step === -1 ? "up" : "down" }; setNotice({ kind: "moved", id }); }
    return next;
  });
  const clearFilters = () => { setQuery(""); setCategory("all"); setPinnedOnly(false); queryInput.current?.focus(); };
  const iconButton = "grid h-11 w-9 sm:w-11 shrink-0 place-items-center rounded-md text-mu hover:bg-s2 hover:text-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-30 disabled:hover:bg-transparent";

  return <section ref={root} className="card min-w-0 space-y-3" data-testid="market-watchlist" aria-labelledby="market-watchlist-title">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 space-y-1">
        <h2 id="market-watchlist-title" className="font-serif text-lg font-bold text-tx">{w.title}</h2>
        <p className="text-[11px] text-mu" data-testid="market-watchlist-count">
          {formatString(w.count, { n: list.ids.length, max: WATCHLIST_LIMIT })} · {inAccount ? w.accountNote : w.deviceNote}
        </p>
        <MarketSyncLine />
      </div>
      <Button ref={addButton} variant={adding ? "primary" : "secondary"} onClick={() => setAdding(v => !v)}
        aria-expanded={adding} aria-controls="market-watchlist-picker-panel" data-testid="market-watchlist-add">
        {!adding && <Plus size={14} aria-hidden="true" />}{adding ? w.done : w.add}
      </Button>
    </div>
    {priorityIssue && <div className="flex flex-wrap items-center gap-x-3 text-xs text-mu">
      <p id="watchlist-priority-help" role="status" data-testid="watchlist-priority-help">{p[priorityIssue]}</p>
      {(priorityIssue === "pending" || priorityIssue === "error") && <button type="button" className="min-h-[36px] rounded text-vi focus-visible:ring-2 focus-visible:ring-vi" data-testid="watchlist-pins-retry" onClick={() => void priorities.controller?.run().catch(priorities.failed)}>{p.retry}</button>}
    </div>}
    {queueStatus && <div className="flex flex-wrap items-center gap-x-3 text-xs text-mu" data-testid="watchlist-pins-summary" data-kind={queueStatus}>
      {!priorityIssue && <p role="status">{formatString(p.state, { status: p[queueStatus] })}</p>}
      {filtered && queueStatus !== "pending" && <button type="button" className="min-h-[36px] rounded text-vi focus-visible:ring-2 focus-visible:ring-vi" onClick={clearFilters}>{p.showAll}</button>}
    </div>}
    {full && <p className="text-xs text-mu" role="status" data-testid="market-watchlist-full">{formatString(w.full, { n: list.ids.length })}</p>}
    {adding && <div id="market-watchlist-picker-panel" className="rounded-md border border-line bg-s1 p-3" onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); setAdding(false); addButton.current?.focus(); }
    }}><InstrumentPicker idPrefix="market-watchlist" selected={id => list.ids.includes(id)} disabled={() => full} onPick={toggle} /></div>}
    {!!list.ids.length && <>
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.6fr)_auto]">
        <label className="relative block min-w-0">
          <span className="sr-only">{w.search}</span><Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-mu" />
          <input ref={queryInput} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={w.search}
            className="min-h-[44px] w-full rounded-md border border-line bg-s1 pl-9 pr-3 text-sm text-tx placeholder:text-mu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi"
            data-testid="market-watchlist-query" />
        </label>
        <Select<WatchlistCategory> value={category} onChange={setCategory} aria-label={w.category} searchable={false}
          options={[{ value: "all", label: w.allCategories }, ...PICKER_CATEGORIES.map(c => ({ value: c.id, label: t.overview.categories[c.id] }))]}
          data-testid="market-watchlist-category" />
      <button type="button" aria-pressed={pinnedOnly} disabled={!priorities.userId} onClick={() => setPinnedOnly(v => !v)}
        className={`inline-flex min-h-[44px] items-center gap-2 rounded-md px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi disabled:opacity-40 ${pinnedOnly ? "bg-pri/25 text-vi" : "text-mu hover:bg-s2"}`}
        data-testid="watchlist-pinned-filter"><Pin size={14} aria-hidden="true" />{p.filter}</button>
      </div>
      {filtered && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mu">
        <span role="status">{formatString(w.shown, { n: visible.length, total: list.ids.length })}</span>
        <button type="button" onClick={clearFilters} className="min-h-[44px] rounded px-2 text-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi" data-testid="market-watchlist-clear-filters">{w.clearFilters}</button>
      </div>}
    </>}
    {!list.ids.length ? !adding && <EmptyState icon={<Eye size={18} />} title={w.emptyTitle} description={w.emptyText} />
      : !visible.length ? <p role="status" className="py-2 text-sm text-mu" data-testid="market-watchlist-no-results">{w.noResults}</p>
      : <ol className="divide-y divide-line/60" data-testid="market-watchlist-rows">
        {visible.map((id, index) => {
          const name = instrumentName(id, t.instruments), category = categoryOf(id)!;
          const queued = priorities.record?.queue.filter(q => q.operation.instrument === id);
          const state = queued?.some(q => q.status === "conflict") ? "conflict" : queued?.some(q => q.status === "error") ? "error" : queued?.length ? "pending" : priorities.record && priorityDocument(priorities.record)?.entries[id] ? "saved" : null;
          return <li key={id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-1.5" data-testid={`market-watchlist-row-${id}`}>
            <div className="grid min-w-0 gap-x-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
              <button type="button" onClick={() => onOpenChart(id)} aria-label={`${w.openChart}: ${name}`}
                className="min-w-0 rounded text-left hover:text-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi" data-testid={`market-watchlist-chart-${id}`}>
                <span className="flex items-start gap-1 text-sm font-semibold leading-snug text-tx"><span className="break-words">{name}</span><BarChart3 size={14} className="mt-0.5 shrink-0 text-vi" aria-hidden="true" /></span>
                <span className="block text-[11px] text-mu">{INSTRUMENTS[id].ticker}</span>
              </button>
              <span className="self-center break-words text-[11px] text-mu" data-testid={`market-watchlist-row-category-${id}`}>{t.overview.categories[category]}</span>
              {state && <span className={`text-[11px] ${state === "conflict" || state === "error" ? "text-vi" : "text-mu"}`} role="status" data-testid={`watchlist-pin-status-${id}`} data-kind={state}>{p[state]}</span>}
              {(state === "conflict" || state === "error") && <div className="flex flex-wrap gap-x-3 text-xs sm:col-span-2">
                <button type="button" className="min-h-[36px] rounded text-vi focus-visible:ring-2 focus-visible:ring-vi" data-testid={`watchlist-pin-mine-${id}`} onClick={() => void priorities.controller?.resolve(id, true).catch(priorities.failed)}>{p.keepMine}</button>
                <button type="button" className="min-h-[36px] rounded text-mu focus-visible:ring-2 focus-visible:ring-vi" data-testid={`watchlist-pin-cloud-${id}`} onClick={() => void priorities.controller?.resolve(id, false).catch(priorities.failed)}>{p.useCloud}</button>
              </div>}
            </div>
            <div className="flex items-center">
              <button type="button" disabled={!canPin || state === "conflict" || state === "error"} aria-pressed={pinned(id)} aria-describedby={priorityIssue ? "watchlist-priority-help" : undefined}
                className={`${iconButton} ${pinned(id) ? "bg-pri/20 !text-vi" : ""}`} aria-label={`${pinned(id) ? p.unpin : p.pin}: ${name}`} data-testid={`watchlist-pin-${id}`}
                onClick={() => { if (pinnedOnly && pinned(id)) focusAfter.current = {}; void priorities.controller?.enqueue(id).catch(priorities.failed); }}><Pin size={16} aria-hidden="true" /></button>
              <button type="button" onClick={() => move(id, -1)} disabled={index === 0} className={iconButton} aria-label={`${w.up}: ${name}`} data-testid={`market-watchlist-up-${id}`}><ArrowUp size={16} aria-hidden="true" /></button>
              <button type="button" onClick={() => move(id, 1)} disabled={index === visible.length - 1} className={iconButton} aria-label={`${w.down}: ${name}`} data-testid={`market-watchlist-down-${id}`}><ArrowDown size={16} aria-hidden="true" /></button>
              <button type="button" onClick={() => remove(id)} className={iconButton} aria-label={`${w.remove}: ${name}`} data-testid={`market-watchlist-remove-${id}`}><X size={16} aria-hidden="true" /></button>
            </div>
          </li>;
        })}
      </ol>}
    {!!list.ids.length && <WatchlistQuotes ids={list.ids} origin={origin} />}
    <p role="status" aria-live="polite" className="sr-only">{notice ? formatString(w[notice.kind], { name: instrumentName(notice.id, t.instruments) }) : ""}</p>
  </section>;
}
