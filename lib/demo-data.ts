export interface MarketInstrument {
  symbol: string;
  nameKey: string;
  points: number[];
  isUp: boolean;
}

export const DEMO_MARKETS: MarketInstrument[] = [
  { symbol: "DXY", nameKey: "market.dxy", points: [104.2, 104.5, 104.3, 104.8, 104.6, 105.1, 105.0, 105.3], isUp: true },
  { symbol: "S&P 500", nameKey: "market.sp500", points: [5100, 5120, 5150, 5140, 5180, 5200, 5190, 5230], isUp: true },
  { symbol: "Nasdaq", nameKey: "market.nasdaq", points: [18000, 18150, 18100, 18300, 18250, 18500, 18450, 18600], isUp: true },
  { symbol: "Gold", nameKey: "market.gold", points: [2380, 2370, 2375, 2360, 2365, 2350, 2355, 2340], isUp: false },
  { symbol: "Oil", nameKey: "market.oil", points: [82, 84, 81, 83, 79, 80, 78, 77], isUp: false },
  { symbol: "BTC", nameKey: "market.btc", points: [64000, 65500, 64800, 67000, 66200, 69000, 68100, 70500], isUp: true },
];

export interface CalendarEvent {
  titleKey: string;
  fallbackTitleRu: string;
  fallbackTitleEn: string;
  dayType: "today" | "tomorrow" | "friday";
  color: string;
}

export const DEMO_EVENTS: CalendarEvent[] = [
  {
    titleKey: "calendar.cpiUsd",
    fallbackTitleRu: "CPI (США)",
    fallbackTitleEn: "CPI (US)",
    dayType: "today",
    color: "#e58a8a",
  },
  {
    titleKey: "calendar.fomcMinutes",
    fallbackTitleRu: "Протокол FOMC",
    fallbackTitleEn: "FOMC Minutes",
    dayType: "tomorrow",
    color: "#e58a8a",
  },
  {
    titleKey: "calendar.pmiEuro",
    fallbackTitleRu: "PMI (еврозона)",
    fallbackTitleEn: "PMI (Eurozone)",
    dayType: "friday",
    color: "#d6a94a",
  },
];
