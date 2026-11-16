"use client";

import { useEffect, useState } from "react";
import { fiscalRange, fiscalSources, formatUsd, type FiscalData, type FiscalPoint, type FiscalSeries, type FiscalSnapshot } from "@/lib/market/economy/fiscal-data";
import { fiscalText } from "@/lib/market/economy/fiscal-dictionary";
import { ranges, type HistoryRange } from "@/lib/market/economy/project-calendar";
import { economyText } from "@/lib/market/economy/dictionary";

const groups = ["debt", "budget", "interest"] as const;

function FiscalChart({ points, series, column, lang }: { points: FiscalPoint[]; series: FiscalSeries; column: number; lang: "ru" | "en" }) {
  const words = economyText[lang];
  const t = fiscalText[lang];
  const monthly = series !== "debt" || points.length > 500;
  const sampled = monthly && series === "debt" ? [...new Map(points.map(point => [point.date.slice(0, 7), point])).values()] : points;
  const graph = sampled.flatMap((point, index) => {
    const value = point.values[column];
    return value == null ? [] : [{ ...point, value, index }];
  });
  if (graph.length < 2) return <p className="rounded-md bg-s1 p-3 text-xs text-mu">{words.historyEmpty}</p>;
  const times = graph.map(point => Date.parse(point.date));
  const values = graph.map(point => Number(point.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const first = times[0];
  const last = times[times.length - 1];
  const x = (i: number) => 5 + (times[i] - first) / (last - first) * 390;
  const y = (value: number) => max === min ? 48 : 86 - (value - min) / (max - min) * 78;
  const month = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));
  const path = graph.map((point, i) => {
    const connected = i > 0 && point.index === graph[i - 1].index + 1
      && (monthly ? month(point.date) - month(graph[i - 1].date) === 1 : times[i] - times[i - 1] <= 4 * 86_400_000);
    return `${connected ? "L" : "M"}${x(i).toFixed(2)},${y(values[i]).toFixed(2)}`;
  }).join(" ");
  return <div className="space-y-1 rounded-md bg-s1 p-3">
    <div className="flex justify-between gap-2 text-xs text-mu"><span>{formatUsd(graph[values.indexOf(min)].value, lang)}</span><span>{formatUsd(graph[values.indexOf(max)].value, lang)}</span></div>
    <svg aria-hidden="true" viewBox="0 0 400 94" preserveAspectRatio="none" className="h-24 w-full text-vi">
      <path d="M5 8H395 M5 47H395 M5 86H395" stroke="currentColor" opacity=".18" />
      <path d={path} stroke="currentColor" strokeWidth="1.7" fill="none" vectorEffect="non-scaling-stroke" />
      {graph.map((point, i) => <circle key={point.date} cx={x(i)} cy={y(values[i])} r="1.5" fill="currentColor">
        <title>{point.date} · {formatUsd(point.value, lang)}</title>
      </circle>)}
    </svg>
    <div className="flex justify-between gap-2 text-xs text-mu"><time>{graph[0].date}</time><time>{graph[graph.length - 1].date}</time></div>
    {monthly && series === "debt" && <p className="text-xs text-mu">{t.monthlySample}</p>}
    <details className="text-xs text-mu">
      <summary className="cursor-pointer">{words.data}</summary>
      <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
        {[...graph].reverse().map(point => <li key={point.date}>{point.date} · {formatUsd(point.value, lang)}</li>)}
      </ul>
    </details>
  </div>;
}

export function MarketPublicFinances({ lang }: { lang: "ru" | "en" }) {
  const t = fiscalText[lang];
  const words = economyText[lang];
  const [data, setData] = useState<Partial<FiscalData>>({});
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [range, setRange] = useState<HistoryRange>("1");
  const [columns, setColumns] = useState<Record<FiscalSeries, number>>({ debt: 0, budget: 2, interest: 0 });
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    for (const series of groups) void readFiscal(series, "latest", abort.signal).then(result => {
      if (!abort.signal.aborted) setData(current => ({
        ...current,
        [series]: result.status === "error" && current[series]?.points.length
          ? { ...current[series], status: "stale" } : result,
      }));
    });
    return () => abort.abort();
  }, [attempt, open]);
  const date = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" });
  const hasErrors = groups.some(group => data[group]?.status === "error" || data[group]?.status === "stale");
  return <details id="public-finances" open={open} onToggle={event => setOpen(event.currentTarget.open)}
    className="scroll-mt-4 rounded-lg border border-line bg-s2 p-4" data-testid="market-public-finances">
    <summary className="cursor-pointer font-serif text-lg font-semibold text-tx">{t.title}</summary>
    {open && <div className="mt-4 space-y-4">
      <p className="text-sm text-mu">{t.intro}</p>
      <div role="group" aria-label={words.history} className="flex flex-wrap gap-1">
        {ranges.map((value, index) => <button key={value} type="button" aria-pressed={range === value}
          onClick={() => setRange(value)}
          className={`rounded border border-line px-2 py-1.5 text-xs ${range === value ? "bg-vi/15 text-vi" : "text-mu"}`}>{words.ranges[index]}</button>)}
      </div>
      {hasErrors && <div role="status" className="flex flex-wrap items-center justify-between gap-2 text-sm text-mu">
        {groups.some(group => data[group]?.status === "error") ? words.error : t.stale}
        <button type="button" onClick={() => setAttempt(value => value + 1)}
          className="rounded-md border border-line px-3 py-1 text-vi">{words.retry}</button>
      </div>}
      <div className="grid gap-3 xl:grid-cols-3">
        {groups.map(group => {
          const row = data[group];
          const points = row?.points ?? [];
          const latest = points[points.length - 1];
          const labels = t.metrics[group];
          const column = columns[group];
          const oldTotal = points[0]?.values[0];
          const latestTotal = latest?.values[0];
          const delta = group === "debt" && points.length > 1 && oldTotal && latestTotal ? String(BigInt(latestTotal) - BigInt(oldTotal)) : null;
          return <section key={group} className="min-w-0 space-y-3 rounded-md border border-line bg-s1 p-3" data-testid={`fiscal-${group}`}>
            <h3 className="font-semibold text-tx">{t.groups[group]}</h3>
            {row?.status === "stale" && <p role="status" className="text-xs text-vi">{t.stale}</p>}
            {row?.partial && <p className="text-xs text-mu">{t.partial}</p>}
            {latest ? <>
              <dl className="grid grid-cols-2 gap-2">
                {latest.values.map((amount, index) => <div key={labels[index]}>
                  <dt className="text-xs text-mu">{labels[index]}</dt>
                  <dd className="text-base font-semibold tabular-nums text-tx">{amount === null ? words.empty : formatUsd(amount, lang)}</dd>
                </div>)}
                {delta !== null && <div><dt className="text-xs text-mu">{t.change}</dt>
                  <dd className="text-base font-semibold tabular-nums text-tx">{formatUsd(delta, lang)}</dd>
                  <dd className="text-xs text-mu">{points[0].date} — {latest.date}</dd></div>}
              </dl>
              {latest.ytd && <div className="rounded border border-line p-2 text-xs text-mu">
                <p className="font-medium text-tx">{t.fytd} {latest.fiscalYear}</p>
                <dl className="mt-1 grid grid-cols-2 gap-2">{latest.ytd.map((amount, i) => <div key={labels[i]}><dt>{labels[i]}</dt><dd>{formatUsd(amount, lang)}</dd></div>)}</dl>
              </div>}
              <p className="text-xs text-mu">{group === "debt" ? t.observed : t.monthEnding} · <time>{latest.date}</time></p>
              <p className="text-xs text-mu">{t.checked} · {row?.checkedAt ? <time dateTime={row.checkedAt}>{date.format(Date.parse(row.checkedAt))}</time> : words.timeUnknown}</p>
              <p className="text-xs text-mu">{words.updated} · {words.timeUnknown}</p>
              {labels.length > 1 && <div role="group" aria-label={words.history} className="flex flex-wrap gap-1">
                {labels.map((label, index) => <button key={label} type="button" aria-pressed={column === index}
                  onClick={() => setColumns(current => ({ ...current, [group]: index }))}
                  className={`rounded border border-line px-2 py-1 text-xs ${column === index ? "bg-vi/15 text-vi" : "text-mu"}`}>{label}</button>)}
              </div>}
              <p className="text-xs text-mu">{t.recent}</p>
              <FiscalChart points={points} series={group} column={column} lang={lang} />
            </> : <p className="text-sm text-mu">{row?.status === "error" ? words.unavailable : row ? words.empty : words.loading}</p>}
            <FiscalHistory key={range} series={group} range={range} column={column} lang={lang} />
            <a href={fiscalSources[group]} target="_blank" rel="noreferrer" className="inline-block text-xs font-semibold text-vi">Treasury FiscalData ↗</a>
            <p className="text-xs text-mu">{t.notes[group]}</p>
          </section>;
        })}
      </div>
      <details className="rounded border border-line p-3 text-sm text-mu">
        <summary className="cursor-pointer font-medium text-tx">{t.context}</summary>
        <div className="mt-2 space-y-2">{t.education.map(paragraph => <p key={paragraph}>{paragraph}</p>)}<p className="text-xs">{words.disclaimer}</p></div>
      </details>
    </div>}
  </details>;
}

async function readFiscal(series: FiscalSeries, range: HistoryRange | "latest", signal: AbortSignal): Promise<FiscalSnapshot> {
  try {
    const response = await fetch(`/api/market-economy/treasury?series=${series}&range=${range}`, { signal });
    if (response.ok) return await response.json() as FiscalSnapshot;
  } catch { /* Network errors have the same public state as unavailable data. */ }
  return { status: "error", points: [] };
}

function FiscalHistory({ series, range, column, lang }: {
  series: FiscalSeries; range: HistoryRange; column: number; lang: "ru" | "en";
}) {
  const words = economyText[lang];
  const t = fiscalText[lang];
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<FiscalSnapshot>();
  useEffect(() => {
    if (attempt === 0) return;
    const abort = new AbortController();
    void readFiscal(series, range, abort.signal).then(result => {
      if (!abort.signal.aborted) setHistory(result);
    });
    return () => abort.abort();
  }, [attempt, range, series]);
  const points = fiscalRange(history?.points ?? [], range);
  const first = points[0]?.values[0];
  const last = points.at(-1)?.values[0];
  return <div className="space-y-2 border-t border-line pt-2">
    {(!history || history.status === "error") && <button type="button" disabled={attempt > 0 && !history}
      onClick={() => { setHistory(undefined); setAttempt(value => value + 1); }}
      className="rounded border border-line px-2 py-1 text-xs text-vi">
      {history ? words.retry : attempt > 0 ? words.loading : t.loadHistory + " · " + words.ranges[ranges.indexOf(range)]}
    </button>}
    {history?.status === "error" && <p role="status" className="text-xs text-mu">{words.error}</p>}
    {history?.status === "stale" && <p role="status" className="text-xs text-vi">{t.stale}</p>}
    {history && history.status !== "error" && <>
      {series === "debt" && points.length > 1 && first && last && <p className="text-xs text-mu">
        {t.change} · {points[0].date} — {points.at(-1)?.date} · {formatUsd(String(BigInt(last) - BigInt(first)), lang)}
      </p>}
      <FiscalChart points={points} series={series} column={column} lang={lang} />
    </>}
  </div>;
}
