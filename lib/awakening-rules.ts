import { QuestCategory } from "./quests";

export interface ProgramDraft {
  startingPath: "structure" | "discipline" | "mind" | "analysis";
  categoryWeights: Record<QuestCategory, number>;
  templateWeights: Record<string, number>;
  firstDayQuestIds: string[];
  forcedFirstQuestId: string | null;
  focusStats: string[];
  weeklyGoalIds: string[];
  academyTopicIds: string[];
  maxCoreDurationMinutes: number;
  bonusCount: number;
  reasons: Record<string, string[]>;
}

export interface AwakeningRule {
  id: string;
  priority: number; // 1 = highest
  condition: (answers: Record<string, any>, minorMode: boolean) => boolean;
  effect: (draft: ProgramDraft, answers: Record<string, any>, minorMode: boolean) => void;
  descriptionRu: string;
  descriptionEn: string;
}

export function createInitialProgramDraft(): ProgramDraft {
  return {
    startingPath: "discipline",
    categoryWeights: {
      Trading: 1.0,
      Discipline: 1.0,
      Psychology: 1.0,
      Physical: 1.0,
      Mental: 1.0,
      Social: 0.8,
      Lifestyle: 1.0,
    },
    templateWeights: {},
    firstDayQuestIds: [],
    forcedFirstQuestId: null,
    focusStats: ["discipline", "trading"],
    weeklyGoalIds: ["wgoal_consistency_3d"],
    academyTopicIds: ["topic_discipline"],
    maxCoreDurationMinutes: 30,
    bonusCount: 1,
    reasons: {},
  };
}

export function addReasonToDraft(draft: ProgramDraft, targetKey: string, ruleId: string) {
  if (!draft.reasons[targetKey]) {
    draft.reasons[targetKey] = [];
  }
  if (!draft.reasons[targetKey].includes(ruleId)) {
    draft.reasons[targetKey].push(ruleId);
  }
}

export const AWAKENING_RULES_CATALOG: AwakeningRule[] = [
  // 1. Path Rules
  {
    id: "rule_problem_structure",
    priority: 1,
    condition: (ans) => ans.mainProblem === "no_system" || ans.mainProblem === "lack_of_time",
    effect: (draft) => {
      draft.startingPath = "structure";
      draft.categoryWeights.Discipline += 0.5;
      draft.categoryWeights.Lifestyle += 0.5;
      addReasonToDraft(draft, "startingPath", "rule_problem_structure");
    },
    descriptionRu: "Главная проблема — нехватка времени или отсутствие системы",
    descriptionEn: "Main challenge: lack of time or system",
  },
  {
    id: "rule_problem_discipline",
    priority: 1,
    condition: (ans) =>
      ans.mainProblem === "discipline" ||
      ans.mainProblem === "unstable_result" ||
      ans.mainProblem === "risk_mgmt",
    effect: (draft) => {
      draft.startingPath = "discipline";
      draft.categoryWeights.Discipline += 0.8;
      addReasonToDraft(draft, "startingPath", "rule_problem_discipline");
    },
    descriptionRu: "Главная проблема — дисциплина, нестабильность или риск",
    descriptionEn: "Main challenge: discipline, consistency, or risk",
  },
  {
    id: "rule_problem_emotions",
    priority: 1,
    condition: (ans) => ans.mainProblem === "emotions",
    effect: (draft) => {
      draft.startingPath = "mind";
      draft.categoryWeights.Psychology += 1.0;
      if (!draft.focusStats.includes("psychology")) {
        draft.focusStats[0] = "psychology";
      }
      if (!draft.academyTopicIds.includes("topic_psychology")) {
        draft.academyTopicIds.push("topic_psychology");
      }
      addReasonToDraft(draft, "startingPath", "rule_problem_emotions");
      addReasonToDraft(draft, "category_Psychology", "rule_problem_emotions");
    },
    descriptionRu: "Главная проблема — эмоции и тильт",
    descriptionEn: "Main challenge: emotions and tilt control",
  },
  {
    id: "rule_problem_analysis",
    priority: 1,
    condition: (ans) => ans.mainProblem === "market_analysis",
    effect: (draft) => {
      draft.startingPath = "analysis";
      draft.categoryWeights.Trading += 0.8;
      if (!draft.focusStats.includes("trading")) {
        draft.focusStats.push("trading");
      }
      addReasonToDraft(draft, "startingPath", "rule_problem_analysis");
    },
    descriptionRu: "Главная проблема — анализ рынка",
    descriptionEn: "Main challenge: market analysis",
  },

  // 2. Journal Rules
  {
    id: "rule_no_journal",
    priority: 2,
    condition: (ans) => ans.keepJournal === "no",
    effect: (draft) => {
      draft.forcedFirstQuestId = "q_tradelog";
      if (!draft.academyTopicIds.includes("topic_journal")) {
        draft.academyTopicIds.push("topic_journal");
      }
      addReasonToDraft(draft, "firstDayQuests", "rule_no_journal");
      addReasonToDraft(draft, "academyTopics", "rule_no_journal");
    },
    descriptionRu: "Не ведёт журнал сделок",
    descriptionEn: "Does not keep a trade journal",
  },
  {
    id: "rule_sometimes_journal",
    priority: 2,
    condition: (ans) => ans.keepJournal === "sometimes",
    effect: (draft) => {
      draft.templateWeights["q_tradelog"] = (draft.templateWeights["q_tradelog"] || 1.0) + 1.5;
      draft.categoryWeights.Discipline += 0.5;
      addReasonToDraft(draft, "quest_q_tradelog", "rule_sometimes_journal");
    },
    descriptionRu: "Журнал ведётся нерегулярно",
    descriptionEn: "Journal kept irregularly",
  },

  // 3. Strategy & Technical Rules
  {
    id: "rule_no_strategy",
    priority: 3,
    condition: (ans) => ans.readyStrategy === "no" || ans.readyStrategy === "in_progress",
    effect: (draft) => {
      if (!draft.academyTopicIds.includes("topic_market_structure")) {
        draft.academyTopicIds.push("topic_market_structure");
      }
      if (!draft.academyTopicIds.includes("topic_price_action")) {
        draft.academyTopicIds.push("topic_price_action");
      }
      if (!draft.weeklyGoalIds.includes("wgoal_3_entry_rules")) {
        draft.weeklyGoalIds.push("wgoal_3_entry_rules");
      }
      addReasonToDraft(draft, "academyTopics", "rule_no_strategy");
      addReasonToDraft(draft, "weeklyGoals", "rule_no_strategy");
    },
    descriptionRu: "Нет готовой стратегии",
    descriptionEn: "No ready trading strategy",
  },
  {
    id: "rule_problem_risk_mgmt",
    priority: 3,
    condition: (ans) => ans.mainProblem === "risk_mgmt",
    effect: (draft) => {
      draft.templateWeights["q_riskcheck"] = (draft.templateWeights["q_riskcheck"] || 1.0) + 2.0;
      if (!draft.academyTopicIds.includes("topic_risk_mgmt")) {
        draft.academyTopicIds.push("topic_risk_mgmt");
      }
      addReasonToDraft(draft, "quest_q_riskcheck", "rule_problem_risk_mgmt");
      addReasonToDraft(draft, "academyTopics", "rule_problem_risk_mgmt");
    },
    descriptionRu: "Проблема с риск-менеджментом",
    descriptionEn: "Risk management focus",
  },

  // 4. Time Budget Rules
  {
    id: "rule_short_dev_time",
    priority: 4,
    condition: (ans) => ans.devTime === "15m" || ans.devTime === "30m",
    effect: (draft) => {
      draft.maxCoreDurationMinutes = 15;
      draft.bonusCount = 0;
      addReasonToDraft(draft, "timeBudget", "rule_short_dev_time");
    },
    descriptionRu: "Время на развитие ≤ 30 минут",
    descriptionEn: "Development time ≤ 30 minutes",
  },
  {
    id: "rule_long_dev_time",
    priority: 4,
    condition: (ans) => ans.devTime === "60m" || ans.devTime === "90m_plus",
    effect: (draft) => {
      draft.maxCoreDurationMinutes = 30;
      draft.bonusCount = 2;
      addReasonToDraft(draft, "timeBudget", "rule_long_dev_time");
    },
    descriptionRu: "Время на развитие ≥ 60 минут",
    descriptionEn: "Development time ≥ 60 minutes",
  },

  // 5. Lifestyle & Activity Rules
  {
    id: "rule_busy_lifestyle",
    priority: 5,
    condition: (ans) =>
      Array.isArray(ans.lifestyleMode) &&
      (ans.lifestyleMode.includes("full_time_work") || ans.lifestyleMode.includes("study")),
    effect: (draft) => {
      draft.categoryWeights.Lifestyle += 0.4;
      addReasonToDraft(draft, "lifestyle", "rule_busy_lifestyle");
    },
    descriptionRu: "Занятость: работа или учёба",
    descriptionEn: "Lifestyle: full-time work or study",
  },
  {
    id: "rule_sports_active",
    priority: 5,
    condition: (ans) => Array.isArray(ans.sports) && ans.sports.length > 0,
    effect: (draft, ans) => {
      const sports: string[] = ans.sports || [];
      if (sports.includes("running")) draft.templateWeights["q_running"] = 2.5;
      if (sports.includes("swimming")) draft.templateWeights["q_swimming"] = 2.5;
      if (sports.includes("gym")) draft.templateWeights["q_gym"] = 2.5;
      if (sports.includes("walks")) draft.templateWeights["q_walk"] = 2.0;
      if (sports.includes("stretching")) draft.templateWeights["q_stretching"] = 2.0;
      draft.categoryWeights.Physical += 0.8;
      addReasonToDraft(draft, "category_Physical", "rule_sports_active");
    },
    descriptionRu: "Активные занятия спортом",
    descriptionEn: "Active sports routine",
  },
  {
    id: "rule_reading_active",
    priority: 5,
    condition: (ans) => ans.reading === "books" || ans.reading === "articles",
    effect: (draft) => {
      draft.templateWeights["q_read_pages"] = (draft.templateWeights["q_read_pages"] || 1.0) + 2.0;
      draft.categoryWeights.Mental += 0.5;
      addReasonToDraft(draft, "quest_q_read_pages", "rule_reading_active");
    },
    descriptionRu: "Чтение книг или статей",
    descriptionEn: "Reading books or articles",
  },
  {
    id: "rule_languages_active",
    priority: 5,
    condition: (ans) => Array.isArray(ans.languages) && ans.languages.length > 0,
    effect: (draft) => {
      draft.templateWeights["q_lang_10m"] = (draft.templateWeights["q_lang_10m"] || 1.0) + 2.0;
      draft.categoryWeights.Mental += 0.5;
      addReasonToDraft(draft, "quest_q_lang_10m", "rule_languages_active");
    },
    descriptionRu: "Изучение иностранных языков",
    descriptionEn: "Foreign language learning",
  },

  // 6. Experience & Goal Rules
  {
    id: "rule_short_analysis_time",
    priority: 6,
    condition: (ans) => ans.analysisTime === "up_to_15m",
    effect: (draft) => {
      if (!draft.weeklyGoalIds.includes("wgoal_analysis_routine_15m")) {
        draft.weeklyGoalIds.push("wgoal_analysis_routine_15m");
      }
      addReasonToDraft(draft, "weeklyGoals", "rule_short_analysis_time");
    },
    descriptionRu: "Время на анализ до 15 минут",
    descriptionEn: "Market analysis time up to 15 minutes",
  },
  {
    id: "rule_beginner_experience",
    priority: 6,
    condition: (ans) => ans.experience === "less_than_1",
    effect: (draft) => {
      if (!draft.academyTopicIds.includes("topic_basics")) {
        draft.academyTopicIds.push("topic_basics");
      }
      addReasonToDraft(draft, "academyTopics", "rule_beginner_experience");
    },
    descriptionRu: "Опыт в трейдинге меньше года",
    descriptionEn: "Trading experience under 1 year",
  },

  // 7. Safety / MinorMode
  {
    id: "rule_minor_mode",
    priority: 7,
    condition: (_ans, minorMode) => minorMode,
    effect: (draft) => {
      draft.weeklyGoalIds = draft.weeklyGoalIds.filter((id) => !id.includes("money") && !id.includes("capital"));
      addReasonToDraft(draft, "minorMode", "rule_minor_mode");
    },
    descriptionRu: "Безопасный режим (minorMode)",
    descriptionEn: "Minor mode active",
  },
];
