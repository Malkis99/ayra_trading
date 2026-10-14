"use client";

import React from "react";
import {
  Award,
  Bitcoin,
  BookOpen,
  BookX,
  Briefcase,
  CandlestickChart,
  Check,
  CircleDashed,
  Clock,
  Compass,
  DollarSign,
  Dumbbell,
  Flame,
  Footprints,
  Gem,
  GraduationCap,
  HeartPulse,
  Hourglass,
  Layers,
  LineChart,
  Moon,
  Mountain,
  Newspaper,
  Rocket,
  Search,
  Shapes,
  Shield,
  Sparkles,
  Sprout,
  Sun,
  Sunrise,
  Target,
  Timer,
  TrendingUp,
  User,
  Waves,
  Zap,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/components/ui/cn";

type Icon = LucideIcon;

const OPTION_ICONS: Record<string, Icon> = {
  "markets.forex": DollarSign,
  "markets.indices": LineChart,
  "markets.metals": Gem,
  "markets.energy": Flame,
  "markets.stocks": CandlestickChart,
  "markets.crypto": Bitcoin,
  "markets.other": Shapes,
  "mainProblem.discipline": Target,
  "mainProblem.emotions": HeartPulse,
  "mainProblem.risk_mgmt": Shield,
  "mainProblem.no_system": Layers,
  "mainProblem.unstable_result": Activity,
  "mainProblem.market_analysis": Search,
  "mainProblem.lack_of_time": Clock,
  "tradingStyle.scalping": Zap,
  "tradingStyle.daytrading": Sun,
  "tradingStyle.swing": Waves,
  "tradingStyle.positional": Mountain,
  "tradingStyle.undecided": Compass,
  "readyStrategy.yes": Check,
  "readyStrategy.in_progress": Hourglass,
  "readyStrategy.no": CircleDashed,
  "keepJournal.yes": BookOpen,
  "keepJournal.sometimes": Hourglass,
  "keepJournal.no": CircleDashed,
  "reading.books": BookOpen,
  "reading.articles": Newspaper,
  "reading.dont_read": BookX,
  "lifestyleMode.full_time_work": Briefcase,
  "lifestyleMode.study": GraduationCap,
  "lifestyleMode.pro_trader": Rocket,
  "lifestyleMode.just_starting": Sprout,
  "lifestyleMode.other": Shapes,
  "freeTime.morning": Sunrise,
  "freeTime.afternoon": Sun,
  "freeTime.evening": Moon,
  "sports.gym": Dumbbell,
  "sports.running": Footprints,
  "sports.walks": Footprints,
};

const QUESTION_ICONS: Record<string, Icon> = {
  ageRange: User,
  experience: TrendingUp,
  analysisTime: Timer,
  devTime: Timer,
  skills3m: Award,
  tradingGoal: Target,
  joinReason: Sparkles,
  obstacles: Shield,
};

export function optionIcon(questionId: string, optionId: string): Icon {
  return OPTION_ICONS[`${questionId}.${optionId}`] ?? QUESTION_ICONS[questionId] ?? Sparkles;
}

type Props = {
  label: string;
  description?: string;
  icon: Icon;
  selected: boolean;
  multi?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

/** Large answer card: icon, title, optional description and a clear selected state with a check. */
export function AnswerCard({ label, description, icon: IconCmp, selected, multi, disabled, onClick }: Props) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group relative flex min-h-[64px] w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
        "disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-vi bg-gradient-to-r from-pri/45 to-vi/10 shadow-[0_0_0_1px_rgb(var(--c-vi)/0.6),0_8px_24px_-12px_rgb(var(--c-vi)/0.6)]"
          : "border-edge bg-field hover:-translate-y-px hover:border-vi/60 hover:bg-s2"
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-lg border transition-colors",
          selected ? "border-vi/60 bg-vi/20 text-tx" : "border-line bg-s2 text-vi group-hover:text-tx"
        )}
        aria-hidden="true"
      >
        <IconCmp size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold leading-snug text-tx">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] leading-snug text-mu">{description}</span>}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center border transition-colors",
          multi ? "rounded-md" : "rounded-full",
          selected ? "border-vi bg-vi text-ink" : "border-edge bg-transparent text-transparent"
        )}
      >
        <Check size={14} strokeWidth={3} />
      </span>
    </button>
  );
}

