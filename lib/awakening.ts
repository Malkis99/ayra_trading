import { DEFAULT_AVATAR_APPEARANCE, AvatarAppearance } from "./avatar";

export type OnboardingStatus = "none" | "inProgress" | "done" | "legacy";

export interface OnboardingState {
  status: OnboardingStatus;
  step: number; // 1..5
  subStep: number; // 0..N
  answers: Record<string, any>;
  startedAt?: string;
  finishedAt?: string;
  legacyDismissed?: boolean;
}

export const INITIAL_ONBOARDING_STATE: OnboardingState = {
  status: "none",
  step: 1,
  subStep: 0,
  answers: {
    nickname: "",
    language: "ru",
    timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC",
    appearance: { ...DEFAULT_AVATAR_APPEARANCE },
    ageRange: "",
  },
};

export interface QuestionOption {
  id: string;
  labelKey: string;
  minorSafe: boolean;
}

export interface QuestionDefinition {
  id: string;
  step: number;
  subStep: number;
  titleKey: string;
  explanationKey: string;
  mandatory: boolean;
  type: "single" | "multi" | "text" | "custom_select" | "custom_multi" | "custom_component";
  options?: QuestionOption[];
  maxLength?: number;
}

export const AGE_RANGES: QuestionOption[] = [
  { id: "16-17", labelKey: "awakening.age.16_17", minorSafe: true },
  { id: "18-24", labelKey: "awakening.age.18_24", minorSafe: true },
  { id: "25-34", labelKey: "awakening.age.25_34", minorSafe: true },
  { id: "35+", labelKey: "awakening.age.35_plus", minorSafe: true },
];

export const EXPERIENCE_OPTIONS: QuestionOption[] = [
  { id: "less_than_1", labelKey: "awakening.exp.less_than_1", minorSafe: true },
  { id: "1_2_years", labelKey: "awakening.exp.1_2_years", minorSafe: true },
  { id: "3_5_years", labelKey: "awakening.exp.3_5_years", minorSafe: true },
  { id: "more_than_5", labelKey: "awakening.exp.more_than_5", minorSafe: true },
];

export const MARKETS_OPTIONS: QuestionOption[] = [
  { id: "forex", labelKey: "awakening.markets.forex", minorSafe: true },
  { id: "indices", labelKey: "awakening.markets.indices", minorSafe: true },
  { id: "metals", labelKey: "awakening.markets.metals", minorSafe: true },
  { id: "energy", labelKey: "awakening.markets.energy", minorSafe: true },
  { id: "stocks", labelKey: "awakening.markets.stocks", minorSafe: true },
  { id: "crypto", labelKey: "awakening.markets.crypto", minorSafe: true },
  { id: "other", labelKey: "awakening.markets.other", minorSafe: true },
];

export const MAIN_PROBLEM_OPTIONS: QuestionOption[] = [
  { id: "discipline", labelKey: "awakening.problem.discipline", minorSafe: true },
  { id: "emotions", labelKey: "awakening.problem.emotions", minorSafe: true },
  { id: "risk_mgmt", labelKey: "awakening.problem.risk_mgmt", minorSafe: true },
  { id: "no_system", labelKey: "awakening.problem.no_system", minorSafe: true },
  { id: "unstable_result", labelKey: "awakening.problem.unstable_result", minorSafe: true },
  { id: "market_analysis", labelKey: "awakening.problem.market_analysis", minorSafe: true },
  { id: "lack_of_time", labelKey: "awakening.problem.lack_of_time", minorSafe: true },
];

export const TRADING_STYLE_OPTIONS: QuestionOption[] = [
  { id: "scalping", labelKey: "awakening.style.scalping", minorSafe: true },
  { id: "daytrading", labelKey: "awakening.style.daytrading", minorSafe: true },
  { id: "swing", labelKey: "awakening.style.swing", minorSafe: true },
  { id: "positional", labelKey: "awakening.style.positional", minorSafe: true },
  { id: "undecided", labelKey: "awakening.style.undecided", minorSafe: true },
];

export const READY_STRATEGY_OPTIONS: QuestionOption[] = [
  { id: "yes", labelKey: "awakening.strategy.yes", minorSafe: true },
  { id: "in_progress", labelKey: "awakening.strategy.in_progress", minorSafe: true },
  { id: "no", labelKey: "awakening.strategy.no", minorSafe: true },
];

export const KEEP_JOURNAL_OPTIONS: QuestionOption[] = [
  { id: "yes", labelKey: "awakening.journal.yes", minorSafe: true },
  { id: "sometimes", labelKey: "awakening.journal.sometimes", minorSafe: true },
  { id: "no", labelKey: "awakening.journal.no", minorSafe: true },
];

export const TIME_FOR_ANALYSIS_OPTIONS: QuestionOption[] = [
  { id: "up_to_15m", labelKey: "awakening.analysis_time.up_to_15m", minorSafe: true },
  { id: "15_60m", labelKey: "awakening.analysis_time.15_60m", minorSafe: true },
  { id: "1_2h", labelKey: "awakening.analysis_time.1_2h", minorSafe: true },
  { id: "more_than_2h", labelKey: "awakening.analysis_time.more_than_2h", minorSafe: true },
];

export const LIFESTYLE_MODE_OPTIONS: QuestionOption[] = [
  { id: "full_time_work", labelKey: "awakening.lifestyle_mode.full_time_work", minorSafe: true },
  { id: "study", labelKey: "awakening.lifestyle_mode.study", minorSafe: true },
  { id: "pro_trader", labelKey: "awakening.lifestyle_mode.pro_trader", minorSafe: true },
  { id: "just_starting", labelKey: "awakening.lifestyle_mode.just_starting", minorSafe: true },
  { id: "other", labelKey: "awakening.lifestyle_mode.other", minorSafe: true },
];

export const DEV_TIME_OPTIONS: QuestionOption[] = [
  { id: "15m", labelKey: "awakening.dev_time.15m", minorSafe: true },
  { id: "30m", labelKey: "awakening.dev_time.30m", minorSafe: true },
  { id: "60m", labelKey: "awakening.dev_time.60m", minorSafe: true },
  { id: "90m_plus", labelKey: "awakening.dev_time.90m_plus", minorSafe: true },
];

export const FREE_TIME_OPTIONS: QuestionOption[] = [
  { id: "morning", labelKey: "awakening.free_time.morning", minorSafe: true },
  { id: "afternoon", labelKey: "awakening.free_time.afternoon", minorSafe: true },
  { id: "evening", labelKey: "awakening.free_time.evening", minorSafe: true },
];

export const READING_OPTIONS: QuestionOption[] = [
  { id: "books", labelKey: "awakening.reading.books", minorSafe: true },
  { id: "articles", labelKey: "awakening.reading.articles", minorSafe: true },
  { id: "dont_read", labelKey: "awakening.reading.dont_read", minorSafe: true },
];

export const SPORTS_OPTIONS: QuestionOption[] = [
  { id: "gym", labelKey: "awakening.sports.gym", minorSafe: true },
  { id: "running", labelKey: "awakening.sports.running", minorSafe: true },
  { id: "walks", labelKey: "awakening.sports.walks", minorSafe: true },
  { id: "stretching", labelKey: "awakening.sports.stretching", minorSafe: true },
  { id: "swimming", labelKey: "awakening.sports.swimming", minorSafe: true },
  { id: "team_games", labelKey: "awakening.sports.team_games", minorSafe: true },
];

export const TRADING_GOAL_OPTIONS: QuestionOption[] = [
  { id: "master_discipline", labelKey: "awakening.goal.master_discipline", minorSafe: true },
  { id: "market_understanding", labelKey: "awakening.goal.market_understanding", minorSafe: true },
  { id: "systematic_approach", labelKey: "awakening.goal.systematic_approach", minorSafe: true },
  { id: "emotional_control", labelKey: "awakening.goal.emotional_control", minorSafe: true },
  { id: "stable_income", labelKey: "awakening.goal.stable_income", minorSafe: false },
  { id: "financial_independence", labelKey: "awakening.goal.financial_independence", minorSafe: false },
];

export const JOIN_REASON_OPTIONS: QuestionOption[] = [
  { id: "structure_habits", labelKey: "awakening.join_reason.structure_habits", minorSafe: true },
  { id: "improve_discipline", labelKey: "awakening.join_reason.improve_discipline", minorSafe: true },
  { id: "track_progress", labelKey: "awakening.join_reason.track_progress", minorSafe: true },
  { id: "find_community", labelKey: "awakening.join_reason.find_community", minorSafe: true },
  { id: "increase_capital", labelKey: "awakening.join_reason.increase_capital", minorSafe: false },
];

export const SKILLS_3M_OPTIONS: QuestionOption[] = [
  { id: "risk_management", labelKey: "awakening.skills3m.risk_management", minorSafe: true },
  { id: "journaling", labelKey: "awakening.skills3m.journaling", minorSafe: true },
  { id: "chart_analysis", labelKey: "awakening.skills3m.chart_analysis", minorSafe: true },
  { id: "emotional_stability", labelKey: "awakening.skills3m.emotional_stability", minorSafe: true },
  { id: "plan_compliance", labelKey: "awakening.skills3m.plan_compliance", minorSafe: true },
];

export const OBSTACLES_OPTIONS: QuestionOption[] = [
  { id: "lack_of_time", labelKey: "awakening.obstacles.lack_of_time", minorSafe: true },
  { id: "emotions_fomo", labelKey: "awakening.obstacles.emotions_fomo", minorSafe: true },
  { id: "no_clear_plan", labelKey: "awakening.obstacles.no_clear_plan", minorSafe: true },
  { id: "inconsistency", labelKey: "awakening.obstacles.inconsistency", minorSafe: true },
  { id: "small_deposit", labelKey: "awakening.obstacles.small_deposit", minorSafe: false },
];

export const QUESTIONS_CATALOG: QuestionDefinition[] = [
  // STEP 1: Персонаж
  {
    id: "nickname",
    step: 1,
    subStep: 0,
    titleKey: "awakening.q.nickname.title",
    explanationKey: "awakening.q.nickname.exp",
    mandatory: true,
    type: "text",
  },
  {
    id: "language_timezone",
    step: 1,
    subStep: 1,
    titleKey: "awakening.q.lang_tz.title",
    explanationKey: "awakening.q.lang_tz.exp",
    mandatory: true,
    type: "custom_component",
  },
  {
    id: "appearance",
    step: 1,
    subStep: 2,
    titleKey: "awakening.q.appearance.title",
    explanationKey: "awakening.q.appearance.exp",
    mandatory: false,
    type: "custom_component",
  },
  {
    id: "ageRange",
    step: 1,
    subStep: 3,
    titleKey: "awakening.q.age.title",
    explanationKey: "awakening.q.age.exp",
    mandatory: true,
    type: "single",
    options: AGE_RANGES,
  },

  // STEP 2: Интересы и образ жизни
  {
    id: "hobbies",
    step: 2,
    subStep: 0,
    titleKey: "awakening.q.hobbies.title",
    explanationKey: "awakening.q.hobbies.exp",
    mandatory: false,
    type: "custom_multi",
  },
  {
    id: "sports",
    step: 2,
    subStep: 1,
    titleKey: "awakening.q.sports.title",
    explanationKey: "awakening.q.sports.exp",
    mandatory: false,
    type: "custom_multi",
    options: SPORTS_OPTIONS,
  },
  {
    id: "reading",
    step: 2,
    subStep: 2,
    titleKey: "awakening.q.reading.title",
    explanationKey: "awakening.q.reading.exp",
    mandatory: false,
    type: "single",
    options: READING_OPTIONS,
  },
  {
    id: "languages",
    step: 2,
    subStep: 3,
    titleKey: "awakening.q.languages.title",
    explanationKey: "awakening.q.languages.exp",
    mandatory: false,
    type: "custom_multi",
  },
  {
    id: "skillsToDevelop",
    step: 2,
    subStep: 4,
    titleKey: "awakening.q.skills.title",
    explanationKey: "awakening.q.skills.exp",
    mandatory: false,
    type: "custom_multi",
  },
  {
    id: "lifestyleMode",
    step: 2,
    subStep: 5,
    titleKey: "awakening.q.lifestyle_mode.title",
    explanationKey: "awakening.q.lifestyle_mode.exp",
    mandatory: false,
    type: "multi",
    options: LIFESTYLE_MODE_OPTIONS,
  },
  {
    id: "devTime",
    step: 2,
    subStep: 6,
    titleKey: "awakening.q.dev_time.title",
    explanationKey: "awakening.q.dev_time.exp",
    mandatory: false,
    type: "single",
    options: DEV_TIME_OPTIONS,
  },
  {
    id: "freeTime",
    step: 2,
    subStep: 7,
    titleKey: "awakening.q.free_time.title",
    explanationKey: "awakening.q.free_time.exp",
    mandatory: false,
    type: "single",
    options: FREE_TIME_OPTIONS,
  },

  // STEP 3: Торговый профиль
  {
    id: "experience",
    step: 3,
    subStep: 0,
    titleKey: "awakening.q.experience.title",
    explanationKey: "awakening.q.experience.exp",
    mandatory: true,
    type: "single",
    options: EXPERIENCE_OPTIONS,
  },
  {
    id: "markets",
    step: 3,
    subStep: 1,
    titleKey: "awakening.q.markets.title",
    explanationKey: "awakening.q.markets.exp",
    mandatory: true,
    type: "multi",
    options: MARKETS_OPTIONS,
  },
  {
    id: "mainProblem",
    step: 3,
    subStep: 2,
    titleKey: "awakening.q.main_problem.title",
    explanationKey: "awakening.q.main_problem.exp",
    mandatory: true,
    type: "single",
    options: MAIN_PROBLEM_OPTIONS,
  },
  {
    id: "tradingStyle",
    step: 3,
    subStep: 3,
    titleKey: "awakening.q.trading_style.title",
    explanationKey: "awakening.q.trading_style.exp",
    mandatory: false,
    type: "single",
    options: TRADING_STYLE_OPTIONS,
  },
  {
    id: "readyStrategy",
    step: 3,
    subStep: 4,
    titleKey: "awakening.q.ready_strategy.title",
    explanationKey: "awakening.q.ready_strategy.exp",
    mandatory: false,
    type: "single",
    options: READY_STRATEGY_OPTIONS,
  },
  {
    id: "keepJournal",
    step: 3,
    subStep: 5,
    titleKey: "awakening.q.keep_journal.title",
    explanationKey: "awakening.q.keep_journal.exp",
    mandatory: false,
    type: "single",
    options: KEEP_JOURNAL_OPTIONS,
  },
  {
    id: "analysisTime",
    step: 3,
    subStep: 6,
    titleKey: "awakening.q.analysis_time.title",
    explanationKey: "awakening.q.analysis_time.exp",
    mandatory: false,
    type: "single",
    options: TIME_FOR_ANALYSIS_OPTIONS,
  },

  // STEP 4: Цели
  {
    id: "tradingGoal",
    step: 4,
    subStep: 0,
    titleKey: "awakening.q.trading_goal.title",
    explanationKey: "awakening.q.trading_goal.exp",
    mandatory: false,
    type: "custom_select",
    options: TRADING_GOAL_OPTIONS,
  },
  {
    id: "joinReason",
    step: 4,
    subStep: 1,
    titleKey: "awakening.q.join_reason.title",
    explanationKey: "awakening.q.join_reason.exp",
    mandatory: false,
    type: "custom_multi",
    options: JOIN_REASON_OPTIONS,
  },
  {
    id: "skills3m",
    step: 4,
    subStep: 2,
    titleKey: "awakening.q.skills3m.title",
    explanationKey: "awakening.q.skills3m.exp",
    mandatory: false,
    type: "multi",
    options: SKILLS_3M_OPTIONS,
  },
  {
    id: "vision1y",
    step: 4,
    subStep: 3,
    titleKey: "awakening.q.vision1y.title",
    explanationKey: "awakening.q.vision1y.exp",
    mandatory: false,
    type: "text",
    maxLength: 200,
  },
  {
    id: "obstacles",
    step: 4,
    subStep: 4,
    titleKey: "awakening.q.obstacles.title",
    explanationKey: "awakening.q.obstacles.exp",
    mandatory: false,
    type: "custom_multi",
    options: OBSTACLES_OPTIONS,
  },
  {
    id: "successVision",
    step: 4,
    subStep: 5,
    titleKey: "awakening.q.success_vision.title",
    explanationKey: "awakening.q.success_vision.exp",
    mandatory: false,
    type: "text",
    maxLength: 200,
  },
];

export function getQuestionsForStep(step: number): QuestionDefinition[] {
  return QUESTIONS_CATALOG.filter((q) => q.step === step);
}

export function getFilteredOptions(options: QuestionOption[] = [], minorMode: boolean): QuestionOption[] {
  if (!minorMode) return options;
  return options.filter((opt) => opt.minorSafe);
}

/**
 * Extension point for T5b: starter program generation stub.
 */
export function generateProgram(_answers: Record<string, any>): null {
  return null;
}
