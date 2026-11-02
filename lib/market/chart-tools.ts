/**
 * «Chart type» and «Indicators» for the TradingView chart (owner 2026-11-01, PR «Indicators and Chart type»).
 * Our own buttons: the widget's top toolbar stays hidden, because its «Indicators» menu has «Technical ratings»
 * (a «buy / sell» rating). Every value below was checked in the live widget (2026-11-02): the chart type through the
 * `style` setting, the indicators through `studies` (their name and values show in the chart's legend).
 */

/** TradingView `style` values, in the order of the menu. */
export const CHART_STYLES = ["1", "9", "0", "8", "2", "3", "10", "13", "12", "16"] as const;
export type ChartStyle = (typeof CHART_STYLES)[number];
export const DEFAULT_CHART_STYLE: ChartStyle = "1";
export const isChartStyle = (v: unknown): v is ChartStyle => typeof v === "string" && (CHART_STYLES as readonly string[]).includes(v);

/** Our list of indicators: overlays on the price first, then the ones in their own pane. No «Technical ratings». */
export const INDICATORS = [
  { id: "sma", study: "STD;SMA" },
  { id: "ema", study: "STD;EMA" },
  { id: "bb", study: "STD;Bollinger_Bands" },
  { id: "vwap", study: "STD;VWAP" },
  { id: "supertrend", study: "STD;Supertrend" },
  { id: "donchian", study: "STD;Donchian_Channels" },
  { id: "keltner", study: "STD;Keltner_Channels" },
  { id: "pivots", study: "STD;Pivot_Points_Standard" },
  { id: "zigzag", study: "STD;Zig_Zag" },
  { id: "rsi", study: "STD;RSI" },
  { id: "macd", study: "STD;MACD" },
  { id: "stoch", study: "STD;Stochastic" },
  { id: "stochrsi", study: "STD;Stochastic_RSI" },
  { id: "atr", study: "STD;Average_True_Range" },
  { id: "cci", study: "STD;CCI" },
  { id: "dmi", study: "STD;DMI" },
] as const;
export type IndicatorId = (typeof INDICATORS)[number]["id"];
export const isIndicatorId = (v: unknown): v is IndicatorId => typeof v === "string" && INDICATORS.some((i) => i.id === v);

/** At most this many at once, so the chart stays readable on a phone (a UI limit, not a business number). */
export const MAX_INDICATORS = 6;

export function normalizeIndicators(raw: unknown): IndicatorId[] {
  if (!Array.isArray(raw)) return [];
  const out: IndicatorId[] = [];
  for (const id of raw) if (isIndicatorId(id) && !out.includes(id) && out.length < MAX_INDICATORS) out.push(id);
  return out;
}

/** Adds or removes an indicator; nothing is added past the limit. */
export function toggleIndicator(list: readonly IndicatorId[], id: IndicatorId): IndicatorId[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  return list.length >= MAX_INDICATORS ? [...list] : [...list, id];
}

export const studiesOf = (ids: readonly IndicatorId[]) => ids.map((id) => INDICATORS.find((i) => i.id === id)!.study);

/** Keys 1–6 switch the first six timeframes of the bar (owner's idea 2026-11-01). */
export const HOTKEY_COUNT = 6;
