"use client";

import React, { useState } from "react";
import { TabHeader } from "@/components/TabHeader";
import { useApp } from "@/lib/context";

const tabs = ["Обзор", "Wardrobe", "Достижения", "Хроника", "Посты", "Статистика"];

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState(0);
  const { showToast } = useApp();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">Профиль персонажа</h1>
        <p className="text-xs text-mu mt-1">Персонаж, экипировка, достижения и статистика</p>
      </div>

      <TabHeader tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Character Stage Placeholder */}
        <div className="lg:col-span-5 card min-h-[400px] flex flex-col items-center justify-between p-6 bg-radial-gradient">
          <div className="flex w-full justify-between text-xs text-mu">
            <span className="chip">360° Drag-to-rotate</span>
            <span className="chip">10 slots</span>
          </div>

          <div className="my-8 flex flex-col items-center text-center">
            <div className="lvbadge mb-4">1</div>
            <h3 className="font-serif text-xl font-bold text-tx">TraderOne</h3>
            <p className="text-xs text-mu">Lv 1 · Новичок пути</p>
          </div>

          <div className="flex gap-2">
            <button onClick={() => showToast("Сброс поворота")} className="btn-ghost text-xs">
              ⟲ Сброс
            </button>
            <button onClick={() => showToast("Автоповорот 360°")} className="btn-ghost text-xs">
              360°
            </button>
            <button onClick={() => showToast("Переключение фона")} className="btn-ghost text-xs">
              Фон
            </button>
          </div>
        </div>

        {/* Tab Content Panel */}
        <div className="lg:col-span-7 card">
          <h4 className="h4">Вкладка: {tabs[activeTab]}</h4>
          <p className="text-xs text-mu">Раздел находиться в разработке (T4). Полный интерактивный 360° гардероб и логика экипировки будут реализованы в T4.</p>
          <div className="mt-4 h-48 rounded-xl bg-s2/50 border border-line border-dashed flex items-center justify-center text-xs text-mu">
            Детали {tabs[activeTab]}
          </div>
        </div>
      </div>
    </div>
  );
}
