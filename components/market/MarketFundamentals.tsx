"use client";

import { useEffect, useId, useState } from "react";
import { economyText } from "@/lib/market/economy/dictionary";
import { fundamentalsText } from "@/lib/market/economy/fundamentals-dictionary";
import { fundamentalDefinitions, type FundamentalSeries, type FundamentalSnapshot } from "@/lib/market/economy/fundamentals-data";
import { EconomyDetails } from "./EconomyDetails";
import { EconomyHistoryChart } from "./EconomyHistoryChart";

export function MarketFundamentals({ lang, series, embedded = false }: { lang: "ru" | "en"; series: readonly FundamentalSeries[]; embedded?: boolean }) {
  const cards = series.map(value => <FundamentalCard key={value} lang={lang} series={value} />);
  return embedded ? <>{cards}</> : <div className="grid min-w-0 items-start gap-3 md:grid-cols-2">{cards}</div>;
}

function FundamentalCard({ lang, series }: { lang: "ru" | "en"; series: FundamentalSeries }) {
  const t = economyText[lang];
  const f = fundamentalsText[lang];
  const definition = fundamentalDefinitions[series];
  const [latest, setLatest] = useState<FundamentalSnapshot>();
  const [history, setHistory] = useState<FundamentalSnapshot>();
  const [historyVisible, setHistoryVisible] = useState(true);
  const historyId = useId();
  const [attempt, setAttempt] = useState(0);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void load(series, "latest", controller.signal).then(result => {
      if (!controller.signal.aborted) setLatest(prior =>
        result.status === "error" && prior?.points.length ? { ...prior, status: "stale", staleReason: "source_unavailable" } : result);
    });
    return () => controller.abort();
  }, [series, attempt]);
  useEffect(() => {
    if (!historyAttempt) return;
    const controller = new AbortController();
    void load(series, "history", controller.signal).then(result => { if (!controller.signal.aborted) setHistory(result); });
    return () => controller.abort();
  }, [series, historyAttempt]);
  const point = latest?.points[0];
  const [title, description] = f.definitions[series];
  const format = (value: number) => new Intl.NumberFormat(lang, {
    maximumFractionDigits: series === "earnings" ? 2 : series === "continuing" ? 0 : 1,
    minimumFractionDigits: series === "earnings" ? 2 : 0,
  }).format(value);
  const date = (value: string) => new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone: "UTC" }).format(Date.parse(value));
  const retrieved = (value?: string) => value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(Date.parse(value)) + " UTC" : f.dateUnknown;
  const status = (data: FundamentalSnapshot) => data.status === "stale" ? (data.staleReason ? f.staleReasons[data.staleReason] : f.stale) : data.status === "partial" ? f.partial
    : data.status === "error" ? t.error : t.empty;
  const button = "rounded border border-line px-2 py-1.5 text-xs text-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi";
  return <article data-testid={"economy-fundamental-" + series} className="min-w-0 space-y-2 rounded-lg border border-line bg-s2 p-3 sm:p-4">
      <header><p className="text-xs text-vi">{t.country} · {f.frequency[definition.frequency]}{latest?.status === "ready" ? " · " + t.confirmed : ""}</p>
      <h4 className="mt-1 font-semibold text-tx">{title}</h4>
    </header>
    {(!latest || latest.status !== "ready") && <p role="status" className="text-xs text-mu">{latest ? status(latest) : t.loading}</p>}
    {latest && ["error", "stale", "partial"].includes(latest.status) && <button type="button" className={button} onClick={() => setAttempt(value => value + 1)}>{t.retry}</button>}
    {point && <>
      <dl className="grid grid-cols-2 gap-3">
        <div><dt className="text-xs text-mu">{t.actual}</dt><dd className="text-2xl font-semibold tabular-nums text-tx">{format(point.value)}</dd></div>
        {point.previous !== null && <div><dt className="text-xs text-mu">{t.previous}</dt><dd className="text-2xl font-semibold tabular-nums text-tx">{format(point.previous)}</dd></div>}
      </dl>
      <div className="space-y-1 text-xs text-mu">
        <p>{f.units[definition.unit]} · {definition.adjustment}</p>
        <p>{t.period} · {point.period}</p>
      </div>
    </>}
    <EconomyDetails label={t.details}>
      <p>{description}</p>
      <p>{f.sourceDate} · {point?.publishedAt ? date(point.publishedAt) : f.dateUnknown}</p>
      <p>{f.vintage} · {point ? (point.vintage === "current" ? f.current : point.vintage) + " · " + f[point.stage] : f.dateUnknown}</p>
      <p>{f.retrieved} · {retrieved(latest?.retrievedAt)}</p>
    <a className="block break-words text-xs font-semibold text-vi" href={point?.sourceUrl ?? definition.url} target="_blank" rel="noreferrer">{f.source} ↗</a>
    </EconomyDetails>
    <button type="button" className={button} disabled={historyAttempt > 0 && !history}
      aria-expanded={!!history && historyVisible} aria-controls={historyId}
      onClick={() => {
        if (history && history.status !== "error") setHistoryVisible(value => !value);
        else { setHistoryVisible(true); setHistory(undefined); setHistoryAttempt(value => value + 1); }
      }}>
      {historyAttempt > 0 && !history ? t.loading : history?.status === "error" ? t.retry : history && historyVisible ? t.hideHistory : f.history}
    </button>
    <div id={historyId} hidden={!history || !historyVisible}>
    {history && <>
      {history.status !== "ready" && <p role="status" className="text-xs text-mu">{status(history)}</p>}
      <p className="text-xs text-mu">{f.retrieved} · {retrieved(history.retrievedAt)}</p>
      <EconomyHistoryChart points={history.points.map(row => ({ period: row.period, value: row.value, group: [series, definition.unit, row.vintage, row.stage].join(":") }))}
        format={format} empty={f.short} cadence={definition.frequency} />
      {!!history.points.length && <div className="max-h-80 space-y-2 overflow-y-auto text-xs text-mu">
        <p>{f.historyNote}</p>
        <ul className="space-y-2">{history.points.map(row => <li key={row.period} className="border-t border-line pt-2">
          <p className="flex flex-wrap justify-between gap-2"><span>{row.period}</span><strong className="tabular-nums text-tx">{format(row.value)}</strong></p>
          <a className="text-vi" href={row.sourceUrl} target="_blank" rel="noreferrer">{f.vintage} · {row.vintage === "current" ? f.current : row.vintage} · {f[row.stage]} ↗</a>
        </li>)}</ul>
      </div>}
    </>}
    </div>
  </article>;
}

async function load(series: FundamentalSeries, range: "latest" | "history", signal: AbortSignal): Promise<FundamentalSnapshot> {
  try {
    const response = await fetch("/api/market-economy/fundamentals?series=" + series + "&range=" + range, { signal });
    if (response.ok) return await response.json() as FundamentalSnapshot;
  } catch { /* The card retains its last confirmed values on a failed retry. */ }
  return { status: "error", points: [] };
}
