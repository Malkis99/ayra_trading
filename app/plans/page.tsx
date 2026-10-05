"use client";

import React from "react";
import { useApp } from "@/lib/context";

const plansList = [
  {
    name: "Free",
    price: "$0",
    desc: "Для старта и ознакомления",
    features: [
      "Журнал сделок с лимитами",
      "Квесты, XP и базовый персонаж",
      "Overview и Calendar (базовые)",
      "Weekly Review без AI",
    ],
    color: "text-mu",
    borderColor: "border-line",
  },
  {
    name: "Pro",
    price: "$9 / мес",
    desc: "Для регулярной торговли",
    features: [
      "Расширенные отчёты и Trade DNA",
      "AI Weekly Review и News Intelligence",
      "Scanner с лимитом правил",
      "Больше счетов и импортов",
    ],
    color: "text-vi",
    borderColor: "border-vi",
  },
  {
    name: "Elite",
    price: "$19 / мес",
    desc: "Максимум аналитики и инструментария",
    features: [
      "Все AI-ассистенты без ограничений",
      "Scanner без лимитов",
      "Prop Rules Tracker с алертами",
      "Эксклюзивная косметика и ранний доступ",
    ],
    color: "text-go",
    borderColor: "border-go",
  },
];

export default function PlansPage() {
  const { userPlan, setUserPlan, showToast } = useApp();

  const handleSelectPlan = (planName: "Free" | "Pro" | "Elite") => {
    setUserPlan(planName);
    showToast(`Выбран тариф ${planName} (демо, без оплаты)`);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="text-center">
        <h1 className="font-serif text-3xl font-bold text-tx">Тарифные планы</h1>
        <p className="text-xs text-mu mt-2 max-w-md mx-auto">
          Подписка расширяет аналитические инструменты и косметику. На XP, рейтинг и репутацию она не влияет. Цены демонстрационные.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {plansList.map((p) => {
          const isCurrent = userPlan === p.name;
          return (
            <div
              key={p.name}
              className={`card flex flex-col justify-between border ${p.borderColor}`}
            >
              <div>
                <div className={`font-serif text-2xl font-bold ${p.color}`}>{p.name}</div>
                <div className="mt-1 text-xl font-bold text-tx">{p.price}</div>
                <div className="text-xs text-mu mt-1">{p.desc}</div>

                <hr className="my-4 border-line" />

                <ul className="space-y-2 text-xs text-mu">
                  {p.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-vi">•</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-6">
                {isCurrent ? (
                  <div className="chip w-full justify-center py-2 text-center font-semibold">
                    Текущий тариф
                  </div>
                ) : (
                  <button
                    onClick={() => handleSelectPlan(p.name as "Free" | "Pro" | "Elite")}
                    className="btn w-full text-xs"
                  >
                    Выбрать {p.name}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
