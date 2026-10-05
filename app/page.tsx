"use client";

import React from "react";
import Link from "next/link";
import { useApp } from "@/lib/context";
import { Plus, CheckSquare, BarChart2, Zap } from "lucide-react";

export default function HomePage() {
  const { setAddModalOpen, showToast, userPlan } = useApp();

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="card bg-gradient-to-r from-s1 via-[#1c1b28] to-s1">
        <div className="text-xs text-mu">Добрый день</div>
        <h1 className="font-serif text-2xl font-bold text-tx md:text-3xl mt-1">
          TraderOne, твой путь продолжается
        </h1>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="chip">Задания: 0/3</span>
          <span className="chip">Lv 1 · 0/120 XP</span>
          <span className="chip">Coins: 0</span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2.5">
          <button
            onClick={() => setAddModalOpen(true)}
            className="btn text-xs py-2 px-3.5 flex items-center gap-1.5"
          >
            <Plus size={15} />
            <span>Добавить сделку</span>
          </button>
          <Link href="/quests" className="btn-ghost text-xs flex items-center gap-1.5">
            <CheckSquare size={15} />
            <span>К заданиям</span>
          </Link>
          <Link href="/market" className="btn-ghost text-xs flex items-center gap-1.5">
            <BarChart2 size={15} />
            <span>Рынок сегодня</span>
          </Link>
        </div>
      </div>

      {/* Grid Layout for Dashboard Cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left Column */}
        <div className="space-y-4 lg:col-span-7">
          {/* Daily Quests */}
          <div className="card space-y-3">
            <h4 className="h4">Задания дня</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-line bg-s2/60 p-3 text-xs">
                <span>Daily Bias перед сессией</span>
                <span className="text-mu">+40 XP · Trading</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-line bg-s2/60 p-3 text-xs">
                <span>Запись сделки в журнал</span>
                <span className="text-mu">+40 XP · Discipline</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-line bg-s2/60 p-3 text-xs">
                <span>10 минут рефлексии</span>
                <span className="text-mu">+40 XP · Psychology</span>
              </div>
            </div>

            <div className="pt-2">
              <div className="flex justify-between text-xs text-mu mb-1.5">
                <span>Испытание недели: 10 заданий</span>
                <span>0 из 10</span>
              </div>
              <div className="xp">
                <i className="bg-gradient-to-r from-pri to-vi" style={{ width: "0%" }} />
              </div>
            </div>
          </div>

          {/* 7-Day Reward */}
          <div className="card space-y-3">
            <h4 className="h4">Ежедневная награда</h4>
            <div className="grid grid-cols-7 gap-1.5 text-center text-[10px]">
              {[10, 10, 15, 15, 20, 25, 50].map((coins, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg border p-2 ${
                    idx === 0 ? "border-go bg-go/10 text-go font-bold" : "border-line text-mu"
                  }`}
                >
                  <div>День {idx + 1}</div>
                  <b className="block text-xs mt-0.5">{coins}</b>
                </div>
              ))}
            </div>
            <button
              onClick={() => showToast("Забрать награду (+10 Coins)")}
              className="btn w-full text-xs mt-2"
            >
              Забрать награду
            </button>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-4 lg:col-span-5">
          {/* Character Mini Card */}
          <div className="card text-center space-y-3">
            <h4 className="h4">Твой персонаж</h4>
            <div className="grid place-items-center h-40 rounded-xl bg-s2/40 border border-line border-dashed">
              <div className="lvbadge text-lg">1</div>
            </div>
            <div>
              <b className="text-sm text-tx">TraderOne</b>
              <div className="text-xs text-mu">Lv 1 · Resting</div>
            </div>
            <Link href="/profile" className="btn-ghost w-full text-xs block">
              Открыть профиль
            </Link>
          </div>

          {/* AI Brief */}
          <div className="card space-y-2">
            <h4 className="h4">AI-бриф дня</h4>
            {userPlan === "Free" ? (
              <>
                <p className="text-xs text-mu">
                  Доступно в Pro и Elite: разбор событий дня и сценарии «если/то».
                </p>
                <Link href="/plans" className="text-xs font-semibold text-go hover:underline block pt-1">
                  Смотреть тарифы →
                </Link>
              </>
            ) : (
              <p className="text-xs text-mu">
                Демо: сегодня важны CPI и реакция доллара. Сценарии, не signals.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
