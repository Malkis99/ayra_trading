"use client";

import { useEffect, useState } from "react";
import { economyText } from "@/lib/market/economy/dictionary";
import { fiscalText } from "@/lib/market/economy/fiscal-dictionary";
import { monetaryText } from "@/lib/market/economy/monetary-dictionary";
import { dayMs, maturities, monetarySources, type MonetaryPoint, type MonetarySeries, type MonetarySnapshot } from "@/lib/market/economy/monetary-data";

type Language = "en" | "ru";
const seriesList = Object.keys(monetarySources) as MonetarySeries[];
const chartYears = [1, 3, 5, 10, 0];

async function read(series: MonetarySeries, history: boolean, signal: AbortSignal): Promise<MonetarySnapshot> {
  try {
    const response = await fetch("/api/market-economy/monetary?series=" + series + "&range=" + (history ? "history" : "latest"), { signal });
    if (response.ok) return await response.json() as MonetarySnapshot;
  } catch { /* Use the same visible error state as a failed upstream request. */ }
  return { status: "error", points: [] };
}

function HistoryChart({ points, column, lang, gap, format }: {
  points: MonetaryPoint[]; column: number; lang: Language; gap: number; format: (value: number) => string;
}) {
  const t = economyText[lang];
  const values = points.flatMap((point, index) => point.values[column] == null ? [] : [{ date: point.date, value: point.values[column]!, index }]);
  if (values.length < 2) return <p className="text-xs text-mu">{t.historyEmpty}</p>;
  const times = values.map(point => Date.parse(point.date));
  const min = Math.min(...values.map(point => point.value));
  const max = Math.max(...values.map(point => point.value));
  const path = values.map((point, i) => {
    const x = 5 + (times[i] - times[0]) / (times[times.length - 1] - times[0]) * 390;
    const y = max === min ? 45 : 80 - (point.value - min) / (max - min) * 70;
    return (i > 0 && point.index === values[i - 1].index + 1 && times[i] - times[i - 1] <= gap ? "L" : "M")
      + x.toFixed(2) + "," + y.toFixed(2);
  }).join(" ");
  return <div className="rounded-md bg-s1 p-2">
    <div className="flex justify-between text-xs text-mu"><span>{format(min)}</span><span>{format(max)}</span></div>
    <svg viewBox="0 0 400 90" preserveAspectRatio="none" aria-hidden="true" className="h-24 w-full text-vi">
      <path d="M5 10H395 M5 45H395 M5 80H395" stroke="currentColor" opacity=".2" />
      <path d={path} stroke="currentColor" fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="flex justify-between text-xs text-mu"><time>{values[0].date}</time><time>{values.at(-1)?.date}</time></div>
    <details className="mt-2 text-xs text-mu">
      <summary className="cursor-pointer">{t.data}</summary>
      <ul className="max-h-40 overflow-y-auto">{values.slice().reverse().map(point => <li key={point.date}>{point.date} · {format(point.value)}</li>)}</ul>
    </details>
  </div>;
}

function MonetaryCard({ series, lang }: { series: MonetarySeries; lang: Language }) {
  const t = monetaryText[lang];
  const words = economyText[lang];
  const [latest, setLatest] = useState<MonetarySnapshot>();
  const [history, setHistory] = useState<MonetarySnapshot>();
  const [refresh, setRefresh] = useState(0);
  const [historyRequest, setHistoryRequest] = useState(0);
  const [column, setColumn] = useState(3);
  const [years, setYears] = useState(series === "policy" ? 0 : 1);
  const fetchingHistory = historyRequest > 0 && !history;
  useEffect(() => {
    const abort = new AbortController();
    void read(series, false, abort.signal).then(data => {
      if (!abort.signal.aborted) setLatest(old => data.status === "error" && old?.points.length ? { ...old, status: "stale" } : data);
    });
    return () => abort.abort();
  }, [series, refresh]);
  useEffect(() => {
    if (!historyRequest) return;
    const abort = new AbortController();
    void read(series, true, abort.signal).then(data => { if (!abort.signal.aborted) setHistory(data); });
    return () => abort.abort();
  }, [series, historyRequest]);
  const tip = latest?.points.at(-1);
  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: series === "dollar" ? 4 : 2 });
  const signed = new Intl.NumberFormat(lang, { maximumFractionDigits: 2, signDisplay: "exceptZero" });
  const format = (value: number, i = column) => number.format(value) + (series === "dollar" ? " " + t.points : series === "yields" && i >= 5 ? " " + t.bp : "%");
  const historyCutoff = new Date(tip?.date ?? history?.points.at(-1)?.date ?? "2000-01-01");
  historyCutoff.setUTCFullYear(historyCutoff.getUTCFullYear() - years);
  const points = history?.status === "ready" || history?.status === "stale"
    ? history.points.filter(point => !years || point.date >= historyCutoff.toISOString().slice(0, 10))
    : latest?.points ?? [];
  const columnPoints = points.filter(point => point.values[column] != null);
  const first = columnPoints[0]?.values[column];
  const last = columnPoints.at(-1)?.values[column];
  const delta = columnPoints.length > 1 && first != null && last != null ? (column >= 5 ? last - first : Math.round((last - first) * 100)) : null;
  return <article className="min-w-0 space-y-3 rounded-lg border border-line bg-s2 p-4" data-testid={"monetary-" + series}>
    <h4 className="font-serif text-lg font-semibold text-tx">{t[series]}</h4>
    {(!latest || latest.status !== "ready") && <p role="status" className="text-sm text-mu">
      {!latest ? words.loading : latest.status === "stale" ? fiscalText[lang].stale : latest.status === "unavailable" ? words.unavailable : words.error}
    </p>}
    {(latest?.status === "error" || latest?.status === "stale") && <button type="button" onClick={() => setRefresh(value => value + 1)}
      className="rounded border border-line px-2 py-1 text-xs text-vi">{words.retry}</button>}
    {tip && series === "policy" && <>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <div><dt className="text-xs text-mu">{t.target}</dt><dd className="text-2xl font-semibold tabular-nums">{format(tip.values[0]!)}–{format(tip.values[1]!)}</dd>
          <dd className="text-xs text-mu">{t.effectiveSince} · <time>{tip.date}</time></dd></div>
        <div><dt className="text-xs text-mu">{t.effective}</dt><dd className="text-lg font-semibold tabular-nums">{latest?.effectiveRate ? format(latest.effectiveRate.values[0]!) : words.empty}</dd>
          {latest?.effectiveRate && <dd className="text-xs text-mu">{t.observed} · <time>{latest.effectiveRate.date}</time> · <a className="text-vi" href="https://www.newyorkfed.org/markets/reference-rates/effr">New York Fed</a></dd>}</div>
      </dl>
      <a href="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" className="text-xs text-vi">{t.documents} ↗</a>
      {latest?.effectiveRate && <details className="text-xs text-mu">
        <summary className="cursor-pointer">{t.terms}</summary>
        <p className="mt-1">{t.effrTerms}</p>
        <a href="https://www.newyorkfed.org/privacy/termsofuse" className="text-vi">{t.terms} ↗</a>
      </details>}
    </>}
    {tip && series === "yields" && <>
      <p className="text-xs text-mu">{t.observed} · <time>{tip.date}</time> · {t.annual}</p>
      <div role="group" aria-label={t.yields} className="grid grid-cols-2 gap-1">
        {maturities.map((maturity, i) => <button key={maturity} type="button" onClick={() => setColumn(i)} aria-pressed={column === i}
          className={"rounded border border-line p-2 text-left text-xs " + (column === i ? "bg-vi/15 text-vi" : "text-mu")}>
          {maturity} <strong className="ml-1 tabular-nums text-tx">{tip.values[i] == null ? "—" : format(tip.values[i]!, i)}</strong>
        </button>)}
      </div>
      {delta !== null && <p className="text-xs text-mu">{t.change} · {signed.format(delta)} {t.bp}</p>}
    </>}
    {tip && series === "dollar" && <>
      <p className="text-xs text-mu">{t.index}</p>
      <p className="text-2xl font-semibold tabular-nums">{number.format(tip.values[0]!)}</p>
      <p className="text-xs text-mu">{t.base}</p>
      <p className="text-xs text-mu">{t.observed} · <time>{tip.date}</time></p>
      {latest?.releasedOn && <p className="text-xs text-mu">{t.published} · <time>{latest.releasedOn}</time></p>}
      <dl className="grid grid-cols-3 gap-1 text-sm">{t.changes.map((label, i) => {
        const value = latest?.dollarChanges?.[i];
        return <div key={label}><dt className="text-xs text-mu">{label}</dt><dd className="tabular-nums">{value == null ? "—" : signed.format(value) + "%"}</dd></div>;
      })}</dl>
    </>}
    {(!history || history.status === "error" || history.status === "unavailable") && <button type="button" disabled={fetchingHistory}
      onClick={() => { setHistory(undefined); setHistoryRequest(value => value + 1); }} className="rounded border border-line px-2 py-1 text-xs text-vi">
      {fetchingHistory ? words.loading : history ? words.retry : t.history}
    </button>}
    {history?.status === "error" && <p role="status" className="text-xs text-mu">{words.error}</p>}
    {history?.status === "stale" && <p role="status" className="text-xs text-mu">{fiscalText[lang].stale}</p>}
    {history?.status === "unavailable" && <p role="status" className="text-xs text-mu">{words.unavailable}</p>}
    {history && (history.status === "ready" || history.status === "stale") && <div role="group" aria-label={words.history} className="flex flex-wrap gap-1">
      {chartYears.map((value, i) => <button key={value} type="button" aria-pressed={value === years} onClick={() => setYears(value)}
        className={"rounded border border-line px-2 py-1 text-xs " + (value === years ? "bg-vi/15 text-vi" : "text-mu")}>{words.ranges[i]}</button>)}
    </div>}
    {series !== "policy" && <HistoryChart points={points} column={series === "dollar" ? 0 : column} lang={lang} gap={4 * dayMs} format={format} />}
    {series === "policy" && points.length > 1 && <details className="text-xs text-mu">
      <summary className="cursor-pointer">{t.policyHistory}</summary>
      <ul className="mt-2 max-h-40 overflow-y-auto">{points.slice().reverse().map(point =>
        <li key={point.date}>{point.date} · {format(point.values[0]!)}–{format(point.values[1]!)}</li>)}</ul>
    </details>}
    <a className="block text-xs font-semibold text-vi" target="_blank" rel="noreferrer" href={monetarySources[series]}>{t.source} ↗</a>
    <p className="text-xs text-mu">{t.education[series]}</p>
  </article>;
}

export function MarketMonetary({ lang }: { lang: Language }) {
  const t = monetaryText[lang];
  return <section className="space-y-3" aria-labelledby="market-monetary-title">
    <h3 id="market-monetary-title" className="font-serif text-lg font-semibold text-tx">{t.heading}</h3>
    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{seriesList.map(series => <MonetaryCard key={series} series={series} lang={lang} />)}</div>
    <details className="rounded-lg border border-line bg-s1 p-3 text-sm text-mu">
      <summary className="cursor-pointer font-medium text-tx">{economyText[lang].markets}</summary>
      <div className="mt-2 space-y-2">{t.scenarios.map(text => <p key={text}>{text}</p>)}<p className="text-xs">{economyText[lang].disclaimer}</p></div>
    </details>
  </section>;
}
