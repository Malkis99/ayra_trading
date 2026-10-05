"use client";

import React, { useState } from "react";
import { TabHeader } from "@/components/TabHeader";

const tabs = ["Dashboard", "Trades", "Reports", "Trading Plan", "Strategies", "Accounts", "Notes"];

export default function JournalPage() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold text-tx">Journal</h1>
        <p className="text-xs text-mu mt-1">Торговый журнал, R-аналитика и структура процесса</p>
      </div>

      <TabHeader tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="card">
        <h4 className="h4">Вкладка: {tabs[activeTab]}</h4>
        <p className="text-xs text-mu">Раздел находиться в разработке (T6). Данные появятся после подключения локального стора и Supabase.</p>
        <div className="mt-4 h-32 rounded-xl bg-s2/50 border border-line border-dashed flex items-center justify-center text-xs text-mu">
          Пустое состояние / Графики и таблицы {tabs[activeTab]}
        </div>
      </div>
    </div>
  );
}
