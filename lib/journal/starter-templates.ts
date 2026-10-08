import { Strategy, StrategyRule } from "./types";

export interface StarterTemplate {
  id: string;
  nameRu: string;
  nameEn: string;
  color: string;
  descriptionRu: string;
  descriptionEn: string;
  tags: string[];
  riskLimit?: { type: "r" | "percent"; value: number };
  allowedSessions?: ("asia" | "london" | "newyork" | "overlap" | "other")[];
  rulesRu: Omit<StrategyRule, "id">[];
  rulesEn: Omit<StrategyRule, "id">[];
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "tpl_structure",
    nameRu: "Структура рынка",
    nameEn: "Market Structure",
    color: "#50348f",
    descriptionRu: "Базовая стратегия анализа рыночной структуры, ликвидности и дисбаланса.",
    descriptionEn: "Basic strategy analyzing market structure, liquidity, and imbalance.",
    tags: ["SMC", "Sweep", "MSS", "FVG"],
    riskLimit: { type: "r", value: 1.0 },
    allowedSessions: ["london", "newyork"],
    rulesRu: [
      { group: "entry", text: "Снятие ликвидности с ключевого максимума/минимума (Sweep)", weight: "required" },
      { group: "entry", text: "Слом структуры на младшем таймфрейме (MSS)", weight: "required" },
      { group: "entry", text: "Вход от зоны дисбаланса (FVG) или OTE", weight: "optional" },
      { group: "risk", text: "Стоп-лосс за ключевой структурный свинг", weight: "required" },
    ],
    rulesEn: [
      { group: "entry", text: "HTF High/Low liquidity sweep", weight: "required" },
      { group: "entry", text: "LTF Market Structure Shift (MSS)", weight: "required" },
      { group: "entry", text: "Entry from FVG or OTE zone", weight: "optional" },
      { group: "risk", text: "Stop Loss beyond key structural swing", weight: "required" },
    ],
  },
  {
    id: "tpl_breakout",
    nameRu: "Пробой уровня",
    nameEn: "Level Breakout",
    color: "#3b82f6",
    descriptionRu: "Классическая модель торговли импульсного пробоя уровней поддержки/сопротивления.",
    descriptionEn: "Classic model for impulse breakout of support/resistance levels.",
    tags: ["Breakout", "Level", "Volume"],
    riskLimit: { type: "r", value: 1.0 },
    allowedSessions: ["london", "newyork"],
    rulesRu: [
      { group: "entry", text: "Подтверждённый уровень поддержки или сопротивления (3+ касания)", weight: "required" },
      { group: "entry", text: "Импульсная свеча пробоя с повышенным объёмом", weight: "required" },
      { group: "entry", text: "Ретест пробитого уровня", weight: "optional" },
      { group: "risk", text: "Стоп-лосс за пробойную свечу или защитный уровень", weight: "required" },
    ],
    rulesEn: [
      { group: "entry", text: "Confirmed support/resistance level (3+ touches)", weight: "required" },
      { group: "entry", text: "Impulsive breakout candle with volume", weight: "required" },
      { group: "entry", text: "Retest of broken level", weight: "optional" },
      { group: "risk", text: "Stop Loss behind breakout candle or level", weight: "required" },
    ],
  },
  {
    id: "tpl_pullback",
    nameRu: "Откат к зоне",
    nameEn: "Pullback to Zone",
    color: "#10b981",
    descriptionRu: "Трендовая стратегия входа на коррекции к зонам интереса.",
    descriptionEn: "Trend-following strategy entering on pullbacks to interest zones.",
    tags: ["Trend", "Pullback", "POI"],
    riskLimit: { type: "r", value: 1.0 },
    allowedSessions: ["asia", "london", "newyork"],
    rulesRu: [
      { group: "entry", text: "Чётко выраженный тренд на старшем таймфрейме", weight: "required" },
      { group: "entry", text: "Откат цены к зоне спроса/предложения (POI)", weight: "required" },
      { group: "entry", text: "Паттерн разворота в зоне интереса", weight: "optional" },
      { group: "risk", text: "Стоп-лосс за границу зоны интереса", weight: "required" },
    ],
    rulesEn: [
      { group: "entry", text: "Clear HTF trend established", weight: "required" },
      { group: "entry", text: "Price pullback to demand/supply zone (POI)", weight: "required" },
      { group: "entry", text: "LTF reversal confirmation pattern in POI", weight: "optional" },
      { group: "risk", text: "Stop Loss behind boundary of interest zone", weight: "required" },
    ],
  },
];

export function createStrategyFromTemplate(
  template: StarterTemplate,
  lang: "ru" | "en" = "ru"
): Strategy {
  const isRu = lang === "ru";
  const name = isRu ? template.nameRu : template.nameEn;
  const description = isRu ? template.descriptionRu : template.descriptionEn;
  const rulesList = isRu ? template.rulesRu : template.rulesEn;

  const rules: StrategyRule[] = rulesList.map((r, index) => ({
    id: `rule_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 5)}`,
    group: r.group,
    text: r.text,
    weight: r.weight,
  }));

  return {
    id: `strat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    description,
    color: template.color,
    rules,
    tags: [...template.tags],
    riskLimit: template.riskLimit ? { ...template.riskLimit } : null,
    allowedSessions: template.allowedSessions ? [...template.allowedSessions] : null,
    version: 1,
    archivedAt: null,
    createdAt: new Date().toISOString(),
  };
}
