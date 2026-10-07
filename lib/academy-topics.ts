export interface AcademyTopicDefinition {
  id: string;
  titleKey: string;
  fallbackTitleRu: string;
  fallbackTitleEn: string;
  descKey: string;
  fallbackDescRu: string;
  fallbackDescEn: string;
  minorSafe: boolean;
}

export const ACADEMY_TOPICS: Record<string, AcademyTopicDefinition> = {
  topic_journal: {
    id: "topic_journal",
    titleKey: "academy.topics.journal.title",
    fallbackTitleRu: "Журнал сделок и рефлексия",
    fallbackTitleEn: "Trade Journal & Reflection",
    descKey: "academy.topics.journal.desc",
    fallbackDescRu: "Как правильно вести дневник и находить паттерны ошибок",
    fallbackDescEn: "How to properly keep a log and identify error patterns",
    minorSafe: true,
  },
  topic_market_structure: {
    id: "topic_market_structure",
    titleKey: "academy.topics.market_structure.title",
    fallbackTitleRu: "Структура рынка",
    fallbackTitleEn: "Market Structure",
    descKey: "academy.topics.market_structure.desc",
    fallbackDescRu: "Понимание трендов, боковиков и смещения приоритета",
    fallbackDescEn: "Understanding trends, ranges, and directional bias",
    minorSafe: true,
  },
  topic_price_action: {
    id: "topic_price_action",
    titleKey: "academy.topics.price_action.title",
    fallbackTitleRu: "Price Action и сетапы",
    fallbackTitleEn: "Price Action & Setups",
    descKey: "academy.topics.price_action.desc",
    fallbackDescRu: "Анализ движения цены без избыточных индикаторов",
    fallbackDescEn: "Analyzing price movement without indicator noise",
    minorSafe: true,
  },
  topic_risk_mgmt: {
    id: "topic_risk_mgmt",
    titleKey: "academy.topics.risk_mgmt.title",
    fallbackTitleRu: "Управление рисками",
    fallbackTitleEn: "Risk Management",
    descKey: "academy.topics.risk_mgmt.desc",
    fallbackDescRu: "Контроль размера позиции и лимиты потерь",
    fallbackDescEn: "Position sizing and loss limits control",
    minorSafe: true,
  },
  topic_basics: {
    id: "topic_basics",
    titleKey: "academy.topics.basics.title",
    fallbackTitleRu: "Основы системного трейдинга",
    fallbackTitleEn: "Systematic Trading Basics",
    descKey: "academy.topics.basics.desc",
    fallbackDescRu: "Фундаментальные принципы работы финансовых рынков",
    fallbackDescEn: "Fundamental principles of financial markets",
    minorSafe: true,
  },
  topic_psychology: {
    id: "topic_psychology",
    titleKey: "academy.topics.psychology.title",
    fallbackTitleRu: "Психология и эмоциональный контроль",
    fallbackTitleEn: "Psychology & Emotional Control",
    descKey: "academy.topics.psychology.desc",
    fallbackDescRu: "Преодоление FOMO, тильта и страха потерь",
    fallbackDescEn: "Overcoming FOMO, tilt, and fear of execution",
    minorSafe: true,
  },
  topic_discipline: {
    id: "topic_discipline",
    titleKey: "academy.topics.discipline.title",
    fallbackTitleRu: "Дисциплина и торговый план",
    fallbackTitleEn: "Discipline & Trading Plan",
    descKey: "academy.topics.discipline.desc",
    fallbackDescRu: "Построение устойчивой рутины и исполнение правил",
    fallbackDescEn: "Building a sustainable routine and executing rules",
    minorSafe: true,
  },
};
