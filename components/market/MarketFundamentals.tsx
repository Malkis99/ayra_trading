"use client";

import { useEffect, useState } from "react";
import { economyText } from "@/lib/market/economy/dictionary";
import { fundamentalsText } from "@/lib/market/economy/fundamentals-dictionary";
import { fundamentalDefinitions, type FundamentalSeries, type FundamentalSnapshot } from "@/lib/market/economy/fundamentals-data";

export function MarketFundamentals({ lang, series }: { lang: "ru" | "en"; series: readonly FundamentalSeries[] }) {
  return <div className="grid min-w-0 gap-3 lg:grid-cols-2">
    {series.map(value => <FundamentalCard key={value} lang={lang} series={value} />)}
  </div>;
}

function FundamentalCard({ lang, series }: { lang: "ru" | "en"; series: FundamentalSeries }) {
  const t = economyText[lang];
  const f = fundamentalsText[lang];
  const definition = fundamentalDefinitions[series];
  const [latest, setLatest] = useState<FundamentalSnapshot>();
  const [history, setHistory] = useState<FundamentalSnapshot>();
  const [attempt, setAttempt] = useState(0);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void load(series, "latest", controller.signal).then(result => {
      if (!controller.signal.aborted) setLatest(prior =>
        result.status === "error" && prior?.points.length ? { ...prior, status: "stale" } : result);
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
  const status = (data: FundamentalSnapshot) => data.status === "stale" ? f.stale : data.status === "partial" ? f.partial
    : data.status === "error" ? t.error : t.empty;
  const button = "rounded border border-line px-2 py-1.5 text-xs text-vi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi";
  return <article data-testid={"economy-fundamental-" + series} className="min-w-0 space-y-3 rounded-lg border border-line bg-s2 p-4">
    <header><p className="text-xs text-vi">{t.country} · {f.frequency[definition.frequency]}</p>
      <h4 className="mt-1 font-semibold text-tx">{title}</h4>
      <p className="mt-1 text-xs text-mu">{description}</p></header>
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
        <p>{f.sourceDate} · {point.publishedAt ? date(point.publishedAt) : f.dateUnknown}</p>
        <p>{f.vintage} · {point.vintage === "current" ? f.current : point.vintage}{point.vintage !== "current" || point.stage !== "current" ? " · " + f[point.stage] : ""}</p>
        <p>{f.retrieved} · {latest?.retrievedAt ? date(latest.retrievedAt) : f.dateUnknown}</p>
      </div>
    </>}
    <a className="block break-words text-xs font-semibold text-vi" href={point?.sourceUrl ?? definition.url} target="_blank" rel="noreferrer">{f.source} ↗</a>
    <button type="button" className={button} disabled={historyAttempt > 0 && !history}
      onClick={() => { setHistory(undefined); setHistoryAttempt(value => value + 1); }}>
      {historyAttempt > 0 && !history ? t.loading : history?.status === "error" ? t.retry : f.history}
    </button>
    {history && <>
      {history.status !== "ready" && <p role="status" className="text-xs text-mu">{status(history)}</p>}
      {history.points.length < 2 && <p className="text-xs text-mu">{f.short}</p>}
      {!!history.points.length && <div className="max-h-80 space-y-2 overflow-y-auto text-xs text-mu">
        <p>{f.historyNote}</p>
        <ul className="space-y-2">{history.points.map(row => <li key={row.period} className="border-t border-line pt-2">
          <p className="flex flex-wrap justify-between gap-2"><span>{row.period}</span><strong className="tabular-nums text-tx">{format(row.value)}</strong></p>
          <a className="text-vi" href={row.sourceUrl} target="_blank" rel="noreferrer">{f.vintage} · {row.vintage === "current" ? f.current : row.vintage} · {f[row.stage]} ↗</a>
        </li>)}</ul>
      </div>}
    </>}
  </article>;
}

async function load(series: FundamentalSeries, range: "latest" | "history", signal: AbortSignal): Promise<FundamentalSnapshot> {
  try {
    const response = await fetch("/api/market-economy/fundamentals?series=" + series + "&range=" + range, { signal });
    if (response.ok) return await response.json() as FundamentalSnapshot;
  } catch { /* The card retains its last confirmed values on a failed retry. */ }
  return { status: "error", points: [] };
}
