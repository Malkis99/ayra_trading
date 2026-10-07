import { AwakeningProgram } from "./awakening";

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
  {
    id: "q_logic_puzzle",
    category: "Mental",
    durationMinutes: 15,
    difficulty: "Medium",
    xpReward: 35,
    coinsReward: 8,
    statKey: "Intelligence",
    verificationType: "SelfReport",
    titleKey: "quest.logic_puzzle.title",
    fallbackTitleRu: "Логический анализ торговой модели",
    fallbackTitleEn: "Logical trading model analysis",
    whyReasonKey: "quest.logic_puzzle.why",
    fallbackWhyRu: "Тренировка критического мышления и структуры принятия решений.",
    fallbackWhyEn: "Training critical thinking and decision structure.",
  },
  {
    id: "q_lang_study",
    category: "Mental",
    durationMinutes: 15,
    difficulty: "Easy",
    xpReward: 35,
    coinsReward: 8,
    statKey: "Intelligence",
    verificationType: "Timer",
    titleKey: "quest.lang_study.title",
    fallbackTitleRu: "15 минут изучения иностранного языка",
    fallbackTitleEn: "15 minutes language learning",
    whyReasonKey: "quest.lang_study.why",
    fallbackWhyRu: "Нейропластичность и расширение когнитивного резерва.",
    fallbackWhyEn: "Neuroplasticity and expanding cognitive reserve.",
  },
  {
    id: "q_workout",
    category: "Physical",
    durationMinutes: 30,
    difficulty: "Medium",
    xpReward: 40,
    coinsReward: 10,
    statKey: "Strength",
    verificationType: "SelfReport",
    titleKey: "quest.workout.title",
    fallbackTitleRu: "Силовая тренировка или растяжка",
    fallbackTitleEn: "Strength workout or stretching",
    whyReasonKey: "quest.workout.why",
    fallbackWhyRu: "Физическая выносливость поддерживает высокий энергоресурс.",
    fallbackWhyEn: "Physical endurance supports high energy levels.",
  },
  {
    id: "q_stretching",
    category: "Physical",
    durationMinutes: 15,
    difficulty: "Easy",
    xpReward: 30,
    coinsReward: 5,
    statKey: "Strength",
    verificationType: "SelfReport",
    titleKey: "quest.stretching.title",
    fallbackTitleRu: "Растяжка и осанка за столом",
    fallbackTitleEn: "Stretching and posture check at desk",
    whyReasonKey: "quest.stretching.why",
    fallbackWhyRu: "Снятие зажимов в спине после долгого сидения перед мониторами.",
    fallbackWhyEn: "Relieving back tension after long hours sitting at monitors.",
  },
  {
    id: "q_read_pages",
    category: "Mental",
    durationMinutes: 10,
    difficulty: "Easy",
    xpReward: 30,
    coinsReward: 5,
    statKey: "Knowledge",
    verificationType: "Timer",
    titleKey: "quest.read_pages.title",
    fallbackTitleRu: "Прочитать 10 страниц",
    fallbackTitleEn: "Read 10 pages",
    whyReasonKey: "quest.read_pages.why",
    fallbackWhyRu: "Регулярное чтение развивает фокус и дисциплину мышления.",
    fallbackWhyEn: "Regular reading enhances focus and mental discipline.",
  },
  {
    id: "q_lang_10m",
    category: "Mental",
    durationMinutes: 10,
    difficulty: "Easy",
    xpReward: 30,
    coinsReward: 5,
    statKey: "Intelligence",
    verificationType: "Timer",
    titleKey: "quest.lang_10m.title",
    fallbackTitleRu: "10 минут иностранного языка",
    fallbackTitleEn: "10 minutes foreign language",
    whyReasonKey: "quest.lang_10m.why",
    fallbackWhyRu: "Ежедневная тренировка памяти и нейропластичности.",
    fallbackWhyEn: "Daily memory and neuroplasticity training.",
  },
  {
    id: "q_running",
    category: "Physical",
    durationMinutes: 20,
    difficulty: "Medium",
    xpReward: 35,
    coinsReward: 8,
    statKey: "Endurance",
    verificationType: "SelfReport",
    titleKey: "quest.running.title",
    fallbackTitleRu: "Пробежка или кардио",
    fallbackTitleEn: "Jogging or cardio",
    whyReasonKey: "quest.running.why",
    fallbackWhyRu: "Аэробная нагрузка улучшает кровообращение и выносливость.",
    fallbackWhyEn: "Aerobic exercise improves circulation and stamina.",
  },
  {
    id: "q_swimming",
    category: "Physical",
    durationMinutes: 30,
    difficulty: "Medium",
    xpReward: 40,
    coinsReward: 10,
    statKey: "Endurance",
    verificationType: "SelfReport",
    titleKey: "quest.swimming.title",
    fallbackTitleRu: "Сессия плавания",
    fallbackTitleEn: "Swimming session",
    whyReasonKey: "quest.swimming.why",
    fallbackWhyRu: "Комплексная нагрузка на мышечный корсет и дыхание.",
    fallbackWhyEn: "Comprehensive physical load and breathing technique.",
  },
  {
    id: "q_gym",
    category: "Physical",
    durationMinutes: 30,
    difficulty: "Hard",
    xpReward: 45,
    coinsReward: 10,
    statKey: "Strength",
    verificationType: "SelfReport",
    titleKey: "quest.gym.title",
    fallbackTitleRu: "Тренировка в зале",
    fallbackTitleEn: "Gym workout",
    whyReasonKey: "quest.gym.why",
    fallbackWhyRu: "Силовая подготовка укрепляет осанку и общую выносливость.",
    fallbackWhyEn: "Strength training improves posture and total endurance.",
  },
];

export function getDeterministicDailyQuests(dateStr: string): {
  core: QuestTemplate[];
  bonus: QuestTemplate[];
} {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = (hash << 5) - hash + dateStr.charCodeAt(i);
    hash |= 0;
  }
  const seed = Math.abs(hash);

  const pool = [...QUEST_POOL];
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

export function getStableTemplateHash(dateStr: string, userSeed: string, templateId: string): number {
  const str = `${dateStr}:${userSeed}:${templateId}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 1000000) / 1000000;
}

export function getWeightedDailyQuests(
  dateStr: string,
  userSeed: string = "user_default",
  program?: AwakeningProgram | null
): {
  core: QuestTemplate[];
  bonus: QuestTemplate[];
} {
  if (!program) {
    return getDeterministicDailyQuests(dateStr);
  }

  // If dateStr matches user registration / creation date, use program.firstDayQuestIds for core quests
  if ((dateStr === userSeed || userSeed.startsWith(dateStr)) && program.firstDayQuestIds && program.firstDayQuestIds.length === 3) {
    const firstDayCore = program.firstDayQuestIds
      .map((id) => QUEST_POOL.find((q) => q.id === id))
      .filter((q): q is QuestTemplate => q != null);

    if (firstDayCore.length === 3) {
      const firstDayIds = new Set(program.firstDayQuestIds);
      const bonus = QUEST_POOL.filter((q) => !firstDayIds.has(q.id)).slice(0, 2);
      return { core: firstDayCore, bonus };
    }
  }

  const categoryWeights = program.questWeights?.categoryWeights || {};
  const templateWeights = program.questWeights?.templateWeights || {};

  const scored = QUEST_POOL.map((tmpl) => {
    const catW = categoryWeights[tmpl.category] ?? 1.0;
    const tmplW = templateWeights[tmpl.id] ?? 1.0;
    const totalWeight = catW * tmplW;

    if (totalWeight <= 0) {
      return { tmpl, score: -1 };
    }

    const hashVal = getStableTemplateHash(dateStr, userSeed, tmpl.id);
    const score = (hashVal + 0.00001) * totalWeight;
    return { tmpl, score };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const core: QuestTemplate[] = [];
  const usedCategories = new Set<string>();

  for (const item of scored) {
    if (core.length >= 3) break;
    if (!usedCategories.has(item.tmpl.category)) {
      core.push(item.tmpl);
      usedCategories.add(item.tmpl.category);
    }
  }

  for (const item of scored) {
    if (core.length >= 3) break;
    if (!core.some((c) => c.id === item.tmpl.id)) {
      core.push(item.tmpl);
    }
  }

  const bonus: QuestTemplate[] = [];
  const coreIds = new Set(core.map((c) => c.id));

  for (const item of scored) {
    if (bonus.length >= 2) break;
    if (!coreIds.has(item.tmpl.id)) {
      bonus.push(item.tmpl);
    }
  }

  return { core, bonus };
}
