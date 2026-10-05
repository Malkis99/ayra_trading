"use client";

import React from "react";
import { useApp } from "@/lib/context";
import { formatString } from "@/lib/i18n";

export default function PlansPage() {
  const { userPlan, setUserPlan, showToast, dict } = useApp();

  const plansList = [
    {
      name: "Free" as const,
      price: dict.plans.free.price,
      desc: dict.plans.free.desc,
      features: [
        dict.plans.free.f1,
        dict.plans.free.f2,
        dict.plans.free.f3,
        dict.plans.free.f4,
      ],
      color: "text-mu",
      borderColor: "border-line",
    },
    {
      name: "Pro" as const,
      price: dict.plans.pro.price,
      desc: dict.plans.pro.desc,
      features: [
        dict.plans.pro.f1,
        dict.plans.pro.f2,
        dict.plans.pro.f3,
        dict.plans.pro.f4,
      ],
      color: "text-vi",
      borderColor: "border-vi",
    },
    {
      name: "Elite" as const,
      price: dict.plans.elite.price,
      desc: dict.plans.elite.desc,
      features: [
        dict.plans.elite.f1,
        dict.plans.elite.f2,
        dict.plans.elite.f3,
        dict.plans.elite.f4,
      ],
      color: "text-go",
      borderColor: "border-go",
    },
  ];

  const handleSelectPlan = (planName: "Free" | "Pro" | "Elite") => {
    setUserPlan(planName);
    showToast(formatString(dict.plans.selectedToast, { name: planName }));
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="text-center">
        <h1 className="font-serif text-3xl font-bold text-tx">{dict.plans.title}</h1>
        <p className="text-xs text-mu mt-2 max-w-md mx-auto">
          {dict.plans.subtitle}
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
                    {dict.plans.currentPlan}
                  </div>
                ) : (
                  <button
                    onClick={() => handleSelectPlan(p.name)}
                    className="btn w-full text-xs"
                  >
                    {formatString(dict.plans.selectPlan, { name: p.name })}
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
