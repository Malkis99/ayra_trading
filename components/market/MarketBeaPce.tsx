"use client";

import { useEffect, useState } from "react";
import { beaPceText, economyText } from "@/lib/market/economy/dictionary";
import type { PceSnapshot } from "@/lib/market/economy/bea-pce";
import { EconomyDetails } from "./EconomyDetails";

export function MarketBeaPce({ lang }: { lang: "ru" | "en" }) {
  const t = economyText[lang];
  const labels = beaPceText[lang];
  const [latest, setLatest] = useState<PceSnapshot>();
  const [history, setHistory] = useState<PceSnapshot>();
  const [attempt, setAttempt] = useState(0);
  const [historyAttempt, setHistoryAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void load("latest", controller.signal).then(data => {
      if (!controller.signal.aborted) setLatest(prior => data.status === "error" && prior?.points.length ? { ...prior, status: "stale" } : data);
    });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (!historyAttempt) return;
    const controller = new AbortController();
    void load("history", controller.signal).then(data => { if (!controller.signal.aborted) setHistory(data); });
    return () => controller.abort();
  }, [historyAttempt]);

  const snapshot = latest?.points[0];
  const formatter = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
  const format = (value: number) => formatter.format(value) + "%";
  const date = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone: "America/New_York" });
  return <section data-testid="economy-bea-pce" className="space-y-2 rounded-lg border border-line bg-s2 p-3 sm:p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-1"><h4 className="font-semibold text-tx">{labels.title}</h4>{latest?.status === "ready" && <span className="text-xs text-vi">{t.confirmed}</span>}</div>
    {(!latest || latest.status !== "ready") && <p role="status" className="text-xs text-mu">
      {!latest ? t.loading : latest.status === "stale" ? labels.stale : latest.status === "partial" ? labels.partial : latest.status === "error" ? t.error : t.empty}
    </p>}
    {latest?.status === "error" && <button type="button" onClick={() => setAttempt(value => value + 1)} className="rounded border border-line px-2 py-1 text-xs text-vi">{t.retry}</button>}
    {snapshot && <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {labels.metrics.map((label, index) => <div key={label}>
          <dt className="text-xs text-mu">{label}</dt>
          <dd className="text-lg font-semibold tabular-nums text-tx">{format(snapshot.values[index])}</dd>
        </div>)}
      </dl>
      <p className="text-xs text-mu">{t.period} · {snapshot.period}</p>
      <EconomyDetails label={t.details}>
      <p>{labels.intro}</p>
      <a href={snapshot.url} className="block text-xs font-semibold text-vi" target="_blank" rel="noreferrer">
        {labels.vintage} · <time dateTime={snapshot.publishedAt}>{date.format(Date.parse(snapshot.publishedAt))}</time>
        {snapshot.vintageId && " · " + snapshot.vintageId} ↗
      </a>
      <p>{t.retrieved} · {t.timeUnknown}</p>
      </EconomyDetails>
      {(!history || history.status === "error") && <button type="button" disabled={!history && historyAttempt > 0}
        onClick={() => { setHistory(undefined); setHistoryAttempt(value => value + 1); }} className="rounded border border-line px-2 py-1 text-xs text-vi">
        {history ? t.retry : historyAttempt > 0 ? t.loading : labels.load}
      </button>}
      {history && history.status !== "ready" && <p role="status" className="text-xs text-mu">
        {history.status === "error" ? t.error : history.status === "stale" ? labels.stale : history.status === "partial" ? labels.partial : t.empty}
      </p>}
      {!!history?.points.length && <ul className="space-y-2 text-xs text-mu">{history.points.map(row =>
        <li key={row.url} className="border-t border-line pt-2">
          <a className="text-vi" href={row.url} target="_blank" rel="noreferrer">{row.period} · {date.format(Date.parse(row.publishedAt))} ↗</a>
          <dl className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">{labels.metrics.map((label, i) =>
            <div key={label}><dt>{label}</dt><dd className="tabular-nums text-tx">{format(row.values[i])}</dd></div>)}</dl>
        </li>)}</ul>}
    </>}
  </section>;
}

async function load(range: "latest" | "history", signal: AbortSignal): Promise<PceSnapshot> {
  try {
    const response = await fetch("/api/market-economy/bea/pce?range=" + range, { signal });
    if (response.ok) return await response.json() as PceSnapshot;
  } catch { /* The visible error state covers network and source errors. */ }
  return { status: "error", points: [] };
}
