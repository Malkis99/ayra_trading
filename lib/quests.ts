export type QuestCategory =
  | "Trading"
  | "Discipline"
  | "Psychology"
  | "Physical"
  | "Mental"
  | "Social"
  | "Lifestyle";

export interface QuestTemplate {
  id: string;
  category: QuestCategory;
  durationMinutes: number;
  difficulty: "Easy" | "Medium" | "Hard";
  xpReward: number;
  coinsReward: number;
  statKey: string;
  verificationType: "SelfReport" | "JournalCheck" | "Timer";
  titleKey: string;
  fallbackTitleRu: string;
  fallbackTitleEn: string;
  whyReasonKey: string;
  fallbackWhyRu: string;
  fallbackWhyEn: string;
}

export const QUEST_CATEGORY_META: Record<
  QuestCategory,
  { color: string; bg: string; iconName: string }
> = {
  Trading: { color: "#6ec1ff", bg: "#6ec1ff20", iconName: "BarChart2" },
  Discipline: { color: "#a38ad1", bg: "#a38ad120", iconName: "CheckSquare" },
  Psychology: { color: "#d6a94a", bg: "#d6a94a20", iconName: "Brain" },
  Physical: { color: "#6fd3a0", bg: "#6fd3a020", iconName: "Activity" },
  Mental: { color: "#e58a8a", bg: "#e58a8a20", iconName: "Smile" },
  Social: { color: "#f0a8d0", bg: "#f0a8d020", iconName: "Users" },
  Lifestyle: { color: "#c19bf5", bg: "#c19bf520", iconName: "Sun" },
};

export const QUEST_POOL: QuestTemplate[] = [
  {
    id: "q_bias",
    category: "Trading",
    durationMinutes: 10,
    difficulty: "Easy",
    xpReward: 40,
    coinsReward: 10,
    statKey: "Trading",
    verificationType: "SelfReport",
    titleKey: "quest.bias.title",
    fallbackTitleRu: "Daily Bias перед сессией",
    fallbackTitleEn: "Daily Bias before session",
    whyReasonKey: "quest.bias.why",
    fallbackWhyRu: "Подготовка контекста старших таймфреймов перед началом торгов.",
    fallbackWhyEn: "Higher timeframe context preparation before trading session.",
  },
  {
    id: "q_tradelog",
    category: "Discipline",
    durationMinutes: 15,
    difficulty: "Medium",
    xpReward: 40,
    coinsReward: 10,
    statKey: "Discipline",
    verificationType: "JournalCheck",
    titleKey: "quest.tradelog.title",
    fallbackTitleRu: "Запись сделки в журнал",
    fallbackTitleEn: "Log trade in journal",
    whyReasonKey: "quest.tradelog.why",
    fallbackWhyRu: "Фиксация причин входа и исполнения системного плана.",
    fallbackWhyEn: "Recording entry reasons and execution of systemic plan.",
  },
  {
    id: "q_reflect",
    category: "Psychology",
    durationMinutes: 10,
    difficulty: "Easy",
    xpReward: 40,
    coinsReward: 10,
    statKey: "Psychology",
    verificationType: "Timer",
    titleKey: "quest.reflect.title",
    fallbackTitleRu: "10 минут рефлексии",
    fallbackTitleEn: "10 minutes reflection",
    whyReasonKey: "quest.reflect.why",
    fallbackWhyRu: "Анализ эмоционального состояния и контроля рисков за день.",
    fallbackWhyEn: "Analysis of emotional state and risk control for the day.",
  },
  {
    id: "q_walk",
    category: "Physical",
    durationMinutes: 20,
    difficulty: "Easy",
    xpReward: 30,
    coinsReward: 5,
    statKey: "Endurance",
    verificationType: "SelfReport",
    titleKey: "quest.walk.title",
    fallbackTitleRu: "Прогулка 20 минут",
    fallbackTitleEn: "20 minute walk",
    whyReasonKey: "quest.walk.why",
    fallbackWhyRu: "Сброс напряжения и восстановление внимания трейдера.",
    fallbackWhyEn: "Releasing tension and restoring trader's focus.",
  },
  {
    id: "q_meditate",
    category: "Mental",
    durationMinutes: 10,
    difficulty: "Easy",
    xpReward: 30,
    coinsReward: 5,
    statKey: "Focus",
    verificationType: "Timer",
    titleKey: "quest.meditate.title",
    fallbackTitleRu: "Медитация или дыхательная практика",
    fallbackTitleEn: "Meditation or breathing exercise",
    whyReasonKey: "quest.meditate.why",
    fallbackWhyRu: "Снижение импульсивности и стабилизация фокуса.",
    fallbackWhyEn: "Reducing impulsivity and stabilizing focus.",
  },
  {
    id: "q_riskcheck",
    category: "Trading",
    durationMinutes: 5,
    difficulty: "Easy",
    xpReward: 30,
    coinsReward: 5,
    statKey: "Trading",
    verificationType: "SelfReport",
    titleKey: "quest.riskcheck.title",
    fallbackTitleRu: "Проверка дневного лимита риска",
    fallbackTitleEn: "Daily risk limit check",
    whyReasonKey: "quest.riskcheck.why",
    fallbackWhyRu: "Предотвращение тильта и сохранение капитала.",
    fallbackWhyEn: "Preventing tilt and protecting capital.",
  },
  {
    id: "q_screenplan",
    category: "Trading",
    durationMinutes: 15,
    difficulty: "Medium",
    xpReward: 40,
    coinsReward: 10,
    statKey: "Trading",
    verificationType: "SelfReport",
    titleKey: "quest.screenplan.title",
    fallbackTitleRu: "Составление сессионного плана",
    fallbackTitleEn: "Drafting session plan",
    whyReasonKey: "quest.screenplan.why",
    fallbackWhyRu: "Определение ключевых уровней и сценариев до открытия рынка.",
    fallbackWhyEn: "Defining key levels and scenarios before market open.",
  },
  {
    id: "q_nosocial",
    category: "Lifestyle",
    durationMinutes: 60,
    difficulty: "Medium",
    xpReward: 35,
    coinsReward: 8,
    statKey: "Focus",
    verificationType: "Timer",
    titleKey: "quest.nosocial.title",
    fallbackTitleRu: "1 час торгов без соцсетей",
    fallbackTitleEn: "1 hour trading without social media",
    whyReasonKey: "quest.nosocial.why",
    fallbackWhyRu: "Устранение шума и посторонних мнений во время сессии.",
    fallbackWhyEn: "Eliminating noise and external opinions during session.",
  },
  {
    id: "q_community_post",
    category: "Social",
    durationMinutes: 10,
    difficulty: "Easy",
    xpReward: 35,
    coinsReward: 8,
    statKey: "Knowledge",
    verificationType: "SelfReport",
    titleKey: "quest.community.title",
    fallbackTitleRu: "Поделиться разбором или опытом",
    fallbackTitleEn: "Share breakdown or insight",
    whyReasonKey: "quest.community.why",
    fallbackWhyRu: "Формулирование опыта укрепляет понимание торговой системы.",
    fallbackWhyEn: "Formulating insights reinforces trading system mastery.",
  },
  {
    id: "q_review_mistake",
    category: "Psychology",
    durationMinutes: 15,
    difficulty: "Hard",
    xpReward: 50,
    coinsReward: 15,
    statKey: "Psychology",
    verificationType: "JournalCheck",
    titleKey: "quest.review_mistake.title",
    fallbackTitleRu: "Разбор одной ошибки прошлого",
    fallbackTitleEn: "Reviewing one past mistake",
    whyReasonKey: "quest.review_mistake.why",
    fallbackWhyRu: "Трансформация прошлых убытков в конструктивные правила.",
    fallbackWhyEn: "Transforming past losses into constructive rules.",
  },
  {
    id: "q_sleep_prep",
    category: "Lifestyle",
    durationMinutes: 15,
    difficulty: "Easy",
    xpReward: 25,
    coinsReward: 5,
    statKey: "Endurance",
    verificationType: "SelfReport",
    titleKey: "quest.sleep.title",
    fallbackTitleRu: "Подготовка к сну без экранов за 30 мин",
    fallbackTitleEn: "Screen-free sleep prep 30 min before bed",
    whyReasonKey: "quest.sleep.why",
    fallbackWhyRu: "Качественный сон повышает дисциплину следующего дня.",
    fallbackWhyEn: "Quality sleep enhances next-day discipline.",
  },
  {
    id: "q_backtest",
    category: "Discipline",
    durationMinutes: 30,
    difficulty: "Hard",
    xpReward: 50,
    coinsReward: 15,
    statKey: "Knowledge",
    verificationType: "Timer",
    titleKey: "quest.backtest.title",
    fallbackTitleRu: "30 минут бэктеста сетапа",
    fallbackTitleEn: "30 minute setup backtest",
    whyReasonKey: "quest.backtest.why",
    fallbackWhyRu: "Наработка статистического преимущества своей стратегии.",
    fallbackWhyEn: "Building statistical edge for your strategy.",
  },
];

export function getDeterministicDailyQuests(dateStr: string): {
  core: QuestTemplate[];
  bonus: QuestTemplate[];
} {
  // Simple deterministic hash based on date string
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = (hash << 5) - hash + dateStr.charCodeAt(i);
    hash |= 0;
  }
  const seed = Math.abs(hash);

  const pool = [...QUEST_POOL];
  // Fisher-Yates deterministic shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (seed + i * 17) % (i + 1);
    const temp = pool[i];
    pool[i] = pool[j];
    pool[j] = temp;
  }

  return {
    core: pool.slice(0, 3),
    bonus: pool.slice(3, 5),
  };
}
