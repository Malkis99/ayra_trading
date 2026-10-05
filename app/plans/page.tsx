"use client";

import React from "react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { Check } from "lucide-react";
import { formatString } from "@/lib/i18n";

export default function PlansPage() {
  const { dict, showToast } = useApp();
  const { gameState, setPlan } = useGame();

  const plans = [
    {
      id: "Free" as const,
      name: dict.plans.free.name,
      price: dict.plans.free.price,
      desc: dict.plans.free.desc,
      color: "#a09eb2",
      features: [
        dict.plans.free.f1,
        dict.plans.free.f2,
        dict.plans.free.f3,
        dict.plans.free.f4,
      ],
    },
    {
      id: "Pro" as const,
      name: dict.plans.pro.name,
      price: dict.plans.pro.price,
      desc: dict.plans.pro.desc,
      color: "#a38ad1",
      features: [
        dict.plans.pro.f1,
        dict.plans.pro.f2,
        dict.plans.pro.f3,
        dict.plans.pro.f4,
      ],
    },
    {
      id: "Elite" as const,
      name: dict.plans.elite.name,
      price: dict.plans.elite.price,
      desc: dict.plans.elite.desc,
      color: "#d6a94a",
      features: [
        dict.plans.elite.f1,
        dict.plans.elite.f2,
        dict.plans.elite.f3,
        dict.plans.elite.f4,
      ],
    },
  ];

  const handleSelectPlan = (planId: "Free" | "Pro" | "Elite") => {
    if (gameState.plan === planId) return;
    setPlan(planId);
    showToast(formatString(dict.plans.selectedToast, { name: planId }));
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="font-serif text-2xl font-bold text-tx md:text-3xl">
          {dict.plans.title}
        </h1>
        <p className="text-xs text-mu max-w-2xl mx-auto">
          {dict.plans.subtitle}
        </p>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = gameState.plan === p.id;
          return (
            <div
              key={p.id}
              className="card flex flex-col justify-between space-y-4"
              style={{
                borderColor: isCurrent ? p.color : "#2a2836",
              }}
            >
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <b
                    className="font-serif text-xl font-bold"
                    style={{ color: p.color }}
                  >
                    {p.name}
                  </b>
                  {isCurrent && (
                    <span className="chip text-[10px] font-semibold border-go text-go">
                      {dict.plans.currentPlan}
                    </span>
                  )}
                </div>

                <div className="text-2xl font-bold text-tx">{p.price}</div>
                <div className="text-xs text-mu">{p.desc}</div>

                <ul className="space-y-2 pt-2 border-t border-line text-xs text-mu">
                  {p.features.map((feat, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <Check
                        size={14}
                        className="text-vi flex-none mt-0.5"
                        style={{ color: p.color }}
                      />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-2">
                {isCurrent ? (
                  <button
                    disabled
                    className="w-full btn-ghost text-xs py-2 opacity-50 cursor-default"
                  >
                    {dict.plans.currentPlan}
                  </button>
                ) : (
                  <button
                    onClick={() => handleSelectPlan(p.id)}
                    className="w-full btn text-xs py-2"
                  >
                    {formatString(dict.plans.selectPlan, { name: p.name })}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Note footer */}
      <div className="text-center text-[11px] text-mu pt-4 border-t border-line">
        * {dict.plans.subtitle}
      </div>
    </div>
  );
}
