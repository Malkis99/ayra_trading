"use client";

import { useState } from "react";
import { ArrowUpRight, Landmark } from "lucide-react";
import { useApp } from "@/lib/context";
import { economyText } from "@/lib/market/economy/dictionary";
import { economyCodes, economyHistory, periodIndex, ranges, type HistoryRange, type Observation } from "@/lib/market/economy/project-calendar";
import { useEconomyObservations } from "@/lib/market/economy/use-economy-observations";

type Labels = typeof economyText.en;

function History({ rows, range, t, format }: {
  rows: Observation[]; range: HistoryRange; t: Labels; format: (value: number) => string;
}) {
  const points = economyHistory(rows, rows[0]?.stage ?? "", range, Date.now());
  if (points.length < 2) return <p className="rounded-md bg-s1 p-3 text-xs text-mu">{t.historyEmpty}</p>;
  const first = periodIndex(points[0]);
  const last = periodIndex(points[points.length - 1]);
  const min = Math.min(...points.map(point => point.actual));
  const max = Math.max(...points.map(point => point.actual));
  const position = (row: Observation) => ({
    x: 14 + (periodIndex(row) - first) / Math.max(1, last - first) * 292,
    y: max === min ? 42 : 72 - (row.actual - min) / (max - min) * 60,
  });
  return (
    <div className="space-y-2 rounded-md bg-s1 p-3">
      <svg viewBox="0 0 320 84" className="h-24 w-full text-vi" aria-hidden="true">
        <path d="M14 12H306 M14 42H306 M14 72H306" stroke="currentColor" opacity=".18" />
        {points.map((point, i) => {
          const a = position(point);
          const prior = points[i - 1];
          const b = prior && periodIndex(point) - periodIndex(prior) === 1 ? position(prior) : null;
          return <g key={point.id}>
            {b && <line x1={b.x} y1={b.y} x2={a.x} y2={a.y} stroke="currentColor" strokeWidth="2" />}
            <circle cx={a.x} cy={a.y} r="3" fill="currentColor"><title>{point.period} · {format(point.actual)}</title></circle>
          </g>;
        })}
      </svg>
      <div className="flex justify-between text-xs text-mu"><span>{points[0].period}</span><span>{points[points.length - 1].period}</span></div>
      <p className="text-xs text-mu">{t.historyNote}</p>
      <details className="text-xs text-mu">
        <summary className="cursor-pointer">{t.data}</summary>
        <ul className="mt-2 space-y-1">{points.map(point => <li key={point.id}>{point.period} · {format(point.actual)}</li>)}</ul>
      </details>
    </div>
  );
}

export function MarketEconomy() {
  const { lang } = useApp();
  const t = economyText[lang];
  const { data, status, retry } = useEconomyObservations();
  const [range, setRange] = useState<HistoryRange>("1");
  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: 2 });
  const change = new Intl.NumberFormat(lang, { maximumFractionDigits: 2, signDisplay: "exceptZero" });
  const date = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" });
  return (
    <section className="space-y-5" data-testid="market-economy">
      <header className="flex items-start gap-3 rounded-lg border border-line bg-s1 p-4 sm:p-5">
        <span className="rounded-md bg-vi/10 p-2 text-vi"><Landmark size={20} aria-hidden="true" /></span>
        <div>
          <h2 className="font-serif text-xl font-bold text-tx">{t.title}</h2>
          <p className="mt-1 text-sm text-mu">{t.intro}</p>
        </div>
      </header>
      {status === "loading" && <p role="status" className="text-sm text-mu">{t.loading}</p>}
      {(status === "error" || status === "unavailable") && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-s1 p-3 text-sm text-mu">
        {status === "error" ? t.error : t.unavailable}
        {status === "error" && <button type="button" onClick={retry} className="rounded-md border border-line px-3 py-1 text-vi">{t.retry}</button>}
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-serif text-lg font-semibold text-tx">{t.data}</h3>
        <div role="group" aria-label={t.history} className="flex max-w-full flex-wrap gap-1 rounded-md border border-line bg-s1 p-1">
          {ranges.map((value, index) => <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}
            className={`rounded px-2 py-1.5 text-xs ${range === value ? "bg-vi/15 font-semibold text-vi" : "text-mu hover:text-tx"}`}>
            {t.ranges[index]}
          </button>)}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {economyCodes.map(code => {
          const labels = t.indicators[code];
          const rows = data?.[code] ?? [];
          const latest = rows[0];
          const format = (value: number) => (code === "us_jobless_claims" ? number : change).format(value) + (code === "us_gdp" ? "%" : "");
          const stage = latest ? t.stages[latest.stage as keyof Labels["stages"]] : "";
          return (
            <article key={code} className="min-w-0 space-y-4 rounded-lg border border-line bg-s2 p-4" data-testid={`economy-${code}`}>
              <div>
                <p className="text-xs font-medium text-vi">{t.country} · {labels.frequency}{stage && ` · ${stage}`}</p>
                <h4 className="mt-1 text-base font-semibold text-tx">{labels.name}</h4>
                <p className="mt-1 text-xs text-mu">{labels.definition}</p>
              </div>
              {latest ? <>
                <dl className="grid grid-cols-2 gap-3">
                  <div><dt className="text-xs text-mu">{t.actual}</dt><dd className="text-2xl font-semibold tabular-nums text-tx">{format(latest.actual)}</dd></div>
                  {latest.previous !== null && <div><dt className="text-xs text-mu">{t.previous}</dt><dd className="text-2xl font-semibold tabular-nums text-tx">{format(latest.previous)}</dd></div>}
                </dl>
                <p className="text-xs text-mu">{labels.unit}</p>
                <div className="space-y-1 text-xs text-mu">
                  <div>{t.period} · <span className="text-tx">{latest.period}</span></div>
                  {([[t.scheduled, latest.scheduledAt], [t.release, latest.releasedAt], [t.updated, latest.sourceUpdatedAt], [t.retrieved, latest.retrievedAt]] as const).map(([label, timestamp]) =>
                    <div key={label}>{label} · {timestamp ? <time dateTime={timestamp} className="text-tx">{date.format(Date.parse(timestamp))}</time> : t.timeUnknown}</div>)}
                </div>
                <a href={latest.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-vi">{latest.sourceKind === "release" ? t.source : t.archive}<ArrowUpRight size={13} aria-hidden="true" /></a>
              </> : <p className="text-sm text-mu">{status === "loading" ? t.loading : t.empty}</p>}
              <History rows={rows} range={range} t={t} format={format} />
              <details className="border-t border-line pt-3 text-sm text-mu">
                <summary className="cursor-pointer font-medium text-tx">{t.education}</summary>
                <dl className="mt-3 space-y-2">
                  {([[t.what, labels.definition], [t.why, labels.why], [t.up, labels.up], [t.down, labels.down], [t.markets, labels.markets]]).map(([title, value]) =>
                    <div key={title}><dt className="font-medium text-tx">{title}</dt><dd>{value}</dd></div>)}
                </dl>
                <p className="mt-3 text-xs">{t.disclaimer}</p>
              </details>
            </article>
          );
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {t.categories.map((category, i) => (
          <div key={category} className="rounded-md border border-line bg-s1 p-3">
            <h4 className="text-sm font-semibold text-tx">{category}</h4>
            <p className="mt-1 text-xs text-mu">{t.coverage[i]}</p>
            {i > 1 && <p className="mt-2 text-xs text-mu">{t.empty}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
