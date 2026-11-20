import { economyText, inflationText } from "@/lib/market/economy/dictionary";
import { inflationCodes, type projectInflation } from "@/lib/market/economy/project-inflation";
import { MarketBeaPce } from "./MarketBeaPce";
import { EconomyDetails } from "./EconomyDetails";

export function MarketInflation({ lang, data, loading }: {
  lang: "ru" | "en"; data?: ReturnType<typeof projectInflation>; loading: boolean;
}) {
  const t = economyText[lang];
  const copy = inflationText[lang];
  const number = new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const format = (value: number) => number.format(value) + "%";
  const date = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone: "America/New_York" });
  return <section aria-labelledby="economy-inflation" className="space-y-3">
    <h3 id="economy-inflation" className="font-serif text-lg font-semibold text-tx">{t.categories[2]}</h3>
    <div className="grid items-start gap-3 md:grid-cols-2">
      {inflationCodes.map((code, i) => {
        const rows = data?.[code] ?? [];
        const latest = rows[0];
        return <article key={code} data-testid={"economy-" + code} className="min-w-0 space-y-2 rounded-lg border border-line bg-s2 p-3 sm:p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-1"><h4 className="font-semibold text-tx">{copy.metrics[i]}</h4>{latest && <span className="text-xs text-vi">{t.confirmed}</span>}</div>
          <p className="text-xs text-mu">% · {i % 2 === 0 ? "SA" : "NSA"}</p>
          {latest ? <>
            <dl className="grid grid-cols-2 gap-1">
              <div><dt className="text-xs text-mu">{t.actual}</dt><dd className="text-xl font-semibold tabular-nums text-tx">{format(latest.actual)}</dd></div>
              <div><dt className="text-xs text-mu">{t.previous}</dt><dd className="text-xl font-semibold tabular-nums text-tx">{latest.previous === null ? "—" : format(latest.previous)}</dd></div>
            </dl>
            {latest.previous !== null && <p className="text-xs text-vi">{latest.actual > latest.previous ? copy.higher : latest.actual < latest.previous ? copy.lower : copy.same}</p>}
            <p className="text-xs text-mu">{t.period} · {latest.period}</p>
            <EconomyDetails label={t.details}>
              <p>{copy.context}</p>
              <p>{i % 2 === 0 ? copy.monthly : copy.annual}</p>
              <p>{t.retrieved} · {t.timeUnknown}</p>
            <a className="block text-xs font-semibold text-vi" href={latest.sourceUrl} target="_blank" rel="noreferrer">
              {t.source} · <time dateTime={latest.releasedAt}>{date.format(Date.parse(latest.releasedAt))}</time> ↗
            </a>
            </EconomyDetails>
            <details className="text-xs text-mu">
              <summary className="cursor-pointer">{t.history}</summary>
              <ul className="mt-2 space-y-1">{rows.map(row => <li key={row.period}>
                <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-vi">{row.period} · {format(row.actual)}</a>
              </li>)}</ul>
            </details>
          </> : <p className="text-sm text-mu">{loading ? t.loading : t.empty}</p>}
        </article>;
      })}
    </div>
    <MarketBeaPce lang={lang} />
  </section>;
}
